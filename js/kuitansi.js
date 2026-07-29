// kuitansi.js — pembayaran, kuitansi, dan verifikasi QR.
//
// Soal QR: QR sendiri tidak mencegah pemalsuan — siapa pun bisa
// membuatnya. Yang mengamankan adalah halaman verifikasi yang
// membaca data asli dari database. Kertas bisa dipalsukan, isi
// database tidak. Karena itu tokennya acak, bukan nomor urut,
// supaya dokumen lain tidak bisa ditebak dari satu contoh.

import {
  dbase, collection, doc, getDoc, getDocs, query, orderBy, limit,
  writeBatch, updateDoc, serverTimestamp, nomorBerikutnya,
  sertakanLog, tandaBaru, catat,
} from "./db.js";
import { sesi, bolehAkses } from "./auth.js";
import { SHOWROOM, PAJAK, pecahHarga } from "./config.js";
import { sisipkanKas, lepaskanTertahan } from "./kas.js";
import {
  rupiah, terbilang, aman, kabar, tanggal, tanggalJam,
  pasangFormatUang, bacaAngka,
} from "./ui.js";

const JENIS = {
  tanda_jadi:   "Tanda jadi",
  dp:           "Uang muka (DP)",
  pelunasan:    "Pelunasan",
  pengembalian: "Pengembalian",
};

const SYARAT =
  "Tanda jadi dan uang muka mengikat pemesanan. Pembatalan sepihak " +
  "oleh pembeli dikenakan ketentuan yang disepakati pada SPK.";

function tokenAcak() {
  const huruf = "abcdefghijkmnpqrstuvwxyz23456789";
  const acak = new Uint8Array(12);
  crypto.getRandomValues(acak);
  return Array.from(acak, (a) => huruf[a % huruf.length]).join("");
}

function tautanCek(token) {
  return `${location.origin}${location.pathname}#/cek/${token}`;
}

function samarkan(nama) {
  return String(nama || "").split(" ").map((k, i) =>
    i === 0 ? k : (k[0] ? k[0] + "***" : "")).join(" ");
}

// ── QR ────────────────────────────────────────────────────────
let pustakaQR = null;
async function gambarQR(teks) {
  try {
    if (!pustakaQR) {
      pustakaQR = await import("https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm");
    }
    return await (pustakaQR.default || pustakaQR)
      .toDataURL(teks, { margin: 1, width: 240 });
  } catch (e) {
    return null; // tanpa koneksi, tautannya tetap dicetak sebagai teks
  }
}

// ── Terbitkan kuitansi ────────────────────────────────────────
async function terbitkan(trx, { jenis, nominal, metode }) {
  const nomor = await nomorBerikutnya(`kw_${new Date().getFullYear()}`, "KW");
  const token = tokenAcak();
  const pecah = pecahHarga(nominal, trx.tipeSnapshot?.mewah);
  const dibayar = Number(trx.totalDibayar || 0) + Number(nominal);
  const sisa = Math.max(0, Number(trx.hargaNet || 0) - dibayar);

  const ref = doc(collection(dbase, "kuitansi"));
  const batch = writeBatch(dbase);

  const isi = {
    nomor, token, jenis,
    trxId: trx.id, trxKode: trx.kode,
    tipeNama: trx.tipeSnapshot?.nama || "",
    warna: trx.warna || "",
    penerimaDari: trx.pelangganSnapshot?.nama || "",
    nik: trx.pelangganSnapshot?.nik || "",
    nominal: Number(nominal),
    terbilang: terbilang(nominal),
    dpp: pecah.dpp, ppn: pecah.ppn,
    metodeBayar: metode,
    hargaNet: trx.hargaNet || 0,
    dibayarSetelah: dibayar,
    sisaSetelah: sisa,
    syarat: SYARAT,
    penerbit: SHOWROOM.nama,
    kasirId: sesi.uid, kasirNama: sesi.nama,
    status: "aktif",
    tanggal: serverTimestamp(),
    ...tandaBaru(),
  };
  batch.set(ref, isi);

  // Dokumen verifikasi publik. Isinya sengaja minimal — halaman ini
  // bisa dibuka siapa pun yang memegang tautannya.
  batch.set(doc(dbase, "verifikasi", token), {
    nomor, jenis,
    nominal: Number(nominal),
    tipeNama: isi.tipeNama,
    nama: samarkan(isi.penerimaDari),
    penerbit: SHOWROOM.nama,
    status: "aktif",
    tanggal: serverTimestamp(),
  });

  sisipkanKas(batch, {
    kategori: jenis === "pelunasan" ? "pelunasan" : jenis,
    nominal, metode,
    keterangan: `${nomor} · ${trx.kode} · ${isi.penerimaDari}`,
    refType: "kuitansi", refId: ref.id,
  });

  batch.update(doc(dbase, "transaksi", trx.id), {
    totalDibayar: dibayar,
    sisa,
    statusBayar: sisa === 0 ? "lunas" : "sebagian",
  });

  sertakanLog(batch, "kuitansi_terbit", {
    koleksi: "kuitansi", docId: ref.id,
    ringkas: `${nomor} · ${JENIS[jenis]} · ${rupiah(nominal)}`,
  });

  await batch.commit();
  return { id: ref.id, ...isi, tanggal: new Date() };
}

// ── Tampilan kuitansi ─────────────────────────────────────────
async function tampilkan(k, wadah) {
  const tautan = tautanCek(k.token);
  const qr = await gambarQR(tautan);
  wadah.innerHTML = `<div class="kuitansi" id="lembar-kuitansi">
    <div class="kuitansi-kop">
      <div>
        <p class="kuitansi-pt">${aman(SHOWROOM.nama)}</p>
        <p class="kuitansi-kecil">${aman(SHOWROOM.alamat || "")}
          ${SHOWROOM.npwp ? " · NPWP " + aman(SHOWROOM.npwp) : ""}</p>
      </div>
      <div class="kuitansi-nomor mono">${aman(k.nomor)}</div>
    </div>

    <p class="kuitansi-jenis">${aman(JENIS[k.jenis])}</p>
    ${k.jenis === "dp" || k.jenis === "tanda_jadi"
      ? `<p class="kuitansi-tegas">UANG MUKA — BUKAN PELUNASAN</p>` : ""}

    <dl class="rinci">
      <div><dt>Terima dari</dt><dd>${aman(k.penerimaDari)}</dd></div>
      ${k.nik ? `<div><dt>NIK</dt><dd class="mono">${aman(k.nik)}</dd></div>` : ""}
      <div><dt>Untuk</dt><dd>${aman(k.tipeNama)} ${aman(k.warna)}</dd></div>
      <div><dt>SPK</dt><dd class="mono">${aman(k.trxKode)}</dd></div>
      <div><dt>Cara bayar</dt><dd>${aman(k.metodeBayar)}</dd></div>
    </dl>

    <p class="kuitansi-nominal mono">${rupiah(k.nominal)}</p>
    <p class="kuitansi-terbilang">${aman(k.terbilang)}</p>

    <dl class="rinci">
      <div><dt>Harga</dt><dd class="mono">${rupiah(k.hargaNet)}</dd></div>
      <div><dt>Sudah dibayar</dt><dd class="mono">${rupiah(k.dibayarSetelah)}</dd></div>
      <div><dt>Sisa</dt><dd class="mono">${rupiah(k.sisaSetelah)}</dd></div>
      ${PAJAK.pkp ? `<div><dt>DPP / PPN</dt>
        <dd class="mono">${rupiah(k.dpp)} / ${rupiah(k.ppn)}</dd></div>` : ""}
    </dl>

    <div class="kuitansi-kaki">
      <div class="kuitansi-qr">
        ${qr ? `<img src="${qr}" alt="QR validasi" width="120" height="120">`
             : `<p class="kuitansi-kecil">${aman(tautan)}</p>`}
        <p class="kuitansi-kecil">Pindai untuk memastikan keaslian</p>
      </div>
      <div class="kuitansi-ttd">
        <p class="kuitansi-kecil">${tanggalJam(k.tanggal)}</p>
        <p class="kuitansi-garis">${aman(k.kasirNama)}</p>
      </div>
    </div>

    <p class="kuitansi-syarat">${aman(k.syarat)}</p>
  </div>

  <div class="aksi aksi--rapat">
    <button class="tombol tombol--utama" id="cetak-kuitansi">Cetak</button>
    <button class="tombol tombol--kecil tombol--isi" id="wa-kuitansi">
      Kirim WhatsApp
    </button>
  </div>
  <button class="tautan-batal" id="tutup-kuitansi">Tutup</button>`;

  wadah.querySelector("#cetak-kuitansi")
    .addEventListener("click", () => window.print());
  wadah.querySelector("#tutup-kuitansi")
    .addEventListener("click", () => (wadah.innerHTML = ""));
  wadah.querySelector("#wa-kuitansi").addEventListener("click", async () => {
    const pesan =
      `Terima kasih, ${k.penerimaDari}.%0A` +
      `Kuitansi ${k.nomor} — ${JENIS[k.jenis]} ${rupiah(k.nominal)}%0A` +
      `${k.tipeNama} ${k.warna}%0ASisa ${rupiah(k.sisaSetelah)}%0A%0A` +
      `Cek keaslian: ${tautan}%0A${SHOWROOM.nama}`;
    await catat("kuitansi_dikirim", { koleksi: "kuitansi", docId: k.id });
    window.open(`https://wa.me/?text=${pesan}`, "_blank");
  });
  wadah.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Halaman tagihan ───────────────────────────────────────────
export async function halamanTagihan(wadah) {
  const bisaTerima = bolehAkses("kas.input");

  wadah.innerHTML = `<section class="lembar">
    <h2 class="judul">Tagihan</h2>
    <div id="wadah-bayar"></div>
    <div id="daftar-tagihan" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-tagihan");
  const bayarEl = wadah.querySelector("#wadah-bayar");

  async function gambar() {
    const snap = await getDocs(query(
      collection(dbase, "transaksi"), orderBy("dibuatPada", "desc"), limit(60)
    ));
    const isi = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => t.statusBayar !== "lunas" &&
                     !["batal", "reject"].includes(t.statusSPK));
    daftarEl.innerHTML = isi.length
      ? isi.map((t) => `<article class="kartu">
          <div class="kartu-atas">
            <div>
              <h3 class="kartu-judul mono">${aman(t.kode)}</h3>
              <p class="kartu-sub">${aman(t.pelangganSnapshot?.nama || "-")}</p>
            </div>
            <span class="tanda tanda--${t.statusBayar}">
              ${t.statusBayar === "sebagian" ? "Sebagian" : "Belum bayar"}
            </span>
          </div>
          <p class="kartu-rinci">${aman(t.tipeSnapshot?.nama || "")}</p>
          <div class="ringkas-baris"><span>Sisa</span>
            <b class="mono">${rupiah(t.sisa)}</b></div>
          ${bisaTerima ? `<div class="aksi aksi--rapat">
            <button class="tombol tombol--kecil tombol--isi"
                    data-bayar="${t.id}">Terima pembayaran</button></div>` : ""}
        </article>`).join("")
      : `<div class="hampa"><p>Tidak ada tagihan terbuka.</p></div>`;

    daftarEl.querySelectorAll("[data-bayar]").forEach((b) =>
      b.addEventListener("click", () => bukaBayar(b.dataset.bayar)));
  }

  async function bukaBayar(id) {
    const snap = await getDoc(doc(dbase, "transaksi", id));
    if (!snap.exists()) return;
    const trx = { id, ...snap.data() };
    const pertama = Number(trx.totalDibayar || 0) === 0;

    bayarEl.innerHTML = `<form class="form" id="f-bayar">
      <p class="pemisah">${aman(trx.kode)} · sisa ${rupiah(trx.sisa)}</p>
      <label class="label label--gelap" for="b-jenis">Jenis pembayaran</label>
      <select class="isian isian--terang" id="b-jenis">
        ${pertama ? `<option value="tanda_jadi">Tanda jadi</option>` : ""}
        <option value="dp" ${pertama ? "" : "selected"}>Uang muka (DP)</option>
        <option value="pelunasan">Pelunasan</option>
      </select>
      <label class="label label--gelap" for="b-nominal">Nominal diterima</label>
      <input class="isian isian--terang" id="b-nominal" inputmode="numeric">
      <label class="label label--gelap" for="b-metode">Cara bayar</label>
      <select class="isian isian--terang" id="b-metode">
        <option value="tunai">Tunai</option>
        <option value="transfer">Transfer</option>
      </select>
      <p class="petunjuk">Uang muka tercatat sebagai kewajiban, belum
        jadi pendapatan sampai unit diserahkan.</p>
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">
          Terima &amp; cetak kuitansi
        </button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-bayar">Batal</button>
      </div>
    </form>`;

    pasangFormatUang(bayarEl.querySelector("#b-nominal"));
    bayarEl.querySelector("#batal-bayar")
      .addEventListener("click", () => (bayarEl.innerHTML = ""));
    bayarEl.querySelector("#f-bayar").addEventListener("submit", async (e) => {
      e.preventDefault();
      const nominal = bacaAngka(bayarEl.querySelector("#b-nominal"));
      if (!nominal) { kabar("Nominal belum diisi.", "rem"); return; }
      if (nominal > Number(trx.sisa || 0)) {
        kabar("Nominal melebihi sisa tagihan.", "rem");
        return;
      }
      const tombol = e.target.querySelector('button[type="submit"]');
      tombol.disabled = true;
      tombol.textContent = "Menerbitkan…";
      try {
        const k = await terbitkan(trx, {
          jenis: bayarEl.querySelector("#b-jenis").value,
          nominal,
          metode: bayarEl.querySelector("#b-metode").value,
        });
        await tampilkan(k, bayarEl);
        await gambar();
        kabar(`Kuitansi ${k.nomor} terbit.`, "netral");
      } catch (err) {
        kabar("Gagal: " + err.message, "rem");
        tombol.disabled = false;
        tombol.textContent = "Terima & cetak kuitansi";
      }
    });
    bayarEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  await gambar();
}

// ── Daftar kuitansi ───────────────────────────────────────────
export async function halamanKuitansi(wadah) {
  wadah.innerHTML = `<section class="lembar">
    <h2 class="judul">Kuitansi</h2>
    <div id="lihat-kuitansi"></div>
    <div id="daftar-kw" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-kw");
  const lihatEl = wadah.querySelector("#lihat-kuitansi");

  const snap = await getDocs(query(
    collection(dbase, "kuitansi"), orderBy("tanggal", "desc"), limit(40)
  ));
  const isi = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  daftarEl.innerHTML = isi.length
    ? isi.map((k) => `<article class="kartu ${
        k.status === "void" ? "kartu--batal" : ""}">
        <div class="kartu-atas">
          <div>
            <h3 class="kartu-judul mono">${aman(k.nomor)}</h3>
            <p class="kartu-sub">${aman(k.penerimaDari)} · ${
              aman(JENIS[k.jenis] || k.jenis)}</p>
          </div>
          <b class="mono">${rupiah(k.nominal)}</b>
        </div>
        <p class="kartu-rinci">${tanggal(k.tanggal)} · ${aman(k.kasirNama)}
          ${k.status === "void" ? " · DIBATALKAN" : ""}</p>
        <div class="aksi aksi--rapat">
          <button class="tombol tombol--kecil" data-lihat="${k.id}">Lihat</button>
          ${k.status !== "void" && bolehAkses("*")
            ? `<button class="tombol tombol--kecil" data-void="${k.id}">
                 Batalkan</button>` : ""}
        </div>
      </article>`).join("")
    : `<div class="hampa"><p>Belum ada kuitansi terbit.</p></div>`;

  daftarEl.querySelectorAll("[data-lihat]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = isi.find((x) => x.id === b.dataset.lihat);
      tampilkan(k, lihatEl);
    }));

  // Kuitansi tidak pernah dihapus atau diubah nominalnya. Yang bisa
  // dilakukan hanya membatalkan, dan pembatalannya langsung terlihat
  // saat QR dipindai.
  daftarEl.querySelectorAll("[data-void]").forEach((b) =>
    b.addEventListener("click", async () => {
      const alasan = prompt("Alasan pembatalan kuitansi:");
      if (!alasan) return;
      const k = isi.find((x) => x.id === b.dataset.void);
      try {
        await updateDoc(doc(dbase, "kuitansi", k.id), {
          status: "void", voidAlasan: alasan,
          voidOleh: sesi.nama, voidPada: serverTimestamp(),
        });
        await updateDoc(doc(dbase, "verifikasi", k.token), { status: "void" });
        await catat("kuitansi_dibatalkan", {
          koleksi: "kuitansi", docId: k.id, ringkas: `${k.nomor} · ${alasan}`,
        });
        kabar("Kuitansi dibatalkan.", "netral");
        await halamanKuitansi(wadah);
      } catch (err) {
        kabar("Gagal membatalkan: " + err.message, "rem");
      }
    }));
}

// ── Halaman verifikasi publik ─────────────────────────────────
// Dibuka tanpa login. Isinya sengaja minimal: tidak ada NIK,
// alamat, atau nomor rangka.
export async function halamanVerifikasi(token, wadah) {
  wadah.innerHTML = `<div class="cek"><p class="hampa">Memeriksa…</p></div>`;
  try {
    const snap = await getDoc(doc(dbase, "verifikasi", token));
    if (!snap.exists()) {
      wadah.innerHTML = `<div class="cek cek--gagal">
        <span class="lampu lampu--rem lampu--besar"></span>
        <h1>Dokumen tidak ditemukan</h1>
        <p>Kode ini tidak terdaftar di sistem ${aman(SHOWROOM.nama)}.
           Hati-hati terhadap dokumen palsu.</p>
      </div>`;
      return;
    }
    const d = snap.data();
    const sah = d.status === "aktif";
    wadah.innerHTML = `<div class="cek ${sah ? "cek--sah" : "cek--gagal"}">
      <span class="lampu ${sah ? "lampu--netral" : "lampu--rem"} lampu--besar">
      </span>
      <h1>${sah ? "Dokumen asli" : "Sudah dibatalkan"}</h1>
      <p class="cek-nomor mono">${aman(d.nomor)}</p>
      <dl class="rinci">
        <div><dt>Jenis</dt><dd>${aman(JENIS[d.jenis] || d.jenis)}</dd></div>
        <div><dt>Atas nama</dt><dd>${aman(d.nama)}</dd></div>
        <div><dt>Unit</dt><dd>${aman(d.tipeNama)}</dd></div>
        <div><dt>Nominal</dt><dd class="mono">${rupiah(d.nominal)}</dd></div>
        <div><dt>Tanggal</dt><dd>${tanggal(d.tanggal)}</dd></div>
      </dl>
      ${!sah ? `<p class="peringatan">Kuitansi ini telah dibatalkan dan
        tidak berlaku lagi.</p>` : ""}
      <p class="cek-kaki">Diterbitkan oleh ${aman(d.penerbit)}</p>
    </div>`;
  } catch (e) {
    wadah.innerHTML = `<div class="cek cek--gagal">
      <h1>Gagal memeriksa</h1>
      <p>Coba lagi saat koneksi lebih baik.</p></div>`;
  }
}

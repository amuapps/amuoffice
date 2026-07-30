// spk.js — Surat Pesanan Kendaraan, layar bergaya DMS dealer.
//
// Formulirnya memakai tab (Data Pembeli · Unit & Harga ·
// Pembayaran), bukan wizard bertahap: seluruh isian tetap ada di
// halaman, jadi pengguna bisa melompat bolak-balik memeriksa tanpa
// kehilangan apa pun.
//
// Data pembeli dan data Faktur STNK dipasang sejajar dua kolom,
// mengikuti formulir dealer — karena keduanya memang sering beda
// orang, dan menyamakannya tanpa sadar itu kesalahan yang mahal.
//
// SPK lahir SEBELUM unit ditebus, jadi menempel ke tipe motor
// dulu; nomor rangka diisi belakangan di menu Serah Terima.

import {
  dbase, collection, doc, getDocs, updateDoc, query, where,
  orderBy, limit, writeBatch, serverTimestamp, nomorBerikutnya,
  sertakanLog, tandaBaru, catat,
} from "./db.js";
import { sesi, bolehAkses } from "./auth.js";
import { perluPersetujuan, batasDiskon } from "./roles.js";
import { pecahHarga, SHOWROOM, MASA_BERLAKU_SPK } from "./config.js";
import { muatTipe, tipeDari } from "./tipe.js";
import {
  muatPelanggan, pelangganDari, simpanPelanggan,
  formPelanggan, bacaFormPelanggan,
} from "./pelanggan.js";
import { terbitkan } from "./kuitansi.js";
import { cetakSpk } from "./cetak.js";
import { tanya, konfirmasi } from "./dialog.js";
import {
  bilahLayar, seksi, pasangSeksi, bilahTab, pasangTab, bukaTab,
} from "./layar.js";
import {
  rupiah, terbilang, aman, kabar, tanggal, tanggalJam,
  pasangFormatUang, bacaAngka,
} from "./ui.js";

const LABEL = {
  menunggu_persetujuan: "Menunggu persetujuan",
  diajukan: "Diajukan",
  approve: "Disetujui",
  reject: "Ditolak",
  selesai: "Selesai",
  batal: "Batal",
};

// ── Perhitungan ───────────────────────────────────────────────
// PPN dihitung dari nilai unit dan aksesoris saja. BBN dan ongkir
// diteruskan ke pihak ketiga, bukan penyerahan barang oleh dealer,
// jadi tidak ikut dipecah PPN-nya.
export function hitung(d, mewah) {
  const jumlah = Math.max(1, Number(d.jumlah || 1));
  const aksesoris = (d.aksesoris || [])
    .reduce((a, b) => a + Number(b.harga || 0), 0);
  const p = d.potongan || [];
  const potonganHarga = p
    .filter((x) => x.jenis === "harga")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const bebanShowroom = p
    .filter((x) => x.sumber === "showroom")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const piutangProgram = p
    .filter((x) => x.sumber === "atpm")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);

  const nilaiUnit =
    Number(d.hargaOtr || 0) * jumlah + aksesoris - potonganHarga;
  const pecah = pecahHarga(nilaiUnit, mewah);
  const total =
    nilaiUnit + Number(d.tambahanBbn || 0) + Number(d.ongkir || 0);

  return {
    jumlah, aksesoris, potonganHarga, bebanShowroom, piutangProgram,
    nilaiUnit, dpp: pecah.dpp, ppn: pecah.ppn, total,
  };
}

// ── Daftar SPK ────────────────────────────────────────────────
function barisSpk(s, bisaSetujui) {
  const perlu = s.statusSPK === "menunggu_persetujuan";
  return `<article class="kartu ${perlu ? "kartu--sorot" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(s.kode)}</h3>
        <p class="kartu-sub">${aman(s.pelangganSnapshot?.nama || "-")}</p>
      </div>
      <span class="tanda tanda--${s.statusSPK}">
        ${LABEL[s.statusSPK] || s.statusSPK}
      </span>
    </div>
    <p class="kartu-rinci">${aman(s.tipeSnapshot?.nama || "-")}
      · ${aman(s.warna || "-")}${s.jumlah > 1 ? " · " + s.jumlah + " unit" : ""}</p>
    <p class="angka-besar">${rupiah(s.total || s.hargaNet)}</p>
    <p class="kartu-rinci">
      ${s.metode === "kredit"
        ? "Kredit " + aman(s.kredit?.leasing || "-") +
          " · DP " + rupiah(s.kredit?.dp)
        : "Tunai"}
      · ${tanggal(s.dibuatPada)}
    </p>
    ${s.stnk && s.stnk.sama === false
      ? `<p class="kartu-rinci">STNK a.n. ${aman(s.stnk.nama)}</p>` : ""}
    ${s.bebanShowroom
      ? `<p class="kartu-rinci">Ditanggung showroom
         ${rupiah(s.bebanShowroom)}</p>` : ""}
    ${s.persetujuan?.olehNama
      ? `<p class="kartu-rinci">${
          s.statusSPK === "reject" ? "Ditolak" : "Disetujui"} ${
          aman(s.persetujuan.olehNama)} · ${tanggalJam(s.persetujuan.pada)}</p>`
      : ""}
    <div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-cetak="${s.id}">Cetak SPK</button>
      ${perlu && bisaSetujui
        ? `<button class="tombol tombol--kecil tombol--isi"
                   data-setuju="${s.id}">Setujui</button>
           <button class="tombol tombol--kecil" data-tolak="${s.id}">Tolak</button>`
        : ""}
    </div>
  </article>`;
}

export async function halamanSpk(wadah) {
  const bisaBuat = bolehAkses("spk.buat");
  const bisaSetujui = bolehAkses("spk.setujui");
  let saring = bisaSetujui ? "menunggu_persetujuan" : "semua";

  wadah.innerHTML = `<div class="layar">
    ${bilahLayar({
      kode: "PJL-01",
      judul: "Daftar Surat Pesanan Kendaraan",
      aksi: [
        ...(bisaBuat
          ? [{ id: "buat-spk", label: "Entri SPK", jenis: "utama" }] : []),
        { id: "muat-spk", label: "Muat ulang" },
      ],
    })}
    ${seksi("Saringan", `
      <div class="chip-baris" id="saring-spk" style="margin:0">
        ${bisaSetujui ? `<button class="chip aktif"
          data-s="menunggu_persetujuan">Perlu persetujuan</button>` : ""}
        <button class="chip ${bisaSetujui ? "" : "aktif"}"
                data-s="semua">Semua</button>
        <button class="chip" data-s="approve">Disetujui</button>
        <button class="chip" data-s="selesai">Selesai</button>
      </div>`)}
    <div id="wadah-spk"></div>
    ${seksi("Detail", `<div id="daftar-spk" class="daftar">
      <p class="hampa">Memuat…</p></div>`)}
  </div>`;

  pasangSeksi(wadah);
  const daftarEl = wadah.querySelector("#daftar-spk");
  const formEl = wadah.querySelector("#wadah-spk");
  let terakhir = [];

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    const dasar = collection(dbase, "transaksi");
    // Saat menyaring, orderBy sengaja tidak dipakai — kombinasi
    // where + orderBy menuntut indeks gabungan di Firestore.
    const q = saring === "semua"
      ? query(dasar, orderBy("dibuatPada", "desc"), limit(50))
      : query(dasar, where("statusSPK", "==", saring), limit(50));
    const snap = await getDocs(q);
    terakhir = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));

    daftarEl.innerHTML = terakhir.length
      ? terakhir.map((s) => barisSpk(s, bisaSetujui)).join("")
      : `<div class="hampa"><p>Belum ada SPK di kelompok ini.</p></div>`;

    daftarEl.querySelectorAll("[data-cetak]").forEach((b) =>
      b.addEventListener("click", () =>
        cetakSpk(terakhir.find((x) => x.id === b.dataset.cetak))));
    daftarEl.querySelectorAll("[data-setuju]").forEach((b) =>
      b.addEventListener("click", () => putuskan(b.dataset.setuju, true)));
    daftarEl.querySelectorAll("[data-tolak]").forEach((b) =>
      b.addEventListener("click", () => putuskan(b.dataset.tolak, false)));
  }

  wadah.querySelector("#saring-spk").addEventListener("click", (e) => {
    const t = e.target.closest("[data-s]");
    if (!t) return;
    saring = t.dataset.s;
    wadah.querySelectorAll("#saring-spk .chip")
      .forEach((c) => c.classList.toggle("aktif", c === t));
    gambar();
  });

  async function putuskan(id, setuju) {
    const catatan = await tanya({
      judul: setuju ? "Setujui SPK" : "Tolak SPK",
      pesan: setuju
        ? "Tulis catatan persetujuan — misalnya nominal diskon yang disetujui."
        : "Tulis alasan penolakan supaya sales tahu langkah berikutnya.",
      nilai: setuju ? "Disetujui" : "",
      petunjuk: setuju ? "Catatan" : "Alasan penolakan",
    });
    if (catatan === null) return;
    try {
      await updateDoc(doc(dbase, "transaksi", id), {
        statusSPK: setuju ? "approve" : "reject",
        persetujuan: {
          oleh: sesi.uid, olehNama: sesi.nama,
          pada: serverTimestamp(), catatan,
        },
      });
      await catat(setuju ? "spk_disetujui" : "spk_ditolak", {
        koleksi: "transaksi", docId: id, ringkas: catatan,
      });
      kabar(setuju ? "SPK disetujui." : "SPK ditolak.", "netral");
      await gambar();
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  wadah.querySelector("#muat-spk").addEventListener("click", gambar);
  if (bisaBuat) {
    wadah.querySelector("#buat-spk")
      .addEventListener("click", () => layarEntri(formEl, gambar));
  }
  await gambar();
}

// ── Layar entri SPK ───────────────────────────────────────────
async function layarEntri(wadah, selesai) {
  const daftarTipe = await muatTipe();
  const daftarPelanggan = await muatPelanggan();
  if (!daftarTipe.length) {
    kabar("Tambahkan tipe motor dulu di Data Induk.", "rem");
    return;
  }

  // Daftar dinamis disimpan di sini; isian biasa dibaca dari DOM
  // saat disimpan, supaya berpindah tab tidak menghapus apa pun.
  const aksesoris = [];
  const potongan = [];
  const hariIni = new Date().getFullYear();

  const opsiTipe = daftarTipe.map((t) =>
    `<option value="${t.id}">${aman(t.merek)} ${aman(t.tipe)} ${
      aman(t.varian || "")}</option>`).join("");
  const opsiPelanggan = daftarPelanggan.map((p) =>
    `<option value="${p.id}">${aman(p.nama)} — ${aman(p.telepon || "")}
    </option>`).join("");

  wadah.innerHTML = `<div class="layar layar--entri" id="entri-spk">
    ${bilahLayar({
      kode: "PJL-02",
      judul: "Entri Surat Pesanan Kendaraan",
      aksi: [
        { id: "spk-simpan", label: "Simpan SPK", jenis: "utama" },
        { id: "spk-reset", label: "Reset" },
        { id: "spk-tutup", label: "Tutup" },
      ],
    })}

    ${seksi("Header", `
      <div class="tiga">
        <div>
          <label class="label label--gelap">Nomor SPK</label>
          <input class="isian isian--terang kecil" value="otomatis" disabled>
        </div>
        <div>
          <label class="label label--gelap">Tanggal SPK</label>
          <input class="isian isian--terang kecil"
                 value="${new Date().toLocaleDateString("id-ID")}" disabled>
        </div>
        <div>
          <label class="label label--gelap">Sales</label>
          <input class="isian isian--terang kecil"
                 value="${aman(sesi.nama)}" disabled>
        </div>
      </div>`)}

    ${bilahTab([
      { id: "pembeli", label: "Data Pembeli" },
      { id: "unit", label: "Unit & Harga" },
      { id: "bayar", label: "Pembayaran" },
    ], "pembeli")}

    <div class="panel-tab">

      <!-- ── Tab 1: pembeli & STNK ─────────────────────────── -->
      <div data-panel="pembeli">
        <label class="label label--gelap" for="s-pelanggan">
          Pembeli terdaftar</label>
        <select class="isian isian--terang" id="s-pelanggan">
          <option value="">— pembeli baru —</option>${opsiPelanggan}
        </select>

        <div class="kolom-dua">
          <div class="kolom">
            <p class="kolom-judul">Pembeli</p>
            <div id="pembeli-baru">${formPelanggan({})}</div>
          </div>
          <div class="kolom">
            <p class="kolom-judul">Faktur STNK atas nama</p>
            <label class="pilihan">
              <input type="checkbox" id="s-stnk-sama" checked>
              <span>Sama dengan data pembeli</span>
            </label>
            <div id="stnk-beda" hidden>
              <label class="label label--gelap" for="s-stnk-nama">
                Nama di STNK</label>
              <input class="isian isian--terang" id="s-stnk-nama"
                     placeholder="Sesuai KTP pemilik">
              <label class="label label--gelap" for="s-stnk-alamat">
                Alamat STNK</label>
              <input class="isian isian--terang" id="s-stnk-alamat">
              <p class="petunjuk">Salah di sini berarti berkas diulang
                dan biro jasa menagih dua kali.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Tab 2: unit & harga ───────────────────────────── -->
      <div data-panel="unit" hidden>
        <label class="label label--gelap" for="s-tipe">Merk / tipe</label>
        <select class="isian isian--terang" id="s-tipe">
          <option value="">— pilih —</option>${opsiTipe}
        </select>
        <div class="tiga">
          <div>
            <label class="label label--gelap" for="s-warna">Warna</label>
            <select class="isian isian--terang kecil" id="s-warna"></select>
          </div>
          <div>
            <label class="label label--gelap" for="s-tahun">Tahun</label>
            <input class="isian isian--terang kecil" id="s-tahun"
                   inputmode="numeric" value="${hariIni}">
          </div>
          <div>
            <label class="label label--gelap" for="s-jumlah">Jumlah</label>
            <input class="isian isian--terang kecil" id="s-jumlah"
                   inputmode="numeric" value="1">
          </div>
        </div>
        <label class="label label--gelap" for="s-otr">Harga per unit</label>
        <input class="isian isian--terang" id="s-otr" inputmode="numeric">

        <div class="pemisah">Aksesoris tambahan</div>
        <div id="daftar-aksesoris"></div>
        <button class="tombol tombol--kecil" type="button"
                id="tambah-aksesoris">Tambah aksesoris</button>

        <div class="pemisah">Potongan</div>
        <div id="daftar-potongan"></div>
        <button class="tombol tombol--kecil" type="button"
                id="tambah-potongan">Tambah potongan</button>

        <div class="pemisah">Biaya lain</div>
        <div class="dua">
          <div>
            <label class="label label--gelap" for="s-bbn">Penambahan BBN</label>
            <input class="isian isian--terang kecil" id="s-bbn"
                   inputmode="numeric">
          </div>
          <div>
            <label class="label label--gelap" for="s-ongkir">Ongkir</label>
            <input class="isian isian--terang kecil" id="s-ongkir"
                   inputmode="numeric">
          </div>
        </div>
        <p class="petunjuk">BBN dan ongkir diteruskan ke pihak ketiga,
          jadi tidak ikut dihitung PPN-nya.</p>

        <div class="pemisah">Pengiriman</div>
        <div class="chip-baris" id="s-pengiriman">
          <button class="chip aktif" type="button" data-k="on">
            On The Road</button>
          <button class="chip" type="button" data-k="off">
            Off The Road</button>
        </div>
        <div class="dua">
          <div>
            <label class="label label--gelap" for="s-kota">Kota</label>
            <input class="isian isian--terang kecil" id="s-kota">
          </div>
          <div>
            <label class="label label--gelap" for="s-kirim">
              Rencana delivery</label>
            <input class="isian isian--terang kecil" id="s-kirim" type="date">
          </div>
        </div>
      </div>

      <!-- ── Tab 3: pembayaran ─────────────────────────────── -->
      <div data-panel="bayar" hidden>
        <label class="label label--gelap">Cara pembayaran</label>
        <div class="chip-baris" id="metode">
          <button class="chip aktif" type="button" data-m="kredit">
            Kredit</button>
          <button class="chip" type="button" data-m="cash">Tunai</button>
        </div>
        <div id="isian-kredit">
          <label class="label label--gelap" for="s-leasing">Kredit via</label>
          <input class="isian isian--terang" id="s-leasing"
                 placeholder="Nama leasing">
          <div class="tiga">
            <div>
              <label class="label label--gelap" for="s-dp">DP</label>
              <input class="isian isian--terang kecil" id="s-dp"
                     inputmode="numeric">
            </div>
            <div>
              <label class="label label--gelap" for="s-tenor">Tenor (bln)</label>
              <input class="isian isian--terang kecil" id="s-tenor"
                     inputmode="numeric">
            </div>
            <div>
              <label class="label label--gelap" for="s-angsuran">Angsuran</label>
              <input class="isian isian--terang kecil" id="s-angsuran"
                     inputmode="numeric">
            </div>
          </div>
        </div>

        <div class="pemisah">Salesman &amp; agen</div>
        <div class="tiga">
          <input class="isian isian--terang kecil" id="s-kode"
                 placeholder="Kode salesman">
          <input class="isian isian--terang kecil" id="s-agen"
                 placeholder="Nama agen">
          <input class="isian isian--terang kecil" id="s-fee"
                 inputmode="numeric" placeholder="Fee agen">
        </div>

        <div class="pemisah">Tanda jadi</div>
        <div class="dua">
          <input class="isian isian--terang kecil" id="s-tandajadi"
                 inputmode="numeric" placeholder="Nominal diterima">
          <select class="isian isian--terang kecil" id="s-tj-metode">
            <option value="tunai">Tunai</option>
            <option value="transfer">Transfer</option>
          </select>
        </div>
        <p class="petunjuk">Isi kalau pembeli membayar tanda jadi sekarang —
          kuitansinya terbit otomatis bersama SPK ini.</p>

        <label class="label label--gelap" for="s-catatan">Catatan</label>
        <input class="isian isian--terang" id="s-catatan"
               placeholder="Opsional">
      </div>
    </div>

    ${seksi("Ringkasan Nilai", `<div id="ringkas-harga"></div>`)}
  </div>`;

  const layar = wadah.querySelector("#entri-spk");
  pasangSeksi(layar);
  pasangTab(layar);

  const q = (s) => layar.querySelector(s);
  ["#s-otr", "#s-bbn", "#s-ongkir", "#s-dp", "#s-angsuran",
   "#s-fee", "#s-tandajadi"].forEach((id) => pasangFormatUang(q(id)));

  // ── Pembeli & STNK ──────────────────────────────────────────
  const pilihPel = q("#s-pelanggan");
  const baruEl = q("#pembeli-baru");
  const stnkSama = q("#s-stnk-sama");
  const stnkBeda = q("#stnk-beda");
  pilihPel.addEventListener("change", () => {
    baruEl.hidden = !!pilihPel.value;
  });
  stnkSama.addEventListener("change", () => {
    stnkBeda.hidden = stnkSama.checked;
  });

  // ── Unit & harga ────────────────────────────────────────────
  const pTipe = q("#s-tipe");
  const pWarna = q("#s-warna");
  const pOtr = q("#s-otr");
  let pengiriman = "on";
  let metode = "kredit";

  function isiWarna() {
    const t = tipeDari(pTipe.value);
    pWarna.innerHTML = `<option value="">— pilih —</option>` +
      ((t && t.warna) || []).map((w) =>
        `<option value="${aman(w)}">${aman(w)}</option>`).join("");
    if (t && !pOtr.value) {
      pOtr.value = Number(t.hargaOtr || 0).toLocaleString("id-ID");
    }
    ringkas();
  }
  pTipe.addEventListener("change", isiWarna);
  ["#s-otr", "#s-jumlah", "#s-bbn", "#s-ongkir"].forEach((id) =>
    q(id).addEventListener("input", ringkas));

  q("#s-pengiriman").addEventListener("click", (e) => {
    const t = e.target.closest("[data-k]");
    if (!t) return;
    pengiriman = t.dataset.k;
    layar.querySelectorAll("#s-pengiriman .chip")
      .forEach((c) => c.classList.toggle("aktif", c === t));
  });

  q("#metode").addEventListener("click", (e) => {
    const t = e.target.closest("[data-m]");
    if (!t) return;
    metode = t.dataset.m;
    layar.querySelectorAll("#metode .chip")
      .forEach((c) => c.classList.toggle("aktif", c === t));
    q("#isian-kredit").hidden = metode !== "kredit";
  });

  function uang(f) {
    const bersih = f.value.replace(/\D/g, "");
    f.value = bersih ? Number(bersih).toLocaleString("id-ID") : "";
    return Number(bersih || 0);
  }

  function gambarAksesoris() {
    q("#daftar-aksesoris").innerHTML = aksesoris.map((a, i) =>
      `<div class="potongan" data-ai="${i}">
        <div class="dua">
          <input class="isian isian--terang kecil" data-af="nama"
                 value="${aman(a.nama || "")}" placeholder="Nama aksesoris">
          <input class="isian isian--terang kecil" data-af="harga"
                 inputmode="numeric" placeholder="Harga"
                 value="${a.harga
                   ? Number(a.harga).toLocaleString("id-ID") : ""}">
        </div>
        <button class="tautan-batal" type="button" data-ahapus="${i}">
          Hapus</button>
      </div>`).join("");
    layar.querySelectorAll("[data-ai]").forEach((b) => {
      b.querySelectorAll("[data-af]").forEach((f) =>
        f.addEventListener("input", () => {
          const i = Number(b.dataset.ai);
          aksesoris[i][f.dataset.af] =
            f.dataset.af === "harga" ? uang(f) : f.value;
          ringkas();
        }));
    });
    layar.querySelectorAll("[data-ahapus]").forEach((b) =>
      b.addEventListener("click", () => {
        aksesoris.splice(Number(b.dataset.ahapus), 1);
        gambarAksesoris(); ringkas();
      }));
  }

  function gambarPotongan() {
    q("#daftar-potongan").innerHTML = potongan.map((p, i) =>
      `<div class="potongan" data-i="${i}">
        <div class="dua">
          <select class="isian isian--terang kecil" data-f="jenis">
            <option value="harga" ${p.jenis === "harga" ? "selected" : ""}>
              Potongan harga</option>
            <option value="barang" ${p.jenis === "barang" ? "selected" : ""}>
              Hadiah barang</option>
          </select>
          <select class="isian isian--terang kecil" data-f="sumber">
            <option value="showroom" ${
              p.sumber === "showroom" ? "selected" : ""}>
              Ditanggung showroom</option>
            <option value="atpm" ${p.sumber === "atpm" ? "selected" : ""}>
              Program Piaggio</option>
            <option value="leasing" ${p.sumber === "leasing" ? "selected" : ""}>
              Program leasing</option>
            <option value="komisi" ${p.sumber === "komisi" ? "selected" : ""}>
              Potong komisi</option>
          </select>
        </div>
        <div class="dua">
          <input class="isian isian--terang kecil" data-f="nominal"
                 inputmode="numeric" placeholder="Nominal"
                 value="${p.nominal
                   ? Number(p.nominal).toLocaleString("id-ID") : ""}">
          <input class="isian isian--terang kecil" data-f="keterangan"
                 value="${aman(p.keterangan || "")}" placeholder="Keterangan">
        </div>
        <button class="tautan-batal" type="button" data-hapus="${i}">
          Hapus</button>
      </div>`).join("");
    layar.querySelectorAll("[data-i]").forEach((b) => {
      b.querySelectorAll("[data-f]").forEach((f) =>
        f.addEventListener("input", () => {
          const i = Number(b.dataset.i);
          potongan[i][f.dataset.f] =
            f.dataset.f === "nominal" ? uang(f) : f.value;
          ringkas();
        }));
    });
    layar.querySelectorAll("[data-hapus]").forEach((b) =>
      b.addEventListener("click", () => {
        potongan.splice(Number(b.dataset.hapus), 1);
        gambarPotongan(); ringkas();
      }));
  }

  q("#tambah-aksesoris").addEventListener("click", () => {
    aksesoris.push({ nama: "", harga: 0 });
    gambarAksesoris();
  });
  q("#tambah-potongan").addEventListener("click", () => {
    potongan.push({
      jenis: "harga", sumber: "showroom", nominal: 0, keterangan: "",
    });
    gambarPotongan();
  });

  function kumpulkan() {
    return {
      jumlah: Number(q("#s-jumlah").value || 1),
      hargaOtr: bacaAngka(q("#s-otr")),
      tambahanBbn: bacaAngka(q("#s-bbn")),
      ongkir: bacaAngka(q("#s-ongkir")),
      aksesoris, potongan,
    };
  }

  // Ringkasan hidup: ikut berubah tiap kali angka diketik, dan
  // tetap terlihat walau pengguna sedang membuka tab lain.
  function ringkas() {
    const t = tipeDari(pTipe.value);
    const d = kumpulkan();
    const h = hitung(d, t && t.mewah);
    const batas = batasDiskon(sesi.peran);
    const lewat = perluPersetujuan(sesi.peran, h.bebanShowroom);
    q("#ringkas-harga").innerHTML = `
      <div class="ringkas-baris"><span>${h.jumlah} unit</span>
        <span class="mono">${rupiah(d.hargaOtr * h.jumlah)}</span></div>
      ${h.aksesoris ? `<div class="ringkas-baris"><span>Aksesoris</span>
        <span class="mono">${rupiah(h.aksesoris)}</span></div>` : ""}
      ${h.potonganHarga ? `<div class="ringkas-baris"><span>Potongan</span>
        <span class="mono">− ${rupiah(h.potonganHarga)}</span></div>` : ""}
      ${d.tambahanBbn ? `<div class="ringkas-baris">
        <span>Penambahan BBN</span>
        <span class="mono">${rupiah(d.tambahanBbn)}</span></div>` : ""}
      ${d.ongkir ? `<div class="ringkas-baris"><span>Ongkir</span>
        <span class="mono">${rupiah(d.ongkir)}</span></div>` : ""}
      <div class="ringkas-baris ringkas-total"><span>Total</span>
        <b class="mono">${rupiah(h.total)}</b></div>
      <div class="ringkas-baris"><span>DPP / PPN</span>
        <span class="mono">${rupiah(h.dpp)} / ${rupiah(h.ppn)}</span></div>
      ${h.bebanShowroom ? `<div class="ringkas-baris">
        <span>Ditanggung showroom</span>
        <b class="mono">${rupiah(h.bebanShowroom)}</b></div>` : ""}
      ${h.piutangProgram ? `<div class="ringkas-baris">
        <span>Klaim ke Piaggio</span>
        <span class="mono">${rupiah(h.piutangProgram)}</span></div>` : ""}
      ${lewat ? `<p class="peringatan">Melebihi batas Anda
        (${rupiah(batas)}). SPK akan menunggu persetujuan owner.</p>` : ""}`;
  }
  ringkas();

  // ── Toolbar ────────────────────────────────────────────────
  q("#spk-tutup").addEventListener("click", () => (wadah.innerHTML = ""));
  q("#spk-reset").addEventListener("click", async () => {
    const jadi = await konfirmasi({
      judul: "Reset formulir",
      pesan: "Semua isian pada layar ini akan dikosongkan.",
      oke: "Reset", bahaya: true,
    });
    if (jadi) layarEntri(wadah, selesai);
  });

  q("#spk-simpan").addEventListener("click", async () => {
    // Pembeli
    let pelangganId = pilihPel.value;
    let pelangganBaru = null;
    if (!pelangganId) {
      const d = bacaFormPelanggan(layar);
      if (!d.nama || !d.telepon) {
        bukaTab(layar, "pembeli");
        kabar("Nama dan telepon pembeli wajib diisi.", "rem");
        return;
      }
      pelangganBaru = d;
    }
    const sama = stnkSama.checked;
    const stnkNama = sama ? "" : q("#s-stnk-nama").value.trim();
    if (!sama && !stnkNama) {
      bukaTab(layar, "pembeli");
      kabar("Nama di STNK belum diisi.", "rem");
      return;
    }
    // Unit
    if (!pTipe.value) {
      bukaTab(layar, "unit");
      kabar("Pilih tipe motornya.", "rem");
      return;
    }
    if (!bacaAngka(pOtr)) {
      bukaTab(layar, "unit");
      kabar("Harga unit belum diisi.", "rem");
      return;
    }
    // Pembayaran
    const leasing = q("#s-leasing").value.trim();
    if (metode === "kredit" && !leasing) {
      bukaTab(layar, "bayar");
      kabar("Nama leasing wajib diisi untuk penjualan kredit.", "rem");
      return;
    }

    const draft = {
      pelangganId, pelangganBaru,
      stnkSama: sama, stnkNama,
      stnkAlamat: sama ? "" : q("#s-stnk-alamat").value.trim(),
      tipeId: pTipe.value,
      warna: pWarna.value,
      tahun: Number(q("#s-tahun").value || 0),
      ...kumpulkan(),
      pengiriman,
      kota: q("#s-kota").value.trim(),
      rencanaKirim: q("#s-kirim").value,
      catatan: q("#s-catatan").value.trim(),
      metode, leasing,
      dp: bacaAngka(q("#s-dp")),
      tenor: Number(q("#s-tenor").value || 0),
      angsuran: bacaAngka(q("#s-angsuran")),
      kodeSales: q("#s-kode").value.trim(),
      agenNama: q("#s-agen").value.trim(),
      agenFee: bacaAngka(q("#s-fee")),
      tandaJadi: bacaAngka(q("#s-tandajadi")),
      metodeTandaJadi: q("#s-tj-metode").value,
    };

    const tombol = q("#spk-simpan");
    tombol.disabled = true;
    tombol.textContent = "Menyimpan…";
    try {
      const hasil = await simpan(draft);
      wadah.innerHTML = "";
      await selesai();
      const cetak = await konfirmasi({
        judul: `${hasil.kode} tersimpan`,
        pesan: "Cetak lembar SPK sekarang untuk ditandatangani pemesan?",
        oke: "Cetak SPK", batal: "Nanti saja",
      });
      if (cetak) cetakSpk(hasil.data);
    } catch (err) {
      kabar("Gagal menyimpan SPK: " + err.message, "rem");
      tombol.disabled = false;
      tombol.textContent = "Simpan SPK";
    }
  });

  layar.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Penyimpanan ───────────────────────────────────────────────
async function simpan(d) {
  let pelangganId = d.pelangganId;
  if (!pelangganId && d.pelangganBaru) {
    pelangganId = await simpanPelanggan(d.pelangganBaru);
  }
  const pel = pelangganDari(pelangganId);
  const t = tipeDari(d.tipeId);
  const h = hitung(d, t.mewah);
  const perlu = perluPersetujuan(sesi.peran, h.bebanShowroom);

  const kode = await nomorBerikutnya(`spk_${new Date().getFullYear()}`, "SPK");
  const ref = doc(collection(dbase, "transaksi"));
  const batch = writeBatch(dbase);

  const isi = {
    kode,
    statusSPK: perlu ? "menunggu_persetujuan" : "diajukan",
    tipeId: d.tipeId,
    tipeSnapshot: {
      nama: `${t.merek} ${t.tipe} ${t.varian || ""}`.trim(),
      cc: t.cc || null, mewah: !!t.mewah,
    },
    unitId: null,
    warna: d.warna,
    tahun: d.tahun,
    jumlah: h.jumlah,
    pelangganId,
    pelangganSnapshot: {
      nama: pel?.nama || "", telepon: pel?.telepon || "",
      nik: pel?.nik || "", alamat: pel?.alamat || "",
      email: pel?.email || "",
    },
    stnk: d.stnkSama
      ? { sama: true, nama: pel?.nama || "", alamat: pel?.alamat || "" }
      : { sama: false, nama: d.stnkNama, alamat: d.stnkAlamat },
    salesId: sesi.uid,
    salesNama: sesi.nama,
    kodeSales: d.kodeSales,
    agen: d.agenNama
      ? { nama: d.agenNama, fee: d.agenFee, statusBayar: "belum" }
      : null,
    hargaOtr: d.hargaOtr,
    aksesoris: d.aksesoris.filter((a) => a.nama || a.harga),
    potongan: d.potongan.filter((p) => Number(p.nominal || 0) > 0),
    tambahanBbn: d.tambahanBbn,
    ongkir: d.ongkir,
    nilaiUnit: h.nilaiUnit,
    total: h.total,
    hargaNet: h.total,
    dpp: h.dpp,
    ppn: h.ppn,
    bebanShowroom: h.bebanShowroom,
    piutangProgram: h.piutangProgram,
    pengiriman: d.pengiriman,
    kota: d.kota,
    rencanaKirim: d.rencanaKirim || null,
    catatan: d.catatan,
    metode: d.metode,
    kredit: d.metode === "kredit"
      ? {
          leasing: d.leasing, dp: d.dp, tenor: d.tenor,
          angsuran: d.angsuran, statusApproval: "menunggu",
        }
      : null,
    persetujuan: perlu ? { perlu: true } : null,
    totalDibayar: 0,
    sisa: h.total,
    statusBayar: "belum",
    terbilang: terbilang(h.total),
    masaBerlakuHari: MASA_BERLAKU_SPK,
    penerbit: SHOWROOM.nama,
    ...tandaBaru(),
  };
  batch.set(ref, isi);

  sertakanLog(batch, "spk_dibuat", {
    koleksi: "transaksi", docId: ref.id,
    ringkas: `${kode} · ${rupiah(h.total)}`,
    bebanShowroom: h.bebanShowroom,
    perluPersetujuan: perlu,
  });

  await batch.commit();

  let tandaJadiTerbit = 0;
  if (d.tandaJadi > 0) {
    try {
      await terbitkan(
        { id: ref.id, ...isi, dibuatPada: new Date() },
        { jenis: "tanda_jadi", nominal: d.tandaJadi,
          metode: d.metodeTandaJadi }
      );
      tandaJadiTerbit = d.tandaJadi;
    } catch (e) {
      kabar("SPK tersimpan, kuitansi tanda jadi gagal: " + e.message, "rem");
    }
  }

  kabar(
    perlu ? `${kode} menunggu persetujuan owner.` : `${kode} tersimpan.`,
    perlu ? "info" : "netral"
  );
  return {
    kode,
    data: { id: ref.id, ...isi, dibuatPada: new Date(),
            tandaJadi: tandaJadiTerbit },
  };
}

// spk.js — Surat Pesanan Kendaraan.
// Di sub-dealer, SPK lahir SEBELUM unit fisik ditebus. Karena itu
// SPK menempel ke tipe motor, dan nomor rangka baru diisi belakangan.

import {
  dbase, collection, doc, getDocs, updateDoc, query, where, orderBy,
  limit, writeBatch, serverTimestamp, nomorBerikutnya, sertakanLog,
  tandaBaru, catat,
} from "./db.js";
import { sesi, bolehAkses } from "./auth.js";
import { perluPersetujuan, batasDiskon } from "./roles.js";
import { pecahHarga, SHOWROOM } from "./config.js";
import { muatTipe, tipeDari } from "./tipe.js";
import {
  muatPelanggan, pelangganDari, simpanPelanggan,
  formPelanggan, bacaFormPelanggan,
} from "./pelanggan.js";
import {
  rupiah, terbilang, aman, kabar, tanggal, tanggalJam,
  pasangFormatUang, bacaAngka,
} from "./ui.js";
import { tanya } from "./dialog.js";

const LABEL = {
  menunggu_persetujuan: "Menunggu persetujuan",
  diajukan: "Diajukan ke leasing",
  approve: "Disetujui",
  reject: "Ditolak",
  selesai: "Selesai",
  batal: "Batal",
};

// ── Perhitungan ───────────────────────────────────────────────
// Yang menentukan perlu-tidaknya persetujuan hanyalah potongan
// yang DITANGGUNG SHOWROOM. Potongan dari ATPM atau leasing tidak
// mengurangi laba, jadi tidak masuk hitungan batas.
export function hitung(hargaOtr, potongan, mewah) {
  const p = potongan || [];
  const potonganHarga = p
    .filter((x) => x.jenis === "harga")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const bebanShowroom = p
    .filter((x) => x.sumber === "showroom")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const piutangProgram = p
    .filter((x) => x.sumber === "atpm")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const hargaNet = Number(hargaOtr || 0) - potonganHarga;
  const pecah = pecahHarga(hargaNet, mewah);
  return {
    potonganHarga, bebanShowroom, piutangProgram, hargaNet,
    dpp: pecah.dpp, ppn: pecah.ppn,
  };
}

// ── Daftar ────────────────────────────────────────────────────
function kartuSpk(s, bisaSetujui) {
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
      · ${aman(s.warna || "-")}</p>
    <p class="angka-besar">${rupiah(s.hargaNet)}</p>
    <p class="kartu-rinci">
      ${s.metode === "kredit"
        ? `Kredit ${aman(s.kredit?.leasing || "-")} · DP ${rupiah(s.kredit?.dp)}`
        : "Tunai"}
      · ${tanggal(s.dibuatPada)}
    </p>
    ${s.bebanShowroom
      ? `<p class="kartu-rinci">Potongan ditanggung showroom
         ${rupiah(s.bebanShowroom)}</p>` : ""}
    ${perlu && bisaSetujui
      ? `<div class="aksi aksi--rapat">
           <button class="tombol tombol--kecil tombol--isi"
                   data-setuju="${s.id}">Setujui</button>
           <button class="tombol tombol--kecil" data-tolak="${s.id}">Tolak</button>
         </div>`
      : ""}
    ${s.persetujuan?.oleh
      ? `<p class="kartu-rinci">Disetujui ${aman(s.persetujuan.olehNama || "")}
         · ${tanggalJam(s.persetujuan.pada)}</p>` : ""}
  </article>`;
}

// ── Halaman ───────────────────────────────────────────────────
export async function halamanSpk(wadah) {
  const bisaBuat = bolehAkses("spk.buat");
  const bisaSetujui = bolehAkses("spk.setujui");
  let saring = bisaSetujui ? "menunggu_persetujuan" : "semua";

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">SPK</h2>
      ${bisaBuat ? `<button class="tombol tombol--kecil tombol--isi"
        id="buat-spk">Buat SPK</button>` : ""}
    </div>
    <div class="chip-baris" id="saring-spk">
      ${bisaSetujui ? `<button class="chip aktif"
        data-s="menunggu_persetujuan">Perlu persetujuan</button>` : ""}
      <button class="chip ${bisaSetujui ? "" : "aktif"}"
              data-s="semua">Semua</button>
      <button class="chip" data-s="approve">Disetujui</button>
      <button class="chip" data-s="selesai">Selesai</button>
    </div>
    <div id="wadah-spk"></div>
    <div id="daftar-spk" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-spk");
  const formEl = wadah.querySelector("#wadah-spk");

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    const dasar = collection(dbase, "transaksi");
    // Saat menyaring, orderBy sengaja tidak dipakai — kombinasi
    // where + orderBy menuntut indeks gabungan di Firestore.
    // Datanya sedikit, jadi diurutkan di sini saja.
    const q = saring === "semua"
      ? query(dasar, orderBy("dibuatPada", "desc"), limit(50))
      : query(dasar, where("statusSPK", "==", saring), limit(50));
    const snap = await getDocs(q);
    const isi = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
    daftarEl.innerHTML = isi.length
      ? isi.map((s) => kartuSpk(s, bisaSetujui)).join("")
      : `<div class="hampa"><p>Belum ada SPK di kelompok ini.</p></div>`;

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
      judul: setuju ? "Setujui diskon" : "Tolak SPK",
      pesan: setuju
        ? "Tulis catatan persetujuan — misalnya nominal yang disetujui."
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
          pada: serverTimestamp(),
          catatan: catatan || "",
        },
      });
      await catat(setuju ? "diskon_disetujui" : "diskon_ditolak", {
        koleksi: "transaksi", docId: id, ringkas: catatan || "",
      });
      kabar(setuju ? "SPK disetujui." : "SPK ditolak.", "netral");
      await gambar();
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  if (bisaBuat) {
    wadah.querySelector("#buat-spk")
      .addEventListener("click", () => wizard(formEl, gambar));
  }
  await gambar();
}

// ── Wizard tiga langkah ───────────────────────────────────────
// Input berat dipecah supaya tidak melelahkan diisi dari HP, dan
// isian yang sudah diketik tidak hilang saat berpindah langkah.
async function wizard(wadah, selesai) {
  const draft = {
    langkah: 1, pelangganId: "", pelangganBaru: null,
    tipeId: "", warna: "", hargaOtr: 0, potongan: [],
    metode: "kredit", leasing: "", dp: 0, tenor: 0, angsuran: 0,
    agenNama: "", agenFee: 0,
  };
  const daftarTipe = await muatTipe();
  const daftarPelanggan = await muatPelanggan();
  if (!daftarTipe.length) {
    kabar("Tambahkan tipe motor dulu sebelum membuat SPK.", "rem");
    return;
  }
  gambar();

  function kepala() {
    return `<div class="langkah-baris">
      ${[1, 2, 3].map((n) => `<span class="langkah ${
        n === draft.langkah ? "langkah--aktif" : ""
      } ${n < draft.langkah ? "langkah--lewat" : ""}">${n}</span>`).join("")}
      <span class="langkah-label">${
        ["Pembeli", "Unit & harga", "Pembayaran"][draft.langkah - 1]
      }</span>
    </div>`;
  }

  function gambar() {
    wadah.innerHTML = `<div class="form">${kepala()}${
      [isi1, isi2, isi3][draft.langkah - 1]()
    }</div>`;
    [pasang1, pasang2, pasang3][draft.langkah - 1]();
    wadah.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function tombolNav(akhir = false) {
    return `<div class="aksi">
      ${draft.langkah > 1
        ? `<button class="tombol tombol--sunyi tombol--gelap" type="button"
             id="mundur">Kembali</button>` : ""}
      <button class="tombol tombol--utama" type="button" id="maju">
        ${akhir ? "Simpan SPK" : "Lanjut"}
      </button>
    </div>
    <button class="tautan-batal" type="button" id="batal-spk">
      Batalkan pembuatan SPK
    </button>`;
  }

  function pasangNav(saatMaju) {
    const m = wadah.querySelector("#mundur");
    if (m) m.addEventListener("click", () => { draft.langkah--; gambar(); });
    wadah.querySelector("#maju").addEventListener("click", saatMaju);
    wadah.querySelector("#batal-spk").addEventListener("click", () => {
      wadah.innerHTML = "";
    });
  }

  // ── Langkah 1: pembeli ──────────────────────────────────────
  function isi1() {
    const opsi = daftarPelanggan.map((p) =>
      `<option value="${p.id}" ${draft.pelangganId === p.id ? "selected" : ""}>
        ${aman(p.nama)} — ${aman(p.telepon || "")}</option>`).join("");
    return `
      <label class="label label--gelap" for="s-pelanggan">Pembeli terdaftar</label>
      <select class="isian isian--terang" id="s-pelanggan">
        <option value="">— pembeli baru —</option>${opsi}
      </select>
      <div id="pembeli-baru">${formPelanggan(draft.pelangganBaru || {})}</div>
      ${tombolNav()}`;
  }

  function pasang1() {
    const pilih = wadah.querySelector("#s-pelanggan");
    const baru = wadah.querySelector("#pembeli-baru");
    const segarkan = () => { baru.hidden = !!pilih.value; };
    pilih.addEventListener("change", segarkan);
    segarkan();
    pasangNav(() => {
      if (pilih.value) {
        draft.pelangganId = pilih.value;
        draft.pelangganBaru = null;
      } else {
        const d = bacaFormPelanggan(wadah);
        if (!d.nama || !d.telepon) {
          kabar("Nama dan telepon pembeli wajib diisi.", "rem");
          return;
        }
        draft.pelangganBaru = d;
        draft.pelangganId = "";
      }
      draft.langkah = 2;
      gambar();
    });
  }

  // ── Langkah 2: unit & harga ─────────────────────────────────
  function isi2() {
    const opsi = daftarTipe.map((t) =>
      `<option value="${t.id}" ${draft.tipeId === t.id ? "selected" : ""}>
        ${aman(t.merek)} ${aman(t.tipe)} ${aman(t.varian || "")}</option>`
    ).join("");
    return `
      <label class="label label--gelap" for="s-tipe">Tipe motor</label>
      <select class="isian isian--terang" id="s-tipe">
        <option value="">— pilih —</option>${opsi}
      </select>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="s-warna">Warna</label>
          <select class="isian isian--terang" id="s-warna"></select>
        </div>
        <div>
          <label class="label label--gelap" for="s-otr">Harga OTR</label>
          <input class="isian isian--terang" id="s-otr" inputmode="numeric">
        </div>
      </div>

      <div class="pemisah">Potongan</div>
      <div id="daftar-potongan"></div>
      <button class="tombol tombol--kecil" type="button" id="tambah-potongan">
        Tambah potongan
      </button>
      <div id="ringkas-harga" class="ringkas"></div>
      ${tombolNav()}`;
  }

  function barisPotongan(p, i) {
    return `<div class="potongan" data-i="${i}">
      <div class="dua">
        <select class="isian isian--terang kecil" data-f="jenis">
          <option value="harga" ${p.jenis === "harga" ? "selected" : ""}>
            Potongan harga</option>
          <option value="barang" ${p.jenis === "barang" ? "selected" : ""}>
            Hadiah barang</option>
        </select>
        <select class="isian isian--terang kecil" data-f="sumber">
          <option value="showroom" ${p.sumber === "showroom" ? "selected" : ""}>
            Ditanggung showroom</option>
          <option value="atpm" ${p.sumber === "atpm" ? "selected" : ""}>
            Program ATPM</option>
          <option value="leasing" ${p.sumber === "leasing" ? "selected" : ""}>
            Program leasing</option>
          <option value="komisi" ${p.sumber === "komisi" ? "selected" : ""}>
            Potong komisi</option>
        </select>
      </div>
      <div class="dua">
        <input class="isian isian--terang kecil" data-f="nominal"
               inputmode="numeric" value="${
                 p.nominal ? Number(p.nominal).toLocaleString("id-ID") : ""
               }" placeholder="Nominal">
        <input class="isian isian--terang kecil" data-f="keterangan"
               value="${aman(p.keterangan || "")}" placeholder="Keterangan">
      </div>
      <button class="tautan-batal" type="button" data-hapus="${i}">Hapus</button>
    </div>`;
  }

  function pasang2() {
    const pTipe = wadah.querySelector("#s-tipe");
    const pWarna = wadah.querySelector("#s-warna");
    const pOtr = wadah.querySelector("#s-otr");
    pasangFormatUang(pOtr);

    function isiWarna() {
      const t = tipeDari(pTipe.value);
      pWarna.innerHTML = `<option value="">— pilih —</option>` +
        ((t && t.warna) || []).map((w) =>
          `<option value="${aman(w)}" ${draft.warna === w ? "selected" : ""}>
            ${aman(w)}</option>`).join("");
      if (t && !pOtr.value) {
        pOtr.value = Number(t.hargaOtr || 0).toLocaleString("id-ID");
      }
      ringkas();
    }
    pTipe.addEventListener("change", isiWarna);
    pOtr.addEventListener("input", ringkas);
    isiWarna();

    function gambarPotongan() {
      wadah.querySelector("#daftar-potongan").innerHTML =
        draft.potongan.map(barisPotongan).join("");
      wadah.querySelectorAll(".potongan").forEach((b) => {
        b.querySelectorAll("[data-f]").forEach((f) => {
          f.addEventListener("input", () => {
            const i = Number(b.dataset.i);
            const nilai = f.dataset.f === "nominal"
              ? bacaAngka(f) : f.value;
            if (f.dataset.f === "nominal") {
              const bersih = f.value.replace(/\D/g, "");
              f.value = bersih ? Number(bersih).toLocaleString("id-ID") : "";
            }
            draft.potongan[i][f.dataset.f] = nilai;
            ringkas();
          });
        });
      });
      wadah.querySelectorAll("[data-hapus]").forEach((b) =>
        b.addEventListener("click", () => {
          draft.potongan.splice(Number(b.dataset.hapus), 1);
          gambarPotongan(); ringkas();
        }));
    }

    wadah.querySelector("#tambah-potongan").addEventListener("click", () => {
      draft.potongan.push({
        jenis: "harga", sumber: "showroom", nominal: 0, keterangan: "",
      });
      gambarPotongan();
    });
    gambarPotongan();

    function ringkas() {
      const t = tipeDari(pTipe.value);
      const h = hitung(bacaAngka(pOtr), draft.potongan, t && t.mewah);
      const batas = batasDiskon(sesi.peran);
      const lewat = perluPersetujuan(sesi.peran, h.bebanShowroom);
      wadah.querySelector("#ringkas-harga").innerHTML = `
        <div class="ringkas-baris"><span>Harga setelah potongan</span>
          <b class="mono">${rupiah(h.hargaNet)}</b></div>
        <div class="ringkas-baris"><span>DPP</span>
          <span class="mono">${rupiah(h.dpp)}</span></div>
        <div class="ringkas-baris"><span>PPN</span>
          <span class="mono">${rupiah(h.ppn)}</span></div>
        <div class="ringkas-baris"><span>Ditanggung showroom</span>
          <b class="mono">${rupiah(h.bebanShowroom)}</b></div>
        ${h.piutangProgram ? `<div class="ringkas-baris">
          <span>Klaim ke ATPM</span>
          <span class="mono">${rupiah(h.piutangProgram)}</span></div>` : ""}
        ${lewat ? `<p class="peringatan">Melebihi batas Anda
          (${rupiah(batas)}). SPK akan menunggu persetujuan owner.</p>` : ""}`;
    }

    pasangNav(() => {
      if (!pTipe.value) { kabar("Pilih tipe motornya.", "rem"); return; }
      if (!bacaAngka(pOtr)) { kabar("Harga OTR belum diisi.", "rem"); return; }
      draft.tipeId = pTipe.value;
      draft.warna = pWarna.value;
      draft.hargaOtr = bacaAngka(pOtr);
      draft.langkah = 3;
      gambar();
    });
  }

  // ── Langkah 3: pembayaran ───────────────────────────────────
  function isi3() {
    return `
      <label class="label label--gelap">Cara bayar</label>
      <div class="chip-baris" id="metode">
        <button class="chip ${draft.metode === "kredit" ? "aktif" : ""}"
                type="button" data-m="kredit">Kredit</button>
        <button class="chip ${draft.metode === "cash" ? "aktif" : ""}"
                type="button" data-m="cash">Tunai</button>
      </div>
      <div id="isian-kredit">
        <label class="label label--gelap" for="s-leasing">Leasing</label>
        <input class="isian isian--terang" id="s-leasing"
               value="${aman(draft.leasing)}" placeholder="Nama leasing">
        <div class="dua">
          <div>
            <label class="label label--gelap" for="s-dp">DP</label>
            <input class="isian isian--terang" id="s-dp" inputmode="numeric">
          </div>
          <div>
            <label class="label label--gelap" for="s-tenor">Tenor (bulan)</label>
            <input class="isian isian--terang" id="s-tenor" inputmode="numeric"
                   value="${draft.tenor || ""}">
          </div>
        </div>
        <label class="label label--gelap" for="s-angsuran">Angsuran per bulan</label>
        <input class="isian isian--terang" id="s-angsuran" inputmode="numeric">
      </div>

      <div class="pemisah">Agen</div>
      <div class="dua">
        <input class="isian isian--terang kecil" id="s-agen"
               value="${aman(draft.agenNama)}" placeholder="Nama agen">
        <input class="isian isian--terang kecil" id="s-fee"
               inputmode="numeric" placeholder="Fee">
      </div>
      <p class="petunjuk">Fee agen mengurangi laba unit ini. Kosongkan
        kalau penjualan langsung tanpa perantara.</p>
      ${tombolNav(true)}`;
  }

  function pasang3() {
    ["s-dp", "s-angsuran", "s-fee"].forEach((id) =>
      pasangFormatUang(wadah.querySelector("#" + id)));
    const kredit = wadah.querySelector("#isian-kredit");
    kredit.hidden = draft.metode !== "kredit";

    wadah.querySelector("#metode").addEventListener("click", (e) => {
      const t = e.target.closest("[data-m]");
      if (!t) return;
      draft.metode = t.dataset.m;
      wadah.querySelectorAll("#metode .chip")
        .forEach((c) => c.classList.toggle("aktif", c === t));
      kredit.hidden = draft.metode !== "kredit";
    });

    pasangNav(async () => {
      draft.leasing = wadah.querySelector("#s-leasing").value.trim();
      draft.dp = bacaAngka(wadah.querySelector("#s-dp"));
      draft.tenor = Number(wadah.querySelector("#s-tenor").value || 0);
      draft.angsuran = bacaAngka(wadah.querySelector("#s-angsuran"));
      draft.agenNama = wadah.querySelector("#s-agen").value.trim();
      draft.agenFee = bacaAngka(wadah.querySelector("#s-fee"));
      if (draft.metode === "kredit" && !draft.leasing) {
        kabar("Nama leasing wajib diisi untuk penjualan kredit.", "rem");
        return;
      }
      const tombol = wadah.querySelector("#maju");
      tombol.disabled = true;
      tombol.textContent = "Menyimpan…";
      try {
        await simpan(draft);
        wadah.innerHTML = "";
        await selesai();
      } catch (err) {
        kabar("Gagal menyimpan SPK: " + err.message, "rem");
        tombol.disabled = false;
        tombol.textContent = "Simpan SPK";
      }
    });
  }
}

// ── Penyimpanan ───────────────────────────────────────────────
async function simpan(d) {
  let pelangganId = d.pelangganId;
  if (!pelangganId && d.pelangganBaru) {
    pelangganId = await simpanPelanggan(d.pelangganBaru);
  }
  const pel = pelangganDari(pelangganId);
  const t = tipeDari(d.tipeId);
  const h = hitung(d.hargaOtr, d.potongan, t.mewah);
  const perlu = perluPersetujuan(sesi.peran, h.bebanShowroom);

  const kode = await nomorBerikutnya(
    `spk_${new Date().getFullYear()}`, "SPK"
  );
  const ref = doc(collection(dbase, "transaksi"));
  const batch = writeBatch(dbase);

  batch.set(ref, {
    kode,
    statusSPK: perlu ? "menunggu_persetujuan" : "diajukan",
    tipeId: d.tipeId,
    tipeSnapshot: {
      nama: `${t.merek} ${t.tipe} ${t.varian || ""}`.trim(),
      cc: t.cc || null, mewah: !!t.mewah,
    },
    unitId: null,          // diisi saat unit ditebus dari main dealer
    warna: d.warna,
    pelangganId,
    pelangganSnapshot: {
      nama: pel?.nama || "", telepon: pel?.telepon || "", nik: pel?.nik || "",
    },
    salesId: sesi.uid,
    salesNama: sesi.nama,
    agen: d.agenNama
      ? { nama: d.agenNama, fee: d.agenFee, statusBayar: "belum" }
      : null,
    hargaOtr: d.hargaOtr,
    potongan: d.potongan,
    hargaNet: h.hargaNet,
    dpp: h.dpp,
    ppn: h.ppn,
    bebanShowroom: h.bebanShowroom,
    piutangProgram: h.piutangProgram,
    metode: d.metode,
    kredit: d.metode === "kredit"
      ? {
          leasing: d.leasing, dp: d.dp, tenor: d.tenor,
          angsuran: d.angsuran, statusApproval: "menunggu",
        }
      : null,
    persetujuan: perlu ? { perlu: true } : null,
    totalDibayar: 0,
    sisa: h.hargaNet,
    statusBayar: "belum",
    terbilang: terbilang(h.hargaNet),
    penerbit: SHOWROOM.nama,
    ...tandaBaru(),
  });

  sertakanLog(batch, "spk_dibuat", {
    koleksi: "transaksi", docId: ref.id,
    ringkas: `${kode} · ${rupiah(h.hargaNet)}`,
    bebanShowroom: h.bebanShowroom,
    perluPersetujuan: perlu,
  });

  await batch.commit();
  kabar(
    perlu
      ? `${kode} tersimpan — menunggu persetujuan owner.`
      : `${kode} tersimpan.`,
    perlu ? "info" : "netral"
  );
}

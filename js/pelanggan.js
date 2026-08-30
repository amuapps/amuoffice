// pelanggan.js — data pembeli.
// Dipisah dari berkas identitas (KTP/KK) yang hanya boleh dibuka
// owner dan admin. Yang di sini cukup untuk menelepon dan untuk
// melengkapi faktur pajak.

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, writeBatch, query, where,
  orderBy, limit, serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.10.0";
import { bolehAkses, sesi } from "./auth.js?v=3.10.0";
import { aman, kabar, tanggal, rupiah, pasangHurufBesar, namaTampilan } from "./ui.js?v=3.10.0";
import { konfirmasi } from "./dialog.js?v=3.10.0";
import { cetakSpk, mintaCetakKuitansi, labelTombolKuitansi, sudahLunas,
  cetakUlangKuitansiTerakhir } from "./cetak.js?v=3.10.0";
import { pasangEditPelangganSpk, mintaBatalkanSpk } from "./spk.js?v=3.10.0";
import { muatRiwayatDokumen, htmlRiwayatDokumen } from "./log.js?v=3.10.0";
import { muatSaranKecamatan, muatSaranKota, tambahSaranOtomatis }
  from "./referensi.js?v=3.10.0";

let cache = [];

export async function muatPelanggan(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(query(
    collection(dbase, "pelanggan"), orderBy("nama"), limit(300)
  ));
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

export function pelangganDari(id) {
  return cache.find((p) => p.id === id);
}

export async function simpanPelanggan(data, id) {
  const ref = id
    ? doc(dbase, "pelanggan", id)
    : doc(collection(dbase, "pelanggan"));
  const isi = { ...data, diubahPada: serverTimestamp() };
  if (!id) Object.assign(isi, tandaBaru());
  await setDoc(ref, isi, { merge: true });
  await catat(id ? "pelanggan_diubah" : "pelanggan_ditambah", {
    koleksi: "pelanggan", docId: ref.id, ringkas: data.nama,
  });
  // Kecamatan/Kota yang baru diketik otomatis nambah ke Referensi,
  // supaya makin lama makin jarang perlu ketik manual dari nol.
  tambahSaranOtomatis("kecamatan", data.kecamatan);
  tambahSaranOtomatis("kota", data.kota);
  await muatPelanggan(true);
  return ref.id;
}

// ── Sinkronkan ke SPK terkait — SATU ARAH: Database Konsumen → SPK ──
// (arah sebaliknya, SPK → Database Konsumen, sudah ada di spk.js
// lewat simpanPelangganOtomatis). Cuma SPK yang kuitansinya BELUM
// tercetak yang ikut diperbarui — yang SUDAH tercetak dianggap
// dokumen resmi yang beku, tidak boleh diam-diam berubah dari sini.
// Dipanggil SETELAH simpanPelanggan berhasil, cuma untuk konsumen
// yang SUDAH ada sebelumnya (bukan baru ditambah — belum ada SPK
// yang terkait kalau baru).
export async function sinkronKePelangganTerkait(id, data) {
  const [snapPembeli, snapPemakai] = await Promise.all([
    getDocs(query(collection(dbase, "transaksi"), where("pembeliId", "==", id))),
    getDocs(query(collection(dbase, "transaksi"), where("pemakaiId", "==", id))),
  ]);
  const perluDiubah = new Map(); // docId -> { sebagaiPembeli, sebagaiPemakai }
  snapPembeli.docs.forEach((d) => {
    const t = d.data();
    if (t.kuitansiTercetak) return; // dilindungi, lewati
    perluDiubah.set(d.id, { ...(perluDiubah.get(d.id) || {}), sebagaiPembeli: true });
  });
  snapPemakai.docs.forEach((d) => {
    const t = d.data();
    if (t.kuitansiTercetak) return;
    if (t.pemakaiSamaDenganPembeli !== false) return; // pemakai = ikut pembeli, tidak ada objek pemakai terpisah
    perluDiubah.set(d.id, { ...(perluDiubah.get(d.id) || {}), sebagaiPemakai: true });
  });

  if (!perluDiubah.size) return 0;

  const lanjut = await konfirmasi({
    judul: "Ikut Perbarui SPK Terkait?",
    pesan: `Ada ${perluDiubah.size} SPK yang kuitansinya BELUM tercetak dan ` +
           `memakai data konsumen ini — ikut diperbarui otomatis supaya konsisten? ` +
           `SPK yang kuitansinya SUDAH tercetak TIDAK ikut berubah (dilindungi), ` +
           `kalau perlu dikoreksi juga, lewat "Ubah" di SPK itu sendiri.`,
    oke: `Ya, Perbarui ${perluDiubah.size} SPK`, batal: "Tidak, Cukup di Sini",
  });
  if (!lanjut) return 0;

  const batch = writeBatch(dbase);
  for (const [docId, tandai] of perluDiubah) {
    const perubahan = {};
    if (tandai.sebagaiPembeli) perubahan.pembeli = data;
    if (tandai.sebagaiPemakai) perubahan.pemakai = data;
    batch.update(doc(dbase, "transaksi", docId), perubahan);
  }
  await batch.commit();
  await catat("pelanggan_sinkron_ke_spk", {
    koleksi: "pelanggan", docId: id,
    ringkas: `${data.nama} · ${perluDiubah.size} SPK diperbarui`,
  });
  return perluDiubah.size;
}

// ── Simpan otomatis dari transaksi ──────────────────────────────
// Dipanggil dari form SPK (atau modul transaksi lain) nanti: begitu
// data pembeli diisi di sana, baris ini otomatis ditambah atau
// diperbarui di database konsumen — tidak perlu input dua kali.
//
// Dicocokkan lewat NIK. Kalau NIK belum diisi, selalu dibuat baris
// baru (belum ada cara memastikan itu orang yang sama tanpa NIK).
// Field yang datang kosong tidak menimpa data lama yang sudah ada,
// supaya pengisian NIK belakangan tidak menghapus alamat yang sudah
// tercatat sebelumnya.
export async function simpanPelangganOtomatis(data) {
  const nik = (data.nik || "").trim();
  const telepon = (data.telepon || "").trim();

  // Cocokkan siapa pun yang lebih dulu mengisi identitas kuat
  // (NIK) — paling diutamakan, karena paling jarang salah/tertukar.
  if (nik) {
    const snap = await getDocs(query(
      collection(dbase, "pelanggan"), where("nik", "==", nik), limit(1)
    ));
    if (!snap.empty) {
      const ada = snap.docs[0];
      const gabung = { ...ada.data() };
      Object.entries(data).forEach(([k, v]) => { if (v) gabung[k] = v; });
      return await simpanPelanggan(gabung, ada.id);
    }
  }

  // NIK belum diisi (boleh, sesuai desain — "boleh diisi belakangan")
  // — coba cocokkan dari nomor telepon sebagai cadangan, supaya
  // konsumen yang sama tidak sampai tercatat dobel cuma karena
  // NIK-nya belum sempat diisi sales yang menanganinya sekarang.
  if (telepon) {
    const snap = await getDocs(query(
      collection(dbase, "pelanggan"), where("telepon", "==", telepon), limit(1)
    ));
    if (!snap.empty) {
      const ada = snap.docs[0];
      const gabung = { ...ada.data() };
      Object.entries(data).forEach(([k, v]) => { if (v) gabung[k] = v; });
      return await simpanPelanggan(gabung, ada.id);
    }
  }

  return await simpanPelanggan(data, null);
}

export function formPelanggan(p = {}, awalan = "p", saranKecamatan = [], saranKota = []) {
  return `
    <label class="label label--gelap" for="${awalan}-nama">Nama lengkap</label>
    <input class="isian isian--terang" id="${awalan}-nama"
           value="${aman(p.nama || "")}" placeholder="Sesuai KTP">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="${awalan}-telepon">Telepon</label>
        <input class="isian isian--terang mono" id="${awalan}-telepon"
               inputmode="tel" value="${aman(p.telepon || "")}"
               placeholder="08…">
      </div>
      <div>
        <label class="label label--gelap" for="${awalan}-nik">NIK</label>
        <input class="isian isian--terang mono" id="${awalan}-nik"
               inputmode="numeric" value="${aman(p.nik || "")}"
               placeholder="16 digit">
      </div>
    </div>
    <p class="petunjuk">NIK diperlukan untuk faktur pajak. Boleh diisi
      belakangan, tapi harus lengkap sebelum pelunasan.</p>
    <label class="label label--gelap" for="${awalan}-alamat">Alamat</label>
    <input class="isian isian--terang" id="${awalan}-alamat"
           value="${aman(p.alamat || "")}" placeholder="Sesuai KTP">
    <label class="label label--gelap" for="${awalan}-kelurahan">Kelurahan</label>
    <input class="isian isian--terang" id="${awalan}-kelurahan"
           value="${aman(p.kelurahan || "")}">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="${awalan}-kecamatan">Kecamatan</label>
        <input class="isian isian--terang" id="${awalan}-kecamatan"
               list="daftar-kecamatan-${awalan}" value="${aman(p.kecamatan || "")}">
        <datalist id="daftar-kecamatan-${awalan}">
          ${saranKecamatan.map((x) => `<option value="${aman(x)}">`).join("")}
        </datalist>
      </div>
      <div>
        <label class="label label--gelap" for="${awalan}-kota">Kabupaten/Kota</label>
        <input class="isian isian--terang" id="${awalan}-kota"
               list="daftar-kota-${awalan}" value="${aman(p.kota || "")}">
        <datalist id="daftar-kota-${awalan}">
          ${saranKota.map((x) => `<option value="${aman(x)}">`).join("")}
        </datalist>
      </div>
    </div>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="${awalan}-provinsi">Provinsi</label>
        <input class="isian isian--terang" id="${awalan}-provinsi"
               value="${aman(p.provinsi || "")}">
      </div>
      <div>
        <label class="label label--gelap" for="${awalan}-kodepos">Kode pos</label>
        <input class="isian isian--terang mono" id="${awalan}-kodepos"
               inputmode="numeric" value="${aman(p.kodePos || "")}">
      </div>
    </div>
    <label class="label label--gelap" for="${awalan}-email">Email</label>
    <input class="isian isian--terang" id="${awalan}-email" type="email"
           value="${aman(p.email || "")}" placeholder="Opsional">
  `;
}

export function bacaFormPelanggan(wadah, awalan = "p") {
  const v = (id) => {
    const el = wadah.querySelector(`#${awalan}-${id}`);
    return el ? el.value.trim() : "";
  };
  return {
    nama: v("nama"),
    telepon: v("telepon").replace(/\s/g, ""),
    nik: v("nik").replace(/\D/g, ""),
    alamat: v("alamat"),
    kelurahan: v("kelurahan"),
    kecamatan: v("kecamatan"),
    kota: v("kota"),
    provinsi: v("provinsi"),
    kodePos: v("kodepos"),
    email: v("email"),
  };
}

// Kapital otomatis untuk field bertulisan bebas — TIDAK untuk
// telepon/NIK (angka) atau email (biasa diketik huruf kecil).
export function pasangHurufBesarPelanggan(wadah, awalan = "p") {
  ["nama", "alamat", "kelurahan", "kecamatan", "kota", "provinsi"].forEach((id) =>
    pasangHurufBesar(wadah.querySelector(`#${awalan}-${id}`)));
}

// ── Riwayat pesanan seorang konsumen ─────────────────────────────
// Dicek dari DUA sisi: sebagai pembeli, dan sebagai pemakai (siapa
// tahu orang yang sama pernah jadi pemakai di SPK punya orang lain).
// Firestore tidak bisa OR dua field beda dalam satu query, jadi
// dijalankan dua query terpisah lalu digabung, dobelnya dibuang.
export async function muatPesananPelanggan(pelangganId) {
  // Sales cuma boleh lihat pesanan yang dia buat sendiri — walau
  // konsumennya sama, order dari sales lain tidak boleh kelihatan.
  const filterSales = sesi && sesi.peran === "sales"
    ? [where("salesUid", "==", sesi.uid)] : [];

  const [snapPembeli, snapPemakai] = await Promise.all([
    getDocs(query(collection(dbase, "transaksi"),
      where("pembeliId", "==", pelangganId), ...filterSales)),
    getDocs(query(collection(dbase, "transaksi"),
      where("pemakaiId", "==", pelangganId), ...filterSales)),
  ]);
  const semua = new Map();
  [...snapPembeli.docs, ...snapPemakai.docs].forEach((d) =>
    semua.set(d.id, { id: d.id, ...d.data() }));
  return [...semua.values()]
    .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
}

const LABEL_KONDISI = { ready: "Dipesan (unit terkunci)", indent: "Indent" };

function badgeCaraBayar(t) {
  const kredit = (t.caraBayar || []).includes("kredit");
  return kredit
    ? `<span class="tanda tanda--kredit">Kredit</span>`
    : `<span class="tanda tanda--cash">Cash</span>`;
}

function kartuPesanan(t) {
  const batal = t.status === "batal";
  return `<article class="kartu" style="${batal ? "opacity:.55" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(t.spkNo)}</h3>
        <p class="kartu-sub">${aman(t.tipeNama)} · ${aman(t.warna)}</p>
      </div>
      <div style="display:flex;gap:6px;align-items:flex-start">
        ${!batal ? badgeCaraBayar(t) : ""}
        ${batal
          ? `<span class="tanda tanda--batal">Batal</span>`
          : `<span class="tanda ${t.kondisiUnit === "ready" ? "tanda--ready" : "tanda--uji"}">
              ${LABEL_KONDISI[t.kondisiUnit] || t.kondisiUnit}</span>`}
      </div>
    </div>
    <dl class="rinci">
      <div><dt>Harga OTR</dt><dd>${rupiah(t.hargaOtr)}</dd></div>
      <div><dt>Cara bayar</dt><dd>${aman((t.caraBayar || []).join(", "))}</dd></div>
      <div><dt>Sales</dt><dd>${aman(namaTampilan(t.salesPeran, t.salesNama))}</dd></div>
      <div><dt>Tanggal</dt><dd>${tanggal(t.dibuatPada)}</dd></div>
      ${batal ? `<div><dt>Alasan Batal</dt><dd>${aman(t.alasanBatal || "-")}</dd></div>` : ""}
    </dl>
    ${!batal ? `
      ${bolehAkses("cetak.dokumen") ? `
        <button class="tombol tombol--kecil" data-cetak-pesanan="${t.id}">Cetak SPK</button>
        <button class="tombol tombol--kecil" data-kuitansi-pesanan="${t.id}">
          ${labelTombolKuitansi(t)}</button>
        ${t.kuitansiTercetak && !sudahLunas(t) ? `<button class="tombol tombol--kecil"
          data-cetak-ulang-pesanan="${t.id}">Cetak Ulang</button>` : ""}` : ""}
      <button class="tombol tombol--kecil" data-ubah-pesanan="${t.id}">Ubah Pembeli/Pemakai</button>
      <button class="tombol tombol--kecil" data-batalkan-pesanan="${t.id}">Batalkan SPK</button>
      <div data-wadah-edit-pesanan="${t.id}"></div>
    ` : ""}
  </article>`;
}

function barisPelanggan(p, nomor, peranP) {
  const labelPeran = peranP === "keduanya" ? "Pembeli &amp; Nama STNK"
    : peranP === "pembeli" ? "Pembeli"
    : peranP === "pemakai" ? "Nama STNK"
    : "-";
  return `<tr>
    <td class="mono">${nomor}</td>
    <td>${aman(p.nama)}${!p.nik ? ` <span class="tanda tanda--batal" style="font-size:9px">
      NIK belum diisi</span>` : ""}</td>
    <td class="mono">${aman(p.telepon || "-")}</td>
    <td>${labelPeran}</td>
    <td style="white-space:nowrap">
      <button class="tombol tombol--kecil" data-detail="${p.id}">Detail</button>
      <button class="tombol tombol--kecil" data-ubah="${p.id}">Ubah</button>
    </td>
  </tr>
  <tr data-baris-detail-pelanggan="${p.id}" hidden>
    <td colspan="5"><div class="wadah-pesanan" data-wadah-pesanan="${p.id}"></div></td>
  </tr>`;
}

// Panel Detail ringkas: nama, unit, cash/kredit, no HP per pesanan —
// beda dari kartuPesanan (yang lebih lengkap dengan tombol cetak),
// ini cuma buat lihat sekilas cepat.
function ringkasDetailPelanggan(p, pesanan) {
  const baris2 = (label, isi) => `<div class="d-baris">
    <span class="d-label">${aman(label)}</span><span class="d-isi">${isi}</span></div>`;
  return `<div class="d-panel">
    <div class="d-kolom" style="flex-basis:100%">
      ${baris2("Nama", aman(p.nama))}
      ${baris2("No. HP", aman(p.telepon || "-"))}
    </div>
    ${pesanan.length ? pesanan.map((t) => `<div class="d-kolom">
      <p class="d-judul">${aman(t.spkNo)}</p>
      ${baris2("Unit", `${aman(t.tipeNama)} · ${aman(t.warna)}`)}
      ${baris2("Cara Bayar", (t.caraBayar || []).includes("kredit") ? "Kredit" : "Cash")}
    </div>`).join("") : `<p class="hampa" style="flex-basis:100%">Belum ada pesanan.</p>`}
  </div>`;
}

export async function halamanPelanggan(wadah) {
  const bisaUbah = bolehAkses("spk.buat");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Database Konsumen</h2>
      <div style="display:flex;gap:8px">
        <button class="tombol tombol--kecil" id="toggle-filter-pelanggan">Filter</button>
        ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
          id="tambah-pelanggan">Tambah</button>` : ""}
      </div>
    </div>
    <input class="isian isian--terang" id="cari-pelanggan"
           placeholder="Cari nama atau nomor telepon">

    <div id="panel-filter-pelanggan" class="lembar" style="margin-top:10px" hidden>
      <label class="label label--gelap" for="f-peran-pelanggan">Peran</label>
      <select class="isian isian--terang" id="f-peran-pelanggan">
        <option value="">— semua —</option>
        <option value="pembeli">Pembeli saja</option>
        <option value="pemakai">Nama STNK saja</option>
        <option value="keduanya">Pernah jadi keduanya</option>
      </select>
    </div>

    <div id="form-pelanggan-wadah"></div>
    <div style="overflow-x:auto; margin-top:14px">
      <table class="tabel">
        <thead>
          <tr><th>No</th><th>Nama</th><th>No. HP</th><th>Peran</th><th></th></tr>
        </thead>
        <tbody id="daftar-pelanggan">
          <tr><td colspan="5" class="hampa">Memuat…</td></tr>
        </tbody>
      </table>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-pelanggan");
  const formEl = wadah.querySelector("#form-pelanggan-wadah");
  const cariEl = wadah.querySelector("#cari-pelanggan");
  const peranEl = wadah.querySelector("#f-peran-pelanggan");

  wadah.querySelector("#toggle-filter-pelanggan").addEventListener("click", () => {
    const p = wadah.querySelector("#panel-filter-pelanggan");
    p.hidden = !p.hidden;
  });

  // Satu data konsumen bisa berperan sebagai Pembeli di satu SPK,
  // dan/atau jadi Nama STNK (pemakai) di SPK lain — dicek dari
  // seluruh transaksi yang relevan (disaring per-sales kalau perlu,
  // sama seperti pembatasan "lihat punya sendiri" di atas).
  async function klasifikasiPeran() {
    const filterSales = sesi && sesi.peran === "sales"
      ? [where("salesUid", "==", sesi.uid)] : [];
    const snap = await getDocs(query(
      collection(dbase, "transaksi"), ...filterSales
    ));
    const idMilik = filterSales.length ? new Set() : null;
    const idPembeli = new Set();
    const idPemakai = new Set();
    snap.docs.forEach((d) => {
      const t = d.data();
      if (t.pembeliId) {
        idPembeli.add(t.pembeliId);
        if (idMilik) idMilik.add(t.pembeliId);
      }
      if (t.pemakaiId && t.pemakaiSamaDenganPembeli === false) {
        idPemakai.add(t.pemakaiId);
        if (idMilik) idMilik.add(t.pemakaiId);
      }
    });
    return { idMilik, idPembeli, idPemakai };
  }

  function peranUntuk(id, k) {
    const p = k.idPembeli.has(id);
    const s = k.idPemakai.has(id);
    if (p && s) return "keduanya";
    if (p) return "pembeli";
    if (s) return "pemakai";
    return "";
  }

  let daftarUntukSaya = null; // cache daftar milik sales (null = tidak dibatasi)
  let klasifikasi = { idMilik: null, idPembeli: new Set(), idPemakai: new Set() };

  async function gambar() {
    const semua = await muatPelanggan(true);
    klasifikasi = await klasifikasiPeran();
    daftarUntukSaya = klasifikasi.idMilik
      ? semua.filter((p) => klasifikasi.idMilik.has(p.id)) : semua;
    tapis(daftarUntukSaya);
  }

  function tapis(semua) {
    const q = cariEl.value.trim().toLowerCase();
    const peran = peranEl.value;
    let hasil = q
      ? semua.filter((p) =>
          (p.nama || "").toLowerCase().includes(q) ||
          (p.telepon || "").includes(q))
      : semua;
    if (peran) {
      hasil = hasil.filter((p) => {
        const r = peranUntuk(p.id, klasifikasi);
        return peran === "keduanya" ? r === "keduanya" : (r === peran || r === "keduanya");
      });
    }
    daftarEl.innerHTML = hasil.length
      ? hasil.map((p, i) => barisPelanggan(p, i + 1, peranUntuk(p.id, klasifikasi))).join("")
      : `<tr><td colspan="5" class="hampa">${
          q || peran ? "Tidak ada yang cocok." : "Belum ada pelanggan terdaftar."
        }</td></tr>`;
    if (bisaUbah) {
      daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
        b.addEventListener("click", () => buka(pelangganDari(b.dataset.ubah))));
    }
    daftarEl.querySelectorAll("[data-detail]").forEach((b) =>
      b.addEventListener("click", () => bukaPesanan(b.dataset.detail)));
  }
  peranEl.addEventListener("change", () => tapis(daftarUntukSaya || []));

  async function bukaPesanan(id) {
    const barisSembunyi = daftarEl.querySelector(`[data-baris-detail-pelanggan="${id}"]`);
    const wadahPesanan = daftarEl.querySelector(`[data-wadah-pesanan="${id}"]`);
    if (!wadahPesanan || !barisSembunyi) return;
    // Toggle: klik lagi untuk menutup.
    if (!barisSembunyi.hidden) {
      barisSembunyi.hidden = true;
      wadahPesanan.innerHTML = "";
      wadahPesanan.dataset.terbuka = "0";
      return;
    }
    barisSembunyi.hidden = false;
    wadahPesanan.innerHTML = `<p class="hampa">Memuat pesanan…</p>`;
    wadahPesanan.dataset.terbuka = "1";
    try {
      const pesanan = await muatPesananPelanggan(id);
      const p = pelangganDari(id) || { id, nama: "-", telepon: "" };
      wadahPesanan.innerHTML = ringkasDetailPelanggan(p, pesanan.filter((t) => t.status !== "batal")) +
        (pesanan.length
          ? `<div class="pemisah">Riwayat Pesanan (${pesanan.length})</div>` +
            pesanan.map(kartuPesanan).join("")
          : `<p class="hampa">Belum ada pesanan/SPK untuk konsumen ini.</p>`) +
        (sesi && sesi.peran === "owner"
          ? htmlRiwayatDokumen(await muatRiwayatDokumen("pelanggan", id))
          : "");
      wadahPesanan.querySelectorAll("[data-cetak-pesanan]").forEach((b) =>
        b.addEventListener("click", () =>
          cetakSpk(pesanan.find((x) => x.id === b.dataset.cetakPesanan))));
      wadahPesanan.querySelectorAll("[data-kuitansi-pesanan]").forEach((b) =>
        b.addEventListener("click", () => {
          const t = pesanan.find((x) => x.id === b.dataset.kuitansiPesanan);
          mintaCetakKuitansi(t, () => {
            wadahPesanan.dataset.terbuka = "0";
            return bukaPesanan(id);
          });
        }));
      wadahPesanan.querySelectorAll("[data-cetak-ulang-pesanan]").forEach((b) =>
        b.addEventListener("click", () => {
          const t = pesanan.find((x) => x.id === b.dataset.cetakUlangPesanan);
          cetakUlangKuitansiTerakhir(t);
        }));
      wadahPesanan.querySelectorAll("[data-ubah-pesanan]").forEach((b) =>
        b.addEventListener("click", () => {
          const t = pesanan.find((x) => x.id === b.dataset.ubahPesanan);
          const target = wadahPesanan.querySelector(
            `[data-wadah-edit-pesanan="${t.id}"]`);
          pasangEditPelangganSpk(target, t, () => {
            // Reset flag toggle dulu, supaya panggilan ulang bukaPesanan
            // memuat ulang datanya (bukan malah menutup panelnya).
            wadahPesanan.dataset.terbuka = "0";
            return bukaPesanan(id);
          });
        }));
      wadahPesanan.querySelectorAll("[data-batalkan-pesanan]").forEach((b) =>
        b.addEventListener("click", () => {
          const t = pesanan.find((x) => x.id === b.dataset.batalkanPesanan);
          mintaBatalkanSpk(t, () => {
            wadahPesanan.dataset.terbuka = "0";
            return bukaPesanan(id);
          });
        }));
    } catch (err) {
      wadahPesanan.innerHTML = `<p class="hampa">Gagal memuat pesanan: ${
        aman(err.message)}</p>`;
    }
  }

  cariEl.addEventListener("input", () => tapis(daftarUntukSaya || cache));

  async function buka(p) {
    formEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    const [saranKecamatan, saranKota] = await Promise.all([
      muatSaranKecamatan(), muatSaranKota(),
    ]).catch(() => [[], []]);
    formEl.innerHTML = `<form class="form" id="form-pelanggan">
      ${formPelanggan(p || {}, "p", saranKecamatan, saranKota)}
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">Simpan</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-pelanggan">Batal</button>
      </div>
    </form>`;
    pasangHurufBesarPelanggan(formEl, "p");
    formEl.querySelector("#batal-pelanggan")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-pelanggan")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = bacaFormPelanggan(formEl);
        if (!data.nama) { kabar("Nama wajib diisi.", "rem"); return; }
        try {
          const idTersimpan = await simpanPelanggan(data, p ? p.id : null);
          formEl.innerHTML = "";
          await gambar();
          kabar("Pelanggan tersimpan.", "netral");
          // Sinkron ke SPK terkait cuma relevan buat konsumen yang
          // SUDAH ada (baru ditambah = belum ada SPK apa pun) DAN
          // cuma Owner (rules Firestore cuma izinkan Owner menulis
          // field pembeli/pemakai ke transaksi — Admin/Sales dibatasi
          // cuma field pembayaran, lihat firestore.rules).
          if (p && sesi && sesi.peran === "owner") {
            const jumlah = await sinkronKePelangganTerkait(idTersimpan, data);
            if (jumlah > 0) kabar(`${jumlah} SPK ikut diperbarui.`, "netral");
          }
        } catch (err) {
          kabar("Gagal menyimpan: " + err.message, "rem");
        }
      });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-pelanggan")
      .addEventListener("click", () => buka(null));
  }
  await gambar();
}

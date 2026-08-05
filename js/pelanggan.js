// pelanggan.js — data pembeli.
// Dipisah dari berkas identitas (KTP/KK) yang hanya boleh dibuka
// owner dan admin. Yang di sini cukup untuk menelepon dan untuk
// melengkapi faktur pajak.

import {
  dbase, collection, doc, getDocs, setDoc, query, where, orderBy, limit,
  serverTimestamp, catat, tandaBaru,
} from "./db.js";
import { bolehAkses } from "./auth.js";
import { aman, kabar, tanggal, rupiah, pasangHurufBesar } from "./ui.js";
import { cetakSpk, mintaCetakKuitansi } from "./cetak.js";
import { pasangEditPelangganSpk } from "./spk.js";
import { muatSaranKecamatan, muatSaranKota, tambahSaranOtomatis }
  from "./referensi.js";

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
  const [snapPembeli, snapPemakai] = await Promise.all([
    getDocs(query(collection(dbase, "transaksi"),
      where("pembeliId", "==", pelangganId))),
    getDocs(query(collection(dbase, "transaksi"),
      where("pemakaiId", "==", pelangganId))),
  ]);
  const semua = new Map();
  [...snapPembeli.docs, ...snapPemakai.docs].forEach((d) =>
    semua.set(d.id, { id: d.id, ...d.data() }));
  return [...semua.values()]
    .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
}

const LABEL_KONDISI = { ready: "Dipesan (unit terkunci)", indent: "Indent" };

function kartuPesanan(t) {
  return `<article class="kartu">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(t.spkNo)}</h3>
        <p class="kartu-sub">${aman(t.tipeNama)} · ${aman(t.warna)}</p>
      </div>
      <span class="tanda ${t.kondisiUnit === "ready" ? "tanda--ready" : "tanda--uji"}">
        ${LABEL_KONDISI[t.kondisiUnit] || t.kondisiUnit}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>Harga OTR</dt><dd>${rupiah(t.hargaOtr)}</dd></div>
      <div><dt>Cara bayar</dt><dd>${aman((t.caraBayar || []).join(", "))}</dd></div>
      <div><dt>Sales</dt><dd>${aman(t.salesNama)}</dd></div>
      <div><dt>Tanggal</dt><dd>${tanggal(t.dibuatPada)}</dd></div>
    </dl>
    <button class="tombol tombol--kecil" data-cetak-pesanan="${t.id}">Cetak SPK</button>
    <button class="tombol tombol--kecil" data-kuitansi-pesanan="${t.id}">
      ${t.kuitansiTercetak ? "Cetak Ulang Kuitansi" : "Cetak Kuitansi"}</button>
    <button class="tombol tombol--kecil" data-ubah-pesanan="${t.id}">Ubah Pembeli/Pemakai</button>
    <div data-wadah-edit-pesanan="${t.id}"></div>
  </article>`;
}

function kartuPelanggan(p) {
  return `<article class="kartu">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(p.nama)}</h3>
        <p class="kartu-sub mono">${aman(p.telepon || "tanpa nomor")}</p>
      </div>
      <div class="aksi aksi--rapat">
        <button class="tombol tombol--kecil" data-pesanan="${p.id}">Lihat Pesanan</button>
        <button class="tombol tombol--kecil" data-ubah="${p.id}">Ubah</button>
      </div>
    </div>
    ${p.alamat ? `<p class="kartu-rinci">${aman(p.alamat)}${
      [p.kelurahan, p.kecamatan, p.kota, p.provinsi].filter(Boolean).length
        ? ", " + aman([p.kelurahan, p.kecamatan, p.kota, p.provinsi]
            .filter(Boolean).join(", "))
        : ""
    }</p>` : ""}
    ${!p.nik ? `<p class="kartu-rinci peringatan">NIK belum diisi</p>` : ""}
    <p class="kartu-rinci">Terdaftar ${tanggal(p.dibuatPada)}</p>
    <div class="wadah-pesanan" data-wadah-pesanan="${p.id}"></div>
  </article>`;
}

export async function halamanPelanggan(wadah) {
  const bisaUbah = bolehAkses("spk.buat");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Database Konsumen</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="tambah-pelanggan">Tambah</button>` : ""}
    </div>
    <input class="isian isian--terang" id="cari-pelanggan"
           placeholder="Cari nama atau nomor telepon">
    <div id="form-pelanggan-wadah"></div>
    <div id="daftar-pelanggan" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-pelanggan");
  const formEl = wadah.querySelector("#form-pelanggan-wadah");
  const cariEl = wadah.querySelector("#cari-pelanggan");

  async function gambar() {
    const semua = await muatPelanggan(true);
    tapis(semua);
  }

  function tapis(semua) {
    const q = cariEl.value.trim().toLowerCase();
    const hasil = q
      ? semua.filter((p) =>
          (p.nama || "").toLowerCase().includes(q) ||
          (p.telepon || "").includes(q))
      : semua;
    daftarEl.innerHTML = hasil.length
      ? hasil.map(kartuPelanggan).join("")
      : `<div class="hampa"><p>${
          q ? "Tidak ada yang cocok." : "Belum ada pelanggan terdaftar."
        }</p></div>`;
    if (bisaUbah) {
      daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
        b.addEventListener("click", () => buka(pelangganDari(b.dataset.ubah))));
    }
    daftarEl.querySelectorAll("[data-pesanan]").forEach((b) =>
      b.addEventListener("click", () => bukaPesanan(b.dataset.pesanan)));
  }

  async function bukaPesanan(id) {
    const wadahPesanan = daftarEl.querySelector(`[data-wadah-pesanan="${id}"]`);
    if (!wadahPesanan) return;
    // Toggle: klik lagi untuk menutup.
    if (wadahPesanan.dataset.terbuka === "1") {
      wadahPesanan.innerHTML = "";
      wadahPesanan.dataset.terbuka = "0";
      return;
    }
    wadahPesanan.innerHTML = `<p class="hampa">Memuat pesanan…</p>`;
    wadahPesanan.dataset.terbuka = "1";
    try {
      const pesanan = await muatPesananPelanggan(id);
      wadahPesanan.innerHTML = pesanan.length
        ? `<div class="pemisah">Pesanan (${pesanan.length})</div>` +
          pesanan.map(kartuPesanan).join("")
        : `<p class="hampa">Belum ada pesanan/SPK untuk konsumen ini.</p>`;
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
    } catch (err) {
      wadahPesanan.innerHTML = `<p class="hampa">Gagal memuat pesanan: ${
        aman(err.message)}</p>`;
    }
  }

  cariEl.addEventListener("input", () => tapis(cache));

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
          await simpanPelanggan(data, p ? p.id : null);
          formEl.innerHTML = "";
          await gambar();
          kabar("Pelanggan tersimpan.", "netral");
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

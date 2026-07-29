// pelanggan.js — data pembeli.
// Dipisah dari berkas identitas (KTP/KK) yang hanya boleh dibuka
// owner dan admin. Yang di sini cukup untuk menelepon dan untuk
// melengkapi faktur pajak.

import {
  dbase, collection, doc, getDocs, setDoc, query, orderBy, limit,
  serverTimestamp, catat, tandaBaru,
} from "./db.js";
import { bolehAkses } from "./auth.js";
import { aman, kabar, tanggal } from "./ui.js";

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
  await muatPelanggan(true);
  return ref.id;
}

export function formPelanggan(p = {}, awalan = "p") {
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
    email: v("email"),
  };
}

function kartuPelanggan(p) {
  return `<article class="kartu">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(p.nama)}</h3>
        <p class="kartu-sub mono">${aman(p.telepon || "tanpa nomor")}</p>
      </div>
      <button class="tombol tombol--kecil" data-ubah="${p.id}">Ubah</button>
    </div>
    ${p.alamat ? `<p class="kartu-rinci">${aman(p.alamat)}</p>` : ""}
    ${!p.nik ? `<p class="kartu-rinci peringatan">NIK belum diisi</p>` : ""}
    <p class="kartu-rinci">Terdaftar ${tanggal(p.dibuatPada)}</p>
  </article>`;
}

export async function halamanPelanggan(wadah) {
  const bisaUbah = bolehAkses("spk.buat");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Pelanggan</h2>
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
  }

  cariEl.addEventListener("input", () => tapis(cache));

  function buka(p) {
    formEl.innerHTML = `<form class="form" id="form-pelanggan">
      ${formPelanggan(p || {})}
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">Simpan</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-pelanggan">Batal</button>
      </div>
    </form>`;
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

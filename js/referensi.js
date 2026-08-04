// referensi.js — daftar saran Tipe Motor & Warna, dulunya statis di
// config.js (TIPE_VESPA, WARNA_VESPA), sekarang bisa diubah sendiri
// lewat halaman ini tanpa perlu edit kode.
//
// Disimpan sebagai DUA dokumen saja (bukan satu koleksi berisi
// banyak dokumen): /referensi/tipe dan /referensi/warna, masing-
// masing berupa satu larik. Cukup untuk daftar pendek begini, dan
// jadi satu kali pembacaan saja tiap form Tipe Motor dibuka.

import {
  dbase, doc, getDoc, setDoc, serverTimestamp, catat,
} from "./db.js";
import { bolehAkses } from "./auth.js";
import { aman, kabar } from "./ui.js";

// Isi awal, dipakai HANYA kalau dokumennya belum pernah dibuat di
// Firestore sama sekali — begitu ada perubahan pertama (tambah/
// hapus), dokumennya langsung dibuat dan daftar ini tidak dipakai
// lagi. Jadi ini cuma titik mula supaya tidak mulai dari kosong.
const AWAL_TIPE = [
  "LX 125 i-get", "S 125 i-get",
  "Primavera 125 i-get", "Primavera 150 i-get", "Primavera S 150",
  "Sprint 150 i-get", "Sprint S 150",
  "GTS 150", "GTS Super 150", "GTS Super Sport 150",
  "GTS 300 HPE", "GTS Super Tech 300 HPE",
  "Sei Giorni II", "946",
];
const AWAL_WARNA = [
  "Bianco Innocenza", "Nero Vulcano", "Rosso Passione",
  "Blu Energia", "Verde Relax", "Giallo Positano",
  "Grigio Materia", "Beige Avvolgente",
];

let cacheTipe = null;
let cacheWarna = null;

async function muatDaftar(kunci, awal) {
  const snap = await getDoc(doc(dbase, "referensi", kunci));
  return snap.exists() ? (snap.data().item || []) : awal;
}

// Dipanggil dari tipe.js untuk mengisi datalist saran.
export async function muatSaranTipe(paksa = false) {
  if (cacheTipe && !paksa) return cacheTipe;
  cacheTipe = await muatDaftar("tipe", AWAL_TIPE);
  return cacheTipe;
}

export async function muatSaranWarna(paksa = false) {
  if (cacheWarna && !paksa) return cacheWarna;
  cacheWarna = await muatDaftar("warna", AWAL_WARNA);
  return cacheWarna;
}

async function simpanDaftar(kunci, item) {
  await setDoc(doc(dbase, "referensi", kunci), {
    item, diubahPada: serverTimestamp(),
  });
  await catat("referensi_diubah", { koleksi: "referensi", docId: kunci });
  if (kunci === "tipe") cacheTipe = item; else cacheWarna = item;
}

// ── Tampilan satu daftar (dipakai dua kali: tipe & warna) ───────
function seksiDaftar(judul, kunci, item, bisaUbah) {
  return `<div class="lembar" style="margin-top:16px">
    <h3 class="judul" style="font-size:16px">${aman(judul)}</h3>
    <div class="chip-baris" id="daftar-${kunci}" style="flex-wrap:wrap">
      ${
        item.length
          ? item.map((x, i) => `<span class="chip aktif" style="gap:6px">
              ${aman(x)}
              ${bisaUbah ? `<button type="button" class="chip-hapus"
                  data-kunci="${kunci}" data-index="${i}"
                  aria-label="Hapus ${aman(x)}"
                  style="border:0;background:transparent;cursor:pointer;
                         font-weight:bold">×</button>` : ""}
            </span>`).join("")
          : `<p class="hampa" style="margin:0">Belum ada.</p>`
      }
    </div>
    ${bisaUbah ? `<form class="form form--baris" id="tambah-${kunci}"
        style="margin-top:10px;display:flex;gap:8px">
        <input class="isian isian--terang" id="input-${kunci}"
               placeholder="Tambah ${aman(judul.toLowerCase())} baru…"
               style="flex:1">
        <button class="tombol tombol--kecil tombol--isi" type="submit">
          Tambah</button>
      </form>` : ""}
  </div>`;
}

export async function halamanReferensi(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Referensi Tipe &amp; Warna</h2>
    </div>
    <p class="petunjuk">Daftar di bawah ini yang muncul sebagai saran
      otomatis saat mengisi form Tipe Motor. Menambah atau menghapus di
      sini tidak mengubah tipe motor yang sudah tersimpan — cuma
      mengubah daftar sarannya.</p>
    <div id="wadah-referensi"><p class="hampa">Memuat…</p></div>
  </section>`;

  const w = wadah.querySelector("#wadah-referensi");

  async function gambar() {
    const [tipe, warna] = await Promise.all([
      muatSaranTipe(true), muatSaranWarna(true),
    ]);
    w.innerHTML =
      seksiDaftar("Tipe Motor", "tipe", tipe, bisaUbah) +
      seksiDaftar("Warna", "warna", warna, bisaUbah);

    if (!bisaUbah) return;

    w.querySelectorAll(".chip-hapus").forEach((b) => {
      b.addEventListener("click", async () => {
        const kunci = b.dataset.kunci;
        const idx = Number(b.dataset.index);
        const daftar = kunci === "tipe" ? [...tipe] : [...warna];
        daftar.splice(idx, 1);
        try {
          await simpanDaftar(kunci, daftar);
          await gambar();
        } catch (err) {
          kabar("Gagal menghapus: " + err.message, "rem");
        }
      });
    });

    ["tipe", "warna"].forEach((kunci) => {
      const form = w.querySelector(`#tambah-${kunci}`);
      if (!form) return;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = w.querySelector(`#input-${kunci}`);
        const nilai = input.value.trim();
        if (!nilai) return;
        const daftar = kunci === "tipe" ? [...tipe] : [...warna];
        if (daftar.includes(nilai)) {
          kabar("Sudah ada di daftar.", "rem");
          return;
        }
        daftar.push(nilai);
        try {
          await simpanDaftar(kunci, daftar);
          await gambar();
          kabar("Ditambahkan.", "netral");
        } catch (err) {
          kabar("Gagal menambah: " + err.message, "rem");
        }
      });
    });
  }

  await gambar();
}

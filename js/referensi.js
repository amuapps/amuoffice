// referensi.js — daftar saran yang bisa berkembang sendiri, dulunya
// statis di config.js (TIPE_VESPA, WARNA_VESPA), sekarang bisa
// diubah lewat halaman ini ATAU bertambah otomatis begitu ada nilai
// baru diketik di form lain (misalnya Kecamatan/Kota di form
// Pembeli — lihat tambahSaranOtomatis di bawah).
//
// Disimpan satu dokumen per daftar: /referensi/{kunci}, isinya satu
// larik teks. Cukup untuk daftar model begini, dan jadi satu kali
// baca saja tiap form yang butuh dibuka.

import {
  dbase, doc, getDoc, setDoc, serverTimestamp, catat,
} from "./db.js?v=3.5.2";
import { bolehAkses } from "./auth.js?v=3.5.2";
import { aman, kabar } from "./ui.js?v=3.5.2";

// Isi awal, dipakai HANYA kalau dokumennya belum pernah dibuat di
// Firestore sama sekali — begitu ada perubahan pertama (tambah/
// hapus), dokumennya langsung dibuat dan daftar ini tidak dipakai
// lagi. Jadi ini cuma titik mula supaya tidak mulai dari kosong.
const AWAL = {
  tipe: [
    "LX 125 i-get", "S 125 i-get",
    "Primavera 125 i-get", "Primavera 150 i-get", "Primavera S 150",
    "Sprint 150 i-get", "Sprint S 150",
    "GTS 150", "GTS Super 150", "GTS Super Sport 150",
    "GTS 300 HPE", "GTS Super Tech 300 HPE",
    "Sei Giorni II", "946",
  ],
  warna: [
    "Bianco Innocenza", "Nero Vulcano", "Rosso Passione",
    "Blu Energia", "Verde Relax", "Giallo Positano",
    "Grigio Materia", "Beige Avvolgente",
  ],
  kecamatan: [],
  kota: [],
};

// Label ramah untuk tiap kunci — dipakai di halaman kelola & pesan.
const JUDUL = {
  tipe: "Tipe Motor", warna: "Warna",
  kecamatan: "Kecamatan", kota: "Kabupaten/Kota",
};

const cache = {}; // { [kunci]: string[] }

async function muatDaftar(kunci) {
  if (cache[kunci]) return cache[kunci];
  const snap = await getDoc(doc(dbase, "referensi", kunci));
  cache[kunci] = snap.exists() ? (snap.data().item || []) : (AWAL[kunci] || []);
  return cache[kunci];
}

async function simpanDaftar(kunci, item) {
  await setDoc(doc(dbase, "referensi", kunci), {
    item, diubahPada: serverTimestamp(),
  });
  await catat("referensi_diubah", { koleksi: "referensi", docId: kunci });
  cache[kunci] = item;
}

// ── Dipanggil dari form Tipe Motor ──────────────────────────────
export async function muatSaranTipe(paksa = false) {
  if (paksa) delete cache.tipe;
  return muatDaftar("tipe");
}
export async function muatSaranWarna(paksa = false) {
  if (paksa) delete cache.warna;
  return muatDaftar("warna");
}

// ── Dipanggil dari form Pembeli/Pemakai (Database Konsumen & SPK) ──
export async function muatSaranKecamatan() { return muatDaftar("kecamatan"); }
export async function muatSaranKota() { return muatDaftar("kota"); }

// Dipanggil setelah form disimpan: kalau isian Kecamatan/Kota-nya
// belum ada di daftar, langsung ditambahkan sendiri — tidak perlu
// owner buka halaman Referensi cuma untuk menambah satu nama daerah.
// Gagal diam-diam kalau ada masalah (koneksi dsb) — ini cuma
// pemanis, tidak boleh sampai bikin gagal simpan data utamanya.
export async function tambahSaranOtomatis(kunci, nilai) {
  const v = (nilai || "").trim();
  if (!v || !JUDUL[kunci]) return;
  try {
    const daftar = await muatDaftar(kunci);
    if (daftar.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    await simpanDaftar(kunci, [...daftar, v]);
  } catch { /* diam-diam saja, ini bukan bagian penting alur simpan */ }
}

// ── Tampilan satu daftar (dipakai berulang di halaman Referensi) ──
// Daftarnya SENGAJA tidak langsung ditampilkan begitu halaman
// dibuka (lihat renderChip di bawah) — biar tidak "semak" walau
// datanya (khususnya Kecamatan/Kota) terus bertambah dari waktu ke
// waktu. Baru muncul begitu mulai mengetik di kotak pencariannya.

function seksiDaftar(kunci, item, bisaUbah) {
  const judul = JUDUL[kunci];
  return `<div class="lembar" style="margin-top:16px">
    <h3 class="judul" style="font-size:16px">${aman(judul)}
      <span style="font-weight:400;color:var(--abu-2);font-size:13px">
        (${item.length})</span></h3>
    <input class="isian isian--terang" id="cari-${kunci}"
           placeholder="Cari ${aman(judul.toLowerCase())}…" style="margin:10px 0">
    <div class="chip-baris" id="daftar-${kunci}" style="flex-wrap:wrap"></div>
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
  const semuaKunci = Object.keys(JUDUL);

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Referensi &amp; Saran Isian</h2>
    </div>
    <p class="petunjuk">Daftar ini yang muncul sebagai saran otomatis di
      berbagai form (Tipe Motor, dan Kecamatan/Kota di data pembeli).
      Kecamatan &amp; Kabupaten/Kota juga bertambah SENDIRI setiap ada
      nama baru yang diketik di form manapun — tidak wajib ditambah dari
      sini. Menghapus di sini tidak mengubah data yang sudah tersimpan.</p>
    <div id="wadah-referensi"><p class="hampa">Memuat…</p></div>
  </section>`;

  const w = wadah.querySelector("#wadah-referensi");
  const semua = {};

  function renderChip(kunci) {
    const kata = (w.querySelector(`#cari-${kunci}`)?.value || "").trim().toLowerCase();
    const daftarEl = w.querySelector(`#daftar-${kunci}`);

    // Kosong = tidak tampilkan apa-apa dulu — biar tidak "semak" pas
    // dibuka. Daftarnya baru muncul begitu mulai mengetik sesuatu.
    if (!kata) {
      daftarEl.innerHTML = `<p class="hampa" style="margin:0">
        Ketik untuk menampilkan daftar…</p>`;
      return;
    }

    const cocok = [...semua[kunci]]
      .filter((x) => x.toLowerCase().includes(kata))
      .sort((a, b) => a.localeCompare(b, "id"));

    daftarEl.innerHTML = cocok.length
      ? cocok.map((x) => {
          const i = semua[kunci].indexOf(x);
          return `<span class="chip aktif" style="gap:6px">
            ${aman(x)}
            ${bisaUbah ? `<button type="button" class="chip-hapus"
                data-kunci="${kunci}" data-index="${i}"
                aria-label="Hapus ${aman(x)}"
                style="border:0;background:transparent;cursor:pointer;
                       font-weight:bold">×</button>` : ""}
          </span>`;
        }).join("")
      : `<p class="hampa" style="margin:0">Tidak ada yang cocok.</p>`;

    daftarEl.querySelectorAll(".chip-hapus").forEach((b) => {
      b.addEventListener("click", async () => {
        const kc = b.dataset.kunci;
        const idx = Number(b.dataset.index);
        const daftar = [...semua[kc]];
        daftar.splice(idx, 1);
        try {
          await simpanDaftar(kc, daftar);
          semua[kc] = daftar;
          renderChip(kc);
        } catch (err) {
          kabar("Gagal menghapus: " + err.message, "rem");
        }
      });
    });
  }

  async function gambar() {
    for (const k of semuaKunci) delete cache[k];
    for (const k of semuaKunci) semua[k] = await muatDaftar(k);

    w.innerHTML = semuaKunci.map((k) => seksiDaftar(k, semua[k], bisaUbah)).join("");
    semuaKunci.forEach((k) => renderChip(k));

    semuaKunci.forEach((kunci) => {
      w.querySelector(`#cari-${kunci}`)
        .addEventListener("input", () => renderChip(kunci));

      const form = w.querySelector(`#tambah-${kunci}`);
      if (!form) return;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = w.querySelector(`#input-${kunci}`);
        const nilai = input.value.trim();
        if (!nilai) return;
        const daftar = [...semua[kunci]];
        if (daftar.some((x) => x.toLowerCase() === nilai.toLowerCase())) {
          kabar("Sudah ada di daftar.", "rem");
          return;
        }
        daftar.push(nilai);
        try {
          await simpanDaftar(kunci, daftar);
          semua[kunci] = daftar;
          input.value = "";
          renderChip(kunci);
          kabar("Ditambahkan.", "netral");
        } catch (err) {
          kabar("Gagal menambah: " + err.message, "rem");
        }
      });
    });
  }

  await gambar();
}

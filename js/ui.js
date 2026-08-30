// ui.js — pembantu tampilan yang dipakai di seluruh aplikasi.

import { ZONA } from "./config.js?v=3.11.2";

// ── Uang ──────────────────────────────────────────────────────
export function rupiah(n) {
  const angka = Number(n || 0);
  return "Rp " + angka.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

// Memformat input saat diketik: 1500000 → 1.500.000
export function pasangFormatUang(input) {
  input.setAttribute("inputmode", "numeric");
  input.addEventListener("input", () => {
    const bersih = input.value.replace(/\D/g, "");
    input.value = bersih ? Number(bersih).toLocaleString("id-ID") : "";
  });
}

// Mengetik jadi HURUF BESAR otomatis, kursor tidak meloncat.
// Dipakai untuk nama/alamat/dll — sengaja TIDAK dipakai untuk email
// (email itu case-sensitive secara teknis, dan kebiasaan orang
// mengetiknya huruf kecil).
export function pasangHurufBesar(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    const posisi = input.selectionStart;
    input.value = input.value.toUpperCase();
    input.setSelectionRange(posisi, posisi);
  });
}

// Sama seperti pasangHurufBesar, tapi SEKALIGUS buang semua spasi
// sambil mengetik — dipakai khusus No. Rangka/No. Mesin, supaya
// "MD17M 5027277" dan "MD17M5027277" tidak pernah bisa tersimpan
// beda gara-gara spasi yang tidak konsisten (celah proteksi
// keunikan kalau cuma dibersihkan pas submit doang).
export function pasangBersihkanKode(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    const posisi = input.selectionStart;
    const spasiSebelumKursor = (input.value.slice(0, posisi).match(/\s/g) || []).length;
    input.value = input.value.toUpperCase().replace(/\s+/g, "");
    const posisiBaru = Math.max(posisi - spasiSebelumKursor, 0);
    input.setSelectionRange(posisiBaru, posisiBaru);
  });
}

export function bacaAngka(input) {
  return Number(String(input.value).replace(/\D/g, "") || 0);
}

// ── Terbilang, untuk kuitansi ─────────────────────────────────
const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima",
                "enam", "tujuh", "delapan", "sembilan"];

function bagi(n) {
  if (n < 10) return SATUAN[n];
  if (n < 12) return SATUAN[n - 10] + " belas";
  if (n < 20) return SATUAN[n - 10] + " belas";
  if (n < 100) {
    const p = Math.floor(n / 10), s = n % 10;
    return (p === 1 ? "sepuluh" : SATUAN[p] + " puluh") +
           (s ? " " + SATUAN[s] : "");
  }
  if (n < 200) return "seratus" + (n % 100 ? " " + bagi(n % 100) : "");
  if (n < 1000) {
    return SATUAN[Math.floor(n / 100)] + " ratus" +
           (n % 100 ? " " + bagi(n % 100) : "");
  }
  if (n < 2000) return "seribu" + (n % 1000 ? " " + bagi(n % 1000) : "");
  if (n < 1000000) {
    return bagi(Math.floor(n / 1000)) + " ribu" +
           (n % 1000 ? " " + bagi(n % 1000) : "");
  }
  if (n < 1000000000) {
    return bagi(Math.floor(n / 1000000)) + " juta" +
           (n % 1000000 ? " " + bagi(n % 1000000) : "");
  }
  return bagi(Math.floor(n / 1000000000)) + " miliar" +
         (n % 1000000000 ? " " + bagi(n % 1000000000) : "");
}

export function terbilang(n) {
  const angka = Math.floor(Number(n || 0));
  if (angka === 0) return "Nol rupiah";
  const kata = bagi(angka).replace(/\s+/g, " ").trim();
  return kata.charAt(0).toUpperCase() + kata.slice(1) + " rupiah";
}

// ── Tanggal ───────────────────────────────────────────────────
// Firestore menyimpan waktu dalam UTC. Tanpa penerjemahan ini,
// transaksi sore hari bisa tercatat sebagai hari berikutnya.
export function keTanggal(nilai) {
  if (!nilai) return null;
  if (nilai.toDate) return nilai.toDate();
  return new Date(nilai);
}

export function tanggal(nilai) {
  const d = keTanggal(nilai);
  if (!d) return "-";
  return d.toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: ZONA,
  });
}

export function tanggalJam(nilai) {
  const d = keTanggal(nilai);
  if (!d) return "-";
  return d.toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: ZONA,
  });
}

// Kunci harian untuk laporan "hari ini", mengikuti waktu setempat.
export function kunciHari(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: ZONA }); // 2026-07-29
}

export function kunciBulan(d = new Date()) {
  return kunciHari(d).slice(0, 7); // 2026-07
}

// ── Pemberitahuan ─────────────────────────────────────────────
// Owner sering pakai akun sendiri buat input transaksi (mis. saat
// belum ada sales yang menangani) — di tempat-tempat yang dilihat
// konsumen atau dicetak, tampilkan "OWNER" alih-alih nama pribadi
// akun itu supaya lebih rapi/resmi. (Halaman kelola Pengguna
// sengaja TIDAK memakai ini — di sana tetap nama asli yang perlu
// dilihat apa adanya.)
export function namaTampilan(peran, nama) {
  return peran === "owner" ? "OWNER" : (nama || "-");
}

export function kabar(pesan, jenis = "info") {
  const wadah = document.getElementById("kabar");
  if (!wadah) return;
  const el = document.createElement("div");
  el.className = `kabar kabar--${jenis}`;
  el.textContent = pesan;
  wadah.appendChild(el);
  setTimeout(() => {
    el.classList.add("kabar--pergi");
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ── Pembantu DOM ──────────────────────────────────────────────
export function isi(idElemen, html) {
  const el = document.getElementById(idElemen);
  if (el) el.innerHTML = html;
}

export function aman(teks) {
  const d = document.createElement("div");
  d.textContent = teks == null ? "" : String(teks);
  return d.innerHTML;
}

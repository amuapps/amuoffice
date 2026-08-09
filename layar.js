// layar.js — kerangka layar bergaya DMS dealer.
//
// Tiap layar punya kode di kiri bilah judul, nama layar di tengah,
// dan waktu di kanan. Kode itu bukan hiasan: waktu karyawan
// menelepon minta bantuan, mereka menyebut kodenya — jauh lebih
// cepat daripada menjelaskan tampilan.
//
// Aksi selalu di toolbar atas, di posisi yang sama di semua layar,
// supaya tangan hafal tanpa harus membaca.

import { aman } from "./ui.js";
import { ZONA } from "./config.js";

export function jamSekarang() {
  return new Date().toLocaleString("id-ID", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: ZONA,
  }).replace(/\./g, ":");
}

// Bilah judul + toolbar. `aksi` berisi { id, label, jenis }.
// jenis: "utama" (biru), "bahaya" (merah), atau kosong (biasa).
export function bilahLayar({ kode, judul, aksi = [] }) {
  return `<header class="layar-kop">
    <div class="layar-baris">
      <span class="layar-kode mono">${aman(kode)}</span>
      <h2 class="layar-judul">${aman(judul)}</h2>
      <span class="layar-jam mono">${jamSekarang()}</span>
    </div>
    ${aksi.length ? `<div class="layar-toolbar">
      ${aksi.map((a) => `<button type="button" id="${a.id}"
        class="tombol tombol--kecil ${
          a.jenis === "utama" ? "tombol--isi" :
          a.jenis === "bahaya" ? "tombol--bahaya" : ""}">
        ${aman(a.label)}</button>`).join("")}
    </div>` : ""}
  </header>`;
}

// Seksi yang bisa dilipat, seperti Header / Condition / Detail.
export function seksi(judul, isi, { id = "", tutup = false } = {}) {
  return `<section class="seksi ${tutup ? "seksi--tutup" : ""}"
    ${id ? `id="${id}"` : ""}>
    <button class="seksi-kop" type="button">
      <span class="seksi-panah">▾</span>
      <span class="seksi-judul">${aman(judul)}</span>
    </button>
    <div class="seksi-isi">${isi}</div>
  </section>`;
}

// Dipanggil sekali setelah HTML dipasang, untuk mengaktifkan lipatan.
export function pasangSeksi(wadah) {
  wadah.querySelectorAll(".seksi-kop").forEach((k) => {
    k.addEventListener("click", () => {
      k.closest(".seksi").classList.toggle("seksi--tutup");
    });
  });
}

// Tab di dalam satu layar. `tab` berisi { id, label }.
export function bilahTab(tab, aktif) {
  return `<div class="tab-baris" role="tablist">
    ${tab.map((t) => `<button type="button" class="tab ${
      t.id === aktif ? "aktif" : ""}" data-tab="${t.id}" role="tab">
      ${aman(t.label)}</button>`).join("")}
  </div>`;
}

export function pasangTab(wadah) {
  const bar = wadah.querySelector(".tab-baris");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    bar.querySelectorAll(".tab").forEach((x) =>
      x.classList.toggle("aktif", x === t));
    wadah.querySelectorAll("[data-panel]").forEach((p) => {
      p.hidden = p.dataset.panel !== t.dataset.tab;
    });
  });
}

// Membuka tab tertentu dari luar, misal saat isian di tab itu
// belum lengkap dan perlu ditunjukkan ke pengguna.
export function bukaTab(wadah, id) {
  const t = wadah.querySelector(`[data-tab="${id}"]`);
  if (t) t.click();
}

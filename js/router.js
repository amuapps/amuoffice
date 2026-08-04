// router.js — routing pakai hash (#/stok) supaya halaman tidak
// 404 saat di-refresh di GitHub Pages, dan tetap jalan apa adanya
// kalau nanti pindah ke Netlify.

const halaman = new Map();
let saatTolak = () => {};

export function daftar(rute, izin, gambar) {
  halaman.set(rute, { izin, gambar });
}

export function saatDitolak(fn) {
  saatTolak = fn;
}

export function pergiKe(rute) {
  if (location.hash === rute) jalankan();
  else location.hash = rute;
}

export function ruteSekarang() {
  return location.hash || "";
}

function jalankan() {
  const rute = ruteSekarang();
  const h = halaman.get(rute);
  if (!h) {
    const pertama = halaman.keys().next();
    if (!pertama.done) pergiKe(pertama.value);
    return;
  }
  if (h.izin && !h.izin()) {
    saatTolak(rute);
    return;
  }
  h.gambar();
  document.querySelectorAll("[data-rute]").forEach((t) => {
    t.classList.toggle("aktif", t.dataset.rute === rute);
  });
  const konten = document.getElementById("konten");
  if (konten) konten.scrollTop = 0;
}

export function mulaiRouter() {
  window.addEventListener("hashchange", jalankan);
  jalankan();
}

export function bersihkanRute() {
  halaman.clear();
}

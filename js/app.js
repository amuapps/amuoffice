// app.js — merakit semuanya: layar masuk, panel atas, navigasi
// bawah yang berubah sesuai peran, dan halaman kosong tiap menu.

import { SHOWROOM, VERSI, MODE_UJI, MEREK } from "./config.js";
import { masuk, keluar, pantauSesi, bolehAkses, pesanTolak, sesi }
  from "./auth.js";
import { PERAN, batasDiskon } from "./roles.js";
import { saatKoneksiBerubah, catat } from "./db.js";
import { daftar, mulaiRouter, pergiKe, saatDitolak, bersihkanRute }
  from "./router.js";
import { kabar, rupiah, aman, kunciHari } from "./ui.js";
import { halamanStok } from "./stok.js";
import { halamanTipe } from "./tipe.js";
import { halamanSpk } from "./spk.js";
import { halamanPelanggan } from "./pelanggan.js";
import { halamanTagihan, halamanKuitansi, halamanVerifikasi }
  from "./kuitansi.js";
import { halamanKas } from "./kas.js";
import { halamanRingkasan } from "./ringkasan.js";
import { halamanBerkas } from "./serah.js";

const el = (id) => document.getElementById(id);

// ── Layar masuk ───────────────────────────────────────────────
function siapkanLayarMasuk() {
  el("nama-showroom").textContent = SHOWROOM.nama;
  el("jenis-showroom").textContent = SHOWROOM.jenis;
  el("versi").textContent = `v${VERSI}`;
  document.querySelectorAll("[data-merek]").forEach((n) => {
    n.textContent = MEREK;
  });

  const tombol = el("tombol-masuk");
  const form = el("form-masuk");

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = el("email").value;
    const sandi = el("sandi").value;
    if (!email || !sandi) {
      kabar("Isi email dan kata sandi dulu.", "rem");
      return;
    }
    tombol.disabled = true;
    tombol.textContent = "Memeriksa…";
    try {
      await masuk(email, sandi);
      el("sandi").value = "";
    } catch (e) {
      kabar(pesanTolak(e), "rem");
    } finally {
      tombol.disabled = false;
      tombol.textContent = "Masuk";
    }
  });
}

// ── Panel atas ────────────────────────────────────────────────
function gambarPanel(profil) {
  const p = PERAN[profil.peran];
  el("lampu-peran").className = `lampu lampu--${p.warna}`;
  el("label-peran").textContent = p.label;
  el("nama-pengguna").textContent = profil.nama;
  el("penanda-uji").hidden = !MODE_UJI;

  const batas = batasDiskon(profil.peran);
  el("batas-diskon").textContent =
    batas === null ? "Diskon bebas" : `Batas diskon ${rupiah(batas)}`;
}

// ── Navigasi bawah ────────────────────────────────────────────
function gambarNavigasi(profil) {
  const p = PERAN[profil.peran];
  el("nav").innerHTML = p.menu
    .map(
      (m) => `<a class="nav-butir" data-rute="${m.rute}" href="${m.rute}">
        <span class="nav-lampu"></span>
        <span class="nav-label">${aman(m.label)}</span>
      </a>`
    )
    .join("");
}

// ── Halaman ───────────────────────────────────────────────────
// Tahap 1 baru menyediakan kerangkanya. Tiap tahap berikutnya
// menambah file sendiri dan mendaftarkan halamannya di sini,
// tanpa mengubah apa pun yang sudah jalan.
function kosong(judul, ajakan) {
  return `<section class="lembar">
    <h2 class="judul">${aman(judul)}</h2>
    <div class="hampa">
      <p>${aman(ajakan)}</p>
    </div>
  </section>`;
}

function daftarkanHalaman(profil) {
  bersihkanRute();
  const p = PERAN[profil.peran];

  // Halaman bermodul. Tahap berikutnya cukup menambah baris di sini.
  const khusus = {
    "#/stok": (w) => halamanStok(w),
    "#/katalog": (w) => halamanTipe(w, true),
    "#/kelola": (w) => halamanTipe(w, false),
    "#/spk": (w) => halamanSpk(w),
    "#/pelanggan": (w) => halamanPelanggan(w),
    "#/tagihan": (w) => halamanTagihan(w),
    "#/kuitansi": (w) => halamanKuitansi(w),
    "#/kas": (w) => halamanKas(w),
    "#/ringkasan": (w) => halamanRingkasan(w),
    "#/berkas": (w) => halamanBerkas(w),
  };

  const isian = {
    "#/ringkasan": () => kosong(
      "Ringkasan",
      "Angka stok, kas, dan laba bulan ini akan muncul di sini."
    ),
    "#/stok": () => kosong(
      "Stok",
      "Belum ada motor terdaftar. Tambahkan tipe motor dulu, " +
      "lalu masukkan unit per nomor rangka."
    ),
    "#/katalog": () => kosong(
      "Katalog",
      "Daftar motor yang siap dijual akan tampil di sini."
    ),
    "#/spk": () => kosong(
      "SPK",
      "Belum ada surat pesanan. SPK dibuat saat pembeli memilih unit."
    ),
    "#/kas": () => kosong(
      "Kas",
      "Uang masuk dan keluar akan tercatat di sini, " +
      "termasuk DP yang belum boleh dipakai."
    ),
    "#/tagihan": () => kosong(
      "Tagihan hari ini",
      "Pembayaran yang jatuh tempo hari ini akan muncul di sini."
    ),
    "#/kuitansi": () => kosong(
      "Kuitansi",
      "Kuitansi yang sudah terbit akan terdaftar di sini."
    ),
    "#/berkas": () => kosong(
      "Berkas",
      "Unit yang dokumennya belum beres akan muncul di sini."
    ),
    "#/pelanggan": () => kosong(
      "Pelanggan",
      "Data pembeli untuk keperluan tindak lanjut akan tampil di sini."
    ),
    "#/kelola": () => kosong(
      "Kelola",
      "Pengguna, tipe motor, dan cadangan data diatur di sini."
    ),
  };

  p.menu.forEach((m) => {
    daftar(m.rute, () => true, () => {
      const wadah = el("konten");
      // Halaman yang sudah punya modulnya sendiri.
      if (khusus[m.rute]) {
        wadah.innerHTML = `<section class="lembar">
          <p class="hampa">Memuat…</p></section>`;
        khusus[m.rute](wadah).catch((e) =>
          kabar("Gagal memuat halaman: " + e.message, "rem"));
        return;
      }
      wadah.innerHTML = isian[m.rute]
        ? isian[m.rute]()
        : kosong(m.label, "Halaman ini dibangun di tahap berikutnya.");
    });
  });

  saatDitolak(() => {
    kabar("Halaman itu bukan bagian dari akses Anda.", "rem");
    pergiKe(p.beranda);
  });
}

// ── Status koneksi ────────────────────────────────────────────
saatKoneksiBerubah((daring) => {
  const t = el("status-koneksi");
  if (!t) return;
  t.hidden = daring;
});

// ── Halaman verifikasi publik ─────────────────────────────────
// Dibuka lewat QR di kuitansi, tanpa perlu login. Karena itu
// pemeriksaannya dilakukan sebelum layar masuk digambar.
function cekPublik() {
  const h = location.hash || "";
  if (h.startsWith("#/cek/")) {
    el("layar-masuk").hidden = true;
    el("aplikasi").hidden = true;
    el("publik").hidden = false;
    halamanVerifikasi(h.slice(6), el("publik"));
    return true;
  }
  el("publik").hidden = true;
  return false;
}
window.addEventListener("hashchange", cekPublik);

// ── Jalan ─────────────────────────────────────────────────────
siapkanLayarMasuk();

el("tombol-keluar").addEventListener("click", async () => {
  await keluar();
  kabar("Anda sudah keluar.", "info");
});

pantauSesi(
  (profil) => {
    if (cekPublik()) return;
    el("layar-masuk").hidden = true;
    el("aplikasi").hidden = false;
    gambarPanel(profil);
    gambarNavigasi(profil);
    daftarkanHalaman(profil);
    if (!location.hash) location.hash = PERAN[profil.peran].beranda;
    mulaiRouter();
    kabar(`Selamat datang, ${profil.nama}.`, "netral");
  },
  () => {
    if (cekPublik()) return;
    el("aplikasi").hidden = true;
    el("layar-masuk").hidden = false;
    el("konten").innerHTML = "";
    el("nav").innerHTML = "";
  }
);

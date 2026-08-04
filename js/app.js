// app.js — merakit semuanya: layar masuk, panel atas, navigasi
// bawah yang berubah sesuai peran, dan halaman kosong tiap menu.
//
// TAHAP REBUILD (mulai dari Master): hanya Tipe Motor (#/kelola,
// #/katalog) dan Stok/Unit (#/stok) yang punya halaman sungguhan.
// Modul lain sengaja BELUM diimpor — menunya tetap tampil (dari
// roles.js, tidak diubah) tapi jatuh ke halamanSegera secara
// otomatis. Begitu modul itu mau dibangun lagi, tinggal impor
// fungsinya dan tambahkan satu baris di peta `khusus` di bawah.

import { SHOWROOM, VERSI, MODE_UJI, MEREK } from "./config.js";
import { masuk, keluar, pantauSesi, bolehAkses, pesanTolak, sesi }
  from "./auth.js";
import { PERAN, batasDiskon, semuaMenu } from "./roles.js";
import { saatKoneksiBerubah, catat } from "./db.js";
import { daftar, mulaiRouter, pergiKe, saatDitolak, bersihkanRute }
  from "./router.js";
import { kabar, rupiah, aman, kunciHari } from "./ui.js";
import { konfirmasi } from "./dialog.js";
import { halamanStok } from "./stok.js";
import { halamanTipe } from "./tipe.js";
import { halamanPengguna } from "./pengaturan.js";
import { halamanPelanggan } from "./pelanggan.js";
import { halamanSegera } from "./segera.js";

const el = (id) => document.getElementById(id);

// ── Layar masuk ───────────────────────────────────────────────
function siapkanLayarMasuk() {
  el("nama-showroom").textContent = SHOWROOM.nama;
  el("versi").textContent = `v${VERSI}`;
  el("sisi-nama").textContent = SHOWROOM.nama;
  el("sisi-versi").textContent = `v${VERSI}`;
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
function gambarJejak() {
  const aktif = document.querySelector(".nav-butir.aktif");
  if (aktif) {
    aktif.closest(".nav-grup-wadah")?.classList.remove("nav-grup--tutup");
  }
  const j = el("jejak");
  if (!j) return;
  if (!aktif) { j.innerHTML = ""; return; }
  j.innerHTML =
    `<span class="jejak-modul">${aman(aktif.dataset.grup || "")}</span>` +
    `<span class="jejak-pisah">›</span>` +
    `<span class="jejak-kini">${aman(aktif.dataset.nama || "")}</span>`;
}

function gambarPanel(profil) {
  const p = PERAN[profil.peran];
  el("lampu-peran").className = `lampu lampu--${p.warna}`;
  el("label-peran").textContent = p.label;
  el("nama-pengguna").textContent = profil.nama;
  el("penanda-uji").hidden = !MODE_UJI;

  // Hanya ditampilkan kalau perannya memang punya batas. Untuk
  // owner, label "diskon bebas" cuma jadi tulisan yang menempel
  // tanpa memberi informasi.
  const batas = batasDiskon(profil.peran);
  const batasEl = el("batas-diskon");
  batasEl.hidden = batas === null;
  batasEl.textContent = `Batas diskon ${rupiah(batas || 0)}`;
  el("panel-baca").hidden = batas === null && !MODE_UJI;
}

// ── Navigasi bawah ────────────────────────────────────────────
function tutupSisi() {
  el("sisi").classList.remove("sisi--buka");
  el("tirai").hidden = true;
}

function gambarNavigasi(profil) {
  const p = PERAN[profil.peran];
  // Tiap kelompok melipat. Yang berisi halaman aktif dibuka
  // sendiri; sisanya tertutup supaya sidebar tidak sesak saat
  // modulnya bertambah banyak.
  const rute = location.hash || p.beranda;
  el("nav").innerHTML = p.menu
    .map((g, i) => {
      const isiGrup = g.butir.some((m) => m.rute === rute);
      const buka = isiGrup || (i === 0 && !p.menu.some((x) =>
        x.butir.some((m) => m.rute === rute)));
      return `<div class="nav-grup-wadah ${buka ? "" : "nav-grup--tutup"}">
        <button class="nav-grup" type="button">
          <span class="nav-grup-nama">${aman(g.grup)}</span>
          <span class="nav-grup-panah">▾</span>
        </button>
        <div class="nav-butir-isi">
          ${g.butir.map((m) =>
            `<a class="nav-butir" data-rute="${m.rute}" href="${m.rute}"
                data-grup="${aman(g.grup)}" data-nama="${aman(m.label)}">
              <span class="nav-lampu"></span>
              <span class="nav-label">${aman(m.label)}</span>
            </a>`).join("")}
        </div>
      </div>`;
    })
    .join("");

  el("nav").querySelectorAll(".nav-grup").forEach((k) => {
    k.addEventListener("click", () => {
      k.closest(".nav-grup-wadah").classList.toggle("nav-grup--tutup");
    });
  });
  // Di layar HP sidebar berupa laci, jadi ditutup begitu menu dipilih.
  el("nav").querySelectorAll(".nav-butir")
    .forEach((a) => a.addEventListener("click", tutupSisi));
}

// ── Halaman ───────────────────────────────────────────────────
// Tahap 1 baru menyediakan kerangkanya. Tiap tahap berikutnya
// menambah file sendiri dan mendaftarkan halamannya di sini,
// tanpa mengubah apa pun yang sudah jalan.
function daftarkanHalaman(profil) {
  bersihkanRute();
  const p = PERAN[profil.peran];

  // Layar yang sudah dibangun. Sisanya otomatis memakai layar
  // sementara dengan kode dan judul dari daftar menu, jadi susunan
  // modulnya sudah bisa ditelusuri sejak sekarang.
  const khusus = {
    "#/stok": (w) => halamanStok(w),
    "#/katalog": (w) => halamanTipe(w, true),
    "#/kelola": (w) => halamanTipe(w, false),
    "#/pengguna": (w) => halamanPengguna(w),
    "#/pelanggan": (w) => halamanPelanggan(w),
  };

  semuaMenu(profil.peran).forEach((m) => {
    daftar(m.rute, () => true, () => {
      const w = el("konten");
      if (khusus[m.rute]) {
        w.innerHTML = `<p class="hampa">Memuat…</p>`;
        khusus[m.rute](w).catch((e) =>
          kabar("Gagal memuat layar: " + e.message, "rem"));
        return;
      }
      halamanSegera(w, { kode: m.kode || "—", judul: m.label });
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
// NONAKTIF sementara: fitur QR ini milik modul Kuitansi, yang
// belum dibangun ulang di tahap ini. Kerangkanya dibiarkan supaya
// gampang disambung lagi begitu kuitansi.js kembali diimpor.
function cekPublik() {
  el("publik").hidden = true;
  return false;
}
window.addEventListener("hashchange", () => {
  cekPublik();
  setTimeout(gambarJejak, 0);
});

// ── Jalan ─────────────────────────────────────────────────────
siapkanLayarMasuk();

el("buka-sisi").addEventListener("click", () => {
  const sisi = el("sisi");
  const buka = sisi.classList.toggle("sisi--buka");
  el("tirai").hidden = !buka;
});
el("tirai").addEventListener("click", tutupSisi);

el("tombol-keluar").addEventListener("click", async () => {
  const jadi = await konfirmasi({
    judul: "Keluar dari sistem",
    pesan: "Anda akan keluar dari akun ini. Pekerjaan yang belum " +
           "tersimpan bisa hilang.",
    oke: "Keluar",
    batal: "Tetap di sini",
    bahaya: true,
  });
  if (!jadi) return;
  await keluar();
  kabar("Anda sudah keluar.", "info");
});

function selesaiMemuat() {
  const m = el("muat");
  if (!m || m.classList.contains("muat--pergi")) return;
  m.classList.add("muat--pergi");
  setTimeout(() => (m.hidden = true), 320);
}

pantauSesi(
  (profil) => {
    selesaiMemuat();
    if (cekPublik()) return;
    el("layar-masuk").hidden = true;
    el("aplikasi").hidden = false;
    gambarPanel(profil);
    gambarNavigasi(profil);
    daftarkanHalaman(profil);
    if (!location.hash) location.hash = PERAN[profil.peran].beranda;
    mulaiRouter();
    gambarJejak();
    kabar(`Selamat datang, ${profil.nama}.`, "netral");
  },
  () => {
    selesaiMemuat();
    if (cekPublik()) return;
    el("aplikasi").hidden = true;
    el("layar-masuk").hidden = false;
    el("konten").innerHTML = "";
    el("nav").innerHTML = "";
  }
);

// app.js — merakit semuanya: layar masuk, panel atas, navigasi
// bawah yang berubah sesuai peran, dan halaman kosong tiap menu.
//
// TAHAP REBUILD (mulai dari Master): hanya Tipe Motor (#/kelola,
// #/katalog) dan Stok/Unit (#/stok) yang punya halaman sungguhan.
// Modul lain sengaja BELUM diimpor — menunya tetap tampil (dari
// roles.js, tidak diubah) tapi jatuh ke halamanSegera secara
// otomatis. Begitu modul itu mau dibangun lagi, tinggal impor
// fungsinya dan tambahkan satu baris di peta `khusus` di bawah.

import { SHOWROOM, VERSI, MODE_UJI, MEREK } from "./config.js?v=3.4.3";
import { masuk, keluar, pantauSesi, bolehAkses, pesanTolak, sesi,
  ubahPasswordSendiri, mintaResetPassword } from "./auth.js?v=3.4.3";
import { PERAN, batasDiskon, semuaMenu, menuBerlabel } from "./roles.js?v=3.4.3";
import { saatKoneksiBerubah, catat, dbase, doc, getDoc } from "./db.js?v=3.4.3";
import { daftar, mulaiRouter, pergiKe, saatDitolak, bersihkanRute }
  from "./router.js?v=3.4.3";
import { kabar, rupiah, aman, kunciHari, namaTampilan } from "./ui.js?v=3.4.3";
import { konfirmasi, tanya } from "./dialog.js?v=3.4.3";
import { halamanStok } from "./stok.js?v=3.4.3";
import { halamanTipe } from "./tipe.js?v=3.4.3";
import { halamanReferensi } from "./referensi.js?v=3.4.3";
import { halamanPengguna } from "./pengaturan.js?v=3.4.3";
import { halamanPelanggan } from "./pelanggan.js?v=3.4.3";
import { halamanLeasing } from "./leasing.js?v=3.4.3";
import { halamanRekening } from "./rekening.js?v=3.4.3";
import { halamanSpk } from "./spk.js?v=3.4.3";
import { halamanLaporan } from "./laporan.js?v=3.4.3";
import { muatLabelKustom } from "./label.js?v=3.4.3";
import { halamanAkses, muatAksesKustom } from "./akses.js?v=3.4.3";
import { halamanLog } from "./log.js?v=3.4.3";
import { halamanPersetujuan, halamanPengajuanSaya } from "./persetujuan.js?v=3.4.3";
import { halamanAgen } from "./agen.js?v=3.4.3";
import { halamanBiro } from "./biro.js?v=3.4.3";
import { halamanSupplier } from "./supplier.js?v=3.4.3";
import { halamanDashboard } from "./dashboard.js?v=3.4.3";
import { halamanTentang } from "./tentang.js?v=3.4.3";
import { halamanInbox, pasangLencana } from "./notifikasi.js?v=3.4.3";
import { halamanSegera } from "./segera.js?v=3.4.3";

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

  // Lupa password — dipakai SEBELUM login, jadi pakai email yang
  // sudah diketik di kotak Email (kalau ada) sebagai isian awal.
  // Pesannya SENGAJA sama persis mau emailnya terdaftar atau tidak
  // (tidak bilang "email tidak ditemukan") — supaya orang luar tidak
  // bisa dipakai untuk menebak-nebak email siapa saja yang terdaftar
  // di sistem ini.
  el("tombol-lupa-sandi").addEventListener("click", async () => {
    const isian = el("email").value.trim();
    const email = await tanya({
      judul: "Lupa Password",
      pesan: "Masukkan email akun Anda. Kalau email ini terdaftar, " +
             "link buat bikin password baru akan dikirim ke email itu.",
      petunjuk: "Email", nilai: isian,
    });
    if (email === null) return;
    try {
      await mintaResetPassword(email.trim());
    } catch { /* diabaikan dengan sengaja, lihat catatan di atas */ }
    kabar("Kalau email itu terdaftar, link reset password sudah " +
          "dikirim. Cek inbox (atau folder Spam) beberapa saat lagi.",
          "netral");
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
  const grup = aktif.dataset.grup || "";
  j.innerHTML =
    `<button type="button" class="jejak-modul" id="jejak-balik">${aman(grup)}</button>` +
    `<span class="jejak-pisah">›</span>` +
    `<span class="jejak-kini">${aman(aktif.dataset.nama || "")}</span>`;
  // Belum ada halaman ringkasan per grup, jadi "kembali" di sini
  // berarti membuka & menyorot kelompoknya di sidebar — cara
  // tercepat untuk pindah ke menu lain di grup yang sama.
  const tombolBalik = el("jejak-balik");
  if (tombolBalik) {
    tombolBalik.addEventListener("click", () => {
      const wadahGrup = [...document.querySelectorAll(".nav-grup-nama")]
        .find((x) => x.textContent === grup)?.closest(".nav-grup-wadah");
      if (!wadahGrup) return;
      wadahGrup.classList.remove("nav-grup--tutup");
      wadahGrup.scrollIntoView({ behavior: "smooth", block: "nearest" });
      el("sisi").classList.add("sisi--buka");
      el("tirai").hidden = false;
    });
  }
}

function gambarPanel(profil) {
  const p = PERAN[profil.peran];
  el("lampu-peran").className = `lampu lampu--${p.warna}`;
  el("label-peran").textContent = p.label;
  el("nama-pengguna").textContent = namaTampilan(profil.peran, profil.nama);
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
  const menu = menuBerlabel(profil.peran);
  // Tiap kelompok melipat. Yang berisi halaman aktif dibuka
  // sendiri; sisanya tertutup supaya sidebar tidak sesak saat
  // modulnya bertambah banyak.
  const rute = location.hash || p.beranda;
  el("nav").innerHTML = menu
    .map((g, i) => {
      const isiGrup = g.butir.some((m) => m.rute === rute);
      const buka = isiGrup || (i === 0 && !menu.some((x) =>
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

// ── Tab (panel yang dibuka tetap ada, bisa pindah-pindah) ──────
// Setiap kali sebuah menu dibuka, ditambahkan sebagai tab kalau
// belum ada. Menutup tab tidak menghapus datanya di server, cuma
// menyembunyikan panelnya — buka lagi dari sidebar kalau perlu.
let tabTerbuka = [];

function gambarTabBar() {
  const bar = el("tab-bar");
  if (!bar) return;
  const rute = location.hash;
  if (tabTerbuka.length <= 1) { bar.innerHTML = ""; bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = tabTerbuka.map((t) => `
    <button type="button" class="tab ${t.rute === rute ? "tab--aktif" : ""}"
            data-rute="${aman(t.rute)}">
      <span class="tab-label">${aman(t.nama)}</span>
      <span class="tab-tutup" data-tutup="${aman(t.rute)}" title="Tutup">×</span>
    </button>`).join("");
  bar.querySelectorAll(".tab").forEach((b) => {
    b.addEventListener("click", (e) => {
      if (e.target.closest("[data-tutup]")) return;
      pergiKe(b.dataset.rute);
    });
  });
  bar.querySelectorAll("[data-tutup]").forEach((x) => {
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      tutupTab(x.dataset.tutup);
    });
  });
}

function bukaTab(m) {
  if (!tabTerbuka.some((t) => t.rute === m.rute)) {
    tabTerbuka.push({ rute: m.rute, nama: m.label });
  }
  gambarTabBar();
}

function tutupTab(rute) {
  const idx = tabTerbuka.findIndex((t) => t.rute === rute);
  if (idx === -1) return;
  const sedangAktif = location.hash === rute;
  tabTerbuka.splice(idx, 1);
  if (sedangAktif && tabTerbuka.length) {
    // Pindah ke tab tetangga, bukan langsung ke beranda — supaya
    // urutan kerja yang lagi dibuka tidak tiba-tiba lompat jauh.
    const tujuan = tabTerbuka[Math.max(0, idx - 1)];
    pergiKe(tujuan.rute);
  } else {
    gambarTabBar();
  }
}

function daftarkanHalaman(profil) {
  bersihkanRute();
  tabTerbuka = [];
  const p = PERAN[profil.peran];

  // Layar yang sudah dibangun. Sisanya otomatis memakai layar
  // sementara dengan kode dan judul dari daftar menu, jadi susunan
  // modulnya sudah bisa ditelusuri sejak sekarang.
  const khusus = {
    "#/stok": (w) => halamanStok(w),
    "#/katalog": (w) => halamanTipe(w, true),
    "#/kelola": (w) => halamanTipe(w, false),
    "#/referensi": (w) => halamanReferensi(w),
    "#/pengguna": (w) => halamanPengguna(w),
    "#/pelanggan": (w) => halamanPelanggan(w),
    "#/leasing": (w) => halamanLeasing(w),
    "#/rekening": (w) => halamanRekening(w),
    "#/spk": (w) => halamanSpk(w),
    "#/laporan": (w) => halamanLaporan(w),
    "#/akses": (w) => halamanAkses(w, PERAN),
    "#/log": (w) => halamanLog(w),
    "#/persetujuan": (w) => halamanPersetujuan(w),
    "#/agen": (w) => halamanAgen(w),
    "#/biro": (w) => halamanBiro(w),
    "#/supplier": (w) => halamanSupplier(w),
    "#/dashboard": (w) => halamanDashboard(w),
    "#/tentang": (w) => halamanTentang(w),
    "#/inbox": (w) => halamanInbox(w),
    "#/pengajuan-saya": (w) => halamanPengajuanSaya(w),
  };

  semuaMenu(profil.peran).forEach((m) => {
    daftar(m.rute, () => true, () => {
      bukaTab(m);
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

  // Inbox didaftarkan TERPISAH, tanpa syarat menu/Panel Akses apa
  // pun — supaya tombol lonceng selalu berfungsi buat siapa saja
  // yang login, tidak peduli menunya dikustomisasi seperti apa.
  daftar("#/inbox", () => true, () => {
    bukaTab({ label: "Inbox", rute: "#/inbox", kode: "IBX-01" });
    const w = el("konten");
    w.innerHTML = `<p class="hampa">Memuat…</p>`;
    halamanInbox(w).catch((e) =>
      kabar("Gagal memuat layar: " + e.message, "rem"));
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

// ── Jaring pengaman ──────────────────────────────────────────
// Kalau ada error JS yang tidak tertangkap di mana pun (bug yang
// belum ketahuan), setidaknya ada notifikasi jelas — bukan layar
// putih diam-diam tanpa penjelasan apa pun.
window.addEventListener("error", (e) => {
  kabar("Terjadi kesalahan tak terduga: " + (e.message || "tidak diketahui") +
        ". Coba muat ulang halaman kalau tampilan terasa aneh.", "rem");
});
window.addEventListener("unhandledrejection", (e) => {
  const pesan = e.reason?.message || String(e.reason || "tidak diketahui");
  kabar("Terjadi kesalahan tak terduga: " + pesan +
        ". Coba muat ulang halaman kalau tampilan terasa aneh.", "rem");
});

// ── Halaman verifikasi publik ─────────────────────────────────
// Dibuka lewat QR di kuitansi (#/cek/{kode}), TANPA perlu login —
// siapa saja yang scan QR-nya (termasuk konsumen) harus bisa lihat
// ini. Datanya sengaja dibatasi ke koleksi kuitansi_publik yang
// cuma berisi info tidak sensitif (bukan NIK/alamat/dsb), ditulis
// sekali saat kuitansi dicetak (lihat cetak.js).
function cekPublik() {
  const h = location.hash || "";
  if (!h.startsWith("#/cek/")) {
    const p = el("publik");
    if (p) p.hidden = true;
    return false;
  }
  el("layar-masuk").hidden = true;
  el("aplikasi").hidden = true;
  const publikEl = el("publik");
  publikEl.hidden = false;
  const kode = decodeURIComponent(h.slice(6));
  publikEl.innerHTML = `<div class="cek">
    <p class="hampa">Memeriksa keabsahan kuitansi…</p></div>`;
  muatVerifikasiKuitansi(kode, publikEl);
  return true;
}

async function muatVerifikasiKuitansi(kode, publikEl) {
  if (!kode) {
    publikEl.innerHTML = `<div class="cek cek--gagal">
      <h1>Kode Tidak Ada</h1>
      <p>Tautan ini tidak menyertakan kode kuitansi. Coba scan lagi QR
        code-nya langsung dari kuitansi fisiknya.</p>
      <p class="cek-kaki">${aman(SHOWROOM.nama)}</p>
    </div>`;
    return;
  }
  try {
    const snap = await getDoc(doc(dbase, "kuitansi_publik", kode));
    if (!snap.exists()) {
      publikEl.innerHTML = `<div class="cek cek--gagal">
        <h1>Tidak Ditemukan</h1>
        <p class="cek-nomor">${aman(kode)}</p>
        <p>Kuitansi dengan kode ini tidak ada di sistem kami. Kalau Anda
          scan dari kertas fisik, kemungkinan kodenya rusak/salah ketik.</p>
        <p class="cek-kaki">${aman(SHOWROOM.nama)}</p>
      </div>`;
      return;
    }
    const d = snap.data();
    publikEl.innerHTML = `<div class="cek cek--sah">
      <div class="cek-centang" aria-hidden="true">✓</div>
      <h1>Kuitansi Sah</h1>
      <p class="cek-nomor">${aman(d.kuitansiNo)}</p>
      <dl class="rinci">
        <div><dt>Showroom</dt><dd>${aman(d.showroomNama)}</dd></div>
        <div><dt>Tanggal</dt><dd>${aman(d.tanggal)}</dd></div>
        <div><dt>Nama Pembeli</dt><dd>${aman(d.namaPembeli || "-")}</dd></div>
        <div><dt>Unit</dt><dd>${aman(d.tipeNama)} · ${aman(d.warna)}</dd></div>
        <div><dt>Jumlah dibayar</dt><dd>${rupiah(d.jumlahBayar)}</dd></div>
        <div><dt>Cara bayar</dt><dd>${aman((d.caraBayar || []).join(" + ") || "-")}</dd></div>
        <div><dt>Keterangan</dt><dd>${aman(d.keterangan || "-")}</dd></div>
        <div><dt>No. SPK</dt><dd class="mono">${aman(d.spkNo)}</dd></div>
      </dl>
      <p class="cek-kaki">Dokumen ini tercatat resmi di sistem
        ${aman(SHOWROOM.nama)} pada tanggal di atas.</p>
    </div>`;
  } catch (err) {
    publikEl.innerHTML = `<div class="cek cek--gagal">
      <h1>Gagal Memeriksa</h1>
      <p>${aman(err.message)}</p>
    </div>`;
  }
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
    // Bukan tombol--bahaya (merah) — keluar bukan aksi destruktif
    // seperti hapus data, jadi tetap pakai warna biru khas aplikasi.
  });
  if (!jadi) return;
  await keluar();
  kabar("Anda sudah keluar.", "info");
});

el("tombol-inbox").addEventListener("click", () => pergiKe("#/inbox"));

// Ganti sandi sendiri — dibuka siapa saja yang login, tidak
// bergantung menu/peran (kayak Inbox). Tiga langkah pakai dialog
// tanya() berurutan (sandi lama → sandi baru → konfirmasi), supaya
// tidak perlu bikin komponen dialog baru cuma buat ini.
el("tombol-sandi").addEventListener("click", async () => {
  const lama = await tanya({
    judul: "Ubah Password",
    pesan: "Masukkan password Anda saat ini untuk konfirmasi.",
    petunjuk: "Password saat ini", tipeIsian: "password",
  });
  if (lama === null) return;

  const baru = await tanya({
    judul: "Password Baru",
    pesan: "Masukkan password baru (minimal 6 karakter).",
    petunjuk: "Password baru", tipeIsian: "password",
  });
  if (baru === null) return;
  if (baru.length < 6) {
    kabar("Password baru minimal 6 karakter.", "rem");
    return;
  }

  const ulang = await tanya({
    judul: "Konfirmasi Password Baru",
    pesan: "Ketik ulang password baru tadi, supaya tidak salah ketik.",
    petunjuk: "Ulangi password baru", tipeIsian: "password",
  });
  if (ulang === null) return;
  if (ulang !== baru) {
    kabar("Konfirmasi password tidak cocok dengan password baru.", "rem");
    return;
  }

  try {
    await ubahPasswordSendiri(lama, baru);
    kabar("Password berhasil diubah.", "netral");
  } catch (err) {
    const salahSandiLama = ["auth/wrong-password", "auth/invalid-credential"]
      .includes(err.code);
    kabar(salahSandiLama ? "Password saat ini yang Anda masukkan salah."
      : "Gagal mengubah password: " + err.message, "rem");
  }
});

function selesaiMemuat() {
  const m = el("muat");
  if (!m || m.classList.contains("muat--pergi")) return;
  m.classList.add("muat--pergi");
  setTimeout(() => (m.hidden = true), 320);
}

// Firebase memanggil ulang callback "sudah masuk" ini tiap kali
// token disegarkan (bukan cuma sekali di awal) — termasuk saat
// penyegarannya BERHASIL. Tanpa penjagaan ini, tiap kali itu
// terjadi seluruh tampilan digambar ulang dari nol: tab yang
// sedang dibuka hilang, menu ke-reset. uidSesiAktif dipakai supaya
// render penuh cuma terjadi sekali per orang yang login, sisanya
// (penyegaran token untuk orang yang sama) diabaikan saja.
let uidSesiAktif = null;

// ── Auto-logout kalau tidak ada aktivitas ────────────────────────
// 5 menit tanpa interaksi (klik, ketik, scroll, sentuh) → otomatis
// keluar, supaya HP yang lupa di-logout tidak jadi celah keamanan
// kalau ditinggal di meja/berpindah tangan.
const BATAS_IDLE_MS = 5 * 60 * 1000;
let timerIdle = null;

function resetTimerIdle() {
  if (!timerIdle) return; // belum login / sudah logout, tidak perlu jalan
  clearTimeout(timerIdle);
  timerIdle = setTimeout(async () => {
    await keluar();
    kabar("Anda keluar otomatis karena tidak ada aktivitas selama 5 menit.", "rem");
  }, BATAS_IDLE_MS);
}

["click", "keydown", "touchstart", "scroll", "mousemove"].forEach((ev) =>
  document.addEventListener(ev, resetTimerIdle, { passive: true }));

function mulaiTimerIdle() {
  timerIdle = setTimeout(() => {}, 0); // tanda "aktif", nilai aslinya diisi resetTimerIdle
  resetTimerIdle();
}
function hentikanTimerIdle() {
  clearTimeout(timerIdle);
  timerIdle = null;
}

pantauSesi(
  async (profil) => {
    selesaiMemuat();
    if (cekPublik()) return;
    if (uidSesiAktif === profil.uid) return; // cuma token disegarkan, bukan login baru
    uidSesiAktif = profil.uid;

    el("layar-masuk").hidden = true;
    el("aplikasi").hidden = false;
    await muatLabelKustom(); // sekali per sesi, biar sidebar langsung benar
    await muatAksesKustom(); // sekali per sesi, biar sidebar ikuti Panel Akses
    pasangLencana(el("lencana-notif"));
    gambarPanel(profil);
    gambarNavigasi(profil);
    daftarkanHalaman(profil);
    if (!location.hash) location.hash = PERAN[profil.peran].beranda;
    mulaiRouter();
    gambarJejak();
    mulaiTimerIdle();
    kabar(`Selamat datang, ${namaTampilan(profil.peran, profil.nama)}.`, "netral");
  },
  () => {
    selesaiMemuat();
    if (cekPublik()) return;
    uidSesiAktif = null;
    hentikanTimerIdle();
    el("aplikasi").hidden = true;
    el("layar-masuk").hidden = false;
    el("konten").innerHTML = "";
    el("nav").innerHTML = "";
  }
);

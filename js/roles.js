// roles.js — semua aturan peran ada di sini.
// Menambah peran baru cukup menambah satu blok di bawah,
// tanpa menyentuh kode fitur yang sudah jalan.

import { labelItem, labelGrup } from "./label.js";
import { daftarKodeUntuk } from "./akses.js";

// Daftar izin yang dikenal sistem:
//   stok.lihat  stok.ubah
//   spk.buat    spk.lihat   spk.setujui
//   kas.lihat   kas.input
//   laba.lihat        → harga beli, HPP, margin
//   berkas.lihat      → foto KTP/KK pengajuan leasing
//   agen.lihat        → nominal fee agen
//   kelola.pengguna   ekspor   log.lihat

// TAHAP MASTER DATA: menu sengaja dipangkas sampai hanya modul
// yang sungguh punya halaman (Tipe Motor, Stok/Unit, Pelanggan,
// Pengguna). Susunan lengkap ala DMS dealer (Purchase, Sales,
// Sales Report, Inventory, Incentive) sudah pernah dirancang dan
// disimpan di riwayat/dokumentasi proyek — begitu modulnya mulai
// dibangun, tinggal tambahkan grup & butirnya kembali di sini,
// lalu daftarkan halamannya di app.js. Kodenya (SYS-xx, INV-xx,
// dst) sengaja dipertahankan supaya rujukan lama tidak berubah.

const MASTER_DATA = { grup: "Master Data", butir: [
  { label: "Tipe Motor", rute: "#/kelola", kode: "SYS-01" },
  { label: "Referensi & Saran Isian", rute: "#/referensi", kode: "SYS-05" },
  { label: "Master Leasing", rute: "#/leasing", kode: "SYS-06" },
  { label: "Master Rekening", rute: "#/rekening", kode: "SYS-07" },
  { label: "Master Agen", rute: "#/agen", kode: "SYS-12" },
  { label: "Data Karyawan", rute: "#/pengguna", kode: "SYS-03" },
]};

const INVENTORY = { grup: "Inventory", butir: [
  { label: "Data Unit", rute: "#/stok", kode: "INV-06" },
]};

const KATALOG_SAJA = { grup: "Inventory", butir: [
  { label: "Data Unit", rute: "#/katalog", kode: "INV-06" },
]};

const DASHBOARD = { grup: "Dashboard", butir: [
  { label: "Dashboard Penjualan", rute: "#/dashboard", kode: "DSH-01" },
]};

const INBOX = { grup: "Inbox", butir: [
  { label: "Inbox", rute: "#/inbox", kode: "IBX-01" },
]};

const SALES = { grup: "Sales", butir: [
  { label: "SPK Baru", rute: "#/spk", kode: "SLS-01" },
  { label: "Riwayat & Laporan SPK", rute: "#/laporan", kode: "SLS-02" },
]};

const SISTEM_LENGKAP = { grup: "Sistem", butir: [
  { label: "Database Konsumen", rute: "#/pelanggan", kode: "SYS-02" },
  { label: "Ubah Nama Menu", rute: "#/label", kode: "SYS-08" },
  { label: "Log Aktivitas", rute: "#/log", kode: "SYS-09" },
  { label: "Panel Akses", rute: "#/akses", kode: "SYS-10" },
  { label: "Persetujuan Perubahan", rute: "#/persetujuan", kode: "SYS-11" },
]};

const SISTEM_PELANGGAN_SAJA = { grup: "Sistem", butir: [
  { label: "Database Konsumen", rute: "#/pelanggan", kode: "SYS-02" },
]};

export const PERAN = {
  owner: {
    label: "Owner", kode: "OWN", warna: "sein",
    beranda: "#/dashboard", batasDiskon: null, izin: ["*"],
    menu: [DASHBOARD, INBOX, SALES, INVENTORY, MASTER_DATA, SISTEM_LENGKAP],
  },

  admin: {
    label: "Admin", kode: "ADM", warna: "netral",
    beranda: "#/spk", batasDiskon: 500000,
    izin: [
      "stok.lihat", "stok.ubah", "spk.buat", "spk.lihat", "cetak.dokumen",
      "kas.lihat", "kas.input", "laba.lihat", "berkas.lihat", "ekspor",
    ],
    // Admin tidak diberi izin kelola.pengguna, jadi menu Pengguna
    // tidak ditampilkan untuk peran ini.
    menu: [INBOX, SALES, INVENTORY, MASTER_DATA, SISTEM_PELANGGAN_SAJA],
  },

  sales: {
    label: "Sales", kode: "SLS", warna: "sein",
    beranda: "#/spk", batasDiskon: 200000,
    izin: ["stok.lihat", "spk.buat", "spk.lihat"],
    menu: [INBOX, SALES, KATALOG_SAJA, SISTEM_PELANGGAN_SAJA],
  },

  kasir: {
    label: "Kasir", kode: "KAS", warna: "netral",
    beranda: "#/inbox", batasDiskon: 0,
    izin: ["spk.lihat", "kas.input", "kas.lihat", "agen.lihat"],
    // Belum ada modul kasir yang aktif di tahap ini.
    menu: [INBOX],
  },
};

// Menu asli tiap peran (dipakai apa adanya oleh halaman Ubah Nama
// Menu, supaya selalu ada rujukan ke nama bawaan).
// Semua butir menu, dikelompokkan, dengan nama tampilan yang SUDAH
// mengikuti kustomisasi owner (kalau ada), DAN sudah disaring
// mengikuti Panel Akses (kalau owner pernah mengatur ulang menu
// peran ini). Sidebar memakai ini.
export function menuBerlabel(peran) {
  const p = PERAN[peran];
  if (!p) return [];
  const kodeDiizinkan = peran === "owner" ? null : daftarKodeUntuk(peran);
  return p.menu
    .map((g) => ({
      grup: labelGrup(g.grup),
      butir: g.butir
        .filter((b) => !kodeDiizinkan || !b.kode || kodeDiizinkan.includes(b.kode))
        .map((b) => ({ ...b, label: labelItem(b.kode, b.label) })),
    }))
    .filter((g) => g.butir.length); // grup yang kosong (semua disembunyikan) tidak usah tampil
}

// Semua butir menu dalam satu daftar datar, untuk pendaftaran rute.
export function semuaMenu(peran) {
  return menuBerlabel(peran).flatMap((g) =>
    g.butir.map((b) => ({ ...b, grup: g.grup })));
}

export function boleh(peran, izin) {
  const p = PERAN[peran];
  if (!p) return false;
  return p.izin.includes("*") || p.izin.includes(izin);
}

export function batasDiskon(peran) {
  const p = PERAN[peran];
  if (!p) return 0;
  return p.batasDiskon; // null = bebas
}

export function perluPersetujuan(peran, nominal) {
  const batas = batasDiskon(peran);
  if (batas === null) return false;
  return Number(nominal || 0) > batas;
}

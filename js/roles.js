// roles.js — semua aturan peran ada di sini.
// Menambah peran baru cukup menambah satu blok di bawah,
// tanpa menyentuh kode fitur yang sudah jalan.

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
  { label: "Unit Stock Inquiry", rute: "#/stok", kode: "INV-06" },
]};

const KATALOG_SAJA = { grup: "Master Data", butir: [
  { label: "Unit Stock Inquiry", rute: "#/katalog", kode: "INV-06" },
]};

const SISTEM_LENGKAP = { grup: "Sistem", butir: [
  { label: "Pelanggan", rute: "#/pelanggan", kode: "SYS-02" },
  { label: "Pengguna", rute: "#/pengguna", kode: "SYS-03" },
]};

const SISTEM_PELANGGAN_SAJA = { grup: "Sistem", butir: [
  { label: "Pelanggan", rute: "#/pelanggan", kode: "SYS-02" },
]};

export const PERAN = {
  owner: {
    label: "Owner", kode: "OWN", warna: "sein",
    beranda: "#/kelola", batasDiskon: null, izin: ["*"],
    menu: [MASTER_DATA, SISTEM_LENGKAP],
  },

  admin: {
    label: "Admin", kode: "ADM", warna: "netral",
    beranda: "#/kelola", batasDiskon: 500000,
    izin: [
      "stok.lihat", "stok.ubah", "spk.buat", "spk.lihat",
      "kas.lihat", "kas.input", "laba.lihat", "berkas.lihat", "ekspor",
    ],
    // Admin tidak diberi izin kelola.pengguna, jadi menu Pengguna
    // tidak ditampilkan untuk peran ini.
    menu: [MASTER_DATA, SISTEM_PELANGGAN_SAJA],
  },

  sales: {
    label: "Sales", kode: "SLS", warna: "sein",
    beranda: "#/katalog", batasDiskon: 200000,
    izin: ["stok.lihat", "spk.buat", "spk.lihat"],
    menu: [KATALOG_SAJA, SISTEM_PELANGGAN_SAJA],
  },

  kasir: {
    label: "Kasir", kode: "KAS", warna: "netral",
    beranda: "#/pelanggan", batasDiskon: 0,
    izin: ["spk.lihat", "kas.input", "kas.lihat", "agen.lihat"],
    // Belum ada modul kasir yang aktif di tahap ini.
    menu: [],
  },
};

// Semua butir menu dalam satu daftar datar, untuk pendaftaran rute.
export function semuaMenu(peran) {
  const p = PERAN[peran];
  if (!p) return [];
  return p.menu.flatMap((g) =>
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

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

// Menu disusun per MODUL, bukan daftar datar — inilah bentuk ERP:
// tiap kelompok mewakili satu fungsi perusahaan, dan modul baru
// tinggal ditambahkan ke kelompok yang sesuai.
// Struktur menu mengikuti DMS dealer: modul Unit Sales dipecah
// jadi Purchase, Sales, Sales Report, Inventory, dan Incentive.
// Tiap layar punya kode sendiri — kode itu yang disebut karyawan
// saat menelepon minta bantuan.
//
// Produk dan Sistem tetap ada karena SPK tidak bisa dibuat tanpa
// master tipe motor, dan akun karyawan harus bisa dibuat dari
// dalam aplikasi.
// Struktur menu mengikuti modul Unit Sales pada DMS dealer:
// Purchase, Sales, Sales Report, Inventory, Incentive.
//
// Tiap butir punya `kode` layar. Kode itu dipakai di bilah judul
// dan jadi rujukan saat karyawan menanyakan sesuatu — jauh lebih
// cepat daripada menjelaskan tampilannya.
//
// Kelompok Sistem sengaja dipertahankan di luar Unit Sales: tanpa
// Tipe Motor tidak ada yang bisa dijual, dan tanpa Pengguna tidak
// ada yang bisa masuk.

const UNIT_SALES = [
  { grup: "Purchase", butir: [
    { label: "Purchase Order Inquiry", rute: "#/po-inquiry", kode: "PCH-01" },
    { label: "Purchase Order Inquiry (by Model)",
      rute: "#/po-model", kode: "PCH-02" },
    { label: "Purchase Return Entry", rute: "#/po-retur", kode: "PCH-03" },
  ]},
  { grup: "Sales", butir: [
    { label: "Unit SPK Entry (Reguler)", rute: "#/spk", kode: "SLS-01" },
    { label: "Unit SPK Entry (Instansi)", rute: "#/spk-instansi",
      kode: "SLS-02" },
    { label: "Unit SPK Processing", rute: "#/spk-proses", kode: "SLS-03" },
    { label: "Faktur Application", rute: "#/faktur", kode: "SLS-04" },
    { label: "Unit Monitoring by SPK", rute: "#/monitoring", kode: "SLS-05" },
    { label: "Unit Sales Return", rute: "#/retur-jual", kode: "SLS-06" },
    { label: "Unit Receivable Payment Entry", rute: "#/tagihan",
      kode: "SLS-07" },
    { label: "Faktur Re-print Request", rute: "#/faktur-cetak",
      kode: "SLS-08" },
    { label: "Pengaturan Konten", rute: "#/konten", kode: "SLS-09" },
    { label: "Leasing Connect Approve List", rute: "#/leasing",
      kode: "SLS-10" },
  ]},
  { grup: "Sales Report", butir: [
    { label: "Unit Shipment Inquiry", rute: "#/rpt-kirim", kode: "RPT-01" },
    { label: "Unit Sale Return Inquiry", rute: "#/rpt-retur", kode: "RPT-02" },
    { label: "Unit Invoice Inquiry", rute: "#/rpt-faktur", kode: "RPT-03" },
    { label: "Unit Account Receipt Inquiry", rute: "#/rpt-terima",
      kode: "RPT-04" },
    { label: "Detail Open Faktur", rute: "#/rpt-open", kode: "RPT-05" },
    { label: "Police Registration Date Report", rute: "#/rpt-polisi",
      kode: "RPT-06" },
  ]},
  { grup: "Inventory", butir: [
    { label: "Receipt Manifest List", rute: "#/inv-manifest", kode: "INV-01" },
    { label: "Manifest Revise History Inquiry", rute: "#/inv-revisi",
      kode: "INV-02" },
    { label: "Unit Receive Inquiry by Model", rute: "#/inv-terima",
      kode: "INV-03" },
    { label: "Unit Stock Transfer", rute: "#/inv-transfer", kode: "INV-04" },
    { label: "Unit Stock Mutation Inquiry", rute: "#/inv-mutasi",
      kode: "INV-05" },
    { label: "Unit Stock Inquiry", rute: "#/stok", kode: "INV-06" },
    { label: "Stock In Out History Inquiry", rute: "#/inv-riwayat",
      kode: "INV-07" },
    { label: "Unit Stock Mutation / Switch Application",
      rute: "#/inv-switch", kode: "INV-08" },
  ]},
  { grup: "Incentive", butir: [
    { label: "Unit Incentive Application", rute: "#/insentif", kode: "ICT-01" },
  ]},
];

const SISTEM = { grup: "Sistem", butir: [
  { label: "Tipe Motor", rute: "#/kelola", kode: "SYS-01" },
  { label: "Pelanggan", rute: "#/pelanggan", kode: "SYS-02" },
  { label: "Pengguna", rute: "#/pengguna", kode: "SYS-03" },
  { label: "Penomoran", rute: "#/nomor", kode: "SYS-04" },
]};

export const PERAN = {
  owner: {
    label: "Owner", kode: "OWN", warna: "sein",
    beranda: "#/spk", batasDiskon: null, izin: ["*"],
    menu: [...UNIT_SALES, SISTEM],
  },

  admin: {
    label: "Admin", kode: "ADM", warna: "netral",
    beranda: "#/monitoring", batasDiskon: 500000,
    izin: [
      "stok.lihat", "stok.ubah", "spk.buat", "spk.lihat",
      "kas.lihat", "kas.input", "laba.lihat", "berkas.lihat", "ekspor",
    ],
    menu: [
      UNIT_SALES[0],                 // Purchase
      UNIT_SALES[1],                 // Sales
      UNIT_SALES[3],                 // Inventory
      { grup: "Sistem", butir: [
        { label: "Tipe Motor", rute: "#/kelola", kode: "SYS-01" },
        { label: "Pelanggan", rute: "#/pelanggan", kode: "SYS-02" },
      ]},
    ],
  },

  sales: {
    label: "Sales", kode: "SLS", warna: "sein",
    beranda: "#/spk", batasDiskon: 200000,
    izin: ["stok.lihat", "spk.buat", "spk.lihat"],
    menu: [
      { grup: "Sales", butir: [
        { label: "Unit SPK Entry (Reguler)", rute: "#/spk", kode: "SLS-01" },
        { label: "Unit SPK Entry (Instansi)", rute: "#/spk-instansi",
          kode: "SLS-02" },
        { label: "Unit Monitoring by SPK", rute: "#/monitoring",
          kode: "SLS-05" },
      ]},
      { grup: "Inventory", butir: [
        { label: "Unit Stock Inquiry", rute: "#/katalog", kode: "INV-06" },
      ]},
      { grup: "Sistem", butir: [
        { label: "Pelanggan", rute: "#/pelanggan", kode: "SYS-02" },
      ]},
    ],
  },

  kasir: {
    label: "Kasir", kode: "KAS", warna: "netral",
    beranda: "#/tagihan", batasDiskon: 0,
    izin: ["spk.lihat", "kas.input", "kas.lihat", "agen.lihat"],
    menu: [
      { grup: "Sales", butir: [
        { label: "Unit Receivable Payment Entry", rute: "#/tagihan",
          kode: "SLS-07" },
        { label: "Faktur Re-print Request", rute: "#/faktur-cetak",
          kode: "SLS-08" },
      ]},
      { grup: "Sales Report", butir: [
        { label: "Unit Account Receipt Inquiry", rute: "#/kuitansi",
          kode: "RPT-04" },
      ]},
    ],
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

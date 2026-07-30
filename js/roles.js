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
export const PERAN = {
  owner: {
    label: "Owner",
    kode: "OWN",
    warna: "sein",
    beranda: "#/ringkasan",
    batasDiskon: null, // null = tanpa batas
    izin: ["*"],
    menu: [
      { grup: "Beranda", butir: [
        { label: "Dasbor", rute: "#/ringkasan" },
      ]},
      { grup: "Penjualan", butir: [
        { label: "SPK", rute: "#/spk" },
        { label: "Tagihan", rute: "#/tagihan" },
        { label: "Kuitansi", rute: "#/kuitansi" },
      ]},
      { grup: "Inventori", butir: [
        { label: "Stok Unit", rute: "#/stok" },
        { label: "Serah Terima", rute: "#/berkas" },
      ]},
      { grup: "Keuangan", butir: [
        { label: "Kas", rute: "#/kas" },
      ]},
      { grup: "Data Induk", butir: [
        { label: "Tipe Motor", rute: "#/kelola" },
        { label: "Pelanggan", rute: "#/pelanggan" },
      ]},
      { grup: "Pengaturan", butir: [
        { label: "Pengguna", rute: "#/pengguna" },
        { label: "Penomoran", rute: "#/nomor" },
      ]},
    ],
  },

  admin: {
    label: "Admin",
    kode: "ADM",
    warna: "netral",
    beranda: "#/berkas",
    batasDiskon: 500000,
    izin: [
      "stok.lihat", "stok.ubah", "spk.buat", "spk.lihat",
      "kas.lihat", "kas.input", "laba.lihat", "berkas.lihat", "ekspor",
    ],
    menu: [
      { grup: "Inventori", butir: [
        { label: "Serah Terima", rute: "#/berkas" },
        { label: "Stok Unit", rute: "#/stok" },
      ]},
      { grup: "Penjualan", butir: [
        { label: "SPK", rute: "#/spk" },
      ]},
      { grup: "Keuangan", butir: [
        { label: "Kas", rute: "#/kas" },
      ]},
      { grup: "Data Induk", butir: [
        { label: "Pelanggan", rute: "#/pelanggan" },
      ]},
    ],
  },

  sales: {
    label: "Sales",
    kode: "SLS",
    warna: "sein",
    beranda: "#/katalog",
    batasDiskon: 200000,
    izin: ["stok.lihat", "spk.buat", "spk.lihat"],
    menu: [
      { grup: "Penjualan", butir: [
        { label: "Katalog", rute: "#/katalog" },
        { label: "SPK Saya", rute: "#/spk" },
      ]},
      { grup: "Data Induk", butir: [
        { label: "Pelanggan", rute: "#/pelanggan" },
      ]},
    ],
  },

  kasir: {
    label: "Kasir",
    kode: "KAS",
    warna: "netral",
    beranda: "#/tagihan",
    batasDiskon: 0,
    izin: ["spk.lihat", "kas.input", "kas.lihat", "agen.lihat"],
    menu: [
      { grup: "Penerimaan", butir: [
        { label: "Tagihan", rute: "#/tagihan" },
        { label: "Kuitansi", rute: "#/kuitansi" },
      ]},
      { grup: "Keuangan", butir: [
        { label: "Kas", rute: "#/kas" },
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

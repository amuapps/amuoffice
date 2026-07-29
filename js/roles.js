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

export const PERAN = {
  owner: {
    label: "Owner",
    warna: "sein",
    beranda: "#/ringkasan",
    batasDiskon: null, // null = tanpa batas
    izin: ["*"],
    menu: [
      { label: "Ringkasan", rute: "#/ringkasan" },
      { label: "Stok", rute: "#/stok" },
      { label: "SPK", rute: "#/spk" },
      { label: "Kas", rute: "#/kas" },
      { label: "Kelola", rute: "#/kelola" },
    ],
  },

  admin: {
    label: "Admin",
    warna: "netral",
    beranda: "#/berkas",
    batasDiskon: 500000,
    izin: [
      "stok.lihat", "stok.ubah", "spk.buat", "spk.lihat",
      "kas.lihat", "kas.input", "laba.lihat", "berkas.lihat", "ekspor",
    ],
    menu: [
      { label: "Berkas", rute: "#/berkas" },
      { label: "Stok", rute: "#/stok" },
      { label: "SPK", rute: "#/spk" },
      { label: "Kas", rute: "#/kas" },
    ],
  },

  sales: {
    label: "Sales",
    warna: "sein",
    beranda: "#/katalog",
    batasDiskon: 200000,
    izin: ["stok.lihat", "spk.buat", "spk.lihat"],
    menu: [
      { label: "Katalog", rute: "#/katalog" },
      { label: "SPK Saya", rute: "#/spk" },
      { label: "Pelanggan", rute: "#/pelanggan" },
    ],
  },

  kasir: {
    label: "Kasir",
    warna: "netral",
    beranda: "#/tagihan",
    batasDiskon: 0,
    izin: ["spk.lihat", "kas.input", "kas.lihat", "agen.lihat"],
    menu: [
      { label: "Tagihan", rute: "#/tagihan" },
      { label: "Kas", rute: "#/kas" },
      { label: "Kuitansi", rute: "#/kuitansi" },
    ],
  },
};

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

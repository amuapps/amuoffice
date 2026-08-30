// dokumen.js — Tracking Dokumen Kendaraan (STNK/BPKB/Plat & serah
// terima berkas ke Biro Jasa). TAHAP 1: baru peran, login, dan
// struktur data dasar — alur konfirmasi lengkap (dialog+password,
// BAST, log per-berkas) menyusul di tahap berikutnya.
//
// Satu dokumen per SPK, disimpan di koleksi "dokumen_kendaraan"
// dengan ID YANG SAMA PERSIS dengan ID dokumen SPK-nya di
// "transaksi" — supaya gampang dicari-silang, tidak perlu field
// referensi terpisah.
//
// Status berkas awal (KTP + Faktur):
//   belum_diserahkan → diserahkan (menunggu konfirmasi Biro Jasa)
//   → dikonfirmasi (Biro Jasa sudah terima)
//
// Status TIAP dokumen (STNK / BPKB / Plat — independen satu sama
// lain, karena bisa selesai di waktu berbeda):
//   belum → diproses → selesai (menunggu diserahkan ke Admin)
//   → diserahkan (menunggu konfirmasi Admin) → dikonfirmasi

import { dbase, collection, doc, getDoc, getDocs, setDoc, query, where,
  orderBy, limit, catat } from "./db.js?v=3.9.3";
import { sesi, bolehAkses } from "./auth.js?v=3.9.3";
import { aman, tanggal, rupiah } from "./ui.js?v=3.9.3";

export const LABEL_BERKAS = {
  belum_diserahkan: "Belum Diserahkan",
  diserahkan: "Menunggu Konfirmasi Biro Jasa",
  dikonfirmasi: "Diterima Biro Jasa",
};
export const LABEL_DOKUMEN = {
  belum: "Belum Dikerjakan",
  diproses: "Sedang Diproses",
  selesai: "Selesai — Menunggu Diserahkan",
  diserahkan: "Menunggu Konfirmasi Admin",
  dikonfirmasi: "Diterima Admin",
};

function dataDefault(t) {
  return {
    transaksiId: t.id, spkNo: t.spkNo,
    pembeliNama: t.pembeli?.nama || "-",
    tipeNama: t.tipeNama, warna: t.warna,
    biroJasaId: null, biroJasaNama: null,
    berkasStatus: "belum_diserahkan",
    stnkStatus: "belum", bpkbStatus: "belum", platStatus: "belum",
  };
}

// Ambil (atau buat kalau belum ada) dokumen tracking untuk satu SPK.
export async function muatDokumenUntuk(t) {
  const ref = doc(dbase, "dokumen_kendaraan", t.id);
  const snap = await getDoc(ref);
  if (snap.exists()) return { id: snap.id, ...snap.data() };
  return { id: t.id, ...dataDefault(t) };
}

// TAHAP 1: halaman masih ringkas — daftar SPK + status ringkasnya,
// belum ada tombol aksi (serahkan/konfirmasi) sama sekali. Itu
// dibangun di Tahap 2, sekalian dengan dialog konfirmasi+password
// dan cetak BAST-nya.
export async function halamanDokumen(wadah) {
  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">Tracking Dokumen Kendaraan</h2></div>
    <div class="hampa">
      <p><b>Tahap 1 baru selesai</b> — peran Biro Jasa, login, dan
        struktur data dasar sudah siap. Alur lengkapnya (serahkan ke
        Biro Jasa, konfirmasi, cetak BAST, tracking per-dokumen)
        menyusul di pembaruan berikutnya.</p>
    </div>
  </section>`;
}

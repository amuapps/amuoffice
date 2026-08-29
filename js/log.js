// log.js — Log Aktivitas: siapa melakukan apa dan kapan. Sumbernya
// koleksi audit_log yang sudah ditulis otomatis oleh catat()/
// sertakanLog() di db.js dari seluruh modul — halaman ini cuma
// menampilkannya, tidak menulis apa pun ke sana.

import { dbase, collection, getDocs, query, where, orderBy, limit }
  from "./db.js?v=3.8.1";
import { bolehAkses } from "./auth.js?v=3.8.1";
import { aman, tanggalJam } from "./ui.js?v=3.8.1";

// Nama aksi teknis → kalimat yang gampang dibaca. Aksi yang belum
// ada di sini tetap tampil (pakai nama aslinya) supaya tidak ada
// yang "hilang" cuma karena belum sempat diberi label.
export const LABEL_AKSI = {
  login: "Masuk ke sistem",
  logout: "Keluar dari sistem",
  login_ditolak_nonaktif: "Percobaan masuk ditolak (akun nonaktif)",
  unit_ditambah: "Menambah unit",
  unit_diubah: "Mengubah data unit",
  unit_perubahan_diajukan: "Mengajukan perubahan data unit",
  perubahan_unit_disetujui: "Menyetujui perubahan data unit",
  perubahan_unit_ditolak: "Menolak perubahan data unit",
  referensi_diubah: "Mengubah daftar referensi",
  pelanggan_ditambah: "Menambah konsumen",
  pelanggan_diubah: "Mengubah data konsumen",
  leasing_ditambah: "Menambah leasing",
  leasing_diubah: "Mengubah leasing",
  leasing_status_diubah: "Mengubah status leasing",
  rekening_ditambah: "Menambah rekening",
  rekening_diubah: "Mengubah rekening",
  rekening_status_diubah: "Mengubah status rekening",
  spk_dibuat: "Membuat SPK",
  perubahan_spk_diajukan: "Mengajukan perubahan pembeli/pemakai SPK",
  perubahan_spk_disetujui: "Menyetujui perubahan pembeli/pemakai SPK",
  perubahan_spk_ditolak: "Menolak perubahan pembeli/pemakai SPK",
  kuitansi_dicetak: "Mencetak kuitansi (mengunci data SPK)",
  agen_ditambah: "Menambah agen",
  agen_diubah: "Mengubah agen",
  agen_status_diubah: "Mengubah status agen",
  fee_agen_dibayar: "Menandai fee agen sudah dibayar",
  biro_ditambah: "Menambah biro jasa",
  biro_diubah: "Mengubah biro jasa",
  biro_status_diubah: "Mengubah status biro jasa",
  supplier_ditambah: "Menambah supplier",
  supplier_diubah: "Mengubah supplier",
  supplier_status_diubah: "Mengubah status supplier",
  cashback_diajukan: "Mengajukan cashback SPK",
  cashback_disetujui: "Menyetujui cashback SPK",
  cashback_ditolak: "Menolak cashback SPK",
  diskon_diajukan: "Mengajukan diskon melebihi batas",
  diskon_disetujui: "Menyetujui diskon melebihi batas",
  diskon_ditolak: "Menolak diskon melebihi batas",
  batal_spk_diajukan: "Mengajukan pembatalan SPK",
  batal_spk_ditolak: "Menolak pembatalan SPK",
  spk_dibatalkan: "Membatalkan SPK",
  perubahan_spk_diterapkan_owner: "Mengubah data SPK langsung (Owner)",
  pembayaran_dicatat: "Mencatat pembayaran SPK",
  label_diubah: "Mengubah nama menu",
  akses_diubah: "Mengubah hak akses peran",
};

function awalBulanIni() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hariIni() {
  return new Date().toISOString().slice(0, 10);
}

function baris(l) {
  const detail = [l.koleksi, l.ringkas].filter(Boolean).join(" · ");
  return `<tr>
    <td>${tanggalJam(l.pada)}</td>
    <td>${aman(l.email || l.uid)}</td>
    <td>${aman(LABEL_AKSI[l.aksi] || l.aksi)}</td>
    <td>${aman(detail)}</td>
  </tr>`;
}

// Riwayat perubahan untuk SATU dokumen spesifik (mis. satu SPK atau
// satu konsumen) — dipakai buat mini-riwayat di panel Detail,
// bukan halaman Log Aktivitas penuh. Cuma Owner yang boleh lihat
// (sama seperti Log Aktivitas biasa).
export async function muatRiwayatDokumen(koleksi, docId, maks = 15) {
  if (!bolehAkses("log.lihat")) return [];
  try {
    // SENGAJA tidak orderBy di query-nya (biar tidak butuh index
    // gabungan tambahan di Firestore) — diurutkan di sini saja
    // setelah datanya diambil.
    const snap = await getDocs(query(
      collection(dbase, "audit_log"),
      where("koleksi", "==", koleksi), where("docId", "==", docId),
      limit(maks * 3) // ambil agak banyak dulu, baru dipotong setelah diurutkan
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.pada?.seconds || 0) - (a.pada?.seconds || 0))
      .slice(0, maks);
  } catch {
    return []; // gagal diam-diam — ini cuma info tambahan, jangan sampai gagalkan Detail-nya
  }
}

// Render mini-riwayat jadi HTML siap pakai — dipakai bareng dengan
// muatRiwayatDokumen di atas dari laporan.js/pelanggan.js.
export function htmlRiwayatDokumen(daftar) {
  if (!daftar.length) return "";
  return `<div class="d-kolom" style="flex-basis:100%">
    <p class="d-judul">Riwayat Perubahan</p>
    ${daftar.map((l) => `<div class="d-baris">
      <span class="d-label">${aman(tanggalJam(l.pada))}
        · ${aman(l.email || "-")}</span>
      <span class="d-isi">${aman(LABEL_AKSI[l.aksi] || l.aksi)}
        ${l.ringkas ? ` — ${aman(l.ringkas)}` : ""}</span>
    </div>`).join("")}
  </div>`;
}

export async function halamanLog(wadah) {
  if (!bolehAkses("kelola.pengguna")) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Hanya Owner yang bisa melihat Log Aktivitas.</p></div>
    </section>`;
    return;
  }

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">Log Aktivitas</h2></div>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="lg-dari">Dari tanggal</label>
        <input class="isian isian--terang" id="lg-dari" type="date"
               value="${awalBulanIni()}">
      </div>
      <div>
        <label class="label label--gelap" for="lg-sampai">Sampai tanggal</label>
        <input class="isian isian--terang" id="lg-sampai" type="date"
               value="${hariIni()}">
      </div>
    </div>
    <button class="tombol tombol--kecil tombol--isi" id="lg-terapkan">Terapkan</button>

    <div style="overflow-x:auto; margin-top:16px">
      <table class="tabel">
        <thead>
          <tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Detail</th></tr>
        </thead>
        <tbody id="lg-baris">
          <tr><td colspan="4" class="hampa">Memuat…</td></tr>
        </tbody>
      </table>
    </div>
  </section>`;

  const dariEl = wadah.querySelector("#lg-dari");
  const sampaiEl = wadah.querySelector("#lg-sampai");
  const barisEl = wadah.querySelector("#lg-baris");

  async function muat() {
    barisEl.innerHTML = `<tr><td colspan="4" class="hampa">Memuat…</td></tr>`;
    const dari = new Date(dariEl.value + "T00:00:00");
    const sampai = new Date(sampaiEl.value + "T23:59:59");
    try {
      const snap = await getDocs(query(
        collection(dbase, "audit_log"),
        where("pada", ">=", dari),
        where("pada", "<=", sampai),
        orderBy("pada", "desc"),
        limit(500)
      ));
      const data = snap.docs.map((d) => d.data());
      barisEl.innerHTML = data.length
        ? data.map(baris).join("")
        : `<tr><td colspan="4" class="hampa">Tidak ada aktivitas di rentang ini.</td></tr>`;
    } catch (err) {
      barisEl.innerHTML = `<tr><td colspan="4" class="hampa">
        Gagal memuat: ${aman(err.message)}</td></tr>`;
    }
  }

  wadah.querySelector("#lg-terapkan").addEventListener("click", muat);
  await muat();
}

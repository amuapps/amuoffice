// tentang.js — riwayat versi aplikasi, khusus Owner. Isinya
// diperbarui manual tiap ada pembaruan besar (bukan otomatis dari
// git log atau semacamnya — ini aplikasi sederhana tanpa proses
// build/CI, jadi cukup ditulis tangan di sini).

import { sesi } from "./auth.js";
import { VERSI } from "./config.js";
import { aman } from "./ui.js";

const RIWAYAT = [
  {
    versi: "2.6.2", tanggal: "Agustus 2026",
    judul: "Notifikasi Unit: Sebut Peran, Konsumen & No. SPK",
    butir: [
      "Notifikasi pengajuan ubah unit sekarang berformat: \"[Peran] [Nama] mengajukan perubahan [Field]: X menjadi Y untuk konsumen [Nama] dengan No. SPK [Nomor]\" — kalau unit belum terkait SPK, otomatis sebut nomor unitnya saja.",
      "Judul kartu di Persetujuan Perubahan untuk pengajuan ubah unit sekarang menampilkan No. SPK (kalau unit itu sedang terkait SPK aktif) atau nomor rangka — dulu kosong.",
    ],
  },
  {
    versi: "2.6.1", tanggal: "Agustus 2026",
    judul: "Notifikasi Lebih Detail",
    butir: [
      "Notifikasi pengajuan perubahan Unit dan Data Pembeli/Pemakai sekarang menyebutkan RINCIAN field yang berubah (mis. \"No. Mesin: X → Y\"), bukan cuma nomor rangka/nomor SPK-nya saja.",
    ],
  },
  {
    versi: "2.6.0", tanggal: "Agustus 2026",
    judul: "Owner Diberi Tahu Ada Pengajuan Baru",
    butir: [
      "PERBAIKAN PENTING: sebelumnya Owner TIDAK pernah diberi tahu saat ada pengajuan baru (cashback, diskon, batal SPK, ubah data, ubah unit) — cuma tahu kalau buka halaman Persetujuan Perubahan sendiri. Sekarang notifikasi otomatis masuk Inbox Owner begitu ada pengajuan baru.",
      "Riwayat keputusan Owner sendiri (Setujui/Tolak) juga ikut tercatat di Inbox-nya sendiri, bukan cuma dikirim ke pemohon.",
      "Auto-sync daftar Owner tiap buka Data Karyawan — supaya akun Owner yang sudah ada dari sebelumnya ikut ke-detect tanpa perlu disimpan ulang.",
    ],
  },
  {
    versi: "2.5.0", tanggal: "Agustus 2026",
    judul: "Master Agen Lengkap: Data KTP, Rekening & Riwayat Fee",
    butir: [
      "Master Agen sekarang punya data lengkap gaya KTP (Tempat/Tanggal Lahir, Alamat) dan rekening bank (Nama Bank, No. Rekening, a.n.) buat transfer fee.",
      "Tombol \"Lihat Penjualan & Fee\" per agen — menampilkan semua SPK yang membawa agen itu, beserta status fee-nya (Belum/Sudah Dibayar) dan total yang belum dibayar.",
      "Owner bisa menandai fee sebagai sudah dibayar langsung dari panel ini, lengkap tanggal, bank pengirim, dan catatan referensi transfer.",
    ],
  },
  {
    versi: "2.4.1", tanggal: "Agustus 2026",
    judul: "Sales Bisa Pilih Agen",
    butir: [
      "Sales sekarang bisa memilih Agen di SPK (buat catat siapa yang membawa konsumen) — tapi tetap TIDAK bisa lihat/isi nominal Fee Agen (cuma Owner & Admin).",
    ],
  },
  {
    versi: "2.4.0", tanggal: "Agustus 2026",
    judul: "Koreksi Alur Agen & Biro Jasa",
    butir: [
      "Biro Jasa dihapus dari form SPK — pemilihan biro jasa buat urus STNK/BPKB itu keputusan Owner belakangan, terpisah dari proses jual (bukan diisi sales/admin saat SPK dibuat). Master Biro Jasa tetap ada buat catatan Owner.",
      "Fee Agen sekarang juga terlihat Admin (dulu cuma Owner) — karena Admin/Kasir yang membayarkan fee itu ke rekening agen yang dipilih di SPK.",
    ],
  },
  {
    versi: "2.3.2", tanggal: "Agustus 2026",
    judul: "Koreksi: Biaya Internal Terpisah dari Harga Jual",
    butir: [
      "Harga OTR (jual) dikembalikan ke Offroad + BBN saja, sesuai maksud awal — Admin/Sales tetap pakai formula ini.",
      "Biaya Pengiriman, Aksesoris, dan Lain-lain (dari pembaruan sebelumnya) sekarang jadi \"Catatan Biaya Internal\" terpisah, cuma terlihat Owner, TIDAK menambah harga jual sama sekali.",
    ],
  },
  {
    versi: "2.3.1", tanggal: "Agustus 2026",
    judul: "Komponen Harga OTR Lebih Lengkap",
    butir: [
      "Tipe Motor sekarang punya 3 kolom harga tambahan: Biaya Pengiriman, Aksesoris, dan Lain-lain.",
      "Harga OTR otomatis dihitung dari Offroad + Pengiriman + Aksesoris + Lain-lain + BBN (dulu cuma Offroad + BBN).",
    ],
  },
  {
    versi: "2.3.0", tanggal: "Agustus 2026",
    judul: "Batalkan SPK",
    butir: [
      "Tombol \"Batalkan\" di Riwayat SPK & Lihat Pesanan — SPK yang belum Lunas/Terjual sekarang bisa dibatalkan langsung dari aplikasi (dulu cuma bisa manual lewat Firebase Console).",
      "SPK yang sudah Lunas & unitnya sudah Terjual TIDAK bisa dibatalkan lewat sistem — harus ditangani Owner di luar sistem (retur/tukar unit).",
      "Owner bisa langsung membatalkan (pakai password kalau kuitansi sudah dicetak). Admin/Sales cuma bisa mengajukan, Owner yang menyetujui/menolak lewat Persetujuan Perubahan.",
      "Unit yang terkunci ke SPK yang dibatalkan otomatis kembali jadi Ready, stok bertambah balik.",
      "Alasan pembatalan wajib diisi & tercatat di Log Aktivitas; sales pemilik SPK dapat notifikasi kalau yang membatalkan Owner.",
    ],
  },
  {
    versi: "2.2.0", tanggal: "Agustus 2026",
    judul: "Master Biro Jasa",
    butir: [
      "Master Biro Jasa (vendor pengurusan STNK/BPKB) — pola & kerahasiaan sama seperti Master Agen, khusus Owner.",
      "Field \"Biro Jasa\" & \"Biaya Biro Jasa / BBN\" ditambahkan ke SPK, cuma terlihat Owner — mencatat siapa yang mengurus dokumen unit & berapa biaya sungguhannya.",
    ],
  },
  {
    versi: "2.1.1", tanggal: "Agustus 2026",
    judul: "Layar Loading Lebih Informatif",
    butir: [
      "Layar muat di awal sekarang menampilkan persentase (bukan animasi bolak-balik tanpa arti).",
      "Kalau loading kelamaan (lebih dari 12 detik) — biasanya tanda ada file yang belum lengkap ter-upload ke server — otomatis muncul pesan gagal-muat & tombol Muat Ulang, bukan macet diam tanpa penjelasan.",
    ],
  },
  {
    versi: "2.1.0", tanggal: "Agustus 2026",
    judul: "Batas Diskon Ditegakkan Sungguhan",
    butir: [
      "Diskon yang diisi Sales/Admin melebihi batas perannya TIDAK lagi langsung berlaku begitu saja — otomatis masuk pengajuan ke Owner (mirip alur Cashback).",
      "Diskon yang masih dalam batas tetap langsung berlaku seperti biasa, tanpa perlu persetujuan.",
      "Owner memproses pengajuan diskon dari halaman Persetujuan Perubahan (Setujui/Tolak, pakai password), dan yang mengajukan dapat notifikasi balik di Inbox-nya.",
    ],
  },
  {
    versi: "2.0.0", tanggal: "Agustus 2026",
    judul: "Pembayaran Bertahap, Agen & Persetujuan Diperluas",
    butir: [
      "SPK bisa dibayar bertahap (DP → cicilan → pelunasan) — tiap pembayaran dapat kuitansi & nomor sendiri, bukan cetak ulang yang sama.",
      "Status Lunas & Terjual pada unit terdeteksi otomatis begitu total pembayaran mencapai Harga OTR.",
      "Sumber dana kuitansi (Konsumen/Leasing) terdeteksi otomatis dari data SPK, tidak perlu diisi manual.",
      "Master Agen (data agen penjualan, khusus Owner) beserta Fee Agen di SPK.",
      "Cashback di SPK — bisa diajukan siapa saja, baru berlaku setelah disetujui Owner.",
      "Ubah data Unit oleh Admin sekarang lewat alur pengajuan & persetujuan Owner (dulu langsung tersimpan).",
      "Klik unit berstatus Dipesan/Terjual di Data Unit untuk langsung lihat siapa pembelinya.",
    ],
  },
  {
    versi: "1.9.0", tanggal: "Agustus 2026",
    judul: "Dashboard Penjualan & Inbox Notifikasi",
    butir: [
      "Dashboard Penjualan (grafik tren bulanan, unit terjual per tipe, peringkat sales) — beranda default Owner.",
      "Inbox notifikasi realtime (lonceng di panel atas) — Sales diberi tahu saat konsumennya bayar, Admin diberi tahu saat pengajuannya diputuskan.",
      "Data Karyawan diperluas: ID Karyawan, NIK, TTL, Alamat, Pendidikan, Jabatan, Tanggal Bergabung, dan otomatis menghitung masa kerja.",
      "Ubah password sendiri (semua peran) dan \"Lupa password?\" mandiri dari layar login.",
    ],
  },
  {
    versi: "1.8.0", tanggal: "Agustus 2026",
    judul: "Kuitansi Rangkap 3 & Validasi QR",
    butir: [
      "Kuitansi dirombak jadi rangkap 3 dalam satu lembar (Konsumen/Showroom/Cadangan), bergaya krem-emas.",
      "QR code di tiap kuitansi — bisa dipindai siapa saja untuk verifikasi keasliannya lewat halaman publik, tanpa perlu login.",
      "Mencetak kuitansi pertama kali mengunci data pembeli/pemakai/unit SPK itu (wajib konfirmasi password Owner/Admin dulu).",
    ],
  },
  {
    versi: "1.7.0", tanggal: "Agustus 2026",
    judul: "Alur Persetujuan Perubahan Data",
    butir: [
      "Perubahan data Pembeli/Pemakai pada SPK yang sudah tersimpan kini lewat pengajuan — baru berlaku setelah disetujui Owner (pakai password).",
      "Halaman Persetujuan Perubahan — daftar semua pengajuan yang menunggu, lengkap catatan otomatis apa saja yang berubah.",
      "Sales dibatasi cuma bisa lihat SPK & data konsumen yang dia tangani sendiri (ditegakkan sampai level Firestore rules).",
    ],
  },
  {
    versi: "1.5.1", tanggal: "Agustus 2026",
    judul: "Fondasi Sistem",
    butir: [
      "Master data (Tipe Motor, Data Unit, Leasing, Rekening, Referensi & Saran Isian).",
      "SPK — pembuatan, riwayat & laporan, cetak PDF dengan watermark otomatis.",
      "Database Konsumen, Panel Akses per peran, Ubah Nama Menu, Log Aktivitas.",
    ],
  },
];

export async function halamanTentang(wadah) {
  if (!sesi || sesi.peran !== "owner") {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Halaman ini cuma tersedia untuk Owner.</p></div>
    </section>`;
    return;
  }

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Tentang Aplikasi</h2>
    </div>
    <div class="lembar" style="margin:10px 0 16px;text-align:center">
      <p class="kartu-sub" style="margin:0">Versi yang sedang berjalan</p>
      <p class="angka-besar" style="margin:2px 0 0">v${aman(VERSI)}</p>
    </div>

    <h3 class="judul" style="font-size:15px;margin-bottom:8px">Riwayat Pembaruan</h3>
    <div id="daftar-riwayat">
      ${RIWAYAT.map((r, i) => `<div class="lembar" style="margin-bottom:10px;
            ${i === 0 ? "border-left:3px solid var(--biru)" : ""}">
        <div style="display:flex;justify-content:space-between;
                    align-items:baseline;flex-wrap:wrap;gap:6px">
          <h4 class="kartu-judul" style="margin:0">v${aman(r.versi)} —
            ${aman(r.judul)}</h4>
          ${i === 0 ? `<span class="tanda tanda--ready">Terbaru</span>` : ""}
        </div>
        <p class="kartu-sub" style="margin:2px 0 8px">${aman(r.tanggal)}</p>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6">
          ${r.butir.map((b) => `<li>${aman(b)}</li>`).join("")}
        </ul>
      </div>`).join("")}
    </div>
  </section>`;
}

// tentang.js — riwayat versi aplikasi, khusus Owner. Isinya
// diperbarui manual tiap ada pembaruan besar (bukan otomatis dari
// git log atau semacamnya — ini aplikasi sederhana tanpa proses
// build/CI, jadi cukup ditulis tangan di sini).

import { sesi, konfirmasiPassword } from "./auth.js?v=3.8.0";
import { VERSI } from "./config.js?v=3.8.0";
import { aman, rupiah, kabar } from "./ui.js?v=3.8.0";
import { konfirmasi, tanya } from "./dialog.js?v=3.8.0";
import { dbase, collection, getDocs, query, where, doc, getDoc, setDoc,
  deleteDoc, updateDoc, catat } from "./db.js?v=3.8.0";

const RIWAYAT = [
  {
    versi: "3.8.0", tanggal: "Agustus 2026",
    judul: "PERBAIKAN BUG PENTING + 5 Fitur Baru Sekaligus",
    butir: [
      "PERBAIKAN BUG SERIUS: SPK Cash yang dibayar LUNAS langsung di awal (misal Tunai penuh saat tanda tangan) — tombol \"Terima Pembayaran & Cetak Kuitansi\" hilang SEBELUM sempat diklik sama sekali, karena sistem sudah menganggapnya \"Lunas\" duluan sebelum kuitansi pertamanya sempat dicetak. Ini bisa kena BANYAK SPK sekaligus. Sudah diperbaiki — tombol sekarang tetap muncul selama kuitansi belum pernah dicetak, apa pun status Lunas-nya.",
      "\"Hapus SPK Permanen\" (Owner) — beda dari Batalkan, ini benar-benar menghapus SPK dari sistem, termasuk yang sudah Lunas & Terjual (yang sebelumnya tidak bisa dibatalkan sama sekali lewat aplikasi, harus manual di Firestore). Wajib ketik ulang nomor SPK + alasan + password. Unit terkait otomatis kembali jadi Ready.",
      "No. Rangka & No. Mesin sekarang otomatis dibersihkan dari spasi saat diketik (\"MD17M 5027277\" dan \"MD17M5027277\" dianggap SAMA) — mencegah duplikat lolos gara-gara beda spasi. No. Mesin sekarang juga punya proteksi keunikan sendiri (sebelumnya cuma No. Rangka).",
      "Auto-logout dinaikkan dari 5 ke 10 menit, ditambah peringatan 1 menit sebelum benar-benar keluar.",
      "\"Batalkan SPK\" sekarang pakai mekanisme atomik untuk melepas unit (konsisten dengan fitur lain), bukan cara lama yang rawan race condition.",
      "Koreksi pembayaran ke-2 dst (hapus/ubah lewat Ubah atau Detail) sekarang mencetak dokumen resmi \"Koreksi Pembayaran\" — sebelumnya cuma tercatat di Log Aktivitas tanpa bukti cetak, beda dari koreksi DP yang sudah punya Kuitansi Revisi.",
    ],
  },
  {
    versi: "3.7.3", tanggal: "Agustus 2026",
    judul: "PERBAIKAN BUG SERIUS: Aplikasi Gagal Total Dimuat (lagi)",
    butir: [
      "PERBAIKAN BUG PENTING: perubahan v3.7.2 (kolom No. Rangka/Mesin) menaruh kode \"await\" di dalam fungsi yang bukan async — menyebabkan SELURUH APLIKASI gagal dimuat total (\"Uncaught SyntaxError: Unexpected reserved word\"), sama seperti kejadian di v3.6.2. Sudah diperbaiki.",
      "Ditemukan juga: cara pengecekan kode sebelumnya (node --check biasa) TERNYATA tidak selalu bisa menangkap jenis kesalahan ini — mulai versi ini, setiap file dicek ulang dengan cara yang lebih ketat (dipaksa mode modul murni) sebelum dipaketkan, supaya kejadian seperti ini tidak lolos lagi ke depannya.",
    ],
  },
  {
    versi: "3.7.2", tanggal: "Agustus 2026",
    judul: "Area Konten Diperlebar, Kolom No. Rangka/Mesin di Riwayat SPK",
    butir: [
      "Area konten diperlebar dari 860px jadi 1200px — di layar laptop/PC lebar, batas sempit sebelumnya bikin banyak ruang terbuang di kanan & scrollbar menggantung di tengah layar, bukan di ujung jendela. Form (SPK Baru/Ubah) tetap dibatasi 640px supaya tetap nyaman dibaca, cuma tabel/daftar yang memanfaatkan lebar baru ini.",
      "Tabel Riwayat & Laporan SPK sekarang menampilkan kolom No. Rangka dan No. Mesin langsung di daftar utama — sebelumnya cuma kelihatan lewat panel Detail, sekarang bisa dilihat sekilas tanpa perlu klik.",
    ],
  },
  {
    versi: "3.7.1", tanggal: "Agustus 2026",
    judul: "Database Konsumen ↔ SPK Sekarang Dua Arah (Owner)",
    butir: [
      "Owner mengoreksi data konsumen langsung di Database Konsumen sekarang bisa sekalian menyebarkannya ke SPK-SPK terkait — muncul konfirmasi \"ikut perbarui berapa SPK?\" sebelum diterapkan. Cuma SPK yang kuitansinya BELUM tercetak yang ikut berubah; yang sudah tercetak tetap dilindungi (dokumen resmi, harus dikoreksi lewat Ubah di SPK itu sendiri kalau perlu).",
      "Arah sebaliknya (edit di SPK ikut ke Database Konsumen) sudah ada sejak v3.6.7 — sekarang dua arahnya lengkap.",
      "Fitur ini Owner-only, mengikuti aturan Firestore yang memang cuma Owner boleh menulis data pembeli/pemakai ke banyak SPK sekaligus.",
    ],
  },
  {
    versi: "3.7.0", tanggal: "Agustus 2026",
    judul: "Riwayat Perubahan Langsung di Panel Detail SPK & Konsumen",
    butir: [
      "Panel Detail Riwayat SPK dan Detail Konsumen (Owner) sekarang menampilkan \"Riwayat Perubahan\" — daftar aksi/perubahan yang tercatat khusus untuk record itu saja (siapa, kapan, apa yang dilakukan), diambil dari Log Aktivitas. Tidak perlu lagi buka halaman Log Aktivitas terpisah dan cari manual.",
      "Tidak jadi dibuat: panel login \"Dewa\"/reset total sebagai peran terpisah — untuk reset data sebelum pemakaian sungguhan, disarankan pakai fitur \"Delete collection\" bawaan Firebase Console (lebih aman, di luar aplikasi, tidak menambah risiko permanen ke sistem).",
    ],
  },
  {
    versi: "3.6.9", tanggal: "Agustus 2026",
    judul: "Perbaikan: DP Tidak Bisa Lagi Dihapus Langsung dari Panel Detail",
    butir: [
      "PERBAIKAN INKONSISTENSI: sebelumnya tombol \"Hapus\" di panel Detail Riwayat SPK muncul di SEMUA baris riwayat pembayaran, termasuk pembayaran PERTAMA (DP) — kalau dihapus dari situ, tidak lewat alur Revisi Kuitansi resmi (tidak cetak dokumen REV), beda perlakuan dari kalau dikoreksi lewat \"Ubah\". Sekarang baris DP di panel Detail tidak lagi punya tombol Hapus — koreksi DP cuma bisa lewat \"Ubah\" (field Jumlah Dibayar Sekarang), supaya selalu konsisten lewat alur Revisi Kuitansi.",
      "Pembayaran ke-2 dst tetap bisa dikoreksi/dihapus lewat DUA jalur (Ubah maupun Detail) — keduanya melakukan hal yang sama, silakan pakai yang lebih nyaman.",
    ],
  },
  {
    versi: "3.6.8", tanggal: "Agustus 2026",
    judul: "Label \"Total dibayar s/d ini\" Diperjelas",
    butir: [
      "Panel Detail Riwayat SPK — label \"Total dibayar s/d ini\" (singkatan yang kurang jelas) diganti jadi \"Total Sudah Dibayar (semua pembayaran dijumlahkan)\", supaya langsung jelas maksudnya: jumlah SELURUH pembayaran yang tercatat untuk SPK itu, bukan cuma pembayaran terakhir.",
    ],
  },
  {
    versi: "3.6.7", tanggal: "Agustus 2026",
    judul: "Perbaikan: Koreksi Nama Pembeli di Ubah SPK Sekarang Ikut ke Database Konsumen",
    butir: [
      "PERBAIKAN BUG: mengoreksi data Pembeli/Pemakai lewat form Ubah (Owner) sebelumnya cuma tersimpan di dalam SPK-nya sendiri — tidak pernah ikut memperbarui catatan konsumen terpisah yang dipakai halaman Database Konsumen, jadi dua tempat itu bisa tampil beda data (mis. nama sudah benar di Riwayat SPK, tapi masih salah di Database Konsumen). Sudah disambungkan sekarang.",
      "Alur Persetujuan Perubahan (Admin/Sales mengajukan, Owner menyetujui) sudah benar dari awal, tidak kena masalah ini — cuma jalur Owner mengedit langsung yang perlu diperbaiki.",
    ],
  },
  {
    versi: "3.6.6", tanggal: "Agustus 2026",
    judul: "Pengecekan Bug Menyeluruh: 2 Bug Ketemu & Diperbaiki",
    butir: [
      "PERBAIKAN BUG: laporan.js memakai fungsi kabar() di banyak tempat (fitur Hapus Entri & Tandai Cashback Sudah Dibayar) tapi lupa mengimpornya — akan error \"kabar is not defined\" begitu kedua fitur itu dipakai. Sudah diperbaiki.",
      "PERBAIKAN BUG: spk.js memakai fungsi sudahLunas() di alur koreksi riwayat pembayaran untuk SPK format lama, tapi lupa mengimpornya. Sudah diperbaiki.",
      "Dilakukan pengecekan menyeluruh ke semua 30 file — sintaks, keseimbangan kurung, fungsi yang dipakai tapi tidak diimpor, fungsi yang didefinisikan tapi tidak pernah dipanggil, ID elemen HTML yang tidak cocok, dan nama field Firestore yang tidak konsisten. Semua bersih setelah dua perbaikan di atas.",
    ],
  },
  {
    versi: "3.6.5", tanggal: "Agustus 2026",
    judul: "Form Ubah: Field Tunai/Transfer Terpisah, Sama Seperti SPK Baru",
    butir: [
      "Tab Payment Info di form Ubah (Owner) sekarang punya field terpisah \"Jumlah tunai\" dan \"Jumlah transfer\" begitu Cara Bayar Tunai+Transfer sekaligus dicentang — sebelumnya cuma ada satu kotak gabungan, beda dari SPK Baru yang sudah lebih dulu punya field terpisah ini.",
      "Isi Tunai, Transfer otomatis terisi sisanya menuju Harga Efektif — perilaku sama persis seperti SPK Baru (v3.6.4). \"Jumlah Dibayar Sekarang\" gabungan otomatis terkunci & tersinkron selama mode ini aktif, tidak perlu diisi manual dobel.",
    ],
  },
  {
    versi: "3.6.4", tanggal: "Agustus 2026",
    judul: "Tunai+Transfer: Transfer Otomatis Terisi Sisanya",
    butir: [
      "SPK Baru, mode Cara Bayar Tunai+Transfer sekaligus: begitu isi kotak Tunai, kotak Transfer sekarang OTOMATIS terisi sisanya menuju Harga Efektif (OTR − Diskon) — contoh OTR 20jt, isi Tunai 5jt, Transfer otomatis terisi 15jt. Tetap bisa diedit manual kalau ternyata bukan pelunasan penuh (mis. cuma DP gabungan dua metode) — kalau totalnya belum mencapai Harga Efektif, sistem tetap otomatis anggap itu DP, bukan Lunas.",
    ],
  },
  {
    versi: "3.6.3", tanggal: "Agustus 2026",
    judul: "Label \"Jumlah Dibayar Sekarang\" di Form Ubah Diperjelas",
    butir: [
      "Field \"Jumlah Dibayar Sekarang (DP)\" di form Ubah (Owner) — kata \"(DP)\" di labelnya dihapus, karena field ini bisa jadi DP ATAU pelunasan penuh tergantung angkanya, bukan selalu DP. Sistem yang menentukan otomatis, bukan labelnya. Form SPK Baru sudah benar dari awal (\"Jumlah dibayar sekarang\" tanpa embel-embel), cuma form Ubah yang perlu disamakan.",
    ],
  },
  {
    versi: "3.6.2", tanggal: "Agustus 2026",
    judul: "PERBAIKAN BUG SERIUS: Aplikasi Gagal Total Dimuat",
    butir: [
      "PERBAIKAN BUG PENTING: perubahan v3.6.1 (Alat Migrasi Kuitansi) sempat menghapus baris deklarasi fungsi halaman Tentang Aplikasi secara tidak sengaja — menyebabkan SELURUH APLIKASI gagal dimuat sama sekali (\"Uncaught SyntaxError: Illegal return statement\"), bukan cuma halaman Tentang Aplikasi. Sudah diperbaiki.",
      "Mohon maaf atas gangguan ini — untuk sesi berikutnya, setiap penyisipan kode akan dicek ulang keseimbangan tanda kurungnya sebelum dipaketkan, bukan cuma dites sintaksnya saja.",
    ],
  },
  {
    versi: "3.6.1", tanggal: "Agustus 2026",
    judul: "Alat Migrasi Nomor Kuitansi Lama ke Format Baru",
    butir: [
      "Menu Tentang Aplikasi (Owner) sekarang punya tombol \"Jalankan Migrasi\" — sekali klik, semua nomor kuitansi lama (format global KWT/2026/NNNN) diubah ke format baru yang ikut nomor SPK (KWT/2026/NNNN-N). Aman dijalankan berkali-kali, yang sudah format baru otomatis dilewati.",
      "Ikut memindahkan data QR verifikasi publik (kuitansi_publik) ke kode baru, dan menyesuaikan penghitung per-SPK supaya kuitansi berikutnya lanjut dari nomor yang benar.",
      "PENTING: cuma dipakai kalau kuitansi lama masih di tangan showroom (belum ada yang diserahkan ke konsumen) — kalau sudah beredar, nomor di kertas fisik akan tidak cocok lagi dengan sistem setelah migrasi.",
    ],
  },
  {
    versi: "3.6.0", tanggal: "Agustus 2026",
    judul: "Nomor Kuitansi Sekarang Ikut Nomor SPK",
    butir: [
      "Nomor kuitansi diubah dari urutan global (KWT/2026/0001, 0002, 0003... lintas semua SPK) jadi mengikuti nomor SPK-nya masing-masing: KWT/2026/0002-1, KWT/2026/0002-2, dst — jadi langsung kelihatan dari nomornya itu kuitansi ke berapa untuk SPK yang mana, tidak perlu buka datanya dulu.",
      "Tetap atomik (aman dari dua kuitansi kebagian nomor sama walau dicetak dari dua perangkat hampir bersamaan) — counter-nya sekarang per-SPK, bukan satu counter global.",
      "Kuitansi lama (format KWT/2026/NNNN) TIDAK ikut berubah nomornya — cuma kuitansi BARU yang pakai format ini.",
    ],
  },
  {
    versi: "3.5.3", tanggal: "Agustus 2026",
    judul: "Perbaikan Bug: Gagal Simpan Kalau Hapus Lebih dari 1 Entri Sekaligus",
    butir: [
      "PERBAIKAN BUG: di form Ubah bagian \"Riwayat Pembayaran Lainnya\", menghapus/mengubah LEBIH DARI SATU entri sekaligus dalam satu kali Simpan Perubahan menyebabkan error \"Cannot read properties of null (reading 'kuitansiNo')\" dan gagal tersimpan. Sudah diperbaiki — sekarang aman menghapus/mengubah beberapa entri sekaligus dalam satu kali simpan.",
    ],
  },
  {
    versi: "3.5.2", tanggal: "Agustus 2026",
    judul: "Perbaikan: Koreksi DP di Form Ubah Sekarang Pakai Harga Efektif",
    butir: [
      "PERBAIKAN BUG: saat Owner mengoreksi DP/riwayat pembayaran lewat form Ubah, status Lunas/Belum sempat dihitung pakai Harga OTR mentah (bukan Harga Efektif setelah Diskon) — jadi kalau SPK punya Diskon, koreksi bisa salah menyimpulkan status Lunasnya. Sekarang konsisten pakai Harga Efektif seperti di semua tempat lain.",
      "Kalau koreksi ini bikin SPK jadi Lunas, unit fisiknya (kalau ada) sekarang otomatis ditandai Terjual juga — sebelumnya cuma alur \"Terima Pembayaran\" biasa yang melakukan ini, form Ubah belum.",
    ],
  },
  {
    versi: "3.5.1", tanggal: "Agustus 2026",
    judul: "Perbaikan Bug: \"tanggal is not defined\" di Form Ubah",
    butir: [
      "PERBAIKAN BUG: bagian \"Riwayat Pembayaran Lainnya\" yang baru ditambahkan di v3.5.0 lupa mengimpor fungsi tanggal() — menyebabkan error \"tanggal is not defined\" muncul di beberapa halaman (Riwayat & Laporan SPK) begitu ada SPK yang riwayat pembayarannya dimuat. Sudah diperbaiki.",
    ],
  },
  {
    versi: "3.5.0", tanggal: "Agustus 2026",
    judul: "Form Ubah: Sekarang Bisa Hapus/Koreksi Riwayat Pembayaran Langsung",
    butir: [
      "Tab Payment Info di form Ubah (Owner) sekarang punya bagian \"Riwayat Pembayaran Lainnya\" — daftar semua pembayaran SELAIN DP, masing-masing bisa diubah jumlahnya atau dicentang \"Hapus\". Sebelumnya cuma bisa lewat panel Detail terpisah di Riwayat SPK — sekarang bisa langsung di form Ubah yang sama tempat mengoreksi DP.",
      "Sama seperti koreksi lainnya: wajib alasan tertulis + konfirmasi password, tercatat di Log Aktivitas, dan TIDAK menarik kembali kuitansi kertas yang sudah di tangan konsumen — cuma mengoreksi catatan di sistem. Total & status Lunas dihitung ulang otomatis.",
      "Tombol \"Hapus\" di panel Detail Riwayat SPK (v3.4.4) tetap ada — dua jalan menuju fitur yang sama, pilih mana yang lebih nyaman.",
    ],
  },
  {
    versi: "3.4.5", tanggal: "Agustus 2026",
    judul: "Terima Pembayaran: Angka Otomatis Terisi, Wajib Alasan Kalau Diubah",
    butir: [
      "\"Terima Pembayaran\" sekarang otomatis mengisi field jumlahnya dengan Sisa Tagihan yang sebenarnya (bukan kotak kosong lagi) — supaya jalur paling gampang (klik OK saja) adalah jalur yang BENAR (pelunasan penuh). Showroom cuma pernah menerima DP dan Pelunasan, tidak ada pembayaran bertahap lain.",
      "Kalau angkanya SENGAJA diubah jadi bukan pelunasan penuh (kurang atau lebih dari sisa tagihan), sistem sekarang WAJIB minta alasan tertulis dulu — tercatat di Log Aktivitas lengkap dengan angka yang seharusnya vs yang benar-benar dicatat. Ini menutup celah yang menyebabkan angka \"asal ketik\" tanpa jejak kenapa itu diketik.",
    ],
  },
  {
    versi: "3.4.4", tanggal: "Agustus 2026",
    judul: "Owner Bisa Hapus Entri Pembayaran yang Salah/Tidak Sesuai",
    butir: [
      "Panel Detail Riwayat SPK sekarang punya tombol \"Hapus\" di tiap baris Riwayat Pembayaran (khusus Owner) — untuk mengoreksi pembayaran yang salah tercatat (salah ketik, tercatat dua kali, dsb). Wajib isi alasan + konfirmasi password. Total & status Lunas otomatis dihitung ulang tanpa entri yang dihapus.",
      "Fitur ini TIDAK menarik kembali kuitansi kertas yang sudah dicetak/di tangan konsumen — cuma mengoreksi catatan di sistem. Semua penghapusan tercatat di Log Aktivitas lengkap dengan alasannya.",
    ],
  },
  {
    versi: "3.4.3", tanggal: "Agustus 2026",
    judul: "Cashback Sekarang Ditampilkan di Dokumen SPK",
    butir: [
      "Dokumen SPK cetak sekarang menampilkan baris \"Cashback\" (di bawah Diskon) kalau ada isian yang sudah disetujui — sama seperti Diskon, cuma muncul kalau nilainya lebih dari 0. Harga OTR tetap tampil apa adanya, tidak dikurangi Cashback.",
    ],
  },
  {
    versi: "3.4.2", tanggal: "Agustus 2026",
    judul: "Istilah \"Cicilan\" Dihapus dari Kuitansi Showroom",
    butir: [
      "Kata \"Cicilan\" tidak lagi dipakai di kuitansi/label pembayaran manapun — istilah itu cuma berlaku untuk hubungan konsumen-ke-LEASING, bukan konsumen/leasing-ke-showroom. Showroom cuma pernah terima dua jenis uang: DP (dari konsumen, Cash maupun Kredit) dan Pelunasan (satu kali cair — langsung dari konsumen kalau Cash, atau dari Leasing kalau Kredit).",
      "Pembayaran belum-lunas selain DP sekarang berlabel \"Pembayaran Leasing\" (untuk SPK Kredit) atau \"Pembayaran Tambahan\" (untuk SPK Cash) — bukan \"Cicilan\" lagi.",
      "\"Cicilan per bulan\" di form Kredit & Detail SPK TETAP dipakai — itu istilah yang benar, karena memang keterangan rencana cicilan konsumen ke leasing, bukan ke showroom.",
    ],
  },
  {
    versi: "3.4.1", tanggal: "Agustus 2026",
    judul: "Perbaikan: Label Kuitansi Bisa Tidak Sinkron dengan Status Lunas",
    butir: [
      "PERBAIKAN BUG: kalau Diskon SPK diubah SETELAH ada pembayaran tercatat, kuitansi lama yang dicetak ulang bisa menampilkan label \"KETERANGAN: Cicilan\" di atas tapi \"LUNAS\" di bawah — dua-duanya tidak sinkron. Penyebabnya label diambil dari teks yang dibekukan saat pembayaran dicatat, sementara status Lunas dihitung ulang pakai Diskon terbaru.",
      "Sekarang label (DP/Cicilan/Pelunasan/Lunas) DIHITUNG ULANG tiap kali kuitansi dicetak/dicetak-ulang, konsisten dengan status Lunas yang sebenarnya saat itu — bukan lagi trust teks lama yang bisa basi.",
    ],
  },
  {
    versi: "3.4.0", tanggal: "Agustus 2026",
    judul: "PERBAIKAN BESAR: Diskon & Cashback Sekarang Benar-Benar Berfungsi",
    butir: [
      "\"Harga Efektif\" (OTR − Diskon yang sah) sekarang dipakai di SEMUA perhitungan uang — status Lunas/Belum, Sisa Tagihan (kuitansi & SPK), Tagihan ke Leasing, dan Total Nilai di Dashboard/Laporan. Sebelumnya Diskon cuma tampil sebagai baris tercetak di dokumen, tidak pernah benar-benar mengurangi apa pun — sekarang benar-benar mengurangi.",
      "PENTING: angka \"Total Nilai\" di Dashboard & Laporan akan TURUN dibanding sebelumnya kalau ada SPK yang pakai Diskon — ini BUKAN bug baru, ini koreksi ke angka yang seharusnya (bersih setelah diskon, bukan OTR mentah).",
      "PERBAIKAN BUG PENTING: form Ubah (Owner) sebelumnya membaca/menulis field \"cashback\" yang SALAH NAMA — beda total dari field \"cashbackDiajukan\"/\"cashbackDisetujui\" yang dipakai alur SPK Baru & Persetujuan. Akibatnya cashback yang disetujui Owner lewat Persetujuan tidak pernah muncul di form Ubah, dan sebaliknya. Sekarang disatukan pakai cashbackDisetujui di semua tempat.",
      "Cashback sekarang punya status pembayaran (Sudah Dibayar / Belum, tanggal, via bank, catatan) — sama seperti pola Fee Agen — bisa ditandai Owner maupun Admin lewat tombol \"Tandai Sudah Dibayar\" di panel Detail Riwayat SPK.",
      "Export Excel: kolom baru \"Diskon\" dan \"Harga Efektif\" ditambahkan supaya rinciannya transparan.",
      "Firestore Rules: Admin diberi izin tambahan menulis field pembayaran Cashback (cashbackDibayarStatus, dst) — Sales tetap tidak bisa.",
    ],
  },
  {
    versi: "3.3.2", tanggal: "Agustus 2026",
    judul: "Menu \"Ubah Nama Menu\" Dihapus",
    butir: [
      "Menu Sistem → \"Ubah Nama Menu\" dihapus dari sidebar dan rutenya ditutup — fitur ganti nama tampilan menu ini berisiko bikin bingung (Owner bisa lupa sudah mengganti nama menu, jadi tidak cocok lagi dengan panduan/instruksi). Nama-nama menu sekarang tetap baku, tidak bisa diubah lewat aplikasi.",
    ],
  },
  {
    versi: "3.3.1", tanggal: "Agustus 2026",
    judul: "Tema Kemerdekaan Diperbesar — Isi Penuh Panel Login",
    butir: [
      "Tema Kemerdekaan di layar Masuk diperbesar — sebelumnya cuma pita tipis di atas, sekarang mengisi seluruh panel kanan: pita judul lebih besar & tebal, garis diagonal merah-putih sangat halus di seluruh latar, dan watermark besar \"MERDEKA\" di tengah panel. Tetap redup supaya form login tidak terganggu keterbacaannya.",
    ],
  },
  {
    versi: "3.3.0", tanggal: "Agustus 2026",
    judul: "Auto-Logout, Dashboard Peringkat Sales Dirombak, Tema Kemerdekaan",
    butir: [
      "Auto-logout setelah 5 menit tanpa aktivitas (klik/ketik/scroll/sentuh) — mencegah HP yang lupa di-logout jadi celah kalau ditinggal atau berpindah tangan.",
      "Dashboard: \"Sales Penjualan Terbanyak\" dirombak dari kartu besar berwarna jadi list ranking kompak (medali untuk 3 besar, bar progres, nomor urut) — sekarang bisa tampilkan sampai 8 sales sekaligus tanpa jadi berantakan, sebelumnya cuma muat 3 kartu besar berdampingan.",
      "Dialog \"Keluar dari sistem\" — tombolnya diganti dari merah (bahaya) jadi biru khas aplikasi, karena keluar bukan aksi destruktif seperti hapus data. Semua kotak dialog sekarang juga menampilkan logo kecil di kop-nya untuk identitas visual yang konsisten.",
      "Tema Kemerdekaan — otomatis aktif sepanjang bulan Agustus di layar Masuk: bunting bendera merah-putih bergoyang halus + pita \"Dirgahayu Republik Indonesia\" di panel login. Otomatis nonaktif sendiri begitu masuk September, tidak perlu diatur manual tiap tahun.",
    ],
  },
  {
    versi: "3.2.6", tanggal: "Agustus 2026",
    judul: "Form Ubah: Pilih Unit Sekarang Persis Seperti SPK Baru",
    butir: [
      "Bagian \"Unit & Harga\" di form Ubah (Owner) dirombak supaya alurnya BENAR-BENAR sama seperti SPK Baru: pilih Tipe motor → tabel unit ready langsung muncul di bawahnya, tinggal centang salah satu. Sebelumnya ada dua mekanisme terpisah yang membingungkan (kotak Warna manual di atas, dan tabel \"ganti unit fisik tertentu\" terpisah jauh di bawah) — sekarang jadi satu alur saja.",
      "Kalau stok kosong untuk tipe yang dipilih, otomatis muncul dropdown Warna manual (persis seperti SPK Baru) — SPK jadi Indent.",
      "\"Tampilkan semua tipe\" tetap ada untuk cari unit di tipe lain, dan \"Lepas unit ini\" tetap terpisah sebagai aksi sendiri.",
    ],
  },
  {
    versi: "3.2.5", tanggal: "Agustus 2026",
    judul: "PERBAIKAN BUG SERIUS: Tata Letak Form Ubah/Detail Berantakan di Dalam Tabel",
    butir: [
      "AKHIRNYA KETEMU: form \"Ubah\" dan panel \"Detail\" di Riwayat SPK terlihat berantakan/field hilang — padahal field-nya SELALU ada di HTML (bukan bug JavaScript sama sekali). Penyebabnya CSS: aturan \".tabel td { white-space: nowrap }\" DIWARISKAN turun ke semua elemen anak, dan form Ubah/panel Detail ditaruh di dalam sel tabel (<td colspan>) — jadi semua teks label/paragraf di dalamnya ikut dipaksa \"jangan pernah pindah baris\", bikin tata letak tumpang tindih dan terpotong-potong parah di layar sempit.",
      "Diperbaiki dengan memutus pewarisan white-space di dalam .form, .lembar, dan .d-panel — supaya form/detail yang bersarang di dalam tabel tetap tersusun rapi, sementara tabel-tabel kecil YANG MEMANG perlu nowrap (misal tabel pilih unit) tetap tidak terganggu.",
      "Butuh berhari-hari sesi debugging cache/deploy sebelum akhirnya ketemu ini BUKAN soal cache sama sekali — semua perbaikan cache-busting (?v= di setiap file, .nojekyll) sebelumnya tetap penting dan valid, tapi bug SEBENARNYA ada di CSS ini, baru kelihatan setelah app.js/spk.js dipastikan benar-benar termuat versi terbaru.",
    ],
  },
  {
    versi: "3.2.4", tanggal: "Agustus 2026",
    judul: "Cache-Busting di SEMUA File — Perbaikan Deploy yang Tidak Konsisten",
    butir: [
      "PERBAIKAN PENTING: sebelumnya cuma app.js (file utama) yang punya penanda versi (?v=) di index.html — 141 file JS LAIN yang saling import satu sama lain (spk.js, cetak.js, laporan.js, dst) TIDAK punya penanda versi sama sekali. Ini menyebabkan sebagian file bisa \"nyangkut\" di versi lama di sisi browser/CDN/hosting walau sudah di-upload versi barunya, sementara file lain sudah ter-update — gejalanya: sebagian fitur baru muncul, sebagian tidak, padahal semuanya ada di rilis yang sama.",
      "Sekarang SEMUA 142 baris import lintas-file di seluruh aplikasi (30 file) diberi penanda ?v=3.2.4 yang seragam. Setiap kali versi dinaikkan, SEMUA file otomatis dianggap \"baru\" oleh browser/CDN — tidak ada lagi kemungkinan sebagian file ke-cache sementara yang lain tidak.",
    ],
  },
  {
    versi: "3.2.3", tanggal: "Agustus 2026",
    judul: "Proteksi Pembayaran Dobel/Salah Input di \"Terima Pembayaran\"",
    butir: [
      "PERBAIKAN BUG PENTING: alur \"Terima Pembayaran\" untuk cicilan/pelunasan (bukan pembayaran pertama) TIDAK PUNYA langkah konfirmasi sama sekali sebelumnya — ketik jumlah lalu OK langsung tercatat & tercetak. Sekarang ditambahkan langkah tinjau ulang wajib (SPK, pembeli, jumlah, sisa tagihan setelahnya) sebelum benar-benar diproses.",
      "Deteksi otomatis kalau jumlah yang diketik PERSIS SAMA dengan pembayaran TERAKHIR yang tercatat untuk SPK itu — muncul peringatan tegas \"⚠️ Jumlah Sama Seperti Pembayaran Terakhir\" dan wajib konfirmasi eksplisit \"Ya, Ini Memang Benar\", bukan cuma OK biasa. Ini menutup celah yang menyebabkan kasus pembayaran tercatat dua kali dengan angka sama tanpa ada yang sempat sadar.",
      "Kunci anti-klik-ganda ditambahkan — kalau tombol \"Terima Pembayaran\" diklik dua kali cepat (jaringan lambat, dsb) untuk SPK yang sama, permintaan kedua ditolak halus sampai yang pertama selesai diproses.",
    ],
  },
  {
    versi: "3.2.2", tanggal: "Agustus 2026",
    judul: "Minimal Uang Muka (DP) Dinaikkan Jadi Rp1.000.000",
    butir: [
      "Batas minimal DP untuk SPK Baru dinaikkan dari \"asal lebih dari Rp0\" jadi WAJIB minimal Rp1.000.000 — angka ini diatur di satu tempat (config.js → DP_MINIMUM), gampang diubah lagi kalau kebijakannya berubah tanpa perlu cari-cari di kode.",
      "Peringatan merah di dokumen SPK cetak ikut disesuaikan — sekarang muncul untuk SPK (data lama) dengan DP di bawah Rp1.000.000, bukan cuma yang persis Rp0.",
    ],
  },
  {
    versi: "3.2.1", tanggal: "Agustus 2026",
    judul: "SPK Wajib Ada Uang Muka Sebelum Bisa Disimpan",
    butir: [
      "SPK Baru sekarang WAJIB diisi \"Jumlah dibayar sekarang\" lebih dari Rp0 sebelum bisa disimpan — sebelumnya sistem membiarkan SPK tersimpan & tercetak dengan DP Rp0, padahal Syarat No. 4 di dokumen SPK sendiri mensyaratkan uang muka sudah dibayar sebelum SPK dianggap sah.",
      "Dokumen SPK: kotak peringatan merah tegas otomatis muncul di bagian atas cetakan kalau SPK-nya (khusus data LAMA yang kadung tersimpan sebelum validasi ini ada) ternyata belum ada pembayaran sama sekali — supaya tidak disalahartikan sebagai SPK yang sudah sah oleh siapa pun yang memegang kertasnya.",
    ],
  },
  {
    versi: "3.2.0", tanggal: "Agustus 2026",
    judul: "Form Ubah SPK (Owner) Dirombak Jadi 3 Tab, Setara Otoritas Input Awal",
    butir: [
      "Form \"Ubah\" khusus Owner sekarang dibagi 3 tab persis seperti SPK Baru — Customer Info, Internal Info, Payment Info — supaya tidak lagi satu halaman panjang tak berujung.",
      "Field baru \"Jumlah Dibayar Sekarang (DP)\" akhirnya ada di form Ubah (sebelumnya tidak ada field ini sama sekali, jadi Owner tidak bisa memperbaiki salah input DP). Kalau kuitansi belum pernah dicetak, bebas diedit langsung. Kalau kuitansi SUDAH dicetak, mengubah angka ini otomatis memicu alur revisi: wajib isi alasan, konfirmasi password, sistem mencatat riwayat revisi (jumlah lama → baru, siapa, kapan, kenapa) TANPA menimpa kuitansi asli, dan otomatis mencetak dokumen \"Kuitansi Revisi\" terpisah bernomor sama + kode -REV1/-REV2/dst.",
      "Tab Internal Info (baru): Owner sekarang bisa memindahkan SPK ke sales lain (\"Atas nama karyawan\"), serta mengubah Agen & Fee Agen — sebelumnya field-field ini tidak bisa diubah lewat form Ubah sama sekali.",
    ],
  },
  {
    versi: "3.1.0", tanggal: "Agustus 2026",
    judul: "Owner Bisa Kelola Unit Sepenuhnya, Keamanan Diperketat, Laporan Diperluas",
    butir: [
      "Form \"Ubah\" (Owner) sekarang bisa mengubah SEMUA data SPK — bukan cuma pembeli/pemakai — termasuk Tipe/Warna/Unit, Harga OTR, Cara Bayar, Kredit/Leasing, Diskon, Cashback, dan Catatan internal. Perubahan yang berdampak ke keuangan/stok wajib konfirmasi password dulu; perubahan data pembeli/pemakai/catatan saja tetap langsung tersimpan seperti biasa.",
      "3 pilihan baru khusus urusan unit di form Ubah: (1) Ganti ke unit fisik lain lewat TABEL pilih (No. Rangka/Tipe/Warna/Tahun), default cuma tampilkan tipe/warna yang sama, ada opsi \"tampilkan semua tipe\"; (2) Lepas unit ini kembali ke stok TANPA membatalkan SPK (SPK jadi Indent, pembeli/pembayaran tetap tersimpan); (3) Batalkan SPK sepenuhnya (sudah ada sebelumnya). Semua dialog konfirmasinya sekarang menyebutkan nama pembeli, nama karyawan yang input, tipe/warna unit, dan konsekuensinya secara eksplisit.",
      "PERBAIKAN KEAMANAN: penguncian unit ke SPK sekarang pakai transaksi atomik (runTransaction) — sebelumnya ada celah race condition yang memungkinkan dua sales mengunci unit fisik yang sama persis kalau mengklik simpan di waktu yang hampir bersamaan.",
      "PERBAIKAN KEAMANAN: Firestore Rules diperketat di tiga koleksi — transaksi (cuma Owner boleh input SPK atas nama karyawan lain; Admin/Sales dibatasi field yang boleh ditulis saat catat pembayaran), units, dan tipe_motor (Sales dibatasi cuma boleh sentuh field yang memang perlu buat kunci/lepas unit, bukan field data master seperti No. Rangka/harga). Sebelumnya batasan ini cuma ada di tampilan, bisa dilewati lewat DevTools/API langsung.",
      "Riwayat & Laporan SPK: filter baru (Cara Bayar, Status Bayar, Leasing, Sales, Nama Konsumen) yang bisa disembunyikan/dibuka; tombol Unduh Excel & Unduh PDF mengikuti hasil filter; tombol \"Cetak Semua Tagihan Leasing\" kalau filter Cara Bayar = Kredit sedang aktif.",
      "Dokumen baru \"Cetak Tagihan Leasing\" — ditagihkan ke pihak leasing (bukan konsumen), berisi rincian OTR − DP diterima showroom = sisa yang ditagihkan, data unit, dan kolom tanda tangan Salesman/SPV/Leasing.",
      "Tombol-tombol cetak di Riwayat SPK (Cetak SPK/Tagihan Leasing/Cetak Ulang) digabung jadi satu dropdown \"Cetak ▾\" per baris — tombol \"Terima Pembayaran\" dipisah karena itu mencatat data, bukan cetak murni.",
      "Peringatan otomatis di Riwayat SPK kalau data yang tampil kena batas 500 baris (kemungkinan terpotong) — dengan tombol \"Ambil Semua\" buat menaikkan batas ke 10.000 kalau memang perlu.",
      "Admin sekarang ikut melihat badge \"sales: [nama]\" di Riwayat SPK (sebelumnya cuma Owner) — supaya Admin bisa memantau SPK ditangani sales mana. Tombol \"Detail\" (No. Rangka/Mesin, status kredit, riwayat pembayaran) tetap khusus Owner.",
      "Badge Cash/Kredit langsung terlihat di tabel Riwayat SPK dan Database Konsumen, tanpa perlu buka Detail dulu.",
      "Database Konsumen dirombak jadi tampilan tabel (Nama/No. HP/Peran), dengan tombol Detail yang menampilkan ringkasan tiap pesanan (unit & cara bayar) plus riwayat lengkap seperti sebelumnya.",
      "Kuitansi & SPK: mode cetak disesuaikan buat printer dot matrix — warna dipaksa hitam pekat di atas putih (bukan abu-abu/keemasan yang tidak terbaca di ribbon hitam-putih), font dibesarkan, watermark tetap ada (tetap teks vektor ringan).",
      "Teks petunjuk \"Jumlah dibayar sekarang\" di form SPK Kredit diperjelas — DP diterima showroom, bukan ditransfer ke leasing. Field baru \"Tagihan ke Leasing\" (OTR − DP) otomatis terhitung live di form.",
    ],
  },
  {
    versi: "3.0.4", tanggal: "Agustus 2026",
    judul: "Perbaikan Bug: \"Dibayar Sekarang\" Rp 0 Padahal Tunai+Transfer Terisi",
    butir: [
      "PERBAIKAN BUG PENTING: waktu SPK dibuat dengan cara bayar Tunai + Transfer SEKALIGUS, field \"Dibayar sekarang\" (jumlahBayar) tersimpan Rp 0 — padahal jumlah Tunai & Transfer-nya sendiri sudah benar tersimpan. Sekarang jumlahnya otomatis dijumlah dari Tunai + Transfer.",
      "Dampak bug ini: SPK yang dibuat SEBELUM perbaikan ini dengan cara bayar Tunai+Transfer kemungkinan tersimpan seolah belum ada pembayaran sama sekali (statusBayar salah). Perlu dicek & dikoreksi manual lewat Firestore kalau ada SPK seperti ini.",
    ],
  },
  {
    versi: "3.0.3", tanggal: "Agustus 2026",
    judul: "Perbaikan: Label \"DP\" Jelas di Cetakan SPK Kredit",
    butir: [
      "SPK dengan cara bayar Kredit — baris \"Dibayar sekarang\" diganti jadi \"DP (Uang Muka)\" supaya tidak ambigu (sebelumnya labelnya sama generik dengan cara bayar tunai/transfer, jadi ada yang bingung apakah itu DP atau total kredit).",
      "Baris baru \"Sisa Dibiayai Leasing\" ditambahkan — langsung menunjukkan berapa yang ditanggung leasing (Harga OTR dikurangi DP), tidak perlu dihitung manual.",
    ],
  },
  {
    versi: "3.0.2", tanggal: "Agustus 2026",
    judul: "Tombol \"Cetak Ulang\" Kuitansi (Tanpa Catat Pembayaran Baru)",
    butir: [
      "Tombol baru \"Cetak Ulang\" di Riwayat SPK & Lihat Pesanan — mencetak ulang kuitansi TERAKHIR (mis. DP) yang sudah tercetak, tanpa mencatat pembayaran baru. Dulu satu-satunya cara buka lagi kuitansi lama (untuk SPK yang belum lunas) adalah \"Catat Pembayaran\", yang malah selalu meminta jumlah pembayaran baru.",
    ],
  },
  {
    versi: "3.0.1", tanggal: "Agustus 2026",
    judul: "Kuitansi Jadi 1 Lembar (Kertas NCR)",
    butir: [
      "Cetakan kuitansi diubah dari rangkap 3 (satu halaman berisi 3 salinan) jadi CUMA 1 LEMBAR — menyesuaikan pemakaian kertas NCR continuous form (karbon otomatis bawaan kertas, tidak perlu lagi salinan dicetak manual lewat sistem).",
      "Ukuran halaman cetak disesuaikan ke 9½\" x 11\" (ukuran kertas NCR yang dipakai), bukan A4 seperti sebelumnya.",
    ],
  },
  {
    versi: "3.0.0", tanggal: "Agustus 2026",
    judul: "Master Supplier & Dashboard Interaktif",
    butir: [
      "Master Supplier baru (Master Data) — data vendor pemasok unit, dipakai sebagai pilihan \"Supplier\" saat menambah/mengubah Data Unit.",
      "Dashboard sekarang interaktif — klik kartu KPI, batang \"Unit Terjual per Tipe\", titik di grafik tren bulanan, atau kartu peringkat Sales, langsung muncul tabel detail lengkap (No. SPK, Tanggal, Sales, Input Oleh, Pembeli, Unit, Agen, Cara Bayar, Harga OTR, Status).",
    ],
  },
  {
    versi: "2.9.2", tanggal: "Agustus 2026",
    judul: "Koreksi: Owner Bisa Input Atas Nama Karyawan Mana Saja",
    butir: [
      "Dropdown \"Atas nama karyawan\" di form SPK (khusus Owner) sekarang menampilkan SEMUA karyawan aktif (Admin, Sales, dst) — bukan cuma Sales seperti sebelumnya. Tiap nama juga disertai label jabatannya.",
    ],
  },
  {
    versi: "2.9.1", tanggal: "Agustus 2026",
    judul: "Koreksi: Pilih Unit Lewat Tabel, Bukan Cari Rangka",
    butir: [
      "Cara pilih unit di form SPK diubah lagi — sekarang cukup pilih Tipe Motor, tabel unit Ready (No, Rangka, Mesin, Warna, Tahun) langsung muncul di bawahnya. Tinggal centang satu baris (cuma bisa pilih 1), Warna & unitnya otomatis terpilih ke SPK.",
      "Fitur \"Cari No. Rangka\" dari pembaruan sebelumnya dihapus — digantikan tabel ini.",
      "Kalau stok kosong untuk tipe itu, otomatis muncul dropdown Warna manual (buat SPK Indent).",
    ],
  },
  {
    versi: "2.9.0", tanggal: "Agustus 2026",
    judul: "Pilih Unit via Rangka, Owner Input Atas Nama Sales, Owner Bisa Ubah Data Terkunci",
    butir: [
      "Form SPK: bisa langsung cari/pilih No. Rangka duluan — Tipe Motor, Warna, dan Harga OTR otomatis mengikuti (sebelumnya harus pilih Tipe/Warna dulu baru sistem carikan unit).",
      "Owner sekarang bisa membuat SPK atas nama Sales lain (dropdown \"Sales\" di tab Internal) — buat keperluan laporan/komisi. Siapa yang BENAR-BENAR input tetap tercatat terpisah (field dibuatOlehUid/Nama/Peran) dan tampil sebagai catatan kecil di Riwayat SPK untuk Owner/Admin.",
      "Owner sekarang bisa mengubah data Pembeli/Pemakai walau kuitansi sudah dicetak (Admin/Sales tetap terkunci seperti biasa) — langsung tersimpan tanpa perlu proses persetujuan, dan No. Kuitansi tidak berubah sama sekali.",
    ],
  },
  {
    versi: "2.8.1", tanggal: "Agustus 2026",
    judul: "Perbaikan: Kalimat Membingungkan di Cetakan SPK",
    butir: [
      "Kalimat \"sah tanpa tanda tangan basah\" di bagian bawah cetakan SPK dihapus — terlihat kontradiktif karena ditaruh persis di bawah kolom tanda tangan, bisa disalahpahami konsumen jadi mengira SPK tidak perlu ditandatangani.",
    ],
  },
  {
    versi: "2.8.0", tanggal: "Agustus 2026",
    judul: "Pilih Unit Spesifik di SPK",
    butir: [
      "Kalau stok Ready untuk Tipe+Warna yang dipilih lebih dari satu, form SPK sekarang menampilkan daftar unitnya (No. Rangka, No. Mesin, No. DO) — bisa dipilih spesifik yang mana, tidak lagi diambilkan otomatis begitu saja.",
      "Kalau cuma ada satu unit Ready, tetap otomatis terpakai seperti sebelumnya (tidak perlu memilih).",
    ],
  },
  {
    versi: "2.7.1", tanggal: "Agustus 2026",
    judul: "Perbaikan: Riwayat Pengajuan untuk Owner",
    butir: [
      "Halaman \"Pengajuan Saya\" sekarang cerdas soal Owner — karena Owner jarang mengajukan sesuatu ke dirinya sendiri, judulnya berubah jadi \"Riwayat Semua Pengajuan\" dan menampilkan SEMUA pengajuan dari siapa pun (termasuk yang sudah Disetujui/Ditolak, yang sebelumnya menghilang begitu diputuskan di halaman Persetujuan Perubahan).",
      "Sales/Admin tetap cuma lihat pengajuan milik mereka sendiri, seperti semula.",
    ],
  },
  {
    versi: "2.7.0", tanggal: "Agustus 2026",
    judul: "Halaman \"Pengajuan Saya\"",
    butir: [
      "Menu baru \"Pengajuan Saya\" (grup Inbox) — Sales/Admin sekarang bisa lihat riwayat semua pengajuan yang PERNAH mereka ajukan sendiri (ubah data, cashback, diskon, batal SPK, ubah unit), lengkap status Menunggu/Disetujui/Ditolak, tanpa perlu bergantung pada notifikasi.",
      "Bisa disaring per status lewat chip Semua/Menunggu/Disetujui/Ditolak.",
    ],
  },
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

// ── Migrasi Nomor Kuitansi Lama → Format Baru (KWT/2026/NNNN-N) ──
// Alat sekali-jalan, khusus Owner. AMAN dipakai kapan saja karena
// idempotent — SPK yang kuitansinya sudah format baru otomatis
// dilewati, tidak diproses ulang.
function formatBaru(kuitansiNo) {
  // Format baru selalu punya tanda "-" di akhir (mis. "...-1"),
  // format lama tidak. Ini yang dipakai buat deteksi "sudah
  // dimigrasi apa belum" tanpa perlu tandai terpisah.
  return /-\d+$/.test(kuitansiNo || "");
}

async function jalankanMigrasiKuitansi(wadahHasil) {
  const snap = await getDocs(query(
    collection(dbase, "transaksi"), where("kuitansiTercetak", "==", true)));

  let jumlahSpkDiproses = 0;
  let jumlahKuitansiDiubah = 0;
  const detailLog = [];

  for (const dokumen of snap.docs) {
    const t = { id: dokumen.id, ...dokumen.data() };
    const riwayat = Array.isArray(t.riwayatBayar) && t.riwayatBayar.length
      ? [...t.riwayatBayar]
      : [{ kuitansiNo: t.kuitansiNo, kodeAman: t.kuitansiKode,
           jumlah: t.jumlahBayar || 0, sumber: "konsumen",
           sumberNama: t.pembeli?.nama || "-",
           keterangan: t.statusBayar === "lunas" ? "Lunas" : "DP",
           tanggal: t.kuitansiTercetakPada || t.dibuatPada }];

    // Lewati SPK yang kuitansi pertamanya SUDAH format baru — berarti
    // seluruh riwayatnya juga sudah baru semua (format baru dipakai
    // sejak v3.6.0, berurutan, tidak mungkin campur lama-baru).
    if (formatBaru(riwayat[0]?.kuitansiNo)) continue;

    const bagian = (t.spkNo || "").split("/").slice(1).join("/") || "0000/0000";
    let adaPerubahan = false;

    for (let i = 0; i < riwayat.length; i++) {
      const lama = riwayat[i];
      if (formatBaru(lama.kuitansiNo)) continue; // entri ini sendiri sudah baru
      const nomorBaru = `KWT/${bagian}-${i + 1}`;
      const kodeBaru = nomorBaru.replace(/\//g, "-");
      const kodeLama = lama.kodeAman;

      // Pindahkan dokumen kuitansi_publik (QR) ke kode baru — Firestore
      // tidak bisa "rename" doc ID, jadi baca-tulis-hapus.
      if (kodeLama) {
        try {
          const snapPublik = await getDoc(doc(dbase, "kuitansi_publik", kodeLama));
          if (snapPublik.exists()) {
            await setDoc(doc(dbase, "kuitansi_publik", kodeBaru),
              { ...snapPublik.data(), kuitansiNo: nomorBaru });
            await deleteDoc(doc(dbase, "kuitansi_publik", kodeLama));
          }
        } catch { /* kalau gagal pindah QR publik, tetap lanjut — bukan fatal */ }
      }

      riwayat[i] = { ...lama, kuitansiNo: nomorBaru, kodeAman: kodeBaru };
      adaPerubahan = true;
      jumlahKuitansiDiubah++;
      detailLog.push(`${t.spkNo}: ${lama.kuitansiNo || "-"} → ${nomorBaru}`);
    }

    if (adaPerubahan) {
      await updateDoc(doc(dbase, "transaksi", t.id), {
        riwayatBayar: riwayat,
        kuitansiNo: riwayat[0].kuitansiNo,
        kuitansiKode: riwayat[0].kodeAman,
      });
      // Set counter per-SPK supaya kuitansi BARU berikutnya (kalau
      // ada pembayaran lagi) lanjut dari nomor yang benar, bukan
      // mulai dari 1 lagi.
      await setDoc(doc(dbase, "counters", `kuitansi_${t.id}`),
        { terakhir: riwayat.length, diubah: new Date() }, { merge: true });
      jumlahSpkDiproses++;
    }
  }

  await catat("migrasi_nomor_kuitansi", {
    ringkas: `${jumlahSpkDiproses} SPK, ${jumlahKuitansiDiubah} kuitansi diubah`,
  });

  wadahHasil.innerHTML = `<div class="hampa">
    <p><b>Selesai.</b> ${jumlahSpkDiproses} SPK diproses,
      ${jumlahKuitansiDiubah} nomor kuitansi diubah ke format baru.</p>
    ${detailLog.length ? `<p style="text-align:left;font-family:monospace;
      font-size:11px;margin-top:8px">${detailLog.map(aman).join("<br>")}</p>` : ""}
    <p style="margin-top:10px"><b>PENTING:</b> kertas kuitansi yang SUDAH
      dicetak sebelumnya masih tertulis nomor LAMA — cetak ulang lewat
      menu Riwayat SPK ▾ Cetak ▾ Cetak Ulang Kuitansi supaya kertasnya
      cocok dengan nomor baru di sistem.</p>
  </div>`;
}

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

    <div class="lembar" style="margin-bottom:16px">
      <h3 class="judul" style="font-size:15px">Migrasi Nomor Kuitansi Lama</h3>
      <p class="petunjuk">Ubah nomor kuitansi lama (format KWT/2026/NNNN
        global) jadi format baru yang ikut nomor SPK-nya (KWT/2026/NNNN-N).
        Aman dijalankan berkali-kali — yang sudah format baru otomatis
        dilewati. <b>Cuma jalankan kalau kuitansi lama masih di tangan
        showroom</b> (belum ada yang diserahkan ke konsumen) — lihat
        penjelasan di riwayat v3.6.0 di bawah kalau butuh alasan
        lengkapnya.</p>
      <button class="tombol tombol--kecil" id="tombol-migrasi-kuitansi">
        Jalankan Migrasi</button>
      <div id="hasil-migrasi-kuitansi" style="margin-top:10px"></div>
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

  wadah.querySelector("#tombol-migrasi-kuitansi").addEventListener("click", async () => {
    const lanjut = await konfirmasi({
      judul: "Migrasi Nomor Kuitansi?",
      pesan: "Ini akan mengubah nomor kuitansi LAMA jadi format baru " +
             "(ikut nomor SPK) untuk SEMUA SPK sekaligus. Pastikan tidak " +
             "ada kertas kuitansi lama yang sudah diserahkan ke konsumen — " +
             "kalau sudah ada yang beredar, JANGAN lanjutkan, nomor di " +
             "kertas itu akan tidak cocok lagi dengan sistem.",
      oke: "Ya, Jalankan Migrasi", bahaya: true,
    });
    if (!lanjut) return;

    const password = await tanya({
      judul: "Konfirmasi Password",
      pesan: "Ini mengubah data di banyak SPK sekaligus. Masukkan password untuk konfirmasi.",
      petunjuk: "Password", tipeIsian: "password",
    });
    if (password === null) return;
    try {
      await konfirmasiPassword(password);
    } catch {
      kabar("Password salah. Migrasi dibatalkan.", "rem");
      return;
    }

    const tombol = wadah.querySelector("#tombol-migrasi-kuitansi");
    const wadahHasil = wadah.querySelector("#hasil-migrasi-kuitansi");
    tombol.disabled = true;
    tombol.textContent = "Memproses…";
    wadahHasil.innerHTML = `<p class="hampa">Sedang memproses, jangan tutup halaman ini…</p>`;
    try {
      await jalankanMigrasiKuitansi(wadahHasil);
    } catch (err) {
      wadahHasil.innerHTML = `<p class="hampa">Gagal: ${aman(err.message)}</p>`;
    }
    tombol.disabled = false;
    tombol.textContent = "Jalankan Migrasi";
  });
}

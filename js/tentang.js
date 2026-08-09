// tentang.js — riwayat versi aplikasi, khusus Owner. Isinya
// diperbarui manual tiap ada pembaruan besar (bukan otomatis dari
// git log atau semacamnya — ini aplikasi sederhana tanpa proses
// build/CI, jadi cukup ditulis tangan di sini).

import { sesi } from "./auth.js";
import { VERSI } from "./config.js";
import { aman } from "./ui.js";

const RIWAYAT = [
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

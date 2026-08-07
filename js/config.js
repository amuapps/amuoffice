// config.js — satu-satunya file yang perlu diubah saat pindah hosting
// atau ganti proyek Firebase.

// ── Konfigurasi proyek Firebase ───────────────────────────────
// Nilai-nilai ini memang dikirim ke browser dan bukan rahasia.
// Yang menjaga data adalah firestore.rules, bukan file ini.
export const FIREBASE = {
  apiKey: "AIzaSyDX2uO4f6AGQ7KAnXdAdfVWIEot4_sUm0M",
  authDomain: "appsautomitrautama.firebaseapp.com",
  projectId: "appsautomitrautama",
  storageBucket: "appsautomitrautama.firebasestorage.app",
  messagingSenderId: "551121909598",
  appId: "1:551121909598:web:115819630c80e18347c1cf",
};

// ── Identitas perusahaan ──────────────────────────────────────
// Dipakai di layar masuk, SPK, kuitansi, dan katalog publik.
// Nama badan hukum wajib tercetak lengkap di dokumen resmi.
export const SHOWROOM = {
  nama: "PT AUTO MITRA UTAMA",
  namaPendek: "Auto Mitra Utama",
  jenis: "Sub-dealer Vespa",
  alamat: "",
  kota: "",
  telepon: "",
  npwp: "",
};

// ── Merek yang dijual ─────────────────────────────────────────
// Semua nilai bawaan di formulir mengacu ke sini, jadi kalau suatu
// saat menambah merek lain cukup diubah di satu tempat.
export const MEREK_UTAMA = "Vespa";
export const PRINSIPAL = "Piaggio";
export const MAIN_DEALER = "PT Piaggio Indonesia";

// Dipakai sebagai saran isian saat menambah tipe motor.
// SUDAH TIDAK DIPAKAI — diganti daftar dinamis di halaman
// "Referensi Tipe & Warna" (referensi.js), yang bisa diubah sendiri
// tanpa edit kode. Larik ini dibiarkan sebagai catatan isi awal,
// aman dihapus kapan saja.
export const TIPE_VESPA = [
  "LX 125 i-get", "S 125 i-get",
  "Primavera 125 i-get", "Primavera 150 i-get", "Primavera S 150",
  "Sprint 150 i-get", "Sprint S 150",
  "GTS 150", "GTS Super 150", "GTS Super Sport 150",
  "GTS 300 HPE", "GTS Super Tech 300 HPE",
  "Sei Giorni II", "946",
];

// Warna yang lazim ada di showroom Vespa.
// SUDAH TIDAK DIPAKAI — lihat catatan di TIPE_VESPA di atas.
export const WARNA_VESPA = [
  "Bianco Innocenza", "Nero Vulcano", "Rosso Passione",
  "Blu Energia", "Verde Relax", "Giallo Positano",
  "Grigio Materia", "Beige Avvolgente",
];

// ── Pajak ─────────────────────────────────────────────────────
// Perusahaan berstatus PKP, jadi harga OTR sudah termasuk PPN.
// Tarifnya disimpan di sini, bukan ditulis langsung di kode,
// supaya bisa diubah kalau aturannya berganti tanpa membongkar
// perhitungan di banyak tempat.
export const PAJAK = {
  pkp: true,
  // Tarif resmi 12%, tapi untuk barang non-mewah dasar pengenaannya
  // 11/12 dari harga jual — hasil efektifnya 11%.
  tarifResmi: 0.12,
  faktorDpp: 11 / 12,   // motor harian, tidak kena PPnBM
  // Motor di atas 250cc kena PPnBM dan dihitung 12% penuh.
  // Tandai per tipe motor lewat field `mewah: true`.
  faktorDppMewah: 1,
};

// PPN dari harga OTR yang sudah termasuk pajak.
export function pecahHarga(otr, mewah = false) {
  const f = mewah ? PAJAK.faktorDppMewah : PAJAK.faktorDpp;
  const efektif = PAJAK.tarifResmi * f;        // 0,11 atau 0,12
  const dpp = Math.round(Number(otr || 0) / (1 + efektif));
  return { dpp, ppn: Number(otr || 0) - dpp, tarifEfektif: efektif };
}

// ── Penanda versi ─────────────────────────────────────────────
// Naikkan angkanya setiap kali deploy supaya browser tidak
// menyajikan file lama dari cache.
export const VERSI = "2.3.0";

// Zona waktu untuk semua tampilan tanggal.
// Firestore menyimpan waktu dalam UTC — ini yang menerjemahkannya.
export const ZONA = "Asia/Jakarta";

// Selama masa uji coba, setiap dokumen ditandai `uji: true`
// supaya bisa dibersihkan sekaligus sebelum go-live.
// Sekarang showroom mulai memasukkan data sungguhan (Master Data),
// jadi ditutup di sini — dokumen baru tidak lagi ditandai data uji.
export const MODE_UJI = false;

// ── Ketentuan SPK ─────────────────────────────────────────────
// Diambil dari formulir Surat Pesanan Kendaraan yang berlaku di
// dealer Piaggio. Dicetak di lembar SPK, jadi mengikat pemesan.
export const MASA_BERLAKU_SPK = 60; // hari, terhitung sejak unit siap

export const SYARAT_SPK = [
  "Harga yang tercantum dalam Surat Pesanan ini TIDAK MENGIKAT.",
  "Surat Pesanan ini BUKAN merupakan BUKTI PEMBAYARAN.",
  "Kelebihan harga BBN ditanggung oleh pembeli.",
  "Surat Pesanan dianggap SAH apabila: (a) telah ditandatangani " +
  "pemesan, (b) telah disetujui Sales Manager, (c) uang muka telah " +
  "dibayar LUNAS oleh pemesan.",
  "Pembayaran baru dianggap SAH apabila ada kuitansi yang " +
  "dikeluarkan oleh " + "PT AUTO MITRA UTAMA" + ". Pembayaran yang " +
  "dilakukan di luar rekening perusahaan dianggap tidak sah dan " +
  "bukan tanggung jawab perusahaan.",
  "Pembayaran dengan Cek atau Giro harus atas nama perusahaan.",
  "Apabila pemesanan ini dibatalkan oleh pihak pembeli, pengembalian " +
  "uang muka akan diproses sesuai ketentuan yang berlaku di perusahaan.",
  "Pembayaran dapat ditransfer langsung ke rekening perusahaan.",
  "Saya menyetujui syarat & ketentuan yang ditetapkan oleh dealer.",
  "SPK ini berlaku paling lama 60 hari setelah unit siap.",
];

// Rekening resmi yang dicetak di SPK. Isi sesuai rekening PT.
// SUDAH TIDAK DIPAKAI — diganti Master Rekening (rekening.js),
// yang bisa diisi/diubah sendiri lewat halaman tanpa edit kode.
export const REKENING = [
  // { bank: "BCA", cabang: "", nomor: "", atasNama: "PT AUTO MITRA UTAMA" },
];

export const MEREK = "\u00A9SRISP 2026";

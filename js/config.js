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
  jenis: "Sub-dealer motor baru",
  alamat: "",
  kota: "",
  telepon: "",
  npwp: "",
};

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
export const VERSI = "1.4.1";

// Zona waktu untuk semua tampilan tanggal.
// Firestore menyimpan waktu dalam UTC — ini yang menerjemahkannya.
export const ZONA = "Asia/Jakarta";

// Selama masa uji coba, setiap dokumen ditandai `uji: true`
// supaya bisa dibersihkan sekaligus sebelum go-live.
// Ubah ke false saat showroom mulai jalan sungguhan.
export const MODE_UJI = true;

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
  "Apabila pemesanan ini DIBATALKAN oleh pihak pembeli dengan " +
  "alasan apa pun juga, maka 100% UANG MUKA menjadi hak perusahaan.",
  "Pembayaran dapat ditransfer langsung ke rekening perusahaan.",
  "Saya menyetujui syarat & ketentuan yang ditetapkan oleh dealer.",
  "SPK ini berlaku paling lama 60 hari setelah unit siap.",
];

// Rekening resmi yang dicetak di SPK. Isi sesuai rekening PT.
export const REKENING = [
  // { bank: "BCA", cabang: "", nomor: "", atasNama: "PT AUTO MITRA UTAMA" },
];

export const MEREK = "\u00A9SRISP 2026";

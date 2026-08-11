// cetak.js — lembar SPK siap cetak/PDF, mengikuti data yang benar-
// benar tersimpan di transaksi (bukan field lama yang sudah tidak
// dipakai seperti aksesoris/potongan/STNK/tanda jadi).
//
// Dibuka di TAB BARU sebagai dokumen HTML mandiri (bukan panel di
// dalam aplikasi) — supaya window.print() bawaan browser bisa
// langsung memakainya, dan tidak tersangkut di balik tata letak
// aplikasi utama (sidebar, tab, dsb).

import { dbase, doc, getDoc, setDoc, updateDoc, serverTimestamp, catat,
  nomorBerikutnya } from "./db.js?v=3.5.0";
import { SHOWROOM, SYARAT_SPK, MASA_BERLAKU_SPK, DP_MINIMUM } from "./config.js?v=3.5.0";
import { rupiah, terbilang, aman, tanggal } from "./ui.js?v=3.5.0";
import { rekeningDari, muatRekening } from "./rekening.js?v=3.5.0";
import { leasingDari, muatLeasing } from "./leasing.js?v=3.5.0";
import { konfirmasi, tanya } from "./dialog.js?v=3.5.0";
import { konfirmasiPassword } from "./auth.js?v=3.5.0";
import { buatNotifikasi } from "./notifikasi.js?v=3.5.0";
import { kabar } from "./ui.js?v=3.5.0";

function baris(label, isi) {
  return `<tr><td class="c-label">${label}</td>
    <td class="c-titik">:</td><td class="c-isi">${aman(isi || "")}</td></tr>`;
}

const LABEL_CARA_BAYAR = { tunai: "Tunai", transfer: "Transfer", kredit: "Kredit" };

// ── Riwayat pembayaran bertahap (DP → cicilan → pelunasan) ──────
// Total dihitung dari riwayatBayar kalau sudah ada (SPK baru).
// SPK lama yang belum punya riwayatBayar (dicetak sebelum fitur ini
// ada) jatuh balik ke jumlahBayar tunggal — tetap bisa dipakai,
// nanti dibetulkan otomatis begitu dibuka (lihat mintaCetakKuitansi).
export function hitungTotalDibayar(t) {
  if (Array.isArray(t.riwayatBayar) && t.riwayatBayar.length) {
    return t.riwayatBayar.reduce((s, r) => s + (r.jumlah || 0), 0);
  }
  return t.jumlahBayar || 0;
}

// Harga yang SEBENARNYA harus dilunasi konsumen — OTR dikurangi
// Diskon yang SUDAH SAH (t.diskon selalu berisi nilai yang sudah
// berlaku: langsung dari awal kalau masih dalam batas peran, atau
// baru terisi penuh setelah disetujui Owner — lihat diskon_spk di
// persetujuan.js). Diskon yang MASIH menunggu persetujuan TIDAK
// ikut mengurangi apa pun sampai benar-benar disetujui.
//
// Dokumen cetak SPK tetap menampilkan Harga OTR asli + baris Diskon
// terpisah (tidak berubah) — cuma PERHITUNGAN uangnya (Lunas/Sisa
// Tagihan/Tagihan Leasing/Total di Laporan) yang pakai angka ini.
export function hargaEfektif(t) {
  return Math.max((t.hargaOtr || 0) - (t.diskon || 0), 0);
}

// Label untuk pembayaran BELUM lunas selain DP pertama. SENGAJA
// tidak pernah pakai kata "Cicilan" — itu istilah hubungan
// konsumen-ke-LEASING, bukan konsumen/leasing-ke-SHOWROOM. Showroom
// cuma pernah terima: DP (dari konsumen), atau Pelunasan (satu kali
// cair, dari konsumen langsung kalau Cash, atau dari Leasing kalau
// Kredit).
export function labelPembayaranBelumLunas(t) {
  return (t.caraBayar || []).includes("kredit")
    ? "Pembayaran Leasing" : "Pembayaran Tambahan";
}

export function sudahLunas(t) {
  const total = hitungTotalDibayar(t);
  const efektif = hargaEfektif(t);
  return efektif > 0 && total >= efektif;
}

// Label tombol yang konsisten di semua halaman (Riwayat SPK, Lihat
// Pesanan, layar konfirmasi SPK baru) — supaya jelas tahap mana
// yang sedang berlangsung tanpa perlu buka detailnya dulu.
export function labelTombolKuitansi(t) {
  // Generik sengaja — hasil sebenarnya (Lunas kalau cash penuh, DP
  // kalau kredit/cicilan) baru diketahui SETELAH sistem hitung
  // jumlahnya, jadi nama tombol tidak menjanjikan salah satu.
  if (!t.kuitansiTercetak) return "Terima Pembayaran & Cetak Kuitansi";
  return sudahLunas(t) ? "Cetak Ulang Kuitansi Lunas" : "Terima Pembayaran";
}
// Sumber pelunasan/cicilan SETELAH pembayaran pertama otomatis
// mengikuti data yang SUDAH ada di SPK sejak awal — tidak perlu
// tanya manual. Kredit → leasing yang sudah dipilih di SPK.
// Tunai/transfer → tetap dari pembeli sendiri.
async function tentukanSumber(t) {
  if ((t.caraBayar || []).includes("kredit") && t.kredit?.leasingId) {
    await muatLeasing();
    const l = leasingDari(t.kredit.leasingId);
    return { sumber: "leasing", sumberNama: l ? l.nama : "Leasing" };
  }
  return { sumber: "konsumen", sumberNama: t.pembeli?.nama || "-" };
}

// Data yang ditulis ke kuitansi_publik — SENGAJA cuma info yang aman
// dilihat publik (nama pembeli & ringkasan transaksi), BUKAN NIK,
// alamat, atau nomor telepon. Satu dokumen per LEMBAR PEMBAYARAN
// (bukan per SPK) — DP dan pelunasan punya kode QR masing-masing.
function dataKuitansiPublik(t, entri, totalSetelah) {
  const sisa = Math.max(hargaEfektif(t) - totalSetelah, 0);
  return {
    kuitansiNo: entri.kuitansiNo, spkNo: t.spkNo, tipeNama: t.tipeNama,
    warna: t.warna, jumlahBayar: entri.jumlah, sisaTagihan: sisa,
    tanggal: tanggal(entri.tanggal), showroomNama: SHOWROOM.nama,
    namaPembeli: t.pembeli?.nama || "",
    diterimaDari: entri.sumberNama,
    caraBayar: (t.caraBayar || []).map((c) => LABEL_CARA_BAYAR[c] || c),
    keterangan: entri.keterangan,
  };
}

// Owner sering kepakai buat input SPK waktu belum ada sales yang
// menangani (mis. saat uji coba) — tampilkan "OWNER" di cetakan,
// bukan nama pribadinya, supaya tidak terkesan asal-asalan/kurang
// resmi di dokumen yang dipegang konsumen.
function namaSales(t) {
  return t.salesPeran === "owner" ? "OWNER" : (t.salesNama || "-");
}

// SPK yang dibuat SEBELUM field salesPeran ada belum tersimpan
// perannya (cuma salesNama). Untuk yang begitu, cek ulang langsung
// ke data pengguna lewat salesUid, supaya "OWNER" tetap terdeteksi
// walau datanya lama.
export async function resolveNamaSales(t) {
  if (t.salesPeran) return namaSales(t);
  if (!t.salesUid) return t.salesNama || "-";
  try {
    const snap = await getDoc(doc(dbase, "users", t.salesUid));
    if (snap.exists() && snap.data().peran === "owner") return "OWNER";
  } catch { /* gagal cek → pakai nama tersimpan apa adanya */ }
  return t.salesNama || "-";
}

// Watermark: nama perusahaan diulang kecil-kecil & rapat, dibuat
// dari SVG kecil (bukan gambar logo) supaya teksnya tetap tajam
// dibaca-samar walau di-zoom, dan ukurannya kecil sekali (file-nya
// cuma teks, bukan raster).
// Ukuran ubin watermark dihitung persis dari lebar teksnya sendiri
// (bukan angka kira-kira) — supaya beneran rapat tanpa spasi, apa
// pun panjang nama perusahaannya.
function lebarTeks(teks, font) {
  const kanvas = document.createElement("canvas");
  const ctx = kanvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(teks).width;
}
const FONT_WM = "700 10px 'Segoe UI', Arial, sans-serif";
const LEBAR_WM = Math.ceil(lebarTeks(SHOWROOM.nama, FONT_WM)) + 2;
const TINGGI_WM = 12;
const WM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${LEBAR_WM}" height="${TINGGI_WM}">
  <text x="0" y="9.5" font-family="Segoe UI, Arial, sans-serif" font-size="10"
        font-weight="700" fill="#000">${aman(SHOWROOM.nama)}</text>
</svg>`;
const WM_DATA_URI = "data:image/svg+xml," +
  encodeURIComponent(WM_SVG.replace(/\s+/g, " ").trim());

// CSS lembar cetak — salinan dari style.css (blok "Lembar cetak
// SPK") supaya tab baru ini berdiri sendiri, tidak bergantung pada
// file CSS aplikasi (yang lokasinya bisa beda-beda tergantung
// tempat deploy).
const CSS_CETAK = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: #f3f3f3;
    font-family: "Segoe UI", Inter, system-ui, -apple-system, Roboto, sans-serif;
    color: #111;
  }
  .lembar-cetak {
    max-width: 800px; margin: 0 auto 16px; background: #fff; color: #111;
    position: relative; overflow: hidden; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,.15);
    padding: 20px; font-size: 11.5px; line-height: 1.4;
  }
  .lembar-cetak::before {
    content: ""; position: absolute; inset: 0;
    background-image: url("${WM_DATA_URI}");
    background-repeat: repeat; background-size: ${LEBAR_WM}px ${TINGGI_WM}px;
    background-position: center;
    opacity: .035; pointer-events: none; z-index: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .lembar-cetak > * { position: relative; z-index: 1; }
  .c-kop { display: flex; align-items: center; justify-content: space-between;
    gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; }
  .c-kop-kiri { display: flex; align-items: center; gap: 12px; }
  .c-kop-logo { width: 52px; height: 52px; object-fit: contain; flex: none; }
  .c-pt { font-size: 16px; font-weight: 600; margin: 0; }
  .c-kecil { font-size: 10.5px; color: #555; margin: 2px 0 0; }
  .c-nomor table { font-size: 11px; }
  .c-judul { text-align: center; font-size: 15px; font-weight: 600;
    margin: 10px 0; letter-spacing: .02em; }
  .c-peringatan-dp { background: #FDECEC; border: 1.5px solid #D33; color: #A00;
    padding: 8px 10px; border-radius: 4px; font-size: 11px; font-weight: 700;
    text-align: center; margin: 8px 0; }
  .c-dua, .c-badan { display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
    border: 1px solid #999; padding: 9px; margin-bottom: -1px; }
  .c-tabel { width: 100%; border-collapse: collapse; }
  .c-tabel td { vertical-align: top; padding: 1.5px 0; }
  .c-label { width: 42%; color: #444; }
  .c-titik { width: 10px; }
  .c-isi { border-bottom: 1px dotted #aaa; }
  .c-sub { font-weight: 600; font-size: 11px; text-align: center;
    border-bottom: 1px solid #999; padding-bottom: 4px; margin: 0 0 7px;
    text-transform: uppercase; letter-spacing: .05em; }
  .c-harga { width: 100%; border-collapse: collapse; }
  .c-harga td { padding: 1.5px 0; border-bottom: 1px dotted #ccc; }
  .c-kanan { text-align: right; white-space: nowrap; }
  .c-total td { border-bottom: 0; border-top: 1px solid #111; padding-top: 4px; }
  .c-terbilang { font-style: italic; color: #444; margin: 4px 0 0; }
  .c-syarat { margin: 0; padding-left: 15px; font-size: 9.6px; line-height: 1.35; }
  .c-syarat li { margin-bottom: 3px; }
  .c-ttd { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
    text-align: center; font-size: 10px; color: #555;
    border: 1px solid #999; padding: 8px; border-top: 0; }
  .c-ttd > div { padding-top: 46px; position: relative; }
  .c-garis { position: absolute; left: 12%; right: 12%; top: 40px;
    border-top: 1px solid #111; }
  .c-berlaku { font-size: 10px; color: #555; margin: 6px 0 0; text-align: center; }
  .c-kaki { font-size: 9.5px; color: #777; text-align: center; margin: 10px 0 0; }
  .aksi-cetak { max-width: 800px; margin: 0 auto; text-align: center; }
  .aksi-cetak button {
    padding: 10px 22px; border-radius: 8px; border: 0; cursor: pointer;
    background: #0067C0; color: #fff; font-size: 14px; font-weight: 600;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .lembar-cetak { box-shadow: none; border-radius: 0; margin: 0 auto; }
    .aksi-cetak { display: none; }
    .c-dua, .c-badan { grid-template-columns: 1fr 1fr !important; }
    .c-ttd { grid-template-columns: repeat(3, 1fr) !important; }
    /* Sama seperti kuitansi — pastikan hitam pekat di atas putih
       (bukan abu-abu) dan font cukup besar buat dot matrix. */
    * { color: #000 !important; border-color: #000 !important; }
    .lembar-cetak::before { opacity: .06 !important; }
    .c-pt { font-size: 17px; }
    .c-peringatan-dp { background: #fff !important; border: 2px solid #000 !important;
      color: #000 !important; font-size: 12px; }
    .c-kecil { font-size: 11px; }
    .c-judul { font-size: 17px; }
    .c-label, .c-isi, .c-sub, .c-tabel { font-size: 12px; }
    .c-syarat { font-size: 10.5px; }
    .c-ttd { font-size: 11px; }
    .c-kaki { font-size: 10.5px; }
  }
`;

// ── Kuitansi: rangkap 3 dalam satu lembar HVS (disusun ke bawah,
// dipotong pakai gunting) — bukan landscape lagi, mengikuti contoh
// yang diberikan: krem-emas, QR code di kanan atas tiap lembar.
const CSS_KUITANSI = `
  * { box-sizing: border-box; }
  /* Ukuran kertas NCR continuous form (2 ply) — 9½" x 11" —
     BUKAN A4. Kertasnya sendiri yang menghasilkan salinan kedua
     otomatis (karbon bawaan kertas), jadi cukup CETAK SATU KALI,
     tidak perlu 3 lembar berlapis seperti sebelumnya. */
  @page { size: 9.5in 11in; margin: 8mm 10mm; }
  body {
    margin: 0; padding: 16px; background: #ECECEC;
    font-family: "Segoe UI", Inter, system-ui, -apple-system, Roboto, sans-serif;
    color: #2b2210;
  }
  .k-lembar-luar { max-width: 860px; margin: 0 auto 16px; }
  .k-kuitansi {
    background: #FBF7EC; position: relative; overflow: hidden;
    border: 1.5px solid #C9A227; border-radius: 6px; padding: 18px 22px;
    font-size: 12px; line-height: 1.5;
  }
  .k-kuitansi::before {
    content: ""; position: absolute; inset: 0;
    background-image: url("${WM_DATA_URI}");
    background-repeat: repeat; background-size: ${LEBAR_WM * 0.85}px ${TINGGI_WM * 0.85}px;
    background-position: center;
    opacity: .05; pointer-events: none; z-index: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .k-kuitansi > * { position: relative; z-index: 1; }
  .k-atas { display: flex; justify-content: space-between; gap: 10px; }
  .k-kop { display: flex; align-items: flex-start; gap: 8px; }
  .k-kop-logo { width: 42px; height: 42px; object-fit: contain; flex: none; }
  .k-pt { font-size: 17px; font-weight: 800; margin: 0; letter-spacing: .01em; }
  .k-kecil { font-size: 9.5px; color: #6b5f3f; margin: 1px 0 0; max-width: 320px; }
  .k-jenis-tabel { font-size: 10.5px; text-align: right; }
  .k-jenis-tabel td:first-child { color: #6b5f3f; padding-right: 8px; }
  .k-jenis-tabel td:last-child { font-weight: 700; }
  .k-qr { width: 88px; height: 88px; margin-left: 10px; flex: none; }
  .k-judul { font-size: 19px; font-weight: 800; margin: 14px 0 3px;
    color: #2b2210; }
  .k-nomor-tgl { font-size: 10.5px; color: #6b5f3f; margin: 0 0 10px; }
  .k-jumlah-label { font-size: 10.5px; font-weight: 700; color: #6b5f3f;
    text-transform: uppercase; letter-spacing: .04em; margin: 10px 0 0; }
  .k-jumlah-besar { font-size: 28px; font-weight: 800; color: #9C7A1E;
    margin: 2px 0 8px; }
  .k-terbilang-label { font-size: 10.5px; font-weight: 700; color: #6b5f3f;
    text-transform: uppercase; letter-spacing: .04em; margin: 6px 0 3px; }
  .k-terbilang-kotak { border-bottom: 1px dashed #b7a15c; padding: 4px 0 6px;
    font-style: italic; font-size: 12.5px; color: #4a3d17; }
  .k-grid2 { display: grid; grid-template-columns: 1.1fr 1fr; gap: 20px;
    margin-top: 14px; }
  .k-dk-judul { font-size: 10.5px; font-weight: 700; color: #6b5f3f;
    text-transform: uppercase; letter-spacing: .04em; margin: 0 0 5px; }
  .k-tabel { width: 100%; border-collapse: collapse; font-size: 11px; }
  .k-tabel td { padding: 2px 0; vertical-align: top; }
  .k-label { width: 34%; color: #6b5f3f; }
  .k-isi { font-weight: 600; }
  .k-ttd { display: flex; justify-content: space-between; margin-top: 34px;
    font-size: 10px; color: #6b5f3f; }
  .k-ttd > div { width: 46%; }
  .k-garis { display: block; border-top: 1px solid #7a6a35; margin: 42px 0 5px; }
  .k-kaki { font-size: 9px; color: #8a7c50; margin-top: 16px;
    display: flex; justify-content: space-between; }
  .aksi-cetak { max-width: 860px; margin: 0 auto; text-align: center; }
  .aksi-cetak button {
    padding: 10px 22px; border-radius: 8px; border: 0; cursor: pointer;
    background: #0067C0; color: #fff; font-size: 14px; font-weight: 600;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .aksi-cetak { display: none; }
    /* Dot matrix TIDAK bisa cetak warna/abu-abu bertingkat dengan
       bagus (ribbon hitam-putih, resolusi kasar) — jadi waktu cetak,
       semua warna emas/krem/abu dipaksa jadi hitam pekat di atas
       putih polos, dan font dibesarkan supaya tetap tajam terbaca
       walau dot-nya kasar. Watermark TETAP ada (sesuai teks
       perusahaan, dibuat dari SVG teks — bukan foto/gambar — jadi
       ringan & tetap tajam meski di-print draft/NLQ). */
    * { color: #000 !important; border-color: #000 !important; }
    .k-kuitansi { background: #fff !important; border: 1.5px solid #000; }
    .k-kuitansi::before { opacity: .08 !important; }
    .k-pt { font-size: 19px; }
    .k-kecil { font-size: 10.5px; }
    .k-jenis-tabel { font-size: 11.5px; }
    .k-judul { font-size: 21px; }
    .k-nomor-tgl { font-size: 11.5px; }
    .k-jumlah-label, .k-terbilang-label, .k-dk-judul { font-size: 11.5px; }
    .k-kalimat-isi { font-size: 13px; font-weight: 700; }
    .k-jumlah-besar { font-size: 26px; }
    .k-terbilang-kotak { font-size: 13px; font-style: normal; font-weight: 600; }
    .k-tabel { font-size: 12px; }
    .k-ttd { font-size: 11px; }
    .k-kaki { font-size: 10px; }
  }
`;

export async function cetakSpk(t) {
  if (!t) return;

  const tabBaru = window.open("", "_blank");
  if (!tabBaru) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  tabBaru.document.write(`<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>SPK ${aman(t.spkNo || "")}</title>
    <style>${CSS_CETAK}</style></head>
    <body><p style="text-align:center;color:#777">Menyiapkan lembar cetak…</p></body></html>`);
  tabBaru.document.close();

  // Detail unit (nomor rangka/mesin/tahun) diambil langsung dari
  // Data Unit — di transaksi cuma disimpan ID-nya, bukan salinannya.
  let unit = null;
  if (t.unitId) {
    try {
      const snap = await getDoc(doc(dbase, "units", t.unitId));
      if (snap.exists()) unit = snap.data();
    } catch { /* unit tidak wajib ada untuk tetap bisa cetak */ }
  }

  await Promise.all([muatRekening(), muatLeasing()]);
  const namaSalesTampil = await resolveNamaSales(t);
  const rekening = t.rekeningId ? rekeningDari(t.rekeningId) : null;
  const leasing = t.kredit?.leasingId ? leasingDari(t.kredit.leasingId) : null;
  const kredit = (t.caraBayar || []).includes("kredit");
  const pemakaiSama = t.pemakaiSamaDenganPembeli !== false;

  const isi = `<div class="lembar-cetak" id="lembar-spk">

    <header class="c-kop">
      <div class="c-kop-kiri">
        <img class="c-kop-logo" src="${location.origin}/logo.png" alt="">
        <div>
          <p class="c-pt">${aman(SHOWROOM.nama)}</p>
          <p class="c-kecil">${aman(SHOWROOM.alamat || "")}</p>
          <p class="c-kecil">${aman(SHOWROOM.telepon || "")}
            ${SHOWROOM.npwp ? " · NPWP " + aman(SHOWROOM.npwp) : ""}</p>
        </div>
      </div>
      <div class="c-nomor">
        <table>
          ${baris("Nomor", t.spkNo)}
          ${baris("Tanggal", tanggal(t.dibuatPada))}
        </table>
      </div>
    </header>

    <h1 class="c-judul">Surat Pesanan Kendaraan</h1>
    ${hitungTotalDibayar(t) < DP_MINIMUM ? `<p class="c-peringatan-dp">
      ⚠️ UANG MUKA BELUM MEMENUHI SYARAT MINIMUM (${rupiah(DP_MINIMUM)}) —
      SPK INI BELUM SAH sesuai Syarat No. 4 di bawah</p>` : ""}

    <section class="c-dua">
      <table class="c-tabel">
        ${baris("Nama Pembeli", t.pembeli?.nama)}
        ${baris("Alamat", [t.pembeli?.alamat, t.pembeli?.kelurahan,
                            t.pembeli?.kecamatan, t.pembeli?.kota]
                            .filter(Boolean).join(", "))}
        ${baris("Telp / HP", t.pembeli?.telepon)}
        ${baris("NIK", t.pembeli?.nik)}
      </table>
      <table class="c-tabel">
        ${pemakaiSama
          ? baris("Pemakai", "Sama dengan pembeli")
          : baris("Nama Pemakai", t.pemakai?.nama) +
            baris("Alamat Pemakai", [t.pemakai?.alamat, t.pemakai?.kelurahan,
                                      t.pemakai?.kecamatan, t.pemakai?.kota]
                                      .filter(Boolean).join(", ")) +
            baris("Telp / HP", t.pemakai?.telepon) +
            baris("NIK", t.pemakai?.nik)}
      </table>
    </section>

    <section class="c-badan">
      <div class="c-kiri">
        <p class="c-sub">KETERANGAN UNIT</p>
        <table class="c-tabel">
          ${baris("Merk / Tipe", t.tipeNama)}
          ${baris("Warna / Tahun", `${t.warna || "-"} / ${unit?.tahun || "-"}`)}
          ${baris("Nomor Rangka", unit?.noRangka || "Menunggu unit tersedia (Indent)")}
          ${baris("Nomor Mesin", unit?.noMesin || "-")}
          ${baris("Status", t.kondisiUnit === "ready" ? "Unit terkunci (Dipesan)" : "Indent — menunggu unit tiba")}
        </table>

        <table class="c-harga c-total" style="margin-top:8px">
          <tr><td><b>Harga OTR</b></td>
              <td class="c-kanan"><b>${rupiah(t.hargaOtr)}</b></td></tr>
          ${t.diskon ? `<tr><td>Diskon</td>
              <td class="c-kanan">− ${rupiah(t.diskon)}</td></tr>` : ""}
          ${t.cashbackDisetujui ? `<tr><td>Cashback</td>
              <td class="c-kanan">${rupiah(t.cashbackDisetujui)}</td></tr>` : ""}
        </table>
        <p class="c-terbilang">${aman(terbilang(t.hargaOtr || 0))}</p>
        ${t.catatan ? `<p class="c-kecil">Catatan: ${aman(t.catatan)}</p>` : ""}
      </div>

      <div class="c-kanan-kolom">
        <p class="c-sub">SYARAT dan KETENTUAN</p>
        <ol class="c-syarat">
          ${SYARAT_SPK.map((s) => `<li>${aman(s)}</li>`).join("")}
        </ol>
        ${rekening ? `<p class="c-kecil">${aman(rekening.bank)}
          ${rekening.cabang ? aman(rekening.cabang) : ""} a.c ${aman(rekening.nomor)}
          a.n. ${aman(rekening.atasNama)}</p>` : ""}
      </div>
    </section>

    <section class="c-badan">
      <div class="c-kiri">
        <p class="c-sub">CARA PEMBAYARAN</p>
        <table class="c-harga">
          <tr><td>Cara bayar</td>
              <td class="c-kanan">${aman((t.caraBayar || [])
                .map((c) => LABEL_CARA_BAYAR[c] || c).join(" + "))}</td></tr>
          <tr><td>${kredit ? "DP (Uang Muka)" : "Dibayar sekarang"}</td>
              <td class="c-kanan">${rupiah(t.jumlahBayar)}</td></tr>
          ${t.jumlahTunai ? `<tr><td>&nbsp;&nbsp;— Tunai</td>
              <td class="c-kanan">${rupiah(t.jumlahTunai)}</td></tr>` : ""}
          ${t.jumlahTransfer ? `<tr><td>&nbsp;&nbsp;— Transfer</td>
              <td class="c-kanan">${rupiah(t.jumlahTransfer)}</td></tr>` : ""}
          ${kredit ? `
          <tr><td>Leasing</td>
              <td class="c-kanan">${aman(leasing?.nama || "-")}</td></tr>
          <tr><td>Sisa Dibiayai Leasing</td>
              <td class="c-kanan">${rupiah(Math.max(0, hargaEfektif(t) - (t.jumlahBayar || 0)))}</td></tr>
          <tr><td>Cicilan / bulan</td>
              <td class="c-kanan">${rupiah(t.kredit?.cicilan)}</td></tr>
          <tr><td>Lama cicilan</td>
              <td class="c-kanan">${aman(t.kredit?.tenor || 0)} bln</td></tr>` : ""}
        </table>
      </div>

      <div class="c-kanan-kolom">
        <table class="c-tabel">
          ${baris("Salesman", namaSalesTampil)}
        </table>
      </div>
    </section>

    <section class="c-ttd">
      <div><span class="c-garis"></span>Tanda Tangan &amp; Nama Jelas
        <br><span class="c-kecil">Pemesan</span></div>
      <div><span class="c-garis"></span>Tanda Tangan &amp; Nama Jelas
        <br><span class="c-kecil">Salesman</span></div>
      <div><span class="c-garis"></span>Tanda Tangan, Nama Jelas &amp; Cap
        <br><span class="c-kecil">SPV</span></div>
    </section>

    <p class="c-berlaku">SPK ini berlaku paling lama
      ${MASA_BERLAKU_SPK} hari setelah unit siap.</p>

    <p class="c-kaki">${aman(SHOWROOM.nama)}</p>
  </div>

  <div class="aksi-cetak">
    <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>`;

  // Timpa seluruh isi <body> tab barunya dengan lembar yang sudah jadi.
  tabBaru.document.body.innerHTML = isi;
}

// ── Tagihan ke Leasing ──────────────────────────────────────────
// Dokumen terpisah dari kuitansi (yang untuk konsumen) — ini yang
// diserahkan/dikirim ke pihak LEASING supaya mereka cairkan sisa
// pembiayaan ke showroom. Modelnya sengaja dibuat mirip SPK (kop,
// tata letak, tanda tangan) supaya konsisten, isinya disesuaikan.
// Placeholder sampai ada contoh format baku dari leasing/showroom.
export async function cetakTagihanLeasing(t) {
  if (!t) return;
  if (!(t.caraBayar || []).includes("kredit") || !t.kredit?.leasingId) {
    kabar("SPK ini bukan transaksi kredit / belum pilih leasing.", "rem");
    return;
  }

  const tabBaru = window.open("", "_blank");
  if (!tabBaru) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  tabBaru.document.write(`<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>Tagihan Leasing — ${aman(t.spkNo || "")}</title>
    <style>${CSS_CETAK}</style></head>
    <body><p style="text-align:center;color:#777">Menyiapkan lembar cetak…</p></body></html>`);
  tabBaru.document.close();

  let unit = null;
  if (t.unitId) {
    try {
      const snap = await getDoc(doc(dbase, "units", t.unitId));
      if (snap.exists()) unit = snap.data();
    } catch { /* unit tidak wajib ada */ }
  }

  await muatLeasing();
  const namaSalesTampil = await resolveNamaSales(t);
  const leasing = leasingDari(t.kredit.leasingId);
  const totalDibayar = hitungTotalDibayar(t);
  const tagihan = Math.max(hargaEfektif(t) - totalDibayar, 0);

  const isi = `<div class="lembar-cetak" id="lembar-tagihan-leasing">

    <header class="c-kop">
      <div class="c-kop-kiri">
        <img class="c-kop-logo" src="${location.origin}/logo.png" alt="">
        <div>
          <p class="c-pt">${aman(SHOWROOM.nama)}</p>
          <p class="c-kecil">${aman(SHOWROOM.alamat || "")}</p>
          <p class="c-kecil">${aman(SHOWROOM.telepon || "")}
            ${SHOWROOM.npwp ? " · NPWP " + aman(SHOWROOM.npwp) : ""}</p>
        </div>
      </div>
      <div class="c-nomor">
        <table>
          ${baris("No. SPK", t.spkNo)}
          ${baris("Tanggal", tanggal(new Date()))}
        </table>
      </div>
    </header>

    <h1 class="c-judul">Tagihan Pembiayaan ke Leasing</h1>

    <section class="c-dua">
      <table class="c-tabel">
        ${baris("Kepada Yth.", aman(leasing?.nama || "-"))}
        ${baris("Perihal", "Pencairan pembiayaan kendaraan konsumen berikut")}
      </table>
      <table class="c-tabel">
        ${baris("Nama Konsumen", t.pembeli?.nama)}
        ${baris("Alamat", [t.pembeli?.alamat, t.pembeli?.kelurahan,
                            t.pembeli?.kecamatan, t.pembeli?.kota]
                            .filter(Boolean).join(", "))}
        ${baris("Telp / HP", t.pembeli?.telepon)}
        ${baris("NIK", t.pembeli?.nik)}
      </table>
    </section>

    <section class="c-badan">
      <div class="c-kiri">
        <p class="c-sub">KETERANGAN UNIT</p>
        <table class="c-tabel">
          ${baris("Merk / Tipe", t.tipeNama)}
          ${baris("Warna / Tahun", `${t.warna || "-"} / ${unit?.tahun || "-"}`)}
          ${baris("Nomor Rangka", unit?.noRangka || "-")}
          ${baris("Nomor Mesin", unit?.noMesin || "-")}
        </table>
      </div>
      <div class="c-kanan-kolom">
        <p class="c-sub">RINCIAN KREDIT</p>
        <table class="c-tabel">
          ${baris("Cicilan / bulan", rupiah(t.kredit?.cicilan))}
          ${baris("Lama cicilan", `${t.kredit?.tenor || 0} bulan`)}
          ${baris("Tanggal survey", t.kredit?.tanggalSurvey ? tanggal(t.kredit.tanggalSurvey) : "-")}
        </table>
      </div>
    </section>

    <section class="c-badan">
      <div class="c-kiri" style="grid-column: 1 / -1">
        <p class="c-sub">RINCIAN TAGIHAN</p>
        <table class="c-harga c-total">
          <tr><td>Harga OTR</td><td class="c-kanan">${rupiah(t.hargaOtr)}</td></tr>
          <tr><td>DP diterima showroom</td>
              <td class="c-kanan">− ${rupiah(totalDibayar)}</td></tr>
          <tr><td><b>Ditagihkan ke ${aman(leasing?.nama || "Leasing")}</b></td>
              <td class="c-kanan"><b>${rupiah(tagihan)}</b></td></tr>
        </table>
        <p class="c-terbilang">${aman(terbilang(tagihan))}</p>
      </div>
    </section>

    <section class="c-ttd">
      <div><span class="c-garis"></span>Tanda Tangan &amp; Nama Jelas
        <br><span class="c-kecil">Salesman</span></div>
      <div><span class="c-garis"></span>Tanda Tangan, Nama Jelas &amp; Cap
        <br><span class="c-kecil">SPV / Owner</span></div>
      <div><span class="c-garis"></span>Tanda Tangan &amp; Cap
        <br><span class="c-kecil">Pihak Leasing</span></div>
    </section>

    <p class="c-kaki">${aman(SHOWROOM.nama)} · Dibuat oleh ${aman(namaSalesTampil)}</p>
  </div>

  <div class="aksi-cetak">
    <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>`;

  tabBaru.document.body.innerHTML = isi;
}

// ── Unduh Excel (.xlsx) ──────────────────────────────────────────
// Pakai SheetJS dari CDN, dimuat sekali saja (bukan bundel dalam
// aplikasi) — cukup ringan & cuma kepakai kalau tombolnya diklik.
let sheetJsSiap = null;
function muatSheetJS() {
  if (window.XLSX) return Promise.resolve();
  if (sheetJsSiap) return sheetJsSiap;
  sheetJsSiap = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Gagal memuat pustaka Excel."));
    document.head.appendChild(s);
  });
  return sheetJsSiap;
}

function barisEkspor(t) {
  const batal = t.status === "batal";
  return {
    "No. SPK": t.spkNo || "", "Tanggal": tanggal(t.dibuatPada),
    "Pembeli": t.pembeli?.nama || "", "No. HP": t.pembeli?.telepon || "",
    "Unit": t.tipeNama || "", "Warna": t.warna || "",
    "Harga OTR": t.hargaOtr || 0,
    "Diskon": t.diskon || 0,
    "Harga Efektif": hargaEfektif(t),
    "Cara Bayar": (t.caraBayar || []).includes("kredit") ? "Kredit" : "Cash",
    "Status": batal ? "Batal" : (sudahLunas(t) ? "Lunas" : "Belum Lunas"),
    "Total Dibayar": hitungTotalDibayar(t),
    "Sisa Tagihan": Math.max(hargaEfektif(t) - hitungTotalDibayar(t), 0),
    "Sales": t.salesNama || "", "Kondisi": t.kondisiUnit || "",
    "Alasan Batal": t.alasanBatal || "",
  };
}

export async function unduhExcel(daftar) {
  if (!daftar.length) { kabar("Tidak ada data untuk diunduh.", "rem"); return; }
  try {
    await muatSheetJS();
    const ws = window.XLSX.utils.json_to_sheet(daftar.map(barisEkspor));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Riwayat SPK");
    window.XLSX.writeFile(wb, `riwayat-spk-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    kabar("Gagal membuat Excel: " + err.message, "rem");
  }
}

// ── Unduh PDF ─────────────────────────────────────────────────────
// Sama seperti dokumen cetak lain di modul ini — buka tab baru berisi
// tabel siap cetak, lalu window.print() (pengguna pilih "Simpan
// sebagai PDF" di dialog printer). Tidak perlu pustaka tambahan.
export function unduhPdf(daftar) {
  if (!daftar.length) { kabar("Tidak ada data untuk diunduh.", "rem"); return; }
  const tabBaru = window.open("", "_blank");
  if (!tabBaru) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  const baris = daftar.map((t) => {
    const batal = t.status === "batal";
    return `<tr>
      <td>${aman(t.spkNo)}</td><td>${tanggal(t.dibuatPada)}</td>
      <td>${aman(t.pembeli?.nama)}</td><td>${aman(t.tipeNama)} ${aman(t.warna)}</td>
      <td style="text-align:right">${rupiah(t.hargaOtr)}</td>
      <td>${(t.caraBayar || []).includes("kredit") ? "Kredit" : "Cash"}</td>
      <td>${batal ? "Batal" : (sudahLunas(t) ? "Lunas" : "Belum Lunas")}</td>
      <td>${aman(t.salesNama)}</td>
    </tr>`;
  }).join("");
  tabBaru.document.write(`<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>Riwayat SPK</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; padding: 20px; color: #000; }
      h1 { font-size: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
      th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
      th { background: #eee; }
      .aksi-cetak { text-align: center; margin-top: 14px; }
      @media print { .aksi-cetak { display: none; } }
    </style></head>
    <body>
      <h1>Riwayat &amp; Laporan SPK — ${aman(SHOWROOM.nama)}</h1>
      <p style="font-size:10.5px;color:#555">Dicetak ${tanggal(new Date())} · ${daftar.length} SPK</p>
      <table><thead><tr>
        <th>No. SPK</th><th>Tanggal</th><th>Pembeli</th><th>Unit</th>
        <th>Harga OTR</th><th>Cara Bayar</th><th>Status</th><th>Sales</th>
      </tr></thead><tbody>${baris}</tbody></table>
      <div class="aksi-cetak">
        <button onclick="window.print()">Cetak / Simpan PDF</button>
      </div>
    </body></html>`);
  tabBaru.document.close();
}

// ── Tagihan Leasing, MASSAL ──────────────────────────────────────
// Dipakai dari filter "Cara Bayar: Kredit" di Riwayat SPK — satu
// dokumen berisi tagihan SEMUA SPK kredit yang lolos filter,
// dipisah per halaman cetak (page-break), bukan tab terpisah per
// SPK (supaya tidak diblokir pop-up blocker kalau jumlahnya banyak).
export async function cetakTagihanLeasingBatch(daftar) {
  if (!daftar.length) {
    kabar("Tidak ada SPK kredit dengan leasing pada hasil filter ini.", "rem");
    return;
  }
  const tabBaru = window.open("", "_blank");
  if (!tabBaru) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  tabBaru.document.write(`<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>Tagihan Leasing (${daftar.length} SPK)</title>
    <style>${CSS_CETAK}
      .lembar-cetak { page-break-after: always; }
    </style></head>
    <body><p style="text-align:center;color:#777">Menyiapkan ${daftar.length} lembar…</p></body></html>`);
  tabBaru.document.close();

  await muatLeasing();
  const potongan = [];
  for (const t of daftar) {
    let unit = null;
    if (t.unitId) {
      try {
        const snap = await getDoc(doc(dbase, "units", t.unitId));
        if (snap.exists()) unit = snap.data();
      } catch { /* unit tidak wajib ada */ }
    }
    const namaSalesTampil = await resolveNamaSales(t);
    const leasing = leasingDari(t.kredit.leasingId);
    const totalDibayar = hitungTotalDibayar(t);
    const tagihan = Math.max(hargaEfektif(t) - totalDibayar, 0);

    potongan.push(`<div class="lembar-cetak">
      <header class="c-kop">
        <div class="c-kop-kiri">
          <img class="c-kop-logo" src="${location.origin}/logo.png" alt="">
          <div>
            <p class="c-pt">${aman(SHOWROOM.nama)}</p>
            <p class="c-kecil">${aman(SHOWROOM.alamat || "")}</p>
          </div>
        </div>
        <table class="c-nomor">${baris("No. SPK", t.spkNo)}</table>
      </header>
      <h1 class="c-judul">Tagihan Pembiayaan ke Leasing</h1>
      <section class="c-dua">
        <table class="c-tabel">
          ${baris("Kepada Yth.", leasing?.nama || "-")}
        </table>
        <table class="c-tabel">
          ${baris("Nama Konsumen", t.pembeli?.nama)}
          ${baris("Telp / HP", t.pembeli?.telepon)}
        </table>
      </section>
      <section class="c-badan">
        <div class="c-kiri">
          <p class="c-sub">UNIT</p>
          <table class="c-tabel">
            ${baris("Merk / Tipe", t.tipeNama)}
            ${baris("No. Rangka", unit?.noRangka || "-")}
          </table>
        </div>
        <div class="c-kanan-kolom">
          <p class="c-sub">TAGIHAN</p>
          <table class="c-tabel">
            ${baris("Harga OTR", rupiah(t.hargaOtr))}
            ${baris("DP diterima showroom", rupiah(totalDibayar))}
            ${baris("Ditagihkan ke leasing", rupiah(tagihan))}
          </table>
        </div>
      </section>
      <p class="c-kaki">${aman(SHOWROOM.nama)} · Dibuat oleh ${aman(namaSalesTampil)}</p>
    </div>`);
  }

  tabBaru.document.body.innerHTML = potongan.join("") +
    `<div class="aksi-cetak"><button type="button" onclick="window.print()">
      Cetak / Simpan PDF (${daftar.length} lembar)</button></div>`;
}

// ── Kuitansi Revisi ────────────────────────────────────────────
// Dicetak otomatis saat Owner mengoreksi DP setelah kuitansi asli
// sudah pernah dicetak (lewat form Ubah SPK). SENGAJA dokumen
// TERPISAH dari kuitansi asli — bukan menimpanya — supaya kuitansi
// yang sudah di tangan konsumen tetap sah sebagai riwayat, dan
// jelas terlihat kapan/kenapa/oleh siapa dikoreksi.
export async function cetakKuitansiRevisi(t, revisi) {
  const tabBaru = window.open("", "_blank");
  if (!tabBaru) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  tabBaru.document.write(`<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>Kuitansi Revisi — ${aman(revisi.nomorRevisi)}</title>
    <style>${CSS_KUITANSI}</style></head>
    <body><p style="text-align:center;color:#777">Menyiapkan lembar cetak…</p></body></html>`);
  tabBaru.document.close();

  const selisih = revisi.keJumlah - revisi.dariJumlah;
  const isi = `<div class="k-kuitansi">
    <div class="k-atas">
      <div class="k-kop">
        <img class="k-kop-logo" src="${location.origin}/logo.png" alt="">
        <div><p class="k-pt">${aman(SHOWROOM.nama)}</p></div>
      </div>
      <table class="k-jenis-tabel">
        <tr><td>KETERANGAN</td><td>Revisi Kuitansi</td></tr>
      </table>
    </div>

    <h2 class="k-judul">KUITANSI REVISI</h2>
    <p class="k-nomor-tgl">No: ${aman(revisi.nomorRevisi)} &nbsp;·&nbsp; ${tanggal(revisi.pada)}</p>

    <p class="k-kecil" style="margin-top:10px">
      Merevisi kuitansi asli No. <b>${aman(t.kuitansiNo || "-")}</b>
      SPK <b>${aman(t.spkNo)}</b> — ${aman(t.pembeli?.nama || "-")}.
      Kuitansi asli TETAP SAH sebagai riwayat, dokumen ini adalah
      koreksi resmi atas jumlah yang tercatat.</p>

    <div class="k-grid2" style="margin-top:14px">
      <div>
        <p class="k-jumlah-label">Jumlah semula (kuitansi asli)</p>
        <p class="k-kalimat-isi">${rupiah(revisi.dariJumlah)}</p>

        <p class="k-jumlah-label" style="margin-top:9px">Dikoreksi menjadi</p>
        <p class="k-jumlah-besar">${rupiah(revisi.keJumlah)}</p>
        <p class="k-terbilang-kotak">${aman(terbilang(revisi.keJumlah))}</p>

        <p class="k-kecil" style="margin-top:6px">
          Selisih: <b>${selisih >= 0 ? "+" : ""}${rupiah(selisih)}</b></p>
      </div>
      <div>
        <p class="k-jumlah-label">Alasan Koreksi</p>
        <p class="k-kalimat-isi">${aman(revisi.alasan)}</p>
        <p class="k-jumlah-label" style="margin-top:9px">Dikoreksi Oleh</p>
        <p class="k-kalimat-isi">${aman(revisi.olehNama)}</p>
      </div>
    </div>

    <section class="k-ttd">
      <div><span class="k-garis"></span>Tanda Tangan &amp; Nama Jelas
        <br><span class="k-kecil">Konsumen</span></div>
      <div><span class="k-garis"></span>Tanda Tangan, Nama Jelas &amp; Cap
        <br><span class="k-kecil">${aman(SHOWROOM.nama)}</span></div>
    </section>
    <p class="k-kaki">Dokumen koreksi resmi — bukan pengganti kuitansi asli.</p>
  </div>

  <div class="aksi-cetak">
    <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>`;

  tabBaru.document.body.innerHTML = isi;
}

// ── Catat Pembayaran & Cetak Kuitansi ───────────────────────────
// Satu SPK bisa dibayar bertahap: DP dulu, lalu cicilan/pelunasan
// menyusul — tiap pembayaran dapat kuitansi & nomor sendiri, bukan
// cetak ulang yang sama. Cuma PEMBAYARAN PERTAMA yang mengunci data
// pembeli/pemakai/unit (wajib password) — sesudah itu, tambah
// pembayaran tidak perlu password lagi, tinggal catat & cetak.
// Kunci anti-klik-ganda untuk "Terima Pembayaran" (lihat pemakaiannya
// di dalam mintaCetakKuitansi) — modul-level supaya bertahan lintas
// pemanggilan, isinya id SPK yang pembayarannya sedang diproses.
const sedangMemprosesPembayaran = new Set();

export async function mintaCetakKuitansi(t, muatUlang) {
  if (!t) return;

  // ── Sudah lunas: tidak ada lagi yang bisa dicatat, cuma cetak
  // ulang kuitansi TERAKHIR. Sekalian pastikan unitnya (kalau ada)
  // sudah Terjual — untuk SPK yang lunas sebelum langkah otomatis
  // ini dibuatkan, unitnya bisa saja masih nyangkut di Dipesan.
  if (t.kuitansiTercetak && sudahLunas(t)) {
    if (t.unitId) {
      try {
        await updateDoc(doc(dbase, "units", t.unitId), { status: "terjual" });
      } catch { /* tidak fatal, lanjut cetak walau ini gagal */ }
    }
    const riwayat = Array.isArray(t.riwayatBayar) ? t.riwayatBayar : [];
    const terakhir = riwayat.length ? riwayat[riwayat.length - 1] : {
      kuitansiNo: t.kuitansiNo, kodeAman: t.kuitansiKode,
      jumlah: t.jumlahBayar || 0, sumber: "konsumen",
      sumberNama: t.pembeli?.nama || "-", keterangan: "Lunas",
      tanggal: t.dibuatPada,
    };
    try {
      await setDoc(doc(dbase, "kuitansi_publik", terakhir.kodeAman),
        dataKuitansiPublik(t, terakhir, hitungTotalDibayar(t)));
    } catch (err) {
      kabar("Peringatan: gagal menyinkronkan QR validasi (" +
            err.message + ").", "rem");
    }
    await cetakKuitansi(t, terakhir, hitungTotalDibayar(t));
    return;
  }

  // ── SPK lama yang sudah terkunci TAPI belum punya riwayatBayar
  // (dicetak sebelum fitur cicilan ini ada) — jadikan data lama
  // sebagai pembayaran pertama, baru lanjut ke alur normal.
  let tKerja = t;
  if (t.kuitansiTercetak && !Array.isArray(t.riwayatBayar)) {
    const kodeAman = t.kuitansiKode || (t.kuitansiNo ? t.kuitansiNo.replace(/\//g, "-") : "");
    const entriPertama = {
      kuitansiNo: t.kuitansiNo, kodeAman,
      jumlah: t.jumlahBayar || 0, sumber: "konsumen",
      sumberNama: t.pembeli?.nama || "-",
      keterangan: sudahLunas(t) ? "Lunas" : "DP",
      tanggal: t.dibuatPada || new Date(),
    };
    try {
      await updateDoc(doc(dbase, "transaksi", t.id), {
        riwayatBayar: [entriPertama],
        totalDibayar: entriPertama.jumlah,
        statusBayar: sudahLunas(t) ? "lunas" : "dp",
        kuitansiKode: kodeAman,
      });
    } catch { /* tetap lanjut walau pembetulan gagal ditulis */ }
    tKerja = {
      ...t, riwayatBayar: [entriPertama], totalDibayar: entriPertama.jumlah,
      statusBayar: sudahLunas(t) ? "lunas" : "dp", kuitansiKode: kodeAman,
    };
  }

  // ── Belum pernah dicetak SAMA SEKALI: ini pembayaran PERTAMA,
  // wajib tinjau ulang + password (mengunci identitas & unit).
  if (!tKerja.kuitansiTercetak) {
    const lanjut = await konfirmasi({
      judul: "Tinjau ulang sebelum mencetak kuitansi",
      pesan: "Setelah kuitansi ini dicetak, data kendaraan, identitas " +
             "pembeli, dan nama pemakai (STNK) pada SPK ini TIDAK BISA " +
             "diubah lagi lewat sistem. Pastikan semuanya sudah benar. " +
             "Lanjutkan cetak kuitansi?",
      oke: "Ya, Lanjutkan", bahaya: true,
    });
    if (!lanjut) return;

    const password = await tanya({
      judul: "Konfirmasi password",
      pesan: "Masukkan password Anda untuk mengunci & mencetak kuitansi " +
             `SPK ${tKerja.spkNo}.`,
      petunjuk: "Password",
      tipeIsian: "password",
    });
    if (password === null) return;

    try {
      await konfirmasiPassword(password);
    } catch {
      kabar("Password salah. Kuitansi dibatalkan.", "rem");
      return;
    }

    try {
      const kuitansiNo = await nomorBerikutnya("kuitansi", "KWT");
      const kodeAman = kuitansiNo.replace(/\//g, "-");
      const jumlah = tKerja.jumlahBayar || 0;
      const lunasSekarang = hargaEfektif(tKerja) > 0 && jumlah >= hargaEfektif(tKerja);
      const entri = {
        kuitansiNo, kodeAman, jumlah, sumber: "konsumen",
        sumberNama: tKerja.pembeli?.nama || "-",
        keterangan: lunasSekarang ? "Lunas" : "DP",
        tanggal: new Date(),
      };

      await updateDoc(doc(dbase, "transaksi", t.id), {
        kuitansiTercetak: true, kuitansiNo, kuitansiKode: kodeAman,
        kuitansiTercetakPada: serverTimestamp(),
        riwayatBayar: [entri], totalDibayar: jumlah,
        statusBayar: lunasSekarang ? "lunas" : "dp",
      });
      // Begitu lunas & unitnya nyata (bukan Indent), pindahkan status
      // Data Unit dari Dipesan → Terjual. Kalau masih DP, unit tetap
      // Dipesan (belum terjual sungguhan).
      if (lunasSekarang && tKerja.unitId) {
        try {
          await updateDoc(doc(dbase, "units", tKerja.unitId), { status: "terjual" });
        } catch { /* jangan sampai gagal di sini menghentikan kuitansi */ }
      }
      await setDoc(doc(dbase, "kuitansi_publik", kodeAman),
        dataKuitansiPublik(tKerja, entri, jumlah));
      await catat("kuitansi_dicetak", {
        koleksi: "transaksi", docId: t.id, ringkas: `${tKerja.spkNo} · ${kuitansiNo}`,
      });
      kabar(`Kuitansi ${kuitansiNo} tercetak & data SPK ini terkunci.`, "netral");
      await buatNotifikasi(tKerja.salesUid, "Pembayaran Tercatat",
        `${entri.keterangan} ${rupiah(jumlah)} untuk ${tKerja.pembeli?.nama || "-"} ` +
        `(SPK ${tKerja.spkNo}) sudah dicatat.` +
        (lunasSekarang ? " Unit sekarang berstatus LUNAS/Terjual." : ""),
        "#/laporan");
      await cetakKuitansi(
        { ...tKerja, riwayatBayar: [entri], totalDibayar: jumlah }, entri, jumlah);
      if (muatUlang) await muatUlang();
    } catch (err) {
      kabar("Gagal mencetak kuitansi: " + err.message, "rem");
    }
    return;
  }

  // ── Sudah terkunci, BELUM lunas: catat pembayaran BERIKUTNYA
  // (cicilan/pelunasan) — tidak perlu password lagi, TAPI tetap
  // wajib ada langkah tinjau ulang (sebelumnya TIDAK ADA sama
  // sekali di sini — beda dari pembayaran pertama yang sudah punya
  // konfirmasi. Ini titik yang menyebabkan kasus SPK yang tercatat
  // pembayaran sama persis dua kali tanpa ada yang sempat sadar).
  // Field diisi OTOMATIS dengan Sisa Tagihan yang benar (bukan
  // kosong) — supaya jalur paling gampang (klik OK begitu saja)
  // adalah jalur yang BENAR (Pelunasan penuh). Showroom cuma pernah
  // terima DP dan Pelunasan (tidak ada "cicilan" bertahap ke
  // showroom — lihat labelPembayaranBelumLunas) — jadi kalau
  // seseorang sengaja MENGUBAH angka ini jadi bukan pelunasan penuh,
  // itu kejadian tidak biasa dan wajib alasan tambahan.
  const totalSaatIni = hitungTotalDibayar(tKerja);
  const sisaSebelum = hargaEfektif(tKerja) - totalSaatIni;
  const isian = await tanya({
    judul: "Catat Pembayaran (Pelunasan)",
    pesan: `Sisa tagihan SPK ${tKerja.spkNo}: ${rupiah(sisaSebelum)}. Field di ` +
           `bawah sudah otomatis diisi sesuai Pelunasan penuh — cukup klik ` +
           `OK kalau memang segini yang diterima. Showroom cuma pernah ` +
           `menerima DP dan Pelunasan (tidak ada pembayaran bertahap lain) — ` +
           `kalau angkanya perlu diubah jadi BUKAN pelunasan penuh, sistem ` +
           `akan minta alasan tambahan.`,
    nilai: String(Math.max(sisaSebelum, 0)),
    tipeIsian: "number",
  });
  if (isian === null) return;
  const jumlahBaru = Number(String(isian).replace(/\D/g, "")) || 0;
  if (jumlahBaru <= 0) {
    kabar("Jumlah harus lebih dari 0.", "rem");
    return;
  }

  // Kalau BUKAN pelunasan penuh persis sesuai sisa tagihan (baik
  // kurang maupun lebih), ini kejadian tidak biasa — wajib alasan
  // eksplisit, supaya tidak ada lagi angka "asal ketik" tanpa jejak
  // kenapa itu diketik.
  let alasanBeda = "";
  if (jumlahBaru !== Math.max(sisaSebelum, 0)) {
    alasanBeda = await tanya({
      judul: "⚠️ Bukan Pelunasan Penuh — Alasan?",
      pesan: `Sisa tagihan seharusnya ${rupiah(sisaSebelum)}, tapi yang ` +
             `dicatat ${rupiah(jumlahBaru)}. Jelaskan alasannya (wajib, akan ` +
             `tercatat di log) — mis. pembayaran sebagian, ada kelebihan ` +
             `bayar, dsb.`,
      petunjuk: "mis. Konsumen baru bayar sebagian, sisanya menyusul",
    });
    if (alasanBeda === null) return;
    if (!alasanBeda.trim()) {
      kabar("Alasan wajib diisi kalau jumlahnya bukan pelunasan penuh.", "rem");
      return;
    }
  }

  // Deteksi kemungkinan input dobel — jumlah PERSIS sama dengan
  // pembayaran TERAKHIR yang tercatat untuk SPK ini. Bukan berarti
  // otomatis salah (bisa saja kebetulan/memang cicilan tetap tiap
  // bulan), makanya tidak diblokir — tapi wajib disadari & dikonfirmasi
  // secara eksplisit, bukan lewat begitu saja tanpa jeda.
  const riwayatSaatIni = Array.isArray(tKerja.riwayatBayar) ? tKerja.riwayatBayar : [];
  const entriTerakhir = riwayatSaatIni.length ? riwayatSaatIni[riwayatSaatIni.length - 1] : null;
  const kemungkinanDobel = entriTerakhir && entriTerakhir.jumlah === jumlahBaru;

  const sisaSetelah = Math.max(sisaSebelum - jumlahBaru, 0);
  const lanjutBayar = await konfirmasi({
    judul: kemungkinanDobel ? "⚠️ Jumlah Sama Seperti Pembayaran Terakhir" : "Konfirmasi Pembayaran",
    pesan: (kemungkinanDobel
      ? `PERHATIAN: pembayaran TERAKHIR yang tercatat untuk SPK ini juga ` +
        `persis ${rupiah(entriTerakhir.jumlah)} (${aman(entriTerakhir.keterangan)}, ` +
        `${tanggal(entriTerakhir.tanggal)}). Pastikan ini BUKAN pengulangan/salah ` +
        `input dari yang sebelumnya. `
      : "") +
      `SPK ${tKerja.spkNo} — pembeli ${aman(tKerja.pembeli?.nama || "-")}. ` +
      `Akan dicatat: ${rupiah(jumlahBaru)}. Sisa tagihan setelah ini: ${rupiah(sisaSetelah)}.`,
    oke: kemungkinanDobel ? "Ya, Ini Memang Benar" : "Ya, Catat Pembayaran",
    bahaya: !!kemungkinanDobel,
  });
  if (!lanjutBayar) return;

  // Kunci sederhana anti-klik-ganda — tombol "Terima Pembayaran"
  // bisa saja diklik dua kali cepat (jaringan lambat, atau tidak
  // sadar sudah tersubmit) sebelum baris di tabel sempat dimuat
  // ulang dan tombolnya berubah. Selama masih diproses untuk SPK
  // yang sama, permintaan berikutnya ditolak halus.
  if (sedangMemprosesPembayaran.has(t.id)) {
    kabar("Pembayaran untuk SPK ini sedang diproses, tunggu sebentar…", "rem");
    return;
  }
  sedangMemprosesPembayaran.add(t.id);

  try {
    const kuitansiNo = await nomorBerikutnya("kuitansi", "KWT");
    const kodeAman = kuitansiNo.replace(/\//g, "-");
    const { sumber, sumberNama } = await tentukanSumber(tKerja);
    const totalBaru = totalSaatIni + jumlahBaru;
    const lunasBaru = hargaEfektif(tKerja) > 0 && totalBaru >= hargaEfektif(tKerja);
    const entri = {
      kuitansiNo, kodeAman, jumlah: jumlahBaru, sumber, sumberNama,
      keterangan: lunasBaru ? "Pelunasan" : labelPembayaranBelumLunas(tKerja),
      tanggal: new Date(),
      ...(alasanBeda ? { catatanBedaPelunasan: alasanBeda.trim() } : {}),
    };
    const riwayatBaru = [...(tKerja.riwayatBayar || []), entri];

    await updateDoc(doc(dbase, "transaksi", t.id), {
      riwayatBayar: riwayatBaru, totalDibayar: totalBaru,
      statusBayar: lunasBaru ? "lunas" : "dp",
    });
    if (lunasBaru && tKerja.unitId) {
      try {
        await updateDoc(doc(dbase, "units", tKerja.unitId), { status: "terjual" });
      } catch { /* jangan sampai gagal di sini menghentikan kuitansi */ }
    }
    await setDoc(doc(dbase, "kuitansi_publik", kodeAman),
      dataKuitansiPublik(tKerja, entri, totalBaru));
    await catat("pembayaran_dicatat", {
      koleksi: "transaksi", docId: t.id,
      ringkas: `${tKerja.spkNo} · ${kuitansiNo} · ${rupiah(jumlahBaru)}` +
               (alasanBeda ? ` · BUKAN pelunasan penuh (seharusnya ${rupiah(sisaSebelum)}). ` +
                 `Alasan: ${alasanBeda.trim()}` : ""),
    });
    kabar(`Pembayaran ${rupiah(jumlahBaru)} tercatat (${kuitansiNo}).`, "netral");
    await buatNotifikasi(tKerja.salesUid, "Pembayaran Tercatat",
      `${entri.keterangan} ${rupiah(jumlahBaru)} untuk ${tKerja.pembeli?.nama || "-"} ` +
      `(SPK ${tKerja.spkNo}) sudah dicatat, diterima dari ${entri.sumberNama}.` +
      (lunasBaru ? " Unit sekarang berstatus LUNAS/Terjual." : ""),
      "#/laporan");
    await cetakKuitansi(
      { ...tKerja, riwayatBayar: riwayatBaru, totalDibayar: totalBaru },
      entri, totalBaru);
    if (muatUlang) await muatUlang();
  } catch (err) {
    kabar("Gagal mencatat pembayaran: " + err.message, "rem");
  } finally {
    sedangMemprosesPembayaran.delete(t.id);
  }
}

function satuKuitansi(t, unit, entri, totalSetelah, namaSalesTampil) {
  const urlValidasi = `${location.origin}${location.pathname}#/cek/${entri.kodeAman || ""}`;
  const qrSrc = "https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=" +
    encodeURIComponent(urlValidasi);
  const sisa = Math.max(hargaEfektif(t) - totalSetelah, 0);
  // Label "KETERANGAN" & kalimat "Untuk pembayaran" DIHITUNG ULANG
  // di sini (bukan trust entri.keterangan yang dibekukan saat
  // pembayaran itu dicatat dulu) — supaya kalau Diskon SPK berubah
  // BELAKANGAN (lewat form Ubah), cetak ulang kuitansi lama tetap
  // konsisten dengan status Lunas/Belum yang sebenarnya SEKARANG,
  // bukan menampilkan "Cicilan" di atas tapi "LUNAS" di bawah.
  const totalSebelumEntriIni = totalSetelah - (entri.jumlah || 0);
  const lunasSaatIni = sisa <= 0;
  const keteranganAktual = lunasSaatIni
    ? (totalSebelumEntriIni <= 0 ? "Lunas" : "Pelunasan")
    : (totalSebelumEntriIni <= 0 ? "DP" : labelPembayaranBelumLunas(t));

  const labelDiterima = entri.sumber === "leasing"
    ? `DIBAYAR OLEH (${aman(entri.sumberNama).toUpperCase()})`
    : "DIBAYAR OLEH (KONSUMEN)";
  // "Lunas" dibaca janggal dalam kalimat ("Untuk pembayaran: Lunas 1
  // unit...") — disebut "Pelunasan" di kalimat ini saja.
  const labelPembayaranKalimat = keteranganAktual === "Lunas" ? "Pelunasan" : keteranganAktual;
  const namaUnitLengkap = `${aman(t.tipeNama)} ${aman(t.warna)}`.trim();

  return `
    <div class="k-kuitansi">
      <div class="k-atas">
        <div class="k-kop">
          <img class="k-kop-logo" src="${location.origin}/logo.png" alt="">
          <div>
            <p class="k-pt">${aman(SHOWROOM.nama)}</p>
            <p class="k-kecil">${aman(SHOWROOM.alamat || "")}</p>
            <p class="k-kecil">${aman(SHOWROOM.telepon || "")}</p>
          </div>
        </div>
        <table class="k-jenis-tabel">
          <tr><td>KETERANGAN</td><td>${aman(keteranganAktual)}</td></tr>
        </table>
        <img class="k-qr" src="${qrSrc}" alt="QR validasi kuitansi">
      </div>

      <h2 class="k-judul">KUITANSI PEMBAYARAN</h2>
      <p class="k-nomor-tgl">No: ${aman(entri.kuitansiNo || "-")} &nbsp;·&nbsp;
        ${tanggal(entri.tanggal)}</p>

      <div class="k-grid2">
        <div>
          <p class="k-jumlah-label">Sudah terima dari</p>
          <p class="k-kalimat-isi">${aman(entri.sumberNama || "-")}</p>

          <p class="k-jumlah-label" style="margin-top:9px">Untuk pembayaran</p>
          <p class="k-kalimat-isi">${aman(labelPembayaranKalimat)} 1 (satu) unit
            ${namaUnitLengkap}${unit?.noRangka
              ? ` — No. Rangka ${aman(unit.noRangka)}` : ""}</p>

          <p class="k-jumlah-label" style="margin-top:9px">Uang sebanyak</p>
          <p class="k-jumlah-besar">${rupiah(entri.jumlah)}</p>
          <p class="k-terbilang-kotak">${aman(terbilang(entri.jumlah || 0))}</p>

          ${sisa > 0 ? `<p class="k-kecil" style="margin-top:6px">
            Sisa tagihan: <b>${rupiah(sisa)}</b></p>` : `<p class="k-kecil"
            style="margin-top:6px"><b>LUNAS</b></p>`}
        </div>
        <div>
          <p class="k-dk-judul">Data Kendaraan</p>
          <table class="k-tabel">
            <tr><td class="k-label">Unit</td><td class="k-isi">${aman(t.tipeNama)}</td></tr>
            <tr><td class="k-label">No. Rangka</td>
              <td class="k-isi">${aman(unit?.noRangka || "-")}</td></tr>
            <tr><td class="k-label">No. Mesin</td>
              <td class="k-isi">${aman(unit?.noMesin || "-")}</td></tr>
            <tr><td class="k-label">Tahun / Warna</td>
              <td class="k-isi">${aman(unit?.tahun || "-")} / ${aman(t.warna)}</td></tr>
            <tr><td class="k-label">Harga Unit</td>
              <td class="k-isi">${rupiah(t.hargaOtr)}</td></tr>
          </table>
        </div>
      </div>

      <div class="k-ttd">
        <div>
          ${labelDiterima}
          <span class="k-garis"></span>
          ( ${aman(entri.sumberNama || "").toUpperCase()} )
        </div>
        <div>
          DITERIMA OLEH — ${aman(SHOWROOM.nama).toUpperCase()} (TTD &amp; STEMPEL)
          <span class="k-garis"></span>
          ( ${aman(namaSalesTampil)} )
        </div>
      </div>

      <p class="k-kaki">
        <span>Terima kasih atas kepercayaan Anda kepada ${aman(SHOWROOM.nama)}.</span>
      </p>
    </div>`;
}

export async function cetakKuitansi(t, entri, totalSetelah) {
  if (!t || !entri) return;

  const tabBaru = window.open("", "_blank");
  if (!tabBaru) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  tabBaru.document.write(`<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>Kuitansi ${aman(entri.kuitansiNo || "")}</title>
    <style>${CSS_KUITANSI}</style></head>
    <body><p style="text-align:center;color:#777">Menyiapkan kuitansi…</p></body></html>`);
  tabBaru.document.close();

  let unit = null;
  if (t.unitId) {
    try {
      const snap = await getDoc(doc(dbase, "units", t.unitId));
      if (snap.exists()) unit = snap.data();
    } catch { /* unit tidak wajib ada */ }
  }
  const namaSalesTampil = await resolveNamaSales(t);

  // Cuma SATU lembar — kertas NCR yang dipakai sudah otomatis
  // menghasilkan salinan kedua (karbon bawaan kertas), jadi tidak
  // perlu lagi 3 salinan berlapis lewat sistem seperti sebelumnya.
  const isi = `<div class="k-lembar-luar">
    ${satuKuitansi(t, unit, entri, totalSetelah, namaSalesTampil)}
  </div>
  <div class="aksi-cetak">
    <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>`;

  tabBaru.document.body.innerHTML = isi;
}

// Cetak ULANG kuitansi TERAKHIR yang sudah tercetak — tanpa mencatat
// pembayaran baru sama sekali. Dipakai kalau kuitansi DP/cicilan
// sebelumnya perlu dicetak lagi (mis. hilang, atau printer sempat
// bermasalah), beda dari mintaCetakKuitansi yang selalu menawarkan
// mencatat pembayaran BARU untuk SPK yang belum lunas.
export async function cetakUlangKuitansiTerakhir(t) {
  if (!t || !t.kuitansiTercetak) {
    kabar("Belum ada kuitansi yang tercetak untuk SPK ini.", "rem");
    return;
  }
  const riwayat = Array.isArray(t.riwayatBayar) ? t.riwayatBayar : [];
  const terakhir = riwayat.length ? riwayat[riwayat.length - 1] : {
    // SPK lama yang dicetak sebelum fitur riwayatBayar ada.
    kuitansiNo: t.kuitansiNo,
    kodeAman: t.kuitansiKode || (t.kuitansiNo ? t.kuitansiNo.replace(/\//g, "-") : ""),
    jumlah: t.jumlahBayar || 0, sumber: "konsumen",
    sumberNama: t.pembeli?.nama || "-",
    keterangan: sudahLunas(t) ? "Lunas" : "DP",
    tanggal: t.dibuatPada || new Date(),
  };
  await cetakKuitansi(t, terakhir, hitungTotalDibayar(t));
}

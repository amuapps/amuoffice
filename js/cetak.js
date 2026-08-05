// cetak.js — lembar SPK siap cetak/PDF, mengikuti data yang benar-
// benar tersimpan di transaksi (bukan field lama yang sudah tidak
// dipakai seperti aksesoris/potongan/STNK/tanda jadi).
//
// Dibuka di TAB BARU sebagai dokumen HTML mandiri (bukan panel di
// dalam aplikasi) — supaya window.print() bawaan browser bisa
// langsung memakainya, dan tidak tersangkut di balik tata letak
// aplikasi utama (sidebar, tab, dsb).

import { dbase, doc, getDoc, setDoc, updateDoc, serverTimestamp, catat,
  nomorBerikutnya } from "./db.js";
import { SHOWROOM, SYARAT_SPK, MASA_BERLAKU_SPK } from "./config.js";
import { rupiah, terbilang, aman, tanggal } from "./ui.js";
import { rekeningDari, muatRekening } from "./rekening.js";
import { leasingDari, muatLeasing } from "./leasing.js";
import { konfirmasi, tanya } from "./dialog.js";
import { konfirmasiPassword } from "./auth.js";
import { kabar } from "./ui.js";

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
function sudahLunas(t) {
  const total = hitungTotalDibayar(t);
  return (t.hargaOtr || 0) > 0 && total >= (t.hargaOtr || 0);
}

// Label tombol yang konsisten di semua halaman (Riwayat SPK, Lihat
// Pesanan, layar konfirmasi SPK baru) — supaya jelas tahap mana
// yang sedang berlangsung tanpa perlu buka detailnya dulu.
export function labelTombolKuitansi(t) {
  if (!t.kuitansiTercetak) return "Catat Pembayaran & Cetak Kuitansi";
  return sudahLunas(t) ? "Cetak Ulang Kuitansi" : "Catat Pembayaran";
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
  const sisa = Math.max((t.hargaOtr || 0) - totalSetelah, 0);
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
async function resolveNamaSales(t) {
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
  }
`;

// ── Kuitansi: rangkap 3 dalam satu lembar HVS (disusun ke bawah,
// dipotong pakai gunting) — bukan landscape lagi, mengikuti contoh
// yang diberikan: krem-emas, QR code di kanan atas tiap lembar.
const CSS_KUITANSI = `
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 10mm; }
  body {
    margin: 0; padding: 16px; background: #ECECEC;
    font-family: "Segoe UI", Inter, system-ui, -apple-system, Roboto, sans-serif;
    color: #2b2210;
  }
  .k-lembar-luar { max-width: 780px; margin: 0 auto 16px; }
  .k-potong {
    display: flex; align-items: center; gap: 8px; margin: 4px 0;
    color: #9a9a9a; font-size: 9px; text-transform: uppercase;
    letter-spacing: .08em;
  }
  .k-potong::before, .k-potong::after {
    content: ""; flex: 1; border-top: 1px dashed #aaa;
  }
  .k-kuitansi {
    background: #FBF7EC; position: relative; overflow: hidden;
    border: 1.5px solid #C9A227; border-radius: 6px; padding: 14px 16px;
    font-size: 10px; line-height: 1.4;
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
  .k-kop-logo { width: 34px; height: 34px; object-fit: contain; flex: none; }
  .k-pt { font-size: 14px; font-weight: 800; margin: 0; letter-spacing: .01em; }
  .k-kecil { font-size: 8px; color: #6b5f3f; margin: 1px 0 0; max-width: 260px; }
  .k-jenis-tabel { font-size: 9px; text-align: right; }
  .k-jenis-tabel td:first-child { color: #6b5f3f; padding-right: 8px; }
  .k-jenis-tabel td:last-child { font-weight: 700; }
  .k-qr { width: 74px; height: 74px; margin-left: 10px; flex: none; }
  .k-judul { font-size: 15px; font-weight: 800; margin: 10px 0 2px;
    color: #2b2210; }
  .k-nomor-tgl { font-size: 9px; color: #6b5f3f; margin: 0 0 8px; }
  .k-jumlah-label { font-size: 9px; font-weight: 700; color: #6b5f3f;
    text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 0; }
  .k-jumlah-besar { font-size: 22px; font-weight: 800; color: #9C7A1E;
    margin: 1px 0 6px; }
  .k-terbilang-label { font-size: 9px; font-weight: 700; color: #6b5f3f;
    text-transform: uppercase; letter-spacing: .04em; margin: 4px 0 2px; }
  .k-terbilang-kotak { border-bottom: 1px dashed #b7a15c; padding: 3px 0 4px;
    font-style: italic; font-size: 10px; color: #4a3d17; }
  .k-grid2 { display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px;
    margin-top: 10px; }
  .k-dk-judul { font-size: 9px; font-weight: 700; color: #6b5f3f;
    text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; }
  .k-tabel { width: 100%; border-collapse: collapse; font-size: 9px; }
  .k-tabel td { padding: 1px 0; vertical-align: top; }
  .k-label { width: 34%; color: #6b5f3f; }
  .k-isi { font-weight: 600; }
  .k-ttd { display: flex; justify-content: space-between; margin-top: 16px;
    font-size: 8.5px; color: #6b5f3f; }
  .k-ttd > div { width: 46%; }
  .k-garis { display: block; border-top: 1px solid #7a6a35; margin: 26px 0 4px; }
  .k-kaki { font-size: 8px; color: #8a7c50; margin-top: 10px;
    display: flex; justify-content: space-between; }
  .aksi-cetak { max-width: 780px; margin: 0 auto; text-align: center; }
  .aksi-cetak button {
    padding: 10px 22px; border-radius: 8px; border: 0; cursor: pointer;
    background: #0067C0; color: #fff; font-size: 14px; font-weight: 600;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .aksi-cetak { display: none; }
    .k-potong { color: #ccc; }
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
          <tr><td>Dibayar sekarang</td>
              <td class="c-kanan">${rupiah(t.jumlahBayar)}</td></tr>
          ${t.jumlahTunai ? `<tr><td>&nbsp;&nbsp;— Tunai</td>
              <td class="c-kanan">${rupiah(t.jumlahTunai)}</td></tr>` : ""}
          ${t.jumlahTransfer ? `<tr><td>&nbsp;&nbsp;— Transfer</td>
              <td class="c-kanan">${rupiah(t.jumlahTransfer)}</td></tr>` : ""}
          ${kredit ? `
          <tr><td>Leasing</td>
              <td class="c-kanan">${aman(leasing?.nama || "-")}</td></tr>
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

    <p class="c-kaki">${aman(SHOWROOM.nama)} — dokumen ini diterbitkan
      oleh sistem dan sah tanpa tanda tangan basah pada salinan arsip.</p>
  </div>

  <div class="aksi-cetak">
    <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>`;

  // Timpa seluruh isi <body> tab barunya dengan lembar yang sudah jadi.
  tabBaru.document.body.innerHTML = isi;
}

// ── Catat Pembayaran & Cetak Kuitansi ───────────────────────────
// Satu SPK bisa dibayar bertahap: DP dulu, lalu cicilan/pelunasan
// menyusul — tiap pembayaran dapat kuitansi & nomor sendiri, bukan
// cetak ulang yang sama. Cuma PEMBAYARAN PERTAMA yang mengunci data
// pembeli/pemakai/unit (wajib password) — sesudah itu, tambah
// pembayaran tidak perlu password lagi, tinggal catat & cetak.
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
      const lunasSekarang = (tKerja.hargaOtr || 0) > 0 && jumlah >= (tKerja.hargaOtr || 0);
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
      await cetakKuitansi(
        { ...tKerja, riwayatBayar: [entri], totalDibayar: jumlah }, entri, jumlah);
      if (muatUlang) await muatUlang();
    } catch (err) {
      kabar("Gagal mencetak kuitansi: " + err.message, "rem");
    }
    return;
  }

  // ── Sudah terkunci, BELUM lunas: catat pembayaran BERIKUTNYA
  // (cicilan/pelunasan) — tidak perlu password lagi.
  const totalSaatIni = hitungTotalDibayar(tKerja);
  const sisaSebelum = (tKerja.hargaOtr || 0) - totalSaatIni;
  const isian = await tanya({
    judul: "Catat Pembayaran",
    pesan: `Sisa tagihan SPK ${tKerja.spkNo}: ${rupiah(sisaSebelum)}. ` +
           `Masukkan jumlah yang diterima sekarang (Rp).`,
    petunjuk: "Contoh: 20000000",
  });
  if (isian === null) return;
  const jumlahBaru = Number(String(isian).replace(/\D/g, "")) || 0;
  if (jumlahBaru <= 0) {
    kabar("Jumlah harus lebih dari 0.", "rem");
    return;
  }

  try {
    const kuitansiNo = await nomorBerikutnya("kuitansi", "KWT");
    const kodeAman = kuitansiNo.replace(/\//g, "-");
    const { sumber, sumberNama } = await tentukanSumber(tKerja);
    const totalBaru = totalSaatIni + jumlahBaru;
    const lunasBaru = (tKerja.hargaOtr || 0) > 0 && totalBaru >= (tKerja.hargaOtr || 0);
    const entri = {
      kuitansiNo, kodeAman, jumlah: jumlahBaru, sumber, sumberNama,
      keterangan: lunasBaru ? "Pelunasan" : "Cicilan",
      tanggal: new Date(),
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
      ringkas: `${tKerja.spkNo} · ${kuitansiNo} · ${rupiah(jumlahBaru)}`,
    });
    kabar(`Pembayaran ${rupiah(jumlahBaru)} tercatat (${kuitansiNo}).`, "netral");
    await cetakKuitansi(
      { ...tKerja, riwayatBayar: riwayatBaru, totalDibayar: totalBaru },
      entri, totalBaru);
    if (muatUlang) await muatUlang();
  } catch (err) {
    kabar("Gagal mencatat pembayaran: " + err.message, "rem");
  }
}

function satuKuitansi(t, unit, entri, totalSetelah, nomorLembar, labelLembar, namaSalesTampil) {
  const urlValidasi = `${location.origin}${location.pathname}#/cek/${entri.kodeAman || ""}`;
  const qrSrc = "https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=" +
    encodeURIComponent(urlValidasi);
  const sisa = Math.max((t.hargaOtr || 0) - totalSetelah, 0);
  const labelDiterima = entri.sumber === "leasing"
    ? `DIBAYAR OLEH (${aman(entri.sumberNama).toUpperCase()})`
    : "DIBAYAR OLEH (KONSUMEN)";

  return `
    ${nomorLembar > 1 ? `<div class="k-potong">GUNTING DI SINI</div>` : ""}
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
          <tr><td>KETERANGAN</td><td>${aman(entri.keterangan)}</td></tr>
        </table>
        <img class="k-qr" src="${qrSrc}" alt="QR validasi kuitansi">
      </div>

      <h2 class="k-judul">KUITANSI PEMBAYARAN</h2>
      <p class="k-nomor-tgl">No: ${aman(entri.kuitansiNo || "-")} &nbsp;·&nbsp;
        ${tanggal(entri.tanggal)}</p>

      <div class="k-grid2">
        <div>
          <p class="k-jumlah-label">Jumlah diterima</p>
          <p class="k-jumlah-besar">${rupiah(entri.jumlah)}</p>
          <p class="k-terbilang-label">Terbilang</p>
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
        <span>${aman(labelLembar)}</span>
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

  const label = ["LAMPIRAN 1 — KONSUMEN", "LAMPIRAN 2 — SHOWROOM",
    "LAMPIRAN 3 — CADANGAN"];

  const isi = `<div class="k-lembar-luar">
    ${label.map((l, i) =>
      satuKuitansi(t, unit, entri, totalSetelah, i + 1, l, namaSalesTampil)).join("")}
  </div>
  <div class="aksi-cetak">
    <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>`;

  tabBaru.document.body.innerHTML = isi;
}

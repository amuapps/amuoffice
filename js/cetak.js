// cetak.js — lembar SPK siap cetak/PDF, mengikuti data yang benar-
// benar tersimpan di transaksi (bukan field lama yang sudah tidak
// dipakai seperti aksesoris/potongan/STNK/tanda jadi).
//
// Dibuka di TAB BARU sebagai dokumen HTML mandiri (bukan panel di
// dalam aplikasi) — supaya window.print() bawaan browser bisa
// langsung memakainya, dan tidak tersangkut di balik tata letak
// aplikasi utama (sidebar, tab, dsb).

import { dbase, doc, getDoc } from "./db.js";
import { SHOWROOM, SYARAT_SPK, MASA_BERLAKU_SPK } from "./config.js";
import { rupiah, terbilang, aman, tanggal } from "./ui.js";
import { rekeningDari, muatRekening } from "./rekening.js";
import { leasingDari, muatLeasing } from "./leasing.js";

function baris(label, isi) {
  return `<tr><td class="c-label">${label}</td>
    <td class="c-titik">:</td><td class="c-isi">${aman(isi || "")}</td></tr>`;
}

const LABEL_CARA_BAYAR = { tunai: "Tunai", transfer: "Transfer", kredit: "Kredit" };

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
    opacity: .06; pointer-events: none; z-index: 0;
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
                                      .filter(Boolean).join(", "))}
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
          ${baris("Salesman", t.salesNama)}
        </table>
      </div>
    </section>

    <section class="c-ttd">
      <div><span class="c-garis"></span>Tanda Tangan &amp; Nama Jelas
        <br><span class="c-kecil">Pemesan</span></div>
      <div><span class="c-garis"></span>Tanda Tangan &amp; Nama Jelas
        <br><span class="c-kecil">Salesman</span></div>
      <div><span class="c-garis"></span>Tanda Tangan, Nama Jelas &amp; Cap
        <br><span class="c-kecil">Sales Manager</span></div>
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

// cetak.js — lembar SPK siap cetak/PDF, mengikuti data yang benar-
// benar tersimpan di transaksi (bukan field lama yang sudah tidak
// dipakai seperti aksesoris/potongan/STNK/tanda jadi).
//
// Dibuka di TAB BARU sebagai dokumen HTML mandiri (bukan panel di
// dalam aplikasi) — supaya window.print() bawaan browser bisa
// langsung memakainya, dan tidak tersangkut di balik tata letak
// aplikasi utama (sidebar, tab, dsb).

import { dbase, doc, getDoc, updateDoc, serverTimestamp, catat,
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

// Owner sering kepakai buat input SPK waktu belum ada sales yang
// menangani (mis. saat uji coba) — tampilkan "OWNER" di cetakan,
// bukan nama pribadinya, supaya tidak terkesan asal-asalan/kurang
// resmi di dokumen yang dipegang konsumen.
function namaSales(t) {
  return t.salesPeran === "owner" ? "OWNER" : (t.salesNama || "-");
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

// ── Kuitansi: rangkap 3 dalam satu lembar HVS landscape ─────────
const CSS_KUITANSI = `
  * { box-sizing: border-box; }
  @page { size: A4 landscape; margin: 8mm; }
  body {
    margin: 0; padding: 16px; background: #f3f3f3;
    font-family: "Segoe UI", Inter, system-ui, -apple-system, Roboto, sans-serif;
    color: #111;
  }
  .k-lembar-luar { max-width: 1150px; margin: 0 auto 16px; }
  .k-baris3 { display: flex; gap: 10px; }
  .k-kuitansi {
    flex: 1; min-width: 0; background: #fff; position: relative; overflow: hidden;
    border: 1px dashed #999; border-radius: 6px; padding: 12px;
    font-size: 9.5px; line-height: 1.35;
  }
  .k-kuitansi::before {
    content: ""; position: absolute; inset: 0;
    background-image: url("${WM_DATA_URI}");
    background-repeat: repeat; background-size: ${LEBAR_WM * 0.72}px ${TINGGI_WM * 0.72}px;
    background-position: center;
    opacity: .035; pointer-events: none; z-index: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .k-kuitansi > * { position: relative; z-index: 1; }
  .k-label-lembar {
    text-align: center; font-size: 8px; font-weight: 700; color: #888;
    text-transform: uppercase; letter-spacing: .06em; margin: 0 0 4px;
  }
  .k-kop { display: flex; align-items: center; gap: 8px;
    border-bottom: 1.5px solid #111; padding-bottom: 6px; margin-bottom: 6px; }
  .k-kop-logo { width: 28px; height: 28px; object-fit: contain; flex: none; }
  .k-pt { font-size: 11px; font-weight: 700; margin: 0; }
  .k-kecil { font-size: 8px; color: #555; margin: 1px 0 0; }
  .k-judul { text-align: center; font-size: 12px; font-weight: 700;
    margin: 4px 0; letter-spacing: .04em; }
  .k-nomor { display: flex; justify-content: space-between; font-size: 8.5px;
    color: #444; margin-bottom: 6px; }
  .k-tabel { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  .k-tabel td { padding: 1px 0; vertical-align: top; }
  .k-label { width: 38%; color: #444; }
  .k-titik { width: 8px; }
  .k-isi { border-bottom: 1px dotted #aaa; font-weight: 600; }
  .k-jumlah {
    border: 1px solid #111; border-radius: 4px; padding: 6px; margin: 6px 0;
    text-align: center;
  }
  .k-jumlah b { font-size: 13px; }
  .k-terbilang { font-style: italic; color: #444; text-align: center;
    font-size: 8.5px; margin: 0 0 6px; }
  .k-ttd { display: flex; justify-content: space-between; margin-top: 18px;
    font-size: 8px; text-align: center; color: #555; }
  .k-ttd > div { flex: 1; padding-top: 30px; position: relative; }
  .k-garis { position: absolute; left: 10%; right: 10%; top: 26px;
    border-top: 1px solid #111; }
  .aksi-cetak { max-width: 1150px; margin: 0 auto; text-align: center; }
  .aksi-cetak button {
    padding: 10px 22px; border-radius: 8px; border: 0; cursor: pointer;
    background: #0067C0; color: #fff; font-size: 14px; font-weight: 600;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .k-kuitansi { border: 1px dashed #999; }
    .aksi-cetak { display: none; }
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
          ${baris("Salesman", namaSales(t))}
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

// ── Cetak Kuitansi (rangkap 3) ───────────────────────────────────
// Mencetak kuitansi PERTAMA KALI mengunci data pembeli/pemakai/unit
// SPK ini — sesudah itu, pengajuan perubahan (spk.js) ditolak
// otomatis. Makanya wajib konfirmasi password dulu, dengan
// peringatan yang jelas, sebelum kuncinya benar-benar dipasang.
export async function mintaCetakKuitansi(t, muatUlang) {
  if (!t) return;

  // Sudah pernah dicetak sebelumnya → cetak ulang saja, tidak perlu
  // password lagi (kuncinya sudah terpasang sejak pertama kali).
  if (t.kuitansiTercetak) {
    await cetakKuitansi(t);
    return;
  }

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
           `SPK ${t.spkNo}.`,
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
    await updateDoc(doc(dbase, "transaksi", t.id), {
      kuitansiTercetak: true, kuitansiNo,
      kuitansiTercetakPada: serverTimestamp(),
    });
    await catat("kuitansi_dicetak", {
      koleksi: "transaksi", docId: t.id, ringkas: `${t.spkNo} · ${kuitansiNo}`,
    });
    kabar(`Kuitansi ${kuitansiNo} tercetak & data SPK ini terkunci.`, "netral");
    await cetakKuitansi({ ...t, kuitansiNo, kuitansiTercetak: true });
    if (muatUlang) await muatUlang();
  } catch (err) {
    kabar("Gagal mencetak kuitansi: " + err.message, "rem");
  }
}

function satuKuitansi(t, unit, rekening, leasing, labelLembar) {
  const kredit = (t.caraBayar || []).includes("kredit");
  return `<div class="k-kuitansi">
    <p class="k-label-lembar">${aman(labelLembar)}</p>
    <div class="k-kop">
      <img class="k-kop-logo" src="${location.origin}/logo.png" alt="">
      <div>
        <p class="k-pt">${aman(SHOWROOM.nama)}</p>
        <p class="k-kecil">${aman(SHOWROOM.alamat || "")}</p>
      </div>
    </div>
    <h2 class="k-judul">KUITANSI</h2>
    <div class="k-nomor">
      <span>No. ${aman(t.kuitansiNo || "-")}</span>
      <span>${tanggal(t.dibuatPada)}</span>
    </div>
    <table class="k-tabel">
      <tr><td class="k-label">Terima dari</td><td class="k-titik">:</td>
        <td class="k-isi">${aman(t.pembeli?.nama)}</td></tr>
      <tr><td class="k-label">Untuk</td><td class="k-titik">:</td>
        <td class="k-isi">${aman(t.tipeNama)} · ${aman(t.warna)}
          ${unit?.noRangka ? " · " + aman(unit.noRangka) : ""}</td></tr>
      <tr><td class="k-label">No. SPK</td><td class="k-titik">:</td>
        <td class="k-isi">${aman(t.spkNo)}</td></tr>
      <tr><td class="k-label">Cara bayar</td><td class="k-titik">:</td>
        <td class="k-isi">${aman((t.caraBayar || [])
          .map((c) => LABEL_CARA_BAYAR[c] || c).join(" + "))}</td></tr>
      ${kredit ? `<tr><td class="k-label">Leasing</td><td class="k-titik">:</td>
        <td class="k-isi">${aman(leasing?.nama || "-")}</td></tr>` : ""}
    </table>
    <div class="k-jumlah">
      <div style="font-size:8px;color:#666">Jumlah diterima</div>
      <b>${rupiah(t.jumlahBayar)}</b>
    </div>
    <p class="k-terbilang">${aman(terbilang(t.jumlahBayar || 0))}</p>
    ${rekening ? `<p class="k-kecil" style="text-align:center">
      Transfer: ${aman(rekening.bank)} ${aman(rekening.nomor)}
      a.n. ${aman(rekening.atasNama)}</p>` : ""}
    <div class="k-ttd">
      <div><span class="k-garis"></span>Pembeli</div>
      <div><span class="k-garis"></span>Diterima oleh<br>${aman(namaSales(t))}</div>
    </div>
  </div>`;
}

export async function cetakKuitansi(t) {
  if (!t) return;

  const tabBaru = window.open("", "_blank");
  if (!tabBaru) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  tabBaru.document.write(`<!DOCTYPE html><html lang="id"><head>
    <meta charset="utf-8"><title>Kuitansi ${aman(t.spkNo || "")}</title>
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
  await Promise.all([muatRekening(), muatLeasing()]);
  const rekening = t.rekeningId ? rekeningDari(t.rekeningId) : null;
  const leasing = t.kredit?.leasingId ? leasingDari(t.kredit.leasingId) : null;

  const label = ["LEMBAR 1 — UNTUK PEMBELI", "LEMBAR 2 — UNTUK KEUANGAN",
    "LEMBAR 3 — UNTUK ARSIP"];

  const isi = `<div class="k-lembar-luar">
    <div class="k-baris3">
      ${label.map((l) => satuKuitansi(t, unit, rekening, leasing, l)).join("")}
    </div>
  </div>
  <div class="aksi-cetak">
    <button type="button" onclick="window.print()">Cetak / Simpan PDF</button>
  </div>`;

  tabBaru.document.body.innerHTML = isi;
}

// cetak.js — lembar SPK siap cetak/PDF, mengikuti data yang benar-
// benar tersimpan di transaksi (bukan field lama yang sudah tidak
// dipakai seperti aksesoris/potongan/STNK/tanda jadi).
//
// Cara pakai: window.print() dari browser, lalu pilih "Simpan
// sebagai PDF" di kotak dialog cetaknya — tidak perlu library PDF
// terpisah, dan hasilnya konsisten dengan apa yang tampil di layar.

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

export async function cetakSpk(t) {
  if (!t) return;
  const wadah = document.getElementById("cetak-wadah");
  if (!wadah) return;

  wadah.innerHTML = `<div class="cetak-aksi">
    <p class="hampa">Menyiapkan lembar cetak…</p></div>`;
  wadah.hidden = false;
  wadah.scrollIntoView({ behavior: "smooth", block: "start" });

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

  wadah.innerHTML = `<div class="lembar-cetak" id="lembar-spk">

    <header class="c-kop">
      <div>
        <p class="c-pt">${aman(SHOWROOM.nama)}</p>
        <p class="c-kecil">${aman(SHOWROOM.alamat || "")}</p>
        <p class="c-kecil">${aman(SHOWROOM.telepon || "")}
          ${SHOWROOM.npwp ? " · NPWP " + aman(SHOWROOM.npwp) : ""}</p>
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
        ${baris("Alamat", [t.pembeli?.alamat, t.pembeli?.kecamatan,
                            t.pembeli?.kota].filter(Boolean).join(", "))}
        ${baris("Telp / HP", t.pembeli?.telepon)}
        ${baris("NIK", t.pembeli?.nik)}
      </table>
      <table class="c-tabel">
        ${pemakaiSama
          ? baris("Pemakai", "Sama dengan pembeli")
          : baris("Nama Pemakai", t.pemakai?.nama) +
            baris("Alamat Pemakai", [t.pemakai?.alamat, t.pemakai?.kecamatan,
                                      t.pemakai?.kota].filter(Boolean).join(", "))}
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

  <div class="aksi aksi--rapat cetak-aksi">
    <button class="tombol tombol--utama" id="cetak-sekarang">Cetak / Simpan PDF</button>
    <button class="tombol tombol--kecil" id="tutup-cetak">Tutup</button>
  </div>`;

  wadah.querySelector("#cetak-sekarang")
    .addEventListener("click", () => window.print());
  wadah.querySelector("#tutup-cetak").addEventListener("click", () => {
    wadah.innerHTML = "";
    wadah.hidden = true;
  });
}

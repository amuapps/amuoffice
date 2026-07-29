// cetak.js — lembar SPK siap cetak.
//
// Tata letaknya mengikuti formulir Surat Pesanan Kendaraan yang
// dipakai dealer Piaggio: keterangan unit di kiri, syarat dan
// ketentuan di kanan, tanda tangan tiga pihak di bawah, lalu
// potongan tanda terima uang jadi bernomor sama.

import { SHOWROOM, SYARAT_SPK, REKENING, MASA_BERLAKU_SPK }
  from "./config.js";
import { rupiah, terbilang, aman, tanggal } from "./ui.js";

function baris(label, isi) {
  return `<tr><td class="c-label">${label}</td>
    <td class="c-titik">:</td><td class="c-isi">${aman(isi || "")}</td></tr>`;
}

export function cetakSpk(t) {
  if (!t) return;
  const wadah = document.getElementById("cetak-wadah");
  if (!wadah) return;

  const aksesoris = (t.aksesoris || []).filter((a) => a.nama || a.harga);
  const potongan = (t.potongan || []).filter((p) => Number(p.nominal || 0) > 0);
  const kredit = t.metode === "kredit";

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
          ${baris("Nomor", t.kode)}
          ${baris("Tanggal", tanggal(t.dibuatPada))}
        </table>
      </div>
    </header>

    <h1 class="c-judul">Surat Pesanan Kendaraan</h1>

    <section class="c-dua">
      <table class="c-tabel">
        ${baris("Nama Pembeli", t.pelangganSnapshot?.nama)}
        ${baris("Alamat", t.pelangganSnapshot?.alamat)}
        ${baris("Telp / HP", t.pelangganSnapshot?.telepon)}
        ${baris("Alamat email", t.pelangganSnapshot?.email)}
        ${baris("NIK", t.pelangganSnapshot?.nik)}
      </table>
      <table class="c-tabel">
        ${baris("Faktur STNK a.n.", t.stnk?.nama)}
        ${baris("Alamat", t.stnk?.alamat)}
      </table>
    </section>

    <section class="c-badan">
      <div class="c-kiri">
        <p class="c-sub">KETERANGAN</p>
        <p class="c-unit">( ${aman(terbilang(t.jumlah || 1)
          .replace(" rupiah", "").toLowerCase())} ) Unit Sepeda Motor</p>
        <table class="c-tabel">
          ${baris("Merk / Tipe", t.tipeSnapshot?.nama)}
          ${baris("Warna / Tahun",
                  `${t.warna || "-"} / ${t.tahun || "-"}`)}
        </table>

        <p class="c-sub2">Perlengkapan Tambahan (Aksesoris)</p>
        ${aksesoris.length
          ? `<table class="c-harga">${aksesoris.map((a) =>
              `<tr><td>${aman(a.nama)}</td>
                   <td class="c-kanan">${rupiah(a.harga)}</td></tr>`).join("")}
             </table>`
          : `<p class="c-kosong">—</p>`}

        ${potongan.length
          ? `<p class="c-sub2">Potongan</p>
             <table class="c-harga">${potongan.map((p) =>
              `<tr><td>${aman(p.keterangan || (p.jenis === "barang"
                 ? "Hadiah barang" : "Potongan"))}</td>
                   <td class="c-kanan">− ${rupiah(p.nominal)}</td></tr>`)
              .join("")}</table>`
          : ""}

        <table class="c-harga c-total">
          <tr><td><b>Total</b></td>
              <td class="c-kanan"><b>${rupiah(t.total || t.hargaNet)}</b></td></tr>
        </table>
        <p class="c-terbilang">${aman(t.terbilang || "")}</p>
        ${t.catatan ? `<p class="c-kecil">Catatan: ${aman(t.catatan)}</p>` : ""}
      </div>

      <div class="c-kanan-kolom">
        <p class="c-sub">SYARAT dan KETENTUAN</p>
        <ol class="c-syarat">
          ${SYARAT_SPK.map((s) => `<li>${aman(s)}</li>`).join("")}
        </ol>
        ${REKENING.length
          ? `<p class="c-kecil">${REKENING.map((r) =>
              `${aman(r.bank)} ${aman(r.cabang || "")} a.c ${aman(r.nomor)}
               a.n. ${aman(r.atasNama)}`).join("<br>")}</p>`
          : ""}
      </div>
    </section>

    <section class="c-badan">
      <div class="c-kiri">
        <p class="c-sub">CARA PEMBAYARAN</p>
        <table class="c-harga">
          <tr><td>${kredit ? "Kredit via" : "Tunai"}</td>
              <td class="c-kanan">${kredit
                ? aman(t.kredit?.leasing || "-") : ""}</td></tr>
          <tr><td>Harga</td>
              <td class="c-kanan">${rupiah(t.hargaOtr)}</td></tr>
          ${kredit
            ? `<tr><td>DP</td>
                   <td class="c-kanan">${rupiah(t.kredit?.dp)}</td></tr>` : ""}
          <tr><td>Penambahan BBN</td>
              <td class="c-kanan">${rupiah(t.tambahanBbn)}</td></tr>
          <tr><td>Ongkir</td>
              <td class="c-kanan">${rupiah(t.ongkir)}</td></tr>
          <tr><td><b>Total</b></td>
              <td class="c-kanan"><b>${rupiah(t.total || t.hargaNet)}</b></td></tr>
          ${kredit
            ? `<tr><td>Jangka waktu</td>
                   <td class="c-kanan">${aman(t.kredit?.tenor || 0)} bln</td></tr>
               <tr><td>Angsuran</td>
                   <td class="c-kanan">${rupiah(t.kredit?.angsuran)}</td></tr>`
            : ""}
        </table>
      </div>

      <div class="c-kanan-kolom">
        <table class="c-tabel">
          ${baris("Rencana Delivery", t.rencanaKirim
            ? tanggal(new Date(t.rencanaKirim)) : "")}
          ${baris("Pembelian", t.pengiriman === "off"
            ? "Off The Road" : "On The Road")}
          ${baris("Kota", t.kota)}
          ${baris("Salesman", t.salesNama)}
          ${baris("Kode Salesman", t.kodeSales)}
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

    <div class="c-gunting">
      <span>✂</span><span class="c-putus"></span>
    </div>

    <section class="c-tandajadi">
      <div class="c-tj-kop">
        <p class="c-sub">TANDA TERIMA UANG JADI PESANAN SEMENTARA</p>
        <p class="c-nomor-kecil">No. ${aman(t.kode)}</p>
      </div>
      <table class="c-tabel">
        ${baris("Telah terima dari", t.pelangganSnapshot?.nama)}
        ${baris("Sebesar", rupiah(t.tandaJadi || 0))}
        ${baris("Terbilang", terbilang(t.tandaJadi || 0))}
        ${baris("Tanggal", tanggal(t.dibuatPada))}
      </table>
      <p class="c-kecil">Sebagai pembayaran tanda jadi pemesanan kendaraan.</p>
      <section class="c-ttd">
        <div><span class="c-garis"></span>Tanda Tangan Wiraniaga</div>
        <div><span class="c-garis"></span>Tanda Tangan Pemesan</div>
      </section>
      <p class="c-kecil">Tanda terima sementara ini ditukar dengan
        kuitansi resmi paling lambat 3 hari. Pembayaran dianggap lunas
        bila dana sudah masuk ke rekening ${aman(SHOWROOM.nama)}.</p>
    </section>

    <p class="c-kaki">${aman(SHOWROOM.nama)} — dokumen ini diterbitkan
      oleh sistem dan sah tanpa tanda tangan basah pada salinan arsip.</p>
  </div>

  <div class="aksi aksi--rapat cetak-aksi">
    <button class="tombol tombol--utama" id="cetak-sekarang">Cetak</button>
    <button class="tombol tombol--kecil" id="tutup-cetak">Tutup</button>
  </div>`;

  wadah.hidden = false;
  wadah.querySelector("#cetak-sekarang")
    .addEventListener("click", () => window.print());
  wadah.querySelector("#tutup-cetak").addEventListener("click", () => {
    wadah.innerHTML = "";
    wadah.hidden = true;
  });
  wadah.scrollIntoView({ behavior: "smooth", block: "start" });
}

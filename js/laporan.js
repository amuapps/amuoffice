// laporan.js — daftar semua SPK (dengan hitungannya) dan ringkasan
// stok per rentang tanggal. Dari sini juga bisa cetak ulang SPK.

import { dbase, collection, getDocs, query, where, orderBy, limit, doc, getDoc }
  from "./db.js";
import { rupiah, aman, tanggal, namaTampilan } from "./ui.js";
import { cetakSpk, mintaCetakKuitansi, labelTombolKuitansi, sudahLunas,
  cetakUlangKuitansiTerakhir, hitungTotalDibayar, cetakTagihanLeasing } from "./cetak.js";
import { pasangEditPelangganSpk, mintaBatalkanSpk } from "./spk.js";
import { bolehAkses, sesi } from "./auth.js";
import { muatLeasing, leasingDari } from "./leasing.js";
import { muatRekening, rekeningDari } from "./rekening.js";

const LABEL_CARA_BAYAR = { tunai: "Tunai", transfer: "Transfer", kredit: "Kredit" };

const LABEL_KONDISI = { ready: "Dipesan (unit terkunci)", indent: "Indent" };

function badgeCaraBayar(t) {
  const kredit = (t.caraBayar || []).includes("kredit");
  return kredit
    ? `<span class="tanda tanda--kredit">Kredit</span>`
    : `<span class="tanda tanda--cash">Cash</span>`;
}

function awalBulanIni() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hariIni() {
  return new Date().toISOString().slice(0, 10);
}

function baris(t) {
  const batal = t.status === "batal";
  const namaInput = t.dibuatOlehUid
    ? namaTampilan(t.dibuatOlehPeran, t.dibuatOlehNama)
    : namaTampilan(t.salesPeran, t.salesNama); // SPK lama tanpa jejak input
  const namaSales = namaTampilan(t.salesPeran, t.salesNama);
  return `<tr style="${batal ? "opacity:.55" : ""}">
    <td class="mono">${aman(t.spkNo)}
      ${bolehAkses("kelola.pengguna") ? `<br>
        <span class="kunci" style="font-family:inherit">input: ${aman(namaInput)}
          &nbsp;·&nbsp; sales: ${aman(namaSales)}</span>` : ""}
    </td>
    <td>${tanggal(t.dibuatPada)}</td>
    <td>${aman(t.pembeli?.nama)}</td>
    <td>${aman(t.tipeNama)} · ${aman(t.warna)}</td>
    <td>${rupiah(t.hargaOtr)}</td>
    <td>${batal ? "-" : badgeCaraBayar(t)}</td>
    <td>${batal
      ? `<span class="tanda tanda--batal">Batal</span>`
      : `<span class="tanda ${t.kondisiUnit === "ready" ? "tanda--ready" : "tanda--uji"}">
          ${LABEL_KONDISI[t.kondisiUnit] || t.kondisiUnit}</span>`}</td>
    <td style="white-space:nowrap">
      ${batal ? aman(t.alasanBatal || "-") : `
        ${bolehAkses("cetak.dokumen") ? `
          <button class="tombol tombol--kecil" data-cetak="${t.id}">Cetak SPK</button>
          ${(t.caraBayar || []).includes("kredit") && t.kredit?.leasingId ? `
          <button class="tombol tombol--kecil" data-tagihan-leasing="${t.id}">
            Cetak Tagihan Leasing</button>` : ""}
          <button class="tombol tombol--kecil" data-kuitansi="${t.id}">
            ${labelTombolKuitansi(t)}</button>
          ${t.kuitansiTercetak && !sudahLunas(t) ? `<button class="tombol tombol--kecil"
            data-cetak-ulang="${t.id}">Cetak Ulang Kuitansi Terakhir</button>` : ""}` : ""}
        <button class="tombol tombol--kecil" data-ubah="${t.id}">Ubah</button>
        <button class="tombol tombol--kecil" data-batalkan="${t.id}">Batalkan</button>
        ${bolehAkses("kelola.pengguna") ? `<button class="tombol tombol--kecil"
          data-detail="${t.id}">Detail</button>` : ""}
      `}
    </td>
  </tr>
  <tr data-baris-edit="${t.id}" hidden>
    <td colspan="8"><div data-wadah-edit="${t.id}"></div></td>
  </tr>
  <tr data-baris-detail="${t.id}" hidden>
    <td colspan="8"><div data-wadah-detail="${t.id}" class="hampa">Memuat…</div></td>
  </tr>`;
}

// Detail lengkap SPK — cuma dimuat kalau tombol "Detail" diklik
// (bukan sekaligus semua baris), supaya tidak boros baca Firestore
// (unit & leasing) waktu tabel berisi banyak baris.
async function renderDetail(t) {
  let unit = null;
  if (t.unitId) {
    try {
      const snap = await getDoc(doc(dbase, "units", t.unitId));
      if (snap.exists()) unit = snap.data();
    } catch { /* unit tidak wajib ada, mis. Indent */ }
  }

  let leasingNama = "-";
  if (t.kredit?.leasingId) {
    await muatLeasing();
    const l = leasingDari(t.kredit.leasingId);
    leasingNama = l ? l.nama : "-";
  }
  let rekeningTampil = "-";
  if (t.rekeningId) {
    await muatRekening();
    const r = rekeningDari(t.rekeningId);
    rekeningTampil = r ? `${aman(r.bank)} ${aman(r.nomor)} a.n ${aman(r.atasNama)}` : "-";
  }

  const totalDibayar = hitungTotalDibayar(t);
  const sisa = Math.max((t.hargaOtr || 0) - totalDibayar, 0);
  const caraBayarTampil = (t.caraBayar || []).map((c) => LABEL_CARA_BAYAR[c] || c).join(", ") || "-";

  const baris2 = (label, isi) => `<div class="d-baris">
    <span class="d-label">${aman(label)}</span><span class="d-isi">${isi}</span></div>`;

  const riwayat = Array.isArray(t.riwayatBayar) ? t.riwayatBayar : [];

  return `<div class="d-panel">
    <div class="d-kolom">
      <p class="d-judul">Unit</p>
      ${baris2("No. Rangka", aman(unit?.noRangka || "-"))}
      ${baris2("No. Mesin", aman(unit?.noMesin || "-"))}
      ${baris2("Tahun", aman(unit?.tahun || "-"))}
      ${baris2("No. DO", aman(unit?.noDo || "-"))}
    </div>
    <div class="d-kolom">
      <p class="d-judul">Pembayaran</p>
      ${baris2("Cara bayar", caraBayarTampil)}
      ${baris2("Rekening tujuan", rekeningTampil)}
      ${baris2("Jumlah dibayar (awal)", rupiah(t.jumlahBayar || 0))}
      ${baris2("Total dibayar s/d ini", rupiah(totalDibayar))}
      ${baris2("Sisa tagihan", rupiah(sisa))}
      ${baris2("Status", sudahLunas(t) ? "Lunas" : (t.kuitansiTercetak ? "DP/Cicilan" : "Belum ada kuitansi"))}
    </div>
    ${t.kredit ? `<div class="d-kolom">
      <p class="d-judul">Status Kredit (Leasing)</p>
      ${baris2("Leasing", aman(leasingNama))}
      ${baris2("Tagihan ke leasing", rupiah(Math.max((t.hargaOtr || 0) - (t.jumlahBayar || 0), 0)))}
      ${baris2("Cicilan per bulan", rupiah(t.kredit.cicilan || 0))}
      ${baris2("Tenor", `${t.kredit.tenor || 0} bulan`)}
      ${baris2("Tanggal survey", t.kredit.tanggalSurvey ? tanggal(t.kredit.tanggalSurvey) : "-")}
    </div>` : ""}
    <div class="d-kolom">
      <p class="d-judul">Lainnya</p>
      ${baris2("Diskon", rupiah(t.diskon || 0))}
      ${baris2("Cashback", rupiah(t.cashback || 0))}
      ${baris2("Agen", aman(t.agenNama || "-"))}
      ${bolehAkses("kelola.pengguna") ? baris2("Fee Agen", rupiah(t.feeAgen || 0)) : ""}
      ${baris2("Catatan internal", aman(t.catatan || "-"))}
    </div>
    ${riwayat.length ? `<div class="d-kolom" style="flex-basis:100%">
      <p class="d-judul">Riwayat Pembayaran</p>
      ${riwayat.map((r) => baris2(
        `${aman(r.keterangan)} · ${r.tanggal ? tanggal(r.tanggal) : "-"}`,
        `${rupiah(r.jumlah)} (${aman(r.kuitansiNo || "-")}, dari ${aman(r.sumberNama || "-")})`
      )).join("")}
    </div>` : ""}
  </div>`;
}

export async function halamanLaporan(wadah) {
  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">Riwayat &amp; Laporan SPK</h2></div>

    <div class="dua">
      <div>
        <label class="label label--gelap" for="l-dari">Dari tanggal</label>
        <input class="isian isian--terang" id="l-dari" type="date"
               value="${awalBulanIni()}">
      </div>
      <div>
        <label class="label label--gelap" for="l-sampai">Sampai tanggal</label>
        <input class="isian isian--terang" id="l-sampai" type="date"
               value="${hariIni()}">
      </div>
    </div>
    <button class="tombol tombol--kecil tombol--isi" id="l-terapkan">Terapkan</button>

    <div id="l-ringkasan" class="tiga" style="margin-top:16px"></div>

    <div style="overflow-x:auto; margin-top:16px">
      <table class="tabel">
        <thead>
          <tr>
            <th>No. SPK</th><th>Tanggal</th><th>Pembeli</th><th>Unit</th>
            <th>Harga OTR</th><th>Cara Bayar</th><th>Kondisi</th><th></th>
          </tr>
        </thead>
        <tbody id="l-baris">
          <tr><td colspan="8" class="hampa">Memuat…</td></tr>
        </tbody>
      </table>
    </div>
  </section>`;

  const dariEl = wadah.querySelector("#l-dari");
  const sampaiEl = wadah.querySelector("#l-sampai");
  const ringkasanEl = wadah.querySelector("#l-ringkasan");
  const barisEl = wadah.querySelector("#l-baris");
  let dataSpk = [];

  function kartuRingkas(judul, angka, sub) {
    return `<article class="kartu">
      <p class="kartu-sub">${aman(judul)}</p>
      <p class="angka-besar">${angka}</p>
      ${sub ? `<p class="kartu-rinci">${aman(sub)}</p>` : ""}
    </article>`;
  }

  async function muat() {
    barisEl.innerHTML = `<tr><td colspan="8" class="hampa">Memuat…</td></tr>`;
    const dari = new Date(dariEl.value + "T00:00:00");
    const sampai = new Date(sampaiEl.value + "T23:59:59");
    const sales = sesi && sesi.peran === "sales";

    try {
      if (sales) {
        // Sales: cuma equality (salesUid), tanpa gabung rentang+urutan
        // tanggal — supaya TIDAK butuh index gabungan di Firestore.
        // Tanggalnya disaring & diurutkan di sini saja.
        const snap = await getDocs(query(
          collection(dbase, "transaksi"),
          where("salesUid", "==", sesi.uid),
          limit(500)
        ));
        dataSpk = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((t) => {
            const tgl = t.dibuatPada?.toDate ? t.dibuatPada.toDate() : null;
            return tgl && tgl >= dari && tgl <= sampai;
          })
          .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
      } else {
        const snap = await getDocs(query(
          collection(dbase, "transaksi"),
          where("dibuatPada", ">=", dari),
          where("dibuatPada", "<=", sampai),
          orderBy("dibuatPada", "desc"),
          limit(500)
        ));
        dataSpk = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
    } catch (err) {
      barisEl.innerHTML = `<tr><td colspan="8" class="hampa">
        Gagal memuat: ${aman(err.message)}</td></tr>`;
      return;
    }

    const totalNilai = dataSpk.reduce((s, t) => s + (t.hargaOtr || 0), 0);
    const jmlReady = dataSpk.filter((t) => t.kondisiUnit === "ready").length;
    const jmlIndent = dataSpk.filter((t) => t.kondisiUnit === "indent").length;

    ringkasanEl.innerHTML =
      kartuRingkas("Total SPK", dataSpk.length, rupiah(totalNilai) + " total nilai") +
      kartuRingkas("Unit terkunci (Dipesan)", jmlReady, "stok langsung tersedia") +
      kartuRingkas("Indent", jmlIndent, "menunggu unit tiba");

    barisEl.innerHTML = dataSpk.length
      ? dataSpk.map(baris).join("")
      : `<tr><td colspan="8" class="hampa">Tidak ada SPK di rentang ini.</td></tr>`;

    barisEl.querySelectorAll("[data-cetak]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.cetak);
        cetakSpk(t);
      }));
    barisEl.querySelectorAll("[data-tagihan-leasing]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.tagihanLeasing);
        cetakTagihanLeasing(t);
      }));
    barisEl.querySelectorAll("[data-kuitansi]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.kuitansi);
        mintaCetakKuitansi(t, muat);
      }));
    barisEl.querySelectorAll("[data-cetak-ulang]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.cetakUlang);
        cetakUlangKuitansiTerakhir(t);
      }));
    barisEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.ubah);
        const barisSembunyi = barisEl.querySelector(`[data-baris-edit="${t.id}"]`);
        const target = barisEl.querySelector(`[data-wadah-edit="${t.id}"]`);
        const sedangTerbuka = !barisSembunyi.hidden;
        if (sedangTerbuka) {
          barisSembunyi.hidden = true;
          target.innerHTML = "";
          return;
        }
        barisSembunyi.hidden = false;
        pasangEditPelangganSpk(target, t, muat);
      }));
    barisEl.querySelectorAll("[data-batalkan]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.batalkan);
        mintaBatalkanSpk(t, muat);
      }));
    barisEl.querySelectorAll("[data-detail]").forEach((b) =>
      b.addEventListener("click", async () => {
        const t = dataSpk.find((x) => x.id === b.dataset.detail);
        const barisSembunyi = barisEl.querySelector(`[data-baris-detail="${t.id}"]`);
        const target = barisEl.querySelector(`[data-wadah-detail="${t.id}"]`);
        const sedangTerbuka = !barisSembunyi.hidden;
        if (sedangTerbuka) {
          barisSembunyi.hidden = true;
          return;
        }
        barisSembunyi.hidden = false;
        if (!target.dataset.dimuat) {
          target.innerHTML = await renderDetail(t);
          target.dataset.dimuat = "1";
        }
      }));
  }

  wadah.querySelector("#l-terapkan").addEventListener("click", muat);
  await muat();
}

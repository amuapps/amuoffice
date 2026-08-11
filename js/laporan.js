// laporan.js — daftar semua SPK (dengan hitungannya) dan ringkasan
// stok per rentang tanggal. Dari sini juga bisa cetak ulang SPK.

import { dbase, collection, getDocs, query, where, orderBy, limit, doc, getDoc, updateDoc, catat }
  from "./db.js?v=3.4.3";
import { rupiah, aman, tanggal, namaTampilan } from "./ui.js?v=3.4.3";
import { cetakSpk, mintaCetakKuitansi, labelTombolKuitansi, sudahLunas,
  cetakUlangKuitansiTerakhir, hitungTotalDibayar, cetakTagihanLeasing,
  cetakTagihanLeasingBatch, unduhExcel, unduhPdf, hargaEfektif } from "./cetak.js?v=3.4.3";
import { pasangEditPelangganSpk, mintaBatalkanSpk } from "./spk.js?v=3.4.3";
import { bolehAkses, sesi } from "./auth.js?v=3.4.3";
import { muatLeasing, leasingDari } from "./leasing.js?v=3.4.3";
import { muatRekening, rekeningDari } from "./rekening.js?v=3.4.3";

const LABEL_CARA_BAYAR = { tunai: "Tunai", transfer: "Transfer", kredit: "Kredit" };
const BATAS_LAPORAN_DEFAULT = 500;

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
  const owner = sesi && sesi.peran === "owner";
  const admin = sesi && sesi.peran === "admin";
  const namaInput = t.dibuatOlehUid
    ? namaTampilan(t.dibuatOlehPeran, t.dibuatOlehNama)
    : namaTampilan(t.salesPeran, t.salesNama); // SPK lama tanpa jejak input
  const namaSales = namaTampilan(t.salesPeran, t.salesNama);
  const lunas = !batal && sudahLunas(t);
  const adaTagihanLeasing = (t.caraBayar || []).includes("kredit") && t.kredit?.leasingId;
  const adaUlangTerakhir = t.kuitansiTercetak && !lunas;
  return `<tr style="${batal ? "opacity:.55" : ""}">
    <td class="mono">${aman(t.spkNo)}
      ${owner ? `<br>
        <span class="kunci" style="font-family:inherit">input: ${aman(namaInput)}
          &nbsp;·&nbsp; sales: ${aman(namaSales)}</span>` : ""}
      ${admin && !owner ? `<br>
        <span class="kunci" style="font-family:inherit">sales: ${aman(namaSales)}</span>` : ""}
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
        ${!lunas ? `<button class="tombol tombol--kecil" data-kuitansi="${t.id}">
            ${labelTombolKuitansi(t)}</button>` : ""}
        ${bolehAkses("cetak.dokumen") ? `
          <select class="isian isian--kecil" style="width:auto;display:inline-block"
            data-cetak-menu="${t.id}">
            <option value="">Cetak ▾</option>
            <option value="spk">Cetak SPK</option>
            ${adaTagihanLeasing ? `<option value="tagihan">Cetak Tagihan Leasing</option>` : ""}
            ${adaUlangTerakhir ? `<option value="ulang-terakhir">
              Cetak Ulang Kuitansi Terakhir</option>` : ""}
            ${lunas ? `<option value="ulang-lunas">Cetak Ulang Kuitansi Lunas</option>` : ""}
          </select>` : ""}
        <button class="tombol tombol--kecil" data-ubah="${t.id}">Ubah</button>
        <button class="tombol tombol--kecil" data-batalkan="${t.id}">Batalkan</button>
        ${owner ? `<button class="tombol tombol--kecil"
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
  const sisa = Math.max(hargaEfektif(t) - totalDibayar, 0);
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
      ${baris2("Harga OTR", rupiah(t.hargaOtr || 0))}
      ${t.diskon ? baris2("Diskon", `− ${rupiah(t.diskon)}`) : ""}
      ${t.diskon ? baris2("Harga Efektif", rupiah(hargaEfektif(t))) : ""}
      ${baris2("Jumlah dibayar (awal)", rupiah(t.jumlahBayar || 0))}
      ${baris2("Total dibayar s/d ini", rupiah(totalDibayar))}
      ${baris2("Sisa tagihan", rupiah(sisa))}
      ${baris2("Status", sudahLunas(t) ? "Lunas" : (t.kuitansiTercetak ? "Belum Lunas" : "Belum ada kuitansi"))}
    </div>
    ${t.kredit ? `<div class="d-kolom">
      <p class="d-judul">Status Kredit (Leasing)</p>
      ${baris2("Leasing", aman(leasingNama))}
      ${baris2("Tagihan ke leasing", rupiah(Math.max(hargaEfektif(t) - (t.jumlahBayar || 0), 0)))}
      ${baris2("Cicilan per bulan", rupiah(t.kredit.cicilan || 0))}
      ${baris2("Tenor", `${t.kredit.tenor || 0} bulan`)}
      ${baris2("Tanggal survey", t.kredit.tanggalSurvey ? tanggal(t.kredit.tanggalSurvey) : "-")}
    </div>` : ""}
    <div class="d-kolom">
      <p class="d-judul">Lainnya</p>
      ${baris2("Diskon", rupiah(t.diskon || 0))}
      ${baris2("Cashback", t.cashbackStatus === "menunggu"
        ? `${rupiah(t.cashbackDiajukan || 0)} <span class="tanda tanda--uji" style="margin-left:4px">Menunggu</span>`
        : rupiah(t.cashbackDisetujui || 0))}
      ${t.cashbackDisetujui > 0 ? baris2("Status Bayar Cashback",
          t.cashbackDibayarStatus === "sudah_dibayar"
            ? `Sudah Dibayar (${aman(t.cashbackTanggalBayar || "-")})`
            : "Belum Dibayar") : ""}
      ${baris2("Agen", aman(t.agenNama || "-"))}
      ${bolehAkses("kelola.pengguna") ? baris2("Fee Agen", rupiah(t.feeAgen || 0)) : ""}
      ${baris2("Catatan internal", aman(t.catatan || "-"))}
    </div>
    ${bolehAkses("agen.lihat") && t.cashbackDisetujui > 0
        && t.cashbackDibayarStatus !== "sudah_dibayar" ? `<div class="d-kolom">
      <p class="d-judul">Tandai Cashback</p>
      <button class="tombol tombol--kecil" data-tandai-cashback="${t.id}">
        Tandai Sudah Dibayar</button>
      <div data-wadah-bayar-cashback="${t.id}"></div>
    </div>` : ""}
    ${riwayat.length ? `<div class="d-kolom" style="flex-basis:100%">
      <p class="d-judul">Riwayat Pembayaran</p>
      ${riwayat.map((r) => baris2(
        `${aman(r.keterangan)} · ${r.tanggal ? tanggal(r.tanggal) : "-"}`,
        `${rupiah(r.jumlah)} (${aman(r.kuitansiNo || "-")}, dari ${aman(r.sumberNama || "-")})`
      )).join("")}
    </div>` : ""}
  </div>`;
}

// Form "Tandai Cashback Sudah Dibayar" — polanya sama persis dengan
// Bayar Fee Agen (tanggal, via bank, catatan) supaya konsisten.
function formBayarCashback(id) {
  return `<form id="form-bayar-cb-${id}" class="form" style="margin-top:8px">
    <label class="label label--gelap" for="bc-tanggal-${id}">Tanggal dibayar</label>
    <input class="isian isian--terang" id="bc-tanggal-${id}" type="date"
           value="${new Date().toISOString().slice(0, 10)}">
    <label class="label label--gelap" for="bc-bank-${id}">Via Bank</label>
    <input class="isian isian--terang" id="bc-bank-${id}" placeholder="mis. Transfer BCA">
    <label class="label label--gelap" for="bc-catatan-${id}">Catatan (opsional)</label>
    <input class="isian isian--terang" id="bc-catatan-${id}" placeholder="No. referensi transfer, dsb.">
    <div class="aksi">
      <button class="tombol tombol--kecil tombol--isi" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-bayar-cb-${id}">Batal</button>
    </div>
  </form>`;
}

function pasangWiringCashback(target, t, muatUlangDetail) {
  const tombolTandai = target.querySelector(`[data-tandai-cashback="${t.id}"]`);
  if (!tombolTandai) return;
  const wadahForm = target.querySelector(`[data-wadah-bayar-cashback="${t.id}"]`);
  tombolTandai.addEventListener("click", () => {
    wadahForm.innerHTML = formBayarCashback(t.id);
    wadahForm.querySelector(`#batal-bayar-cb-${t.id}`)
      .addEventListener("click", () => (wadahForm.innerHTML = ""));
    wadahForm.querySelector(`#form-bayar-cb-${t.id}`).addEventListener("submit", async (e) => {
      e.preventDefault();
      const tgl = wadahForm.querySelector(`#bc-tanggal-${t.id}`).value;
      const bank = wadahForm.querySelector(`#bc-bank-${t.id}`).value.trim();
      const catatan = wadahForm.querySelector(`#bc-catatan-${t.id}`).value.trim();
      if (!tgl || !bank) {
        kabar("Tanggal dan Bank wajib diisi.", "rem");
        return;
      }
      try {
        await updateDoc(doc(dbase, "transaksi", t.id), {
          cashbackDibayarStatus: "sudah_dibayar",
          cashbackTanggalBayar: tgl,
          cashbackBank: bank,
          cashbackCatatan: catatan,
        });
        await catat("cashback_dibayar", {
          koleksi: "transaksi", docId: t.id, ringkas: `${bank} · ${tgl}`,
        });
        kabar("Cashback ditandai sudah dibayar.", "netral");
        await muatUlangDetail();
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
  });
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
    <div class="aksi aksi--rapat" style="margin-top:8px">
      <button class="tombol tombol--kecil tombol--isi" id="l-terapkan">Terapkan</button>
      <button class="tombol tombol--kecil" id="l-toggle-filter">Filter ▾</button>
      <button class="tombol tombol--kecil" id="l-unduh-excel">Unduh Excel</button>
      <button class="tombol tombol--kecil" id="l-unduh-pdf">Unduh PDF</button>
    </div>

    <div id="l-panel-filter" class="lembar" style="margin-top:10px" hidden>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="l-f-carabayar">Cara Bayar</label>
          <select class="isian isian--terang" id="l-f-carabayar">
            <option value="">— semua —</option>
            <option value="cash">Cash</option>
            <option value="kredit">Kredit</option>
          </select>
        </div>
        <div>
          <label class="label label--gelap" for="l-f-status">Status Bayar</label>
          <select class="isian isian--terang" id="l-f-status">
            <option value="">— semua —</option>
            <option value="lunas">Lunas</option>
            <option value="belum">Belum Lunas</option>
            <option value="batal">Batal</option>
          </select>
        </div>
      </div>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="l-f-leasing">Leasing</label>
          <select class="isian isian--terang" id="l-f-leasing">
            <option value="">— semua —</option>
          </select>
        </div>
        <div id="l-wadah-f-sales">
          <label class="label label--gelap" for="l-f-sales">Sales</label>
          <select class="isian isian--terang" id="l-f-sales">
            <option value="">— semua —</option>
          </select>
        </div>
      </div>
      <label class="label label--gelap" for="l-f-nama">Nama Konsumen</label>
      <input class="isian isian--terang" id="l-f-nama" placeholder="Cari nama…">
      <div class="aksi aksi--rapat" style="margin-top:8px">
        <button class="tombol tombol--kecil tombol--isi" id="l-f-terapkan">Terapkan Filter</button>
        <button class="tombol tombol--kecil" id="l-f-reset">Reset</button>
      </div>
      <div id="l-f-tagihan-massal" style="margin-top:8px" hidden>
        <button class="tombol tombol--kecil" id="l-cetak-tagihan-massal">
          Cetak Semua Tagihan Leasing (hasil filter ini)</button>
      </div>
    </div>

    <div id="l-ringkasan" class="tiga" style="margin-top:16px"></div>
    <div id="l-peringatan-terpotong" hidden style="margin-top:10px"></div>

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
  const peringatanEl = wadah.querySelector("#l-peringatan-terpotong");
  const barisEl = wadah.querySelector("#l-baris");
  const fCaraBayarEl = wadah.querySelector("#l-f-carabayar");
  const fStatusEl = wadah.querySelector("#l-f-status");
  const fLeasingEl = wadah.querySelector("#l-f-leasing");
  const fSalesEl = wadah.querySelector("#l-f-sales");
  const fNamaEl = wadah.querySelector("#l-f-nama");
  const wadahFSales = wadah.querySelector("#l-wadah-f-sales");
  const wadahTagihanMassal = wadah.querySelector("#l-f-tagihan-massal");
  let dataSpk = [];   // hasil query rentang tanggal, belum difilter
  let dataTampil = []; // setelah filter Cara Bayar/Status/Leasing/Sales/Nama
  let kemungkinanTerpotong = false;

  const salesSaja = sesi && sesi.peran === "sales";
  wadahFSales.hidden = salesSaja; // Sales cuma lihat datanya sendiri, filter ini percuma

  wadah.querySelector("#l-toggle-filter").addEventListener("click", () => {
    const p = wadah.querySelector("#l-panel-filter");
    p.hidden = !p.hidden;
  });

  function kartuRingkas(judul, angka, sub) {
    return `<article class="kartu">
      <p class="kartu-sub">${aman(judul)}</p>
      <p class="angka-besar">${angka}</p>
      ${sub ? `<p class="kartu-rinci">${aman(sub)}</p>` : ""}
    </article>`;
  }

  async function muat(ambilSemua = false) {
    barisEl.innerHTML = `<tr><td colspan="8" class="hampa">Memuat…</td></tr>`;
    const dari = new Date(dariEl.value + "T00:00:00");
    const sampai = new Date(sampaiEl.value + "T23:59:59");
    const sales = sesi && sesi.peran === "sales";
    // Default 500 (irit biaya baca Firestore & tetap ringan di HP).
    // Kalau pengguna klik "Ambil Semua" karena curiga datanya
    // terpotong, batas dinaikkan jauh (10.000) — bukan tanpa batas
    // sama sekali, supaya tidak ada yang bisa tidak sengaja menarik
    // jutaan dokumen sekaligus dan bikin tagihan membengkak.
    const batas = ambilSemua ? 10000 : BATAS_LAPORAN_DEFAULT;

    try {
      if (sales) {
        // Sales: cuma equality (salesUid), tanpa gabung rentang+urutan
        // tanggal — supaya TIDAK butuh index gabungan di Firestore.
        // Tanggalnya disaring & diurutkan di sini saja.
        const snap = await getDocs(query(
          collection(dbase, "transaksi"),
          where("salesUid", "==", sesi.uid),
          limit(batas)
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
          limit(batas)
        ));
        dataSpk = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
      // Kalau jumlah yang kembali PERSIS sama dengan batas yang
      // diminta, kemungkinan besar ada lagi yang terpotong (bukan
      // kebetulan pas). Peringatan ini yang tadinya TIDAK ADA sama
      // sekali — orang bisa mengira tabel sudah berisi semuanya.
      kemungkinanTerpotong = dataSpk.length >= batas;
    } catch (err) {
      barisEl.innerHTML = `<tr><td colspan="8" class="hampa">
        Gagal memuat: ${aman(err.message)}</td></tr>`;
      return;
    }

    // Isi pilihan Leasing & Sales dari data yang benar-benar muncul di
    // rentang tanggal ini — supaya tidak menampilkan pilihan yang
    // percuma (leasing yang tidak dipakai siapa pun di rentang ini).
    await muatLeasing();
    const leasingTerpakai = [...new Set(dataSpk
      .map((t) => t.kredit?.leasingId).filter(Boolean))];
    fLeasingEl.innerHTML = `<option value="">— semua —</option>` +
      leasingTerpakai.map((id) => {
        const l = leasingDari(id);
        return `<option value="${id}">${aman(l ? l.nama : id)}</option>`;
      }).join("");

    const salesTerpakai = [...new Map(dataSpk.map((t) =>
      [t.salesUid || t.salesNama, namaTampilan(t.salesPeran, t.salesNama)])).entries()];
    fSalesEl.innerHTML = `<option value="">— semua —</option>` +
      salesTerpakai.map(([uid, nama]) =>
        `<option value="${aman(uid)}">${aman(nama)}</option>`).join("");

    terapkanFilter();
  }

  // Filter jalan di data yang SUDAH dimuat (client-side) — tidak perlu
  // baca Firestore lagi tiap ganti filter, cukup query ulang tanggal.
  function terapkanFilter() {
    const caraBayar = fCaraBayarEl.value;
    const status = fStatusEl.value;
    const leasingId = fLeasingEl.value;
    const salesUid = fSalesEl.value;
    const nama = fNamaEl.value.trim().toLowerCase();

    dataTampil = dataSpk.filter((t) => {
      const batal = t.status === "batal";
      if (caraBayar === "kredit" && !(t.caraBayar || []).includes("kredit")) return false;
      if (caraBayar === "cash" && (t.caraBayar || []).includes("kredit")) return false;
      if (status === "batal" && !batal) return false;
      if (status === "lunas" && (batal || !sudahLunas(t))) return false;
      if (status === "belum" && (batal || sudahLunas(t))) return false;
      if (leasingId && t.kredit?.leasingId !== leasingId) return false;
      if (salesUid && (t.salesUid || t.salesNama) !== salesUid) return false;
      if (nama && !(t.pembeli?.nama || "").toLowerCase().includes(nama)) return false;
      return true;
    });

    // Tombol cetak tagihan leasing massal cuma masuk akal kalau
    // filter Cara Bayar = Kredit sedang aktif (jadi jelas isinya
    // semua SPK kredit yang belum tentu lunas semua).
    wadahTagihanMassal.hidden = caraBayar !== "kredit" ||
      !dataTampil.some((t) => t.status !== "batal" &&
        (t.caraBayar || []).includes("kredit") && t.kredit?.leasingId);

    gambarTabel();
  }

  wadah.querySelector("#l-f-terapkan").addEventListener("click", terapkanFilter);
  wadah.querySelector("#l-f-reset").addEventListener("click", () => {
    fCaraBayarEl.value = ""; fStatusEl.value = ""; fLeasingEl.value = "";
    fSalesEl.value = ""; fNamaEl.value = "";
    terapkanFilter();
  });
  wadah.querySelector("#l-cetak-tagihan-massal").addEventListener("click", () => {
    const daftar = dataTampil.filter((t) => t.status !== "batal" &&
      (t.caraBayar || []).includes("kredit") && t.kredit?.leasingId);
    cetakTagihanLeasingBatch(daftar);
  });
  wadah.querySelector("#l-unduh-excel").addEventListener("click", () => unduhExcel(dataTampil));
  wadah.querySelector("#l-unduh-pdf").addEventListener("click", () => unduhPdf(dataTampil));

  function gambarTabel() {
    if (kemungkinanTerpotong) {
      peringatanEl.hidden = false;
      peringatanEl.innerHTML = `<div class="kartu" style="background:#FFF7E6;border:1px solid #E6C34D">
        <p style="margin:0;font-size:12.5px;color:#6b5a1e">
          ⚠️ Data yang tampil mungkin <b>terpotong</b> (sudah kena batas
          ${BATAS_LAPORAN_DEFAULT} baris) — kemungkinan ada SPK lain di
          rentang tanggal ini yang belum kelihatan.
          <button class="tombol tombol--kecil" id="l-ambil-semua"
            style="margin-left:6px">Ambil Semua</button>
        </p>
      </div>`;
      peringatanEl.querySelector("#l-ambil-semua")
        .addEventListener("click", () => muat(true));
    } else {
      peringatanEl.hidden = true;
      peringatanEl.innerHTML = "";
    }

    const totalNilai = dataTampil.reduce((s, t) => s + hargaEfektif(t), 0);
    const jmlReady = dataTampil.filter((t) => t.kondisiUnit === "ready").length;
    const jmlIndent = dataTampil.filter((t) => t.kondisiUnit === "indent").length;

    ringkasanEl.innerHTML =
      kartuRingkas("Total SPK", dataTampil.length, rupiah(totalNilai) + " total nilai (setelah diskon)") +
      kartuRingkas("Unit terkunci (Dipesan)", jmlReady, "stok langsung tersedia") +
      kartuRingkas("Indent", jmlIndent, "menunggu unit tiba");

    barisEl.innerHTML = dataTampil.length
      ? dataTampil.map(baris).join("")
      : `<tr><td colspan="8" class="hampa">Tidak ada SPK di rentang ini.</td></tr>`;

    barisEl.querySelectorAll("[data-kuitansi]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataTampil.find((x) => x.id === b.dataset.kuitansi);
        mintaCetakKuitansi(t, muat);
      }));
    barisEl.querySelectorAll("[data-cetak-menu]").forEach((sel) =>
      sel.addEventListener("change", () => {
        const t = dataTampil.find((x) => x.id === sel.dataset.cetakMenu);
        const aksi = sel.value;
        sel.value = "";
        if (aksi === "spk") cetakSpk(t);
        else if (aksi === "tagihan") cetakTagihanLeasing(t);
        else if (aksi === "ulang-terakhir") cetakUlangKuitansiTerakhir(t);
        else if (aksi === "ulang-lunas") cetakUlangKuitansiTerakhir(t);
      }));
    barisEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataTampil.find((x) => x.id === b.dataset.ubah);
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
        const t = dataTampil.find((x) => x.id === b.dataset.batalkan);
        mintaBatalkanSpk(t, muat);
      }));
    async function bukaDetail(t, target) {
      target.innerHTML = await renderDetail(t);
      target.dataset.dimuat = "1";
      pasangWiringCashback(target, t, () => bukaDetail(t, target));
    }
    barisEl.querySelectorAll("[data-detail]").forEach((b) =>
      b.addEventListener("click", async () => {
        const t = dataTampil.find((x) => x.id === b.dataset.detail);
        const barisSembunyi = barisEl.querySelector(`[data-baris-detail="${t.id}"]`);
        const target = barisEl.querySelector(`[data-wadah-detail="${t.id}"]`);
        const sedangTerbuka = !barisSembunyi.hidden;
        if (sedangTerbuka) {
          barisSembunyi.hidden = true;
          return;
        }
        barisSembunyi.hidden = false;
        if (!target.dataset.dimuat) await bukaDetail(t, target);
      }));
  }

  wadah.querySelector("#l-terapkan").addEventListener("click", muat);
  await muat();
}

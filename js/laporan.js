// laporan.js — daftar semua SPK (dengan hitungannya) dan ringkasan
// stok per rentang tanggal. Dari sini juga bisa cetak ulang SPK.

import { dbase, collection, getDocs, query, where, orderBy, limit }
  from "./db.js";
import { rupiah, aman, tanggal } from "./ui.js";
import { cetakSpk, mintaCetakKuitansi, labelTombolKuitansi } from "./cetak.js";
import { pasangEditPelangganSpk } from "./spk.js";
import { bolehAkses, sesi } from "./auth.js";

const LABEL_KONDISI = { ready: "Dipesan (unit terkunci)", indent: "Indent" };

function awalBulanIni() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hariIni() {
  return new Date().toISOString().slice(0, 10);
}

function baris(t) {
  return `<tr>
    <td class="mono">${aman(t.spkNo)}</td>
    <td>${tanggal(t.dibuatPada)}</td>
    <td>${aman(t.pembeli?.nama)}</td>
    <td>${aman(t.tipeNama)} · ${aman(t.warna)}</td>
    <td>${rupiah(t.hargaOtr)}</td>
    <td><span class="tanda ${t.kondisiUnit === "ready" ? "tanda--ready" : "tanda--uji"}">
      ${LABEL_KONDISI[t.kondisiUnit] || t.kondisiUnit}</span></td>
    <td style="white-space:nowrap">
      ${bolehAkses("cetak.dokumen") ? `
        <button class="tombol tombol--kecil" data-cetak="${t.id}">Cetak SPK</button>
        <button class="tombol tombol--kecil" data-kuitansi="${t.id}">
          ${labelTombolKuitansi(t)}</button>` : ""}
      <button class="tombol tombol--kecil" data-ubah="${t.id}">Ubah</button>
    </td>
  </tr>
  <tr data-baris-edit="${t.id}" hidden>
    <td colspan="7"><div data-wadah-edit="${t.id}"></div></td>
  </tr>`;
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
            <th>Harga OTR</th><th>Kondisi</th><th></th>
          </tr>
        </thead>
        <tbody id="l-baris">
          <tr><td colspan="7" class="hampa">Memuat…</td></tr>
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
    barisEl.innerHTML = `<tr><td colspan="7" class="hampa">Memuat…</td></tr>`;
    const dari = new Date(dariEl.value + "T00:00:00");
    const sampai = new Date(sampaiEl.value + "T23:59:59");

    // Sales cuma boleh lihat SPK yang dia buat sendiri — bukan cuma
    // disembunyikan di tampilan, tapi juga ditegakkan di
    // firestore.rules (lihat blok /transaksi di sana).
    const filter = [
      where("dibuatPada", ">=", dari),
      where("dibuatPada", "<=", sampai),
    ];
    if (sesi && sesi.peran === "sales") {
      filter.push(where("salesUid", "==", sesi.uid));
    }

    try {
      const snap = await getDocs(query(
        collection(dbase, "transaksi"),
        ...filter,
        orderBy("dibuatPada", "desc"),
        limit(500)
      ));
      dataSpk = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      barisEl.innerHTML = `<tr><td colspan="7" class="hampa">
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
      : `<tr><td colspan="7" class="hampa">Tidak ada SPK di rentang ini.</td></tr>`;

    barisEl.querySelectorAll("[data-cetak]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.cetak);
        cetakSpk(t);
      }));
    barisEl.querySelectorAll("[data-kuitansi]").forEach((b) =>
      b.addEventListener("click", () => {
        const t = dataSpk.find((x) => x.id === b.dataset.kuitansi);
        mintaCetakKuitansi(t, muat);
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
  }

  wadah.querySelector("#l-terapkan").addEventListener("click", muat);
  await muat();
}

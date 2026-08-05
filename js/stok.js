// stok.js — unit fisik, dibedakan hanya oleh nomor rangka.
// Input dibuat sependek mungkin: pilih tipe, isi dua nomor.

import {
  dbase, collection, doc, getDocs, query, where, orderBy,
  limit, writeBatch, serverTimestamp, increment, pakaiNilaiUnik,
  sertakanLog, tandaBaru,
} from "./db.js";
import { bolehAkses, sesi } from "./auth.js";
import { muatTipe, tipeDari, sinkronKatalog } from "./tipe.js";
import { pecahHarga } from "./config.js";
import { beritahu } from "./dialog.js";
import { hitungTotalDibayar } from "./cetak.js";
import {
  rupiah, aman, kabar, tanggal, pasangFormatUang, bacaAngka,
} from "./ui.js";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const LABEL_STATUS = {
  ready: "Ready",
  booked: "Dipesan",
  terjual: "Terjual",
};

function tabelUnit(daftar) {
  return `<div style="overflow-x:auto">
    <table class="tabel">
      <thead>
        <tr>
          <th>Tipe</th><th>Warna</th><th>Tahun</th><th>Rangka</th>
          <th>Mesin</th><th>Status</th><th>Masuk</th><th>No. DO</th>
        </tr>
      </thead>
      <tbody>
        ${daftar.map((u) => `<tr class="${u.status !== "ready" ? "baris-klik" : ""}"
              ${u.status !== "ready" ? `data-lihat-pembeli="${u.id}"` : ""}
              ${u.status !== "ready" ? `title="Klik untuk lihat pembelinya"` : ""}>
          <td>${aman(u.tipeNama)}</td>
          <td>${aman(u.warna || "-")}</td>
          <td>${aman(u.tahun || "-")}</td>
          <td class="mono">${aman(u.noRangka || "-")}</td>
          <td class="mono">${aman(u.noMesin || "-")}</td>
          <td><span class="tanda tanda--${u.status}">
            ${LABEL_STATUS[u.status] || u.status}</span></td>
          <td>${tanggal(u.tglMasuk)}</td>
          <td class="mono">${aman(u.noDo || "-")}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function formUnit(daftarTipe, bisaLihatHarga) {
  const opsi = daftarTipe
    .map((t) => `<option value="${t.id}">${aman(t.merek)} ${aman(t.tipe)} ${
      aman(t.varian || "")}</option>`)
    .join("");
  return `<form id="form-unit" class="form">
    <label class="label label--gelap" for="u-tipe">Tipe motor</label>
    <select class="isian isian--terang" id="u-tipe">
      <option value="">— pilih tipe —</option>${opsi}
    </select>

    <div class="dua">
      <div>
        <label class="label label--gelap" for="u-warna">Warna</label>
        <select class="isian isian--terang" id="u-warna">
          <option value="">— pilih —</option>
        </select>
      </div>
      <div>
        <label class="label label--gelap" for="u-tahun">Tahun</label>
        <input class="isian isian--terang" id="u-tahun" inputmode="numeric"
               value="${new Date().getFullYear()}">
      </div>
    </div>

    <label class="label label--gelap" for="u-rangka">Nomor rangka</label>
    <input class="isian isian--terang mono" id="u-rangka"
           autocapitalize="characters" placeholder="ZAPM…">
    <p class="petunjuk">Wajib diisi — Data Unit cuma untuk unit fisik yang
      sungguh sudah ada. Kalau belum tiba fisiknya, catat nanti saja
      setelah barang sampai (statusnya nanti muncul otomatis dari SPK).</p>

    <label class="label label--gelap" for="u-mesin">Nomor mesin</label>
    <input class="isian isian--terang mono" id="u-mesin"
           autocapitalize="characters" placeholder="M81M…">

    <div class="dua">
      <div>
        <label class="label label--gelap" for="u-do">No. DO / faktur</label>
        <input class="isian isian--terang mono" id="u-do" placeholder="DO-…">
      </div>
      <div>
        <label class="label label--gelap" for="u-tgl">Tanggal masuk</label>
        <input class="isian isian--terang" id="u-tgl" type="date">
      </div>
    </div>

    ${
      bisaLihatHarga
        ? `<label class="label label--gelap" for="u-tebus">Harga tebus
             <span class="kunci">terkunci</span></label>
           <input class="isian isian--terang" id="u-tebus" inputmode="numeric"
                  placeholder="39.800.000">
           <p class="petunjuk">Hanya owner dan admin yang bisa melihat angka
             ini. Disimpan terpisah dari data unit.</p>`
        : ""
    }

    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan unit</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-unit">Batal</button>
    </div>
  </form>`;
}

export async function halamanStok(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");
  const bisaLihatHarga = bolehAkses("laba.lihat");
  const daftarTipe = await muatTipe();

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Data Unit</h2>
      <div style="display:flex;gap:8px">
        <button class="tombol tombol--kecil" id="unduh-excel">
          Unduh Excel</button>
        ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
          id="tambah-unit">Tambah unit</button>` : ""}
      </div>
    </div>
    <div class="chip-baris" id="saring">
      <button class="chip aktif" data-status="semua">Semua</button>
      <button class="chip" data-status="ready">Ready</button>
      <button class="chip" data-status="booked">Dipesan</button>
      <button class="chip" data-status="terjual">Terjual</button>
    </div>

    <div class="dua" style="margin-top:10px">
      <div>
        <label class="label label--gelap" for="f-tipe">Tipe motor</label>
        <select class="isian isian--terang" id="f-tipe">
          <option value="">— semua tipe —</option>
          ${daftarTipe.map((t) => `<option value="${t.id}">
            ${aman(t.merek)} ${aman(t.tipe)} ${aman(t.varian || "")}</option>`).join("")}
        </select>
      </div>
      <div>
        <label class="label label--gelap" for="f-warna">Warna</label>
        <select class="isian isian--terang" id="f-warna">
          <option value="">— semua warna —</option>
        </select>
      </div>
    </div>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="f-dari">Masuk dari tanggal</label>
        <input class="isian isian--terang" id="f-dari" type="date">
      </div>
      <div>
        <label class="label label--gelap" for="f-sampai">Sampai tanggal</label>
        <input class="isian isian--terang" id="f-sampai" type="date">
      </div>
    </div>

    <div id="wadah-form-unit"></div>
    <div id="daftar-unit" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-unit");
  const formEl = wadah.querySelector("#wadah-form-unit");
  const filterTipeEl = wadah.querySelector("#f-tipe");
  const filterWarnaEl = wadah.querySelector("#f-warna");
  const filterDariEl = wadah.querySelector("#f-dari");
  const filterSampaiEl = wadah.querySelector("#f-sampai");
  let status = "semua";
  let unitSemua = [];   // hasil query Firestore (cuma disaring status)
  let unitTampil = [];  // unitSemua setelah disaring tipe/warna/tanggal

  // Warna yang ditawarkan mengikuti tipe yang dipilih — kalau
  // "semua tipe", tawarkan gabungan semua warna yang pernah dipakai.
  function perbaruiOpsiWarna() {
    const nilaiSebelum = filterWarnaEl.value;
    let daftarWarna;
    if (filterTipeEl.value) {
      const t = tipeDari(filterTipeEl.value);
      daftarWarna = (t && t.warna) || [];
    } else {
      daftarWarna = [...new Set(daftarTipe.flatMap((t) => t.warna || []))].sort();
    }
    filterWarnaEl.innerHTML = `<option value="">— semua warna —</option>` +
      daftarWarna.map((w) => `<option value="${aman(w)}">${aman(w)}</option>`).join("");
    if (daftarWarna.includes(nilaiSebelum)) filterWarnaEl.value = nilaiSebelum;
  }
  perbaruiOpsiWarna();

  function terapkanFilterLokal() {
    const tipeId = filterTipeEl.value;
    const warna = filterWarnaEl.value;
    const dari = filterDariEl.value ? new Date(filterDariEl.value + "T00:00:00") : null;
    const sampai = filterSampaiEl.value ? new Date(filterSampaiEl.value + "T23:59:59") : null;

    unitTampil = unitSemua.filter((u) => {
      if (tipeId && u.tipeId !== tipeId) return false;
      if (warna && u.warna !== warna) return false;
      const masuk = u.tglMasuk?.toDate ? u.tglMasuk.toDate() : new Date(u.tglMasuk);
      if (dari && masuk < dari) return false;
      if (sampai && masuk > sampai) return false;
      return true;
    });

    daftarEl.innerHTML = unitTampil.length
      ? tabelUnit(unitTampil)
      : `<div class="hampa"><p>Tidak ada unit yang cocok dengan filter ini.</p></div>`;

    daftarEl.querySelectorAll("[data-lihat-pembeli]").forEach((tr) =>
      tr.addEventListener("click", () => lihatPembeli(tr.dataset.lihatPembeli)));
  }

  async function lihatPembeli(unitId) {
    try {
      // Sales cuma boleh lihat kalau itu SPK yang dia buat sendiri —
      // kalau unitnya kepakai SPK sales lain, dianggap "tidak ada".
      const filterSales = sesi && sesi.peran === "sales"
        ? [where("salesUid", "==", sesi.uid)] : [];
      const snap = await getDocs(query(
        collection(dbase, "transaksi"), where("unitId", "==", unitId),
        ...filterSales, limit(1)
      ));
      if (snap.empty) {
        await beritahu({
          judul: "Belum Ada Data Pembeli",
          pesan: "Unit ini terkunci tapi belum ditemukan SPK yang " +
                 "menyertainya (kemungkinan data lama).",
        });
        return;
      }
      const t = snap.docs[0].data();
      const total = hitungTotalDibayar(t);
      const sisa = Math.max((t.hargaOtr || 0) - total, 0);
      await beritahu({
        judul: `Unit ini untuk: ${t.pembeli?.nama || "-"}`,
        pesan: `No. SPK: ${aman(t.spkNo)}<br>` +
               `Sales: ${aman(t.salesNama)}<br>` +
               `Harga OTR: ${rupiah(t.hargaOtr)}<br>` +
               `Total dibayar: ${rupiah(total)}<br>` +
               (sisa > 0 ? `Sisa tagihan: ${rupiah(sisa)}<br>` : `<b>LUNAS</b><br>`) +
               `Tanggal SPK: ${tanggal(t.dibuatPada)}`,
      });
    } catch (err) {
      kabar("Gagal memuat data pembeli: " + err.message, "rem");
    }
  }

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    // "Semua" tidak menyaring apa pun di query — sisanya (tipe,
    // warna, tanggal) disaring di aplikasi lewat terapkanFilterLokal().
    const snap = status === "semua"
      ? await getDocs(query(collection(dbase, "units"), limit(500)))
      : await getDocs(query(
          collection(dbase, "units"),
          where("status", "==", status),
          limit(500)
        ));
    unitSemua = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
    terapkanFilterLokal();
  }

  wadah.querySelector("#saring").addEventListener("click", (e) => {
    const t = e.target.closest("[data-status]");
    if (!t) return;
    status = t.dataset.status;
    wadah.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("aktif", c === t));
    gambar();
  });

  filterTipeEl.addEventListener("change", () => {
    perbaruiOpsiWarna();
    terapkanFilterLokal();
  });
  [filterWarnaEl, filterDariEl, filterSampaiEl].forEach((el) =>
    el.addEventListener("change", terapkanFilterLokal));

  // ── Unduh Excel ────────────────────────────────────────────
  // File .xlsx asli (bukan .csv) — supaya kolomnya selalu rapi di
  // Excel apa pun setting regionnya (koma vs titik koma). Isinya
  // mengikuti data yang SEDANG tampil (sesudah semua filter).
  wadah.querySelector("#unduh-excel").addEventListener("click", () => {
    if (!unitTampil.length) {
      kabar("Tidak ada data untuk diunduh — sesuaikan dulu filternya.", "rem");
      return;
    }
    const kolom = ["Tipe", "Warna", "Tahun", "No Rangka", "No Mesin",
      "Status", "No DO", "Tanggal Masuk"];
    const baris = unitTampil.map((u) => [
      u.tipeNama, u.warna, u.tahun, u.noRangka, u.noMesin,
      LABEL_STATUS[u.status] || u.status, u.noDo, tanggal(u.tglMasuk),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([kolom, ...baris]);
    ws["!cols"] = [
      { wch: 26 }, { wch: 16 }, { wch: 8 }, { wch: 18 }, { wch: 18 },
      { wch: 10 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Unit");
    XLSX.writeFile(wb, `data-unit-${status}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  async function bukaForm() {
    const daftarTipe = await muatTipe();
    if (!daftarTipe.length) {
      kabar("Tambahkan tipe motor dulu di menu Kelola.", "rem");
      return;
    }
    formEl.innerHTML = formUnit(daftarTipe, bisaLihatHarga);
    const pilihTipe = formEl.querySelector("#u-tipe");
    const pilihWarna = formEl.querySelector("#u-warna");
    formEl.querySelector("#u-tgl").value =
      new Date().toISOString().slice(0, 10);
    if (bisaLihatHarga) pasangFormatUang(formEl.querySelector("#u-tebus"));

    pilihTipe.addEventListener("change", () => {
      const t = tipeDari(pilihTipe.value);
      pilihWarna.innerHTML = `<option value="">— pilih —</option>` +
        ((t && t.warna) || []).map((w) =>
          `<option value="${aman(w)}">${aman(w)}</option>`).join("");
    });

    formEl.querySelector("#batal-unit")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-unit").addEventListener("submit", simpan);
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function simpan(e) {
    e.preventDefault();
    const tipeId = formEl.querySelector("#u-tipe").value;
    const noRangka = formEl.querySelector("#u-rangka").value
      .trim().toUpperCase();
    if (!tipeId) { kabar("Pilih tipe motornya dulu.", "rem"); return; }
    if (!noRangka) { kabar("Nomor rangka wajib diisi.", "rem"); return; }

    const t = tipeDari(tipeId);
    const ref = doc(collection(dbase, "units"));

    try {
      // Menahan nomor rangka lebih dulu. Kalau nomor ini sudah
      // terdaftar, penyimpanan dibatalkan sebelum apa pun berubah.
      await pakaiNilaiUnik("indeks_rangka", noRangka, ref.id);

      const batch = writeBatch(dbase);
      batch.set(ref, {
        tipeId,
        tipeNama: `${t.merek} ${t.tipe} ${t.varian || ""}`.trim(),
        warna: formEl.querySelector("#u-warna").value,
        tahun: Number(formEl.querySelector("#u-tahun").value || 0),
        noRangka,
        noMesin: formEl.querySelector("#u-mesin").value.trim().toUpperCase(),
        noDo: formEl.querySelector("#u-do").value.trim(),
        tglMasuk: new Date(formEl.querySelector("#u-tgl").value),
        status: "ready",
        ...tandaBaru(),
      });

      // Harga tebus dipisah ke subdokumen. Sales dan kasir tidak
      // bisa membacanya, bahkan lewat developer tools.
      if (bisaLihatHarga) {
        const tebus = bacaAngka(formEl.querySelector("#u-tebus"));
        if (tebus) {
          const p = pecahHarga(tebus, t.mewah);
          batch.set(doc(dbase, "units", ref.id, "rahasia", "harga"), {
            hargaTebus: tebus,
            dpp: p.dpp,
            ppnMasukan: p.ppn,
            dicatatPada: serverTimestamp(),
          });
        }
      }

      batch.update(doc(dbase, "tipe_motor", tipeId), {
        jumlahReady: increment(1),
      });

      sertakanLog(batch, "unit_ditambah", {
        koleksi: "units", docId: ref.id, ringkas: noRangka,
      });

      await batch.commit();
      await sinkronKatalog();
      formEl.innerHTML = "";
      kabar("Unit tersimpan.", "netral");
      status = "ready";
      wadah.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("aktif", c.dataset.status === "ready"));
      await gambar();
    } catch (err) {
      kabar(err.message || "Gagal menyimpan unit.", "rem");
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-unit").addEventListener("click", bukaForm);
  }
  await gambar();
}

// ── Dipakai dari SPK ─────────────────────────────────────────────
// Cari SATU unit berstatus ready untuk tipe+warna tertentu. Kalau
// ada, SPK bisa langsung mengunci unit itu (jadi tidak ditawarkan
// ke pembeli lain). Kalau tidak ada, SPK-nya sendiri yang jadi
// Indent — bukan Data Unit yang dibikin dulu tanpa fisiknya.
export async function cariUnitReady(tipeId, warna) {
  const snap = await getDocs(query(
    collection(dbase, "units"),
    where("tipeId", "==", tipeId),
    where("warna", "==", warna),
    where("status", "==", "ready"),
    limit(1)
  ));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// Mengunci satu unit ready ke sebuah SPK: status pindah ke "booked"
// dan jumlahReady di tipe turun satu. Ditambahkan ke batch yang
// sama dengan penyimpanan SPK, supaya dua-duanya berhasil atau
// dua-duanya batal bersamaan.
export function kunciUnitKeBatch(batch, unit, spkId) {
  batch.update(doc(dbase, "units", unit.id), {
    status: "booked",
    spkId,
  });
  batch.update(doc(dbase, "tipe_motor", unit.tipeId), {
    jumlahReady: increment(-1),
  });
}

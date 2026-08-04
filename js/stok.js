// stok.js — unit fisik, dibedakan hanya oleh nomor rangka.
// Input dibuat sependek mungkin: pilih tipe, isi dua nomor.

import {
  dbase, collection, doc, getDocs, query, where, orderBy,
  limit, writeBatch, serverTimestamp, increment, pakaiNilaiUnik,
  sertakanLog, tandaBaru,
} from "./db.js";
import { bolehAkses } from "./auth.js";
import { muatTipe, tipeDari, sinkronKatalog } from "./tipe.js";
import { pecahHarga } from "./config.js";
import {
  rupiah, aman, kabar, tanggal, pasangFormatUang, bacaAngka,
} from "./ui.js";

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
        ${daftar.map((u) => `<tr>
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
    <div id="wadah-form-unit"></div>
    <div id="daftar-unit" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-unit");
  const formEl = wadah.querySelector("#wadah-form-unit");
  let status = "semua";
  let unitTampil = [];

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    // "Semua" tidak menyaring apa pun — supaya bisa lihat seluruh
    // data kendaraan sekaligus, bukan cuma per status.
    const snap = status === "semua"
      ? await getDocs(query(collection(dbase, "units"), limit(500)))
      : await getDocs(query(
          collection(dbase, "units"),
          where("status", "==", status),
          limit(500)
        ));
    unitTampil = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
    daftarEl.innerHTML = unitTampil.length
      ? tabelUnit(unitTampil)
      : `<div class="hampa"><p>Tidak ada unit${
          status === "semua" ? "" : ` berstatus ${LABEL_STATUS[status].toLowerCase()}`
        }.</p></div>`;
  }

  wadah.querySelector("#saring").addEventListener("click", (e) => {
    const t = e.target.closest("[data-status]");
    if (!t) return;
    status = t.dataset.status;
    wadah.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("aktif", c === t));
    gambar();
  });

  // ── Unduh Excel ────────────────────────────────────────────
  // Format .csv — dibaca Excel tanpa perlu library tambahan, dan
  // isinya mengikuti data yang sedang tampil di layar (sesuai filter).
  wadah.querySelector("#unduh-excel").addEventListener("click", () => {
    if (!unitTampil.length) {
      kabar("Tidak ada data untuk diunduh.", "rem");
      return;
    }
    const kolom = ["Tipe", "Warna", "Tahun", "No Rangka", "No Mesin",
      "Status", "No DO", "Tanggal Masuk"];
    const baris = unitTampil.map((u) => [
      u.tipeNama, u.warna, u.tahun, u.noRangka, u.noMesin,
      LABEL_STATUS[u.status] || u.status, u.noDo, tanggal(u.tglMasuk),
    ]);
    const escapeCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [kolom, ...baris]
      .map((baris) => baris.map(escapeCsv).join(","))
      .join("\r\n");
    // \ufeff (BOM) supaya Excel langsung kenali sebagai UTF-8.
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `data-unit-${status}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
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

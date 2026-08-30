// stok.js — unit fisik, dibedakan hanya oleh nomor rangka.
// Input dibuat sependek mungkin: pilih tipe, isi dua nomor.

import {
  dbase, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where,
  orderBy, limit, writeBatch, serverTimestamp, increment, pakaiNilaiUnik,
  sertakanLog, tandaBaru, catat, runTransaction,
} from "./db.js?v=3.11.5";
import { bolehAkses, sesi } from "./auth.js?v=3.11.5";
import { PERAN } from "./roles.js?v=3.11.5";
import { muatTipe, tipeDari, sinkronKatalog } from "./tipe.js?v=3.11.5";
import { pecahHarga } from "./config.js?v=3.11.5";
import { beritahu } from "./dialog.js?v=3.11.5";
import { muatSupplier, supplierAktif } from "./supplier.js?v=3.11.5";
import { beriTahuSemuaOwner } from "./notifikasi.js?v=3.11.5";
import { hitungTotalDibayar } from "./cetak.js?v=3.11.5";
import {
  rupiah, aman, kabar, tanggal, pasangFormatUang, bacaAngka, pasangBersihkanKode,
} from "./ui.js?v=3.11.5";

// No. Rangka & No. Mesin sering diketik dengan spasi yang tidak
// konsisten (mis. "MD17M 5027277" vs "MD17M5027277") — kalau cuma
// di-uppercase tanpa buang spasi, dua penulisan itu dianggap BEDA
// oleh pengecekan keunikan, jadi celah duplikat bisa lolos. Semua
// pemakaian No. Rangka/Mesin WAJIB lewat fungsi ini dulu.
function bersihkanKode(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

const LABEL_STATUS = {
  ready: "Ready",
  booked: "Dipesan",
  terjual: "Terjual",
};

function tabelUnit(daftar, bisaUbah) {
  return `<div style="overflow-x:auto">
    <table class="tabel">
      <thead>
        <tr>
          <th>No.</th><th>Tipe</th><th>Warna</th><th>Tahun</th><th>Rangka</th>
          <th>Mesin</th><th>Status</th><th>Masuk</th><th>No. DO</th>
          ${bisaUbah ? "<th></th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${daftar.map((u, i) => `<tr class="baris-status--${u.status} ${
              u.status !== "ready" ? "baris-klik" : ""}"
              ${u.status !== "ready" ? `data-lihat-pembeli="${u.id}"` : ""}
              ${u.status !== "ready" ? `title="Klik untuk lihat pembelinya"` : ""}>
          <td class="mono">${i + 1}</td>
          <td>${aman(u.tipeNama)}</td>
          <td>${aman(u.warna || "-")}</td>
          <td>${aman(u.tahun || "-")}</td>
          <td class="mono">${aman(u.noRangka || "-")}</td>
          <td class="mono">${aman(u.noMesin || "-")}</td>
          <td><span class="tanda tanda--${u.status}">
            ${LABEL_STATUS[u.status] || u.status}</span></td>
          <td>${tanggal(u.tglMasuk)}</td>
          <td class="mono">${aman(u.noDo || "-")}</td>
          ${bisaUbah ? `<td><button class="tombol tombol--kecil"
              data-ubah-unit="${u.id}"
              onclick="event.stopPropagation()">Ubah</button></td>` : ""}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function formUnit(daftarTipe, bisaLihatHarga, daftarSupplier) {
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

    <label class="label label--gelap" for="u-supplier">Supplier</label>
    <select class="isian isian--terang" id="u-supplier">
      <option value="">— tidak diisi —</option>
      ${daftarSupplier.map((s) =>
        `<option value="${s.id}">${aman(s.nama)}</option>`).join("")}
    </select>

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
        <button class="tombol tombol--kecil" id="toggle-filter-unit">Filter</button>
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

    <div id="panel-filter-unit" class="lembar" style="margin-top:10px" hidden>
      <div class="dua">
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
      <label class="label label--gelap" for="f-urut">Urutkan</label>
      <select class="isian isian--terang" id="f-urut">
        <option value="masuk-terbaru">Tanggal masuk — terbaru dulu</option>
        <option value="masuk-terlama">Tanggal masuk — terlama dulu</option>
        <option value="rangka-az">No. Rangka — A ke Z</option>
        <option value="rangka-za">No. Rangka — Z ke A</option>
        <option value="tipe-az">Tipe Motor — A ke Z</option>
      </select>
    </div>

    <div id="wadah-form-unit"></div>
    <div id="daftar-unit" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  wadah.querySelector("#toggle-filter-unit").addEventListener("click", () => {
    const p = wadah.querySelector("#panel-filter-unit");
    p.hidden = !p.hidden;
  });

  const daftarEl = wadah.querySelector("#daftar-unit");
  const formEl = wadah.querySelector("#wadah-form-unit");
  const filterTipeEl = wadah.querySelector("#f-tipe");
  const filterWarnaEl = wadah.querySelector("#f-warna");
  const filterDariEl = wadah.querySelector("#f-dari");
  const filterSampaiEl = wadah.querySelector("#f-sampai");
  const filterUrutEl = wadah.querySelector("#f-urut");
  let status = "semua";
  let unitSemua = [];   // hasil query Firestore (cuma disaring status)
  let unitTampil = [];  // unitSemua setelah disaring tipe/warna/tanggal/urutan

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
    const urut = filterUrutEl.value;

    unitTampil = unitSemua.filter((u) => {
      if (tipeId && u.tipeId !== tipeId) return false;
      if (warna && u.warna !== warna) return false;
      const masuk = u.tglMasuk?.toDate ? u.tglMasuk.toDate() : new Date(u.tglMasuk);
      if (dari && masuk < dari) return false;
      if (sampai && masuk > sampai) return false;
      return true;
    });

    const waktu = (u) => u.tglMasuk?.toDate
      ? u.tglMasuk.toDate().getTime() : new Date(u.tglMasuk).getTime();
    const pembanding = {
      "masuk-terbaru": (a, b) => waktu(b) - waktu(a),
      "masuk-terlama": (a, b) => waktu(a) - waktu(b),
      "rangka-az": (a, b) => (a.noRangka || "").localeCompare(b.noRangka || ""),
      "rangka-za": (a, b) => (b.noRangka || "").localeCompare(a.noRangka || ""),
      "tipe-az": (a, b) => (a.tipeNama || "").localeCompare(b.tipeNama || ""),
    };
    unitTampil.sort(pembanding[urut] || pembanding["masuk-terbaru"]);

    daftarEl.innerHTML = unitTampil.length
      ? tabelUnit(unitTampil, bisaUbah)
      : `<div class="hampa"><p>Tidak ada unit yang cocok dengan filter ini.</p></div>`;

    daftarEl.querySelectorAll("[data-lihat-pembeli]").forEach((tr) =>
      tr.addEventListener("click", () => lihatPembeli(tr.dataset.lihatPembeli)));
    if (bisaUbah) {
      daftarEl.querySelectorAll("[data-ubah-unit]").forEach((b) =>
        b.addEventListener("click", () => bukaFormUbah(b.dataset.ubahUnit)));
    }
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
  [filterWarnaEl, filterDariEl, filterSampaiEl, filterUrutEl].forEach((el) =>
    el.addEventListener("change", terapkanFilterLokal));

  // ── Unduh Excel ────────────────────────────────────────────
  // Format .xls (tabel HTML, bukan .xlsx XML) — supaya border &
  // header tebal otomatis ada TIAP kali diunduh, tanpa perlu
  // "Format as Table" manual di Excel setiap kali (library .xlsx
  // gratis yang dipakai sebelumnya tidak bisa nulis style/border).
  // Konsekuensinya: tidak ada panah dropdown AutoFilter otomatis
  // seperti versi .xlsx — tapi tinggal klik "Data > Filter" sekali
  // di Excel kalau perlu, jadi bukan kehilangan besar.
  wadah.querySelector("#unduh-excel").addEventListener("click", () => {
    if (!unitTampil.length) {
      kabar("Tidak ada data untuk diunduh — sesuaikan dulu filternya.", "rem");
      return;
    }
    const kolom = ["Tipe", "Warna", "Tahun", "No Rangka", "No Mesin",
      "Status", "No DO", "Tanggal Masuk"];
    const gStyle = "border:1px solid #999;padding:4px 8px;font-family:Calibri,Arial,sans-serif;font-size:12px;";
    const hStyle = gStyle + "background:#1F4E78;color:#fff;font-weight:bold;text-align:left;";
    const baris = unitTampil.map((u) => [
      u.tipeNama, u.warna, u.tahun, u.noRangka, u.noMesin,
      LABEL_STATUS[u.status] || u.status, u.noDo, tanggal(u.tglMasuk),
    ]);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
      <table>
        <thead><tr>${kolom.map((k) => `<th style="${hStyle}">${aman(k)}</th>`).join("")}</tr></thead>
        <tbody>${baris.map((b) => `<tr>${b.map((v) =>
          `<td style="${gStyle}">${aman(v ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </body></html>`;
    const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `data-unit-${status}-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  async function bukaForm() {
    const daftarTipe = await muatTipe();
    if (!daftarTipe.length) {
      kabar("Tambahkan tipe motor dulu di menu Kelola.", "rem");
      return;
    }
    const daftarSupplier = await muatSupplier();
    formEl.innerHTML = formUnit(daftarTipe, bisaLihatHarga, supplierAktif().length ? supplierAktif() : daftarSupplier);
    const pilihTipe = formEl.querySelector("#u-tipe");
    const pilihWarna = formEl.querySelector("#u-warna");
    formEl.querySelector("#u-tgl").value =
      new Date().toISOString().slice(0, 10);
    if (bisaLihatHarga) pasangFormatUang(formEl.querySelector("#u-tebus"));
    pasangBersihkanKode(formEl.querySelector("#u-rangka"));
    pasangBersihkanKode(formEl.querySelector("#u-mesin"));

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
    const noRangka = bersihkanKode(formEl.querySelector("#u-rangka").value);
    const noMesin = bersihkanKode(formEl.querySelector("#u-mesin").value);
    if (!tipeId) { kabar("Pilih tipe motornya dulu.", "rem"); return; }
    if (!noRangka) { kabar("Nomor rangka wajib diisi.", "rem"); return; }

    const t = tipeDari(tipeId);
    const ref = doc(collection(dbase, "units"));

    try {
      // Menahan nomor rangka (& mesin, kalau diisi) lebih dulu. Kalau
      // salah satunya sudah terdaftar, penyimpanan dibatalkan sebelum
      // apa pun berubah.
      await pakaiNilaiUnik("indeks_rangka", noRangka, ref.id);
      if (noMesin) {
        try {
          await pakaiNilaiUnik("indeks_mesin", noMesin, ref.id);
        } catch (errMesin) {
          // Rangka SUDAH terlanjur ditahan di atas — lepas lagi
          // supaya tidak menggantung kalau ternyata mesinnya dobel.
          try { await deleteDoc(doc(dbase, "indeks_rangka", noRangka)); } catch { /* biarkan */ }
          throw errMesin;
        }
      }

      const batch = writeBatch(dbase);
      const elSupplier = formEl.querySelector("#u-supplier");
      const supplierTerpilih = elSupplier && elSupplier.value
        ? supplierAktif().find((s) => s.id === elSupplier.value) : null;
      batch.set(ref, {
        tipeId,
        tipeNama: `${t.merek} ${t.tipe} ${t.varian || ""}`.trim(),
        warna: formEl.querySelector("#u-warna").value,
        tahun: Number(formEl.querySelector("#u-tahun").value || 0),
        noRangka,
        noMesin,
        noDo: formEl.querySelector("#u-do").value.trim(),
        supplierId: supplierTerpilih ? supplierTerpilih.id : null,
        supplierNama: supplierTerpilih ? supplierTerpilih.nama : null,
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

  // ── Ubah unit yang sudah ada ─────────────────────────────────
  // Buat membetulkan salah ketik (rangka/mesin/tipe/warna/dsb) —
  // status (Ready/Dipesan/Terjual) SENGAJA tidak ikut diedit di
  // sini, karena itu cuma boleh berubah lewat alur SPK/pembayaran.
  //
  // Owner: langsung tersimpan. Admin: cuma MENGAJUKAN — perubahan
  // baru berlaku setelah Owner menyetujui (lihat persetujuan.js),
  // supaya tidak ada yang bolak-balik ubah data unit sembarangan
  // (apalagi unit yang sudah keluar dari showroom).
  async function bukaFormUbah(unitId) {
    const u = unitTampil.find((x) => x.id === unitId) ||
      unitSemua.find((x) => x.id === unitId);
    if (!u) return;

    const owner = sesi && sesi.peran === "owner";
    if (!owner) {
      // Cegah pengajuan dobel untuk unit yang sama.
      const sedangMenunggu = await getDocs(query(
        collection(dbase, "pengajuan"),
        where("unitId", "==", unitId),
        where("status", "==", "menunggu"),
        limit(1)
      )).catch(() => null);
      if (sedangMenunggu && !sedangMenunggu.empty) {
        formEl.innerHTML = `<div class="lembar" style="margin-top:10px">
          <p class="hampa">Sudah ada pengajuan perubahan untuk unit ini yang
            masih menunggu persetujuan Owner.</p>
          <button class="tombol tombol--kecil" id="tutup-ubah-unit">Tutup</button>
        </div>`;
        formEl.querySelector("#tutup-ubah-unit")
          .addEventListener("click", () => (formEl.innerHTML = ""));
        return;
      }
    }

    const daftarTipe = await muatTipe();
    const daftarSupplier = await muatSupplier();
    formEl.innerHTML = formUnit(daftarTipe, bisaLihatHarga, supplierAktif().length ? supplierAktif() : daftarSupplier);
    formEl.querySelector('button[type="submit"]').textContent =
      owner ? "Simpan Perubahan" : "Ajukan Perubahan";
    if (!owner) {
      formEl.insertAdjacentHTML("afterbegin",
        `<p class="petunjuk">Perubahan ini perlu <b>disetujui Owner</b> dulu
          sebelum benar-benar berlaku.</p>`);
    }

    const pilihTipe = formEl.querySelector("#u-tipe");
    const pilihWarna = formEl.querySelector("#u-warna");
    pilihTipe.value = u.tipeId;
    const t = tipeDari(u.tipeId);
    pilihWarna.innerHTML = `<option value="">— pilih —</option>` +
      ((t && t.warna) || []).map((w) =>
        `<option value="${aman(w)}" ${w === u.warna ? "selected" : ""}>
          ${aman(w)}</option>`).join("");
    formEl.querySelector("#u-tahun").value = u.tahun || "";
    formEl.querySelector("#u-rangka").value = u.noRangka || "";
    formEl.querySelector("#u-mesin").value = u.noMesin || "";
    formEl.querySelector("#u-do").value = u.noDo || "";
    formEl.querySelector("#u-supplier").value = u.supplierId || "";
    formEl.querySelector("#u-tgl").value = u.tglMasuk?.toDate
      ? u.tglMasuk.toDate().toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    pasangBersihkanKode(formEl.querySelector("#u-rangka"));
    pasangBersihkanKode(formEl.querySelector("#u-mesin"));

    if (bisaLihatHarga) {
      const tebusEl = formEl.querySelector("#u-tebus");
      pasangFormatUang(tebusEl);
      try {
        const snap = await getDoc(doc(dbase, "units", u.id, "rahasia", "harga"));
        if (snap.exists()) {
          tebusEl.value = Number(snap.data().hargaTebus || 0).toLocaleString("id-ID");
        }
      } catch { /* kalau gagal baca, biarkan kosong — bukan fatal */ }
    }

    pilihTipe.addEventListener("change", () => {
      const tb = tipeDari(pilihTipe.value);
      pilihWarna.innerHTML = `<option value="">— pilih —</option>` +
        ((tb && tb.warna) || []).map((w) =>
          `<option value="${aman(w)}">${aman(w)}</option>`).join("");
    });

    formEl.querySelector("#batal-unit")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-unit").addEventListener("submit",
      (e) => simpanUbah(e, u, owner));
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function simpanUbah(e, u, owner) {
    e.preventDefault();
    const tipeId = formEl.querySelector("#u-tipe").value;
    const noRangkaBaru = bersihkanKode(formEl.querySelector("#u-rangka").value);
    if (!tipeId) { kabar("Pilih tipe motornya dulu.", "rem"); return; }
    if (!noRangkaBaru) { kabar("Nomor rangka wajib diisi.", "rem"); return; }

    const t = tipeDari(tipeId);
    const elSupplierUbah = formEl.querySelector("#u-supplier");
    const supplierTerpilihUbah = elSupplierUbah && elSupplierUbah.value
      ? supplierAktif().find((s) => s.id === elSupplierUbah.value) : null;
    const dataBaru = {
      tipeId,
      tipeNama: `${t.merek} ${t.tipe} ${t.varian || ""}`.trim(),
      warna: formEl.querySelector("#u-warna").value,
      tahun: Number(formEl.querySelector("#u-tahun").value || 0),
      noRangka: noRangkaBaru,
      noMesin: bersihkanKode(formEl.querySelector("#u-mesin").value),
      noDo: formEl.querySelector("#u-do").value.trim(),
      supplierId: supplierTerpilihUbah ? supplierTerpilihUbah.id : null,
      supplierNama: supplierTerpilihUbah ? supplierTerpilihUbah.nama : null,
      tglMasuk: new Date(formEl.querySelector("#u-tgl").value),
    };

    // Harga tebus TIDAK ikut alur persetujuan — itu bukan identitas
    // fisik unit (risiko yang dikhawatirkan), jadi tetap langsung
    // tersimpan siapa pun yang mengedit (owner/admin, sesuai izin
    // laba.lihat yang sudah ada).
    if (bisaLihatHarga) {
      const tebus = bacaAngka(formEl.querySelector("#u-tebus"));
      if (tebus) {
        try {
          const p = pecahHarga(tebus, t.mewah);
          await setDoc(doc(dbase, "units", u.id, "rahasia", "harga"), {
            hargaTebus: tebus, dpp: p.dpp, ppnMasukan: p.ppn,
            dicatatPada: serverTimestamp(),
          }, { merge: true });
        } catch (err) {
          kabar("Gagal menyimpan harga tebus: " + err.message, "rem");
        }
      }
    }

    if (owner) {
      try {
        await terapkanPerubahanUnit(u, dataBaru);
        formEl.innerHTML = "";
        kabar("Perubahan unit tersimpan.", "netral");
        await gambar();
      } catch (err) {
        kabar(err.message || "Gagal menyimpan perubahan.", "rem");
      }
      return;
    }

    // Admin: kirim pengajuan saja, tidak langsung berlaku.
    try {
      const ref = doc(collection(dbase, "pengajuan"));
      const catatanPerubahan = buatCatatanUnit(u, dataBaru);

      // Kalau unit ini sedang terkunci ke SPK yang masih berjalan
      // (belum batal), sertakan nama konsumen & no SPK-nya di
      // notifikasi — supaya Owner langsung tahu unit siapa yang
      // sedang diubah, tanpa perlu buka Data Unit dulu.
      let spkTerkait = null;
      try {
        const snapSpk = await getDocs(query(
          collection(dbase, "transaksi"),
          where("unitId", "==", u.id), limit(5)
        ));
        spkTerkait = snapSpk.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .find((t) => t.status !== "batal") || null;
      } catch { /* kalau gagal cek, notifikasi tetap jalan tanpa info SPK */ }

      await setDoc(ref, {
        jenis: "unit_diubah",
        unitId: u.id,
        spkNo: spkTerkait ? spkTerkait.spkNo : null,
        diajukanOlehUid: sesi ? sesi.uid : null,
        diajukanOlehNama: sesi ? sesi.nama : "-",
        diajukanOlehPeran: sesi ? sesi.peran : null,
        status: "menunggu",
        dataLama: {
          tipeId: u.tipeId, tipeNama: u.tipeNama, warna: u.warna,
          tahun: u.tahun, noRangka: u.noRangka, noMesin: u.noMesin,
          noDo: u.noDo, supplierNama: u.supplierNama || null,
        },
        dataBaru,
        catatan: catatanPerubahan,
        ...tandaBaru(),
      });
      await catat("unit_perubahan_diajukan", {
        koleksi: "units", docId: u.id, ringkas: dataBaru.noRangka,
      });

      // Format: "Sales Budi mengajukan perubahan No. Mesin: "X" menjadi
      // "Y" untuk konsumen Fulan dengan No. SPK SPK/2026/0005." — kalau
      // tidak ada SPK terkait, kalimatnya berhenti sebelum bagian itu.
      const labelPeran = sesi ? (PERAN[sesi.peran]?.label || sesi.peran) : "";
      const daftarPerubahan = catatanPerubahan
        .split("\n")
        .map((baris) => baris.replace(" → ", " menjadi "))
        .join("; ");
      const infoSpk = spkTerkait
        ? ` untuk konsumen ${spkTerkait.pembeli?.nama || "-"} ` +
          `dengan No. SPK ${spkTerkait.spkNo}`
        : ` untuk unit ${dataBaru.noRangka || u.noRangka}`;
      await beriTahuSemuaOwner("Pengajuan Perubahan Unit",
        `${labelPeran} ${sesi.nama} mengajukan perubahan ` +
        `${daftarPerubahan}${infoSpk}. Klik untuk lihat detailnya.`,
        "#/persetujuan");

      formEl.innerHTML = "";
      kabar("Pengajuan perubahan unit terkirim, menunggu persetujuan Owner.", "netral");
    } catch (err) {
      kabar("Gagal mengirim pengajuan: " + err.message, "rem");
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
// Sama seperti cariUnitReady, tapi mengembalikan SEMUA unit Ready
// yang cocok (bukan cuma satu) — dipakai di form SPK supaya sales
// bisa pilih unit spesifik (rangka/mesin) kalau stoknya lebih dari
// satu, bukan diambil otomatis begitu saja.
// Dipakai form SPK — daftar ringkas SEMUA unit Ready lintas tipe,
// disaring per tipeId di sisi klien begitu Tipe Motor dipilih,
// supaya tabelnya langsung muncul tanpa query berulang tiap ganti
// tipe.
export async function muatSemuaUnitReadyRingkas() {
  const snap = await getDocs(query(
    collection(dbase, "units"), where("status", "==", "ready"), limit(300)
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function cariSemuaUnitReady(tipeId, warna) {
  const snap = await getDocs(query(
    collection(dbase, "units"),
    where("tipeId", "==", tipeId),
    where("warna", "==", warna),
    where("status", "==", "ready"),
    limit(50)
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.tglMasuk?.seconds || 0) - (b.tglMasuk?.seconds || 0));
}

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

// ── Kunci unit, VERSI ANTI-REBUTAN ───────────────────────────────
// Masalah kunciUnitKeBatch di atas: unit dicari lewat QUERY (baca)
// lalu belakangan baru ditulis lewat writeBatch — ada JEDA di antara
// keduanya. Kalau dua sales sama-sama pilih unit yang sama persis di
// jeda itu, DUA-DUANYA bisa lolos mengunci unit yang sama (Firestore
// batch tidak mengecek ulang kondisi terkini saat commit).
//
// Fungsi ini menutup celah itu: baca ULANG status unit dan menulis
// kuncinya dalam SATU runTransaction — Firestore menjamin cuma SATU
// pemanggil yang bisa berhasil kalau dua-duanya coba unit yang sama
// di saat bersamaan, yang kalah otomatis dilempar error dan harus
// coba unit lain (lihat kunciUnitReadyDenganRetry di spk.js).
export async function kunciUnitTransaksi(unitId, tipeId, spkId) {
  await runTransaction(dbase, async (trx) => {
    const refUnit = doc(dbase, "units", unitId);
    const snap = await trx.get(refUnit);
    if (!snap.exists() || snap.data().status !== "ready") {
      throw new Error("UNIT_SUDAH_TERKUNCI");
    }
    trx.update(refUnit, { status: "booked", spkId });
    trx.update(doc(dbase, "tipe_motor", tipeId), { jumlahReady: increment(-1) });
  });
}

// Lepas kunci unit (dipakai saat Owner ganti unit di form Ubah, atau
// batalkan SPK) — juga lewat transaksi, konsisten dengan penguncian.
export async function lepasUnitTransaksi(unitId) {
  await runTransaction(dbase, async (trx) => {
    const refUnit = doc(dbase, "units", unitId);
    const snap = await trx.get(refUnit);
    if (!snap.exists() || snap.data().status !== "booked") return; // sudah bukan booked, abaikan
    trx.update(refUnit, { status: "ready", spkId: null });
    trx.update(doc(dbase, "tipe_motor", snap.data().tipeId), { jumlahReady: increment(1) });
  });
}

// Sama seperti lepasUnitTransaksi, TAPI juga menangani unit yang
// statusnya sudah "terjual" (bukan cuma "booked") — dipakai khusus
// oleh "Hapus SPK Permanen", yang justru paling sering dipakai untuk
// SPK yang SUDAH Lunas & unitnya sudah Terjual (satu-satunya kondisi
// yang tidak bisa dibereskan lewat "Batalkan" biasa).
export async function lepasUnitPermanen(unitId) {
  await runTransaction(dbase, async (trx) => {
    const refUnit = doc(dbase, "units", unitId);
    const snap = await trx.get(refUnit);
    if (!snap.exists()) return;
    if (snap.data().status === "ready") return; // sudah Ready, tidak usah diapa-apakan
    trx.update(refUnit, { status: "ready", spkId: null });
    trx.update(doc(dbase, "tipe_motor", snap.data().tipeId), { jumlahReady: increment(1) });
  });
}

// ── Terapkan perubahan identitas unit ───────────────────────────
// Dipakai di DUA tempat: (1) Owner mengubah langsung dari halaman
// ini, (2) Persetujuan Perubahan, saat Owner menyetujui pengajuan
// Admin. Jadi logikanya (jaga rangka unik, pindahkan jumlahReady
// kalau tipe berubah) cuma ditulis sekali, tidak dobel.
export async function terapkanPerubahanUnit(u, dataBaru) {
  const rangkaBerubah = dataBaru.noRangka !== u.noRangka;
  const mesinBerubah = dataBaru.noMesin !== u.noMesin;
  const tipeBerubah = dataBaru.tipeId !== u.tipeId;

  if (rangkaBerubah) {
    await pakaiNilaiUnik("indeks_rangka", dataBaru.noRangka, u.id);
  }
  if (mesinBerubah && dataBaru.noMesin) {
    try {
      await pakaiNilaiUnik("indeks_mesin", dataBaru.noMesin, u.id);
    } catch (errMesin) {
      if (rangkaBerubah) {
        try { await deleteDoc(doc(dbase, "indeks_rangka", dataBaru.noRangka)); } catch { /* biarkan */ }
      }
      throw errMesin;
    }
  }

  const batch = writeBatch(dbase);
  batch.update(doc(dbase, "units", u.id), { ...dataBaru });

  if (tipeBerubah && u.status === "ready") {
    batch.update(doc(dbase, "tipe_motor", u.tipeId), { jumlahReady: increment(-1) });
    batch.update(doc(dbase, "tipe_motor", dataBaru.tipeId), { jumlahReady: increment(1) });
  }

  sertakanLog(batch, "unit_diubah", {
    koleksi: "units", docId: u.id,
    ringkas: `${u.noRangka || "-"} → ${dataBaru.noRangka}`,
  });

  await batch.commit();

  // Lepas indeks LAMA (rangka & mesin) baru setelah batch utama
  // berhasil — supaya kalau batch di atas gagal, nomor lama tidak
  // sampai kelanjur terlepas padahal datanya belum benar-benar berubah.
  if (rangkaBerubah && u.noRangka) {
    try {
      await deleteDoc(doc(dbase, "indeks_rangka", u.noRangka.toUpperCase()));
    } catch { /* tidak fatal — nomor lama tertinggal terkunci, bisa dibetulkan manual */ }
  }
  if (mesinBerubah && u.noMesin) {
    try {
      await deleteDoc(doc(dbase, "indeks_mesin", u.noMesin.toUpperCase()));
    } catch { /* tidak fatal */ }
  }

  await sinkronKatalog();
}

// Bandingkan data lama vs baru jadi kalimat yang gampang dibaca
// Owner — sama seperti buatCatatanPerubahan di spk.js, tapi untuk
// field-field milik Data Unit.
const LABEL_FIELD_UNIT = {
  tipeNama: "Tipe Motor", warna: "Warna", tahun: "Tahun",
  noRangka: "No. Rangka", noMesin: "No. Mesin", noDo: "No. DO",
  supplierNama: "Supplier",
};
export function buatCatatanUnit(u, dataBaru) {
  const baris = [];
  Object.keys(LABEL_FIELD_UNIT).forEach((f) => {
    const lama = (u[f] ?? "-").toString().trim();
    const baru = (dataBaru[f] ?? "-").toString().trim();
    if (lama !== baru) {
      baris.push(`${LABEL_FIELD_UNIT[f]}: "${lama || "-"}" → "${baru || "-"}"`);
    }
  });
  return baris.length ? baris.join("\n") : "Tidak ada perubahan data yang terdeteksi.";
}

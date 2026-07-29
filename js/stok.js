// stok.js — unit fisik, dibedakan hanya oleh nomor rangka.
// Input dibuat sependek mungkin: pilih tipe, isi dua nomor.

import {
  dbase, collection, doc, getDocs, query, where, orderBy, limit,
  writeBatch, serverTimestamp, increment, pakaiNilaiUnik,
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

function kartuUnit(u, bisaLihatHarga) {
  return `<article class="kartu kartu--unit">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(u.tipeNama)}</h3>
        <p class="kartu-sub">${aman(u.warna || "-")} · ${aman(u.tahun || "-")}</p>
      </div>
      <span class="tanda tanda--${u.status}">${LABEL_STATUS[u.status] || u.status}</span>
    </div>
    <dl class="rinci">
      <div><dt>Rangka</dt><dd class="mono">${aman(u.noRangka)}</dd></div>
      <div><dt>Mesin</dt><dd class="mono">${aman(u.noMesin || "-")}</dd></div>
      <div><dt>Masuk</dt><dd>${tanggal(u.tglMasuk)}</dd></div>
      ${u.noDo ? `<div><dt>No. DO</dt><dd class="mono">${aman(u.noDo)}</dd></div>` : ""}
    </dl>
  </article>`;
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
           autocapitalize="characters" placeholder="MH1JM...">
    <p class="petunjuk">Belum sempat mengetik? Isi belakangan —
      unit tetap bisa disimpan asal nomor rangkanya ada.</p>

    <label class="label label--gelap" for="u-mesin">Nomor mesin</label>
    <input class="isian isian--terang mono" id="u-mesin"
           autocapitalize="characters" placeholder="JM51E...">

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
                  placeholder="17.200.000">
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
      <h2 class="judul">Stok</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="tambah-unit">Tambah unit</button>` : ""}
    </div>
    <div class="chip-baris" id="saring">
      <button class="chip aktif" data-status="ready">Ready</button>
      <button class="chip" data-status="booked">Dipesan</button>
      <button class="chip" data-status="terjual">Terjual</button>
    </div>
    <div id="wadah-form-unit"></div>
    <div id="daftar-unit" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-unit");
  const formEl = wadah.querySelector("#wadah-form-unit");
  let status = "ready";

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    // Menyaring saja, tanpa orderBy — supaya Firestore tidak
    // menuntut indeks gabungan. Urutannya dibereskan di sini.
    const snap = await getDocs(query(
      collection(dbase, "units"),
      where("status", "==", status),
      limit(60)
    ));
    const unit = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
    daftarEl.innerHTML = unit.length
      ? unit.map((u) => kartuUnit(u, bisaLihatHarga)).join("")
      : `<div class="hampa"><p>Tidak ada unit berstatus
         ${LABEL_STATUS[status].toLowerCase()}.</p></div>`;
  }

  wadah.querySelector("#saring").addEventListener("click", (e) => {
    const t = e.target.closest("[data-status]");
    if (!t) return;
    status = t.dataset.status;
    wadah.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("aktif", c === t));
    gambar();
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
      if (status !== "ready") status = "ready";
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

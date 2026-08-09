// rekening.js — master rekening perusahaan, dulunya statis di
// config.js (REKENING, masih kosong), sekarang bisa diisi sendiri.
// Dipakai sebagai pilihan "rekening tujuan" saat pembeli bayar
// transfer di SPK, dan nanti dicetak di lembar SPK/kuitansi.

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.3.1";
import { bolehAkses } from "./auth.js?v=3.3.1";
import { aman, kabar } from "./ui.js?v=3.3.1";

let cache = [];

export async function muatRekening(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "rekening"), orderBy("bank"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

export function rekeningAktif() {
  return cache.filter((r) => r.aktif !== false);
}

export function rekeningDari(id) {
  return cache.find((r) => r.id === id);
}

function kartuRekening(r, bisaUbah) {
  return `<article class="kartu ${r.aktif === false ? "kartu--batal" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(r.bank)}</h3>
        <p class="kartu-sub mono">${aman(r.nomor)}</p>
      </div>
      <span class="tanda ${r.aktif === false ? "tanda--batal" : "tanda--ready"}">
        ${r.aktif === false ? "Nonaktif" : "Aktif"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>Atas nama</dt><dd>${aman(r.atasNama)}</dd></div>
      ${r.cabang ? `<div><dt>Cabang</dt><dd>${aman(r.cabang)}</dd></div>` : ""}
    </dl>
    ${bisaUbah ? `<div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-ubah="${r.id}">Ubah</button>
      <button class="tombol tombol--kecil" data-status="${r.id}">
        ${r.aktif === false ? "Aktifkan" : "Nonaktifkan"}</button>
    </div>` : ""}
  </article>`;
}

function formRekening(r = {}) {
  return `<form id="form-rekening" class="form">
    <input type="hidden" id="r-id" value="${aman(r.id || "")}">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="r-bank">Bank</label>
        <input class="isian isian--terang" id="r-bank"
               value="${aman(r.bank || "")}" placeholder="BCA">
      </div>
      <div>
        <label class="label label--gelap" for="r-nomor">Nomor rekening</label>
        <input class="isian isian--terang mono" id="r-nomor"
               value="${aman(r.nomor || "")}" placeholder="1234567890">
      </div>
    </div>
    <label class="label label--gelap" for="r-atasnama">Atas nama</label>
    <input class="isian isian--terang" id="r-atasnama"
           value="${aman(r.atasNama || "")}" placeholder="PT AUTO MITRA UTAMA">
    <label class="label label--gelap" for="r-cabang">Cabang (opsional)</label>
    <input class="isian isian--terang" id="r-cabang"
           value="${aman(r.cabang || "")}">
    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-rekening">Batal</button>
    </div>
  </form>`;
}

export async function halamanRekening(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Master Rekening</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="tambah-rekening">Tambah</button>` : ""}
    </div>
    <div id="form-rekening-wadah"></div>
    <div id="daftar-rekening" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-rekening");
  const formEl = wadah.querySelector("#form-rekening-wadah");

  async function gambar() {
    const semua = await muatRekening(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((r) => kartuRekening(r, bisaUbah)).join("")
      : `<div class="hampa"><p>Belum ada rekening terdaftar.</p></div>`;
    if (!bisaUbah) return;
    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => buka(rekeningDari(b.dataset.ubah))));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
  }

  function buka(r) {
    formEl.innerHTML = formRekening(r || {});
    formEl.querySelector("#batal-rekening")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-rekening").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = formEl.querySelector("#r-id").value;
      const bank = formEl.querySelector("#r-bank").value.trim();
      const nomor = formEl.querySelector("#r-nomor").value.trim();
      const atasNama = formEl.querySelector("#r-atasnama").value.trim();
      if (!bank || !nomor || !atasNama) {
        kabar("Bank, nomor rekening, dan atas nama wajib diisi.", "rem");
        return;
      }
      const data = {
        bank, nomor, atasNama,
        cabang: formEl.querySelector("#r-cabang").value.trim(),
        aktif: r && r.id ? r.aktif !== false : true,
        diubahPada: serverTimestamp(),
      };
      try {
        const ref = id
          ? doc(dbase, "rekening", id)
          : doc(collection(dbase, "rekening"));
        if (!id) Object.assign(data, tandaBaru());
        await setDoc(ref, data, { merge: true });
        await catat(id ? "rekening_diubah" : "rekening_ditambah", {
          koleksi: "rekening", docId: ref.id, ringkas: `${bank} ${nomor}`,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar(id ? "Rekening diperbarui." : "Rekening ditambahkan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahStatus(id) {
    const r = rekeningDari(id);
    try {
      await updateDoc(doc(dbase, "rekening", id), { aktif: r.aktif === false });
      await catat("rekening_status_diubah", { koleksi: "rekening", docId: id });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-rekening")
      .addEventListener("click", () => buka(null));
  }
  await gambar();
}

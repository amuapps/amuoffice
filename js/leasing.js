// leasing.js — master partner leasing (Adira, FIF, dll).
// Dipakai sebagai dropdown di tab Payment Info pada SPK, supaya
// nama leasing tidak diketik ulang tiap transaksi.

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.9.0";
import { bolehAkses } from "./auth.js?v=3.9.0";
import { aman, kabar } from "./ui.js?v=3.9.0";

let cache = [];

export async function muatLeasing(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "leasing"), orderBy("nama"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

// Dipakai di SPK — cuma leasing yang masih aktif yang ditawarkan.
export function leasingAktif() {
  return cache.filter((l) => l.aktif !== false);
}

export function leasingDari(id) {
  return cache.find((l) => l.id === id);
}

function kartuLeasing(l, bisaUbah) {
  return `<article class="kartu ${l.aktif === false ? "kartu--batal" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(l.nama)}</h3>
        <p class="kartu-sub">${aman(l.pic || "Tanpa PIC")}${
          l.telepon ? ` · ${aman(l.telepon)}` : ""}</p>
      </div>
      <span class="tanda ${l.aktif === false ? "tanda--batal" : "tanda--ready"}">
        ${l.aktif === false ? "Nonaktif" : "Aktif"}
      </span>
    </div>
    ${bisaUbah ? `<div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-ubah="${l.id}">Ubah</button>
      <button class="tombol tombol--kecil" data-status="${l.id}">
        ${l.aktif === false ? "Aktifkan" : "Nonaktifkan"}</button>
    </div>` : ""}
  </article>`;
}

function formLeasing(l = {}) {
  return `<form id="form-leasing" class="form">
    <input type="hidden" id="l-id" value="${aman(l.id || "")}">
    <label class="label label--gelap" for="l-nama">Nama leasing</label>
    <input class="isian isian--terang" id="l-nama"
           value="${aman(l.nama || "")}" placeholder="Adira Finance">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="l-pic">PIC / Marketing</label>
        <input class="isian isian--terang" id="l-pic"
               value="${aman(l.pic || "")}" placeholder="Nama PIC">
      </div>
      <div>
        <label class="label label--gelap" for="l-telepon">No. Telepon</label>
        <input class="isian isian--terang mono" id="l-telepon"
               inputmode="tel" value="${aman(l.telepon || "")}"
               placeholder="08…">
      </div>
    </div>
    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-leasing">Batal</button>
    </div>
  </form>`;
}

export async function halamanLeasing(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Master Leasing</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="tambah-leasing">Tambah</button>` : ""}
    </div>
    <div id="form-leasing-wadah"></div>
    <div id="daftar-leasing" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-leasing");
  const formEl = wadah.querySelector("#form-leasing-wadah");

  async function gambar() {
    const semua = await muatLeasing(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((l) => kartuLeasing(l, bisaUbah)).join("")
      : `<div class="hampa"><p>Belum ada leasing terdaftar.</p></div>`;
    if (!bisaUbah) return;
    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => buka(leasingDari(b.dataset.ubah))));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
  }

  function buka(l) {
    formEl.innerHTML = formLeasing(l || {});
    formEl.querySelector("#batal-leasing")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-leasing").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = formEl.querySelector("#l-id").value;
      const nama = formEl.querySelector("#l-nama").value.trim();
      if (!nama) { kabar("Nama leasing wajib diisi.", "rem"); return; }
      const data = {
        nama,
        pic: formEl.querySelector("#l-pic").value.trim(),
        telepon: formEl.querySelector("#l-telepon").value.trim(),
        aktif: l && l.id ? l.aktif !== false : true,
        diubahPada: serverTimestamp(),
      };
      try {
        const ref = id
          ? doc(dbase, "leasing", id)
          : doc(collection(dbase, "leasing"));
        if (!id) Object.assign(data, tandaBaru());
        await setDoc(ref, data, { merge: true });
        await catat(id ? "leasing_diubah" : "leasing_ditambah", {
          koleksi: "leasing", docId: ref.id, ringkas: nama,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar(id ? "Leasing diperbarui." : "Leasing ditambahkan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahStatus(id) {
    const l = leasingDari(id);
    try {
      await updateDoc(doc(dbase, "leasing", id), { aktif: l.aktif === false });
      await catat("leasing_status_diubah", { koleksi: "leasing", docId: id });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-leasing")
      .addEventListener("click", () => buka(null));
  }
  await gambar();
}

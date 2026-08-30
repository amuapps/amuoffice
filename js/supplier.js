// supplier.js — master data supplier/pemasok unit. Dipakai sebagai
// pilihan "Supplier" di Data Unit — mencatat dari mana unit itu
// dipasok. Beda dari Agen/Biro Jasa (tidak rahasia — Sales/Admin
// semua boleh lihat, sama seperti Master Leasing/Rekening).

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.10.2";
import { bolehAkses } from "./auth.js?v=3.10.2";
import { aman, kabar, pasangHurufBesar } from "./ui.js?v=3.10.2";

let cache = [];

export async function muatSupplier(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "supplier"), orderBy("nama"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

export function supplierAktif() {
  return cache.filter((s) => s.aktif !== false);
}

export function supplierDari(id) {
  return cache.find((s) => s.id === id);
}

function kartuSupplier(s, bisaUbah) {
  return `<article class="kartu ${s.aktif === false ? "kartu--batal" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(s.nama)}</h3>
        <p class="kartu-sub mono">${aman(s.kontak || "-")}</p>
      </div>
      <span class="tanda ${s.aktif === false ? "tanda--batal" : "tanda--ready"}">
        ${s.aktif === false ? "Nonaktif" : "Aktif"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>Alamat</dt><dd>${aman(s.alamat || "-")}</dd></div>
      <div><dt>Email</dt><dd>${aman(s.email || "-")}</dd></div>
    </dl>
    ${bisaUbah ? `<div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-ubah="${s.id}">Ubah</button>
      <button class="tombol tombol--kecil" data-status="${s.id}">
        ${s.aktif === false ? "Aktifkan" : "Nonaktifkan"}</button>
    </div>` : ""}
  </article>`;
}

function formSupplier(s = {}) {
  return `<form id="form-supplier" class="form">
    <input type="hidden" id="sp-id" value="${aman(s.id || "")}">
    <label class="label label--gelap" for="sp-nama">Nama Supplier</label>
    <input class="isian isian--terang" id="sp-nama"
           value="${aman(s.nama || "")}" placeholder="Nama perusahaan/perorangan">
    <label class="label label--gelap" for="sp-kontak">Kontak (No. HP)</label>
    <input class="isian isian--terang mono" id="sp-kontak"
           inputmode="tel" value="${aman(s.kontak || "")}" placeholder="08…">
    <label class="label label--gelap" for="sp-alamat">Alamat</label>
    <input class="isian isian--terang" id="sp-alamat" value="${aman(s.alamat || "")}">
    <label class="label label--gelap" for="sp-email">Email</label>
    <input class="isian isian--terang" id="sp-email" type="email"
           value="${aman(s.email || "")}" placeholder="Opsional">
    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-supplier">Batal</button>
    </div>
  </form>`;
}

export async function halamanSupplier(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Master Supplier</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="tambah-supplier">Tambah</button>` : ""}
    </div>
    <p class="petunjuk">Vendor pemasok unit — dipakai sebagai pilihan
      "Supplier" saat menambah/mengubah data unit di Inventory.</p>
    <div id="form-supplier-wadah"></div>
    <div id="daftar-supplier" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-supplier");
  const formEl = wadah.querySelector("#form-supplier-wadah");

  async function gambar() {
    const semua = await muatSupplier(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((s) => kartuSupplier(s, bisaUbah)).join("")
      : `<div class="hampa"><p>Belum ada supplier terdaftar.</p></div>`;
    if (!bisaUbah) return;
    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => buka(supplierDari(b.dataset.ubah))));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
  }

  function buka(s) {
    formEl.innerHTML = formSupplier(s || {});
    pasangHurufBesar(formEl.querySelector("#sp-nama"));
    formEl.querySelector("#batal-supplier")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-supplier").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = formEl.querySelector("#sp-id").value;
      const nama = formEl.querySelector("#sp-nama").value.trim();
      if (!nama) {
        kabar("Nama supplier wajib diisi.", "rem");
        return;
      }
      const data = {
        nama,
        kontak: formEl.querySelector("#sp-kontak").value.trim(),
        alamat: formEl.querySelector("#sp-alamat").value.trim(),
        email: formEl.querySelector("#sp-email").value.trim(),
        aktif: s && s.id ? s.aktif !== false : true,
        diubahPada: serverTimestamp(),
      };
      try {
        const ref = id ? doc(dbase, "supplier", id) : doc(collection(dbase, "supplier"));
        if (!id) Object.assign(data, tandaBaru());
        await setDoc(ref, data, { merge: true });
        await catat(id ? "supplier_diubah" : "supplier_ditambah", {
          koleksi: "supplier", docId: ref.id, ringkas: nama,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar(id ? "Supplier diperbarui." : "Supplier ditambahkan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahStatus(id) {
    const s = supplierDari(id);
    try {
      await updateDoc(doc(dbase, "supplier", id), { aktif: s.aktif === false });
      await catat("supplier_status_diubah", { koleksi: "supplier", docId: id });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-supplier").addEventListener("click", () => buka(null));
  }
  await gambar();
}

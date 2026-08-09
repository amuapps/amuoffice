// biro.js — master data biro jasa (vendor pengurusan STNK/BPKB).
// Komponen BBN di harga OTR (Harga Offroad + BBN) itu sebenarnya
// biaya yang dibayarkan ke biro jasa untuk mengurus dokumen
// kendaraan — modul ini yang mencatat SIAPA biro jasanya dan
// BERAPA biaya sungguhannya per SPK.
//
// SELURUH halaman ini (baca & tulis) sengaja dibatasi cuma Owner —
// sama seperti Master Agen, karena biaya biro jasa juga rahasia
// internal.

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.2.5";
import { bolehAkses } from "./auth.js?v=3.2.5";
import { aman, kabar, pasangHurufBesar } from "./ui.js?v=3.2.5";

let cache = [];

export async function muatBiro(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "biro_jasa"), orderBy("nama"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

// Dipakai nanti di SPK — cuma biro jasa aktif yang ditawarkan.
export function biroAktif() {
  return cache.filter((b) => b.aktif !== false);
}

export function biroDari(id) {
  return cache.find((b) => b.id === id);
}

function kartuBiro(b, bisaUbah) {
  return `<article class="kartu ${b.aktif === false ? "kartu--batal" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(b.nama)}</h3>
        <p class="kartu-sub mono">ID: ${aman(b.idBiro)}</p>
      </div>
      <span class="tanda ${b.aktif === false ? "tanda--batal" : "tanda--ready"}">
        ${b.aktif === false ? "Nonaktif" : "Aktif"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>NIK</dt><dd class="mono">${aman(b.nik || "-")}</dd></div>
      <div><dt>No. HP</dt><dd class="mono">${aman(b.noHp || "-")}</dd></div>
      <div><dt>Email</dt><dd>${aman(b.email || "-")}</dd></div>
    </dl>
    ${bisaUbah ? `<div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-ubah="${b.id}">Ubah</button>
      <button class="tombol tombol--kecil" data-status="${b.id}">
        ${b.aktif === false ? "Aktifkan" : "Nonaktifkan"}</button>
    </div>` : ""}
  </article>`;
}

function formBiro(b = {}) {
  return `<form id="form-biro" class="form">
    <input type="hidden" id="bj-id" value="${aman(b.id || "")}">
    <label class="label label--gelap" for="bj-idbiro">ID Biro Jasa</label>
    <input class="isian isian--terang mono" id="bj-idbiro"
           value="${aman(b.idBiro || "")}" placeholder="BJ-001"
           ${b.id ? "disabled" : ""}>
    <p class="petunjuk">Wajib diisi. ${b.id ? "Tidak bisa diubah setelah dibuat." : ""}</p>

    <label class="label label--gelap" for="bj-nama">Nama lengkap / Nama usaha</label>
    <input class="isian isian--terang" id="bj-nama"
           value="${aman(b.nama || "")}" placeholder="Sesuai KTP atau nama biro">

    <div class="dua">
      <div>
        <label class="label label--gelap" for="bj-nik">NIK</label>
        <input class="isian isian--terang mono" id="bj-nik"
               inputmode="numeric" value="${aman(b.nik || "")}"
               placeholder="16 digit, sesuai KTP">
      </div>
      <div>
        <label class="label label--gelap" for="bj-nohp">No. HP</label>
        <input class="isian isian--terang mono" id="bj-nohp"
               inputmode="tel" value="${aman(b.noHp || "")}" placeholder="08…">
      </div>
    </div>

    <label class="label label--gelap" for="bj-email">Email</label>
    <input class="isian isian--terang" id="bj-email" type="email"
           value="${aman(b.email || "")}" placeholder="Opsional">

    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-biro">Batal</button>
    </div>
  </form>`;
}

export async function halamanBiro(wadah) {
  const bisaUbah = bolehAkses("kelola.pengguna"); // owner-only, sama seperti Master Agen

  if (!bisaUbah) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Hanya Owner yang bisa melihat Master Biro Jasa.</p></div>
    </section>`;
    return;
  }

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Master Biro Jasa</h2>
      <button class="tombol tombol--kecil tombol--isi" id="tambah-biro">Tambah</button>
    </div>
    <p class="petunjuk">Vendor pengurusan STNK/BPKB. Komponen BBN pada
      harga OTR itu biaya yang dibayarkan ke biro jasa — dipakai nanti
      sebagai pilihan "Biro Jasa" di SPK, cuma terlihat Owner.</p>
    <div id="form-biro-wadah"></div>
    <div id="daftar-biro" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-biro");
  const formEl = wadah.querySelector("#form-biro-wadah");

  async function gambar() {
    const semua = await muatBiro(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((b) => kartuBiro(b, true)).join("")
      : `<div class="hampa"><p>Belum ada biro jasa terdaftar.</p></div>`;
    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => buka(biroDari(b.dataset.ubah))));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
  }

  function buka(b) {
    formEl.innerHTML = formBiro(b || {});
    pasangHurufBesar(formEl.querySelector("#bj-nama"));
    formEl.querySelector("#batal-biro")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-biro").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = formEl.querySelector("#bj-id").value;
      const idBiro = formEl.querySelector("#bj-idbiro").value.trim();
      const nama = formEl.querySelector("#bj-nama").value.trim();
      const nik = formEl.querySelector("#bj-nik").value.trim();
      const noHp = formEl.querySelector("#bj-nohp").value.trim();
      const email = formEl.querySelector("#bj-email").value.trim();
      if (!idBiro || !nama || !noHp) {
        kabar("ID Biro Jasa, Nama, dan No. HP wajib diisi.", "rem");
        return;
      }
      if (!id) {
        const bentrok = (await muatBiro()).some(
          (b) => b.idBiro.toLowerCase() === idBiro.toLowerCase());
        if (bentrok) {
          kabar("ID Biro Jasa ini sudah dipakai.", "rem");
          return;
        }
      }
      const data = {
        idBiro, nama, nik, noHp, email,
        aktif: b && b.id ? b.aktif !== false : true,
        diubahPada: serverTimestamp(),
      };
      try {
        const ref = id ? doc(dbase, "biro_jasa", id) : doc(collection(dbase, "biro_jasa"));
        if (!id) Object.assign(data, tandaBaru());
        await setDoc(ref, data, { merge: true });
        await catat(id ? "biro_diubah" : "biro_ditambah", {
          koleksi: "biro_jasa", docId: ref.id, ringkas: `${idBiro} · ${nama}`,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar(id ? "Biro jasa diperbarui." : "Biro jasa ditambahkan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahStatus(id) {
    const b = biroDari(id);
    try {
      await updateDoc(doc(dbase, "biro_jasa", id), { aktif: b.aktif === false });
      await catat("biro_status_diubah", { koleksi: "biro_jasa", docId: id });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  wadah.querySelector("#tambah-biro").addEventListener("click", () => buka(null));
  await gambar();
}

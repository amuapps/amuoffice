// agen.js — master data agen penjualan. Dipakai nanti sebagai
// pilihan "Fee Agen" di SPK (khusus terlihat oleh Owner), dan jadi
// dasar portal login agen di tahap berikutnya (belum dibangun).
//
// SELURUH halaman ini (baca & tulis) sengaja dibatasi cuma Owner —
// konsisten dengan aturan "Fee Agen cuma Owner yang lihat". Admin
// dan Sales tidak tahu daftar agen ini sama sekali.

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js";
import { bolehAkses } from "./auth.js";
import { aman, kabar, pasangHurufBesar } from "./ui.js";

let cache = [];

export async function muatAgen(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "agen"), orderBy("nama"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

// Dipakai nanti di SPK — cuma agen aktif yang ditawarkan.
export function agenAktif() {
  return cache.filter((a) => a.aktif !== false);
}

export function agenDari(id) {
  return cache.find((a) => a.id === id);
}

function kartuAgen(a, bisaUbah) {
  return `<article class="kartu ${a.aktif === false ? "kartu--batal" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(a.nama)}</h3>
        <p class="kartu-sub mono">ID: ${aman(a.idAgen)}</p>
      </div>
      <span class="tanda ${a.aktif === false ? "tanda--batal" : "tanda--ready"}">
        ${a.aktif === false ? "Nonaktif" : "Aktif"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>NIK</dt><dd class="mono">${aman(a.nik || "-")}</dd></div>
      <div><dt>No. HP</dt><dd class="mono">${aman(a.noHp || "-")}</dd></div>
      <div><dt>Email</dt><dd>${aman(a.email || "-")}</dd></div>
    </dl>
    ${bisaUbah ? `<div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-ubah="${a.id}">Ubah</button>
      <button class="tombol tombol--kecil" data-status="${a.id}">
        ${a.aktif === false ? "Aktifkan" : "Nonaktifkan"}</button>
    </div>` : ""}
  </article>`;
}

function formAgen(a = {}) {
  return `<form id="form-agen" class="form">
    <input type="hidden" id="a-id" value="${aman(a.id || "")}">
    <label class="label label--gelap" for="a-idagen">ID Agen</label>
    <input class="isian isian--terang mono" id="a-idagen"
           value="${aman(a.idAgen || "")}" placeholder="AGN-001"
           ${a.id ? "disabled" : ""}>
    <p class="petunjuk">Wajib diisi, dipakai juga nanti sebagai identitas
      login portal agen. ${a.id ? "Tidak bisa diubah setelah dibuat." : ""}</p>

    <label class="label label--gelap" for="a-nama">Nama lengkap</label>
    <input class="isian isian--terang" id="a-nama"
           value="${aman(a.nama || "")}" placeholder="Sesuai KTP">

    <div class="dua">
      <div>
        <label class="label label--gelap" for="a-nik">NIK</label>
        <input class="isian isian--terang mono" id="a-nik"
               inputmode="numeric" value="${aman(a.nik || "")}"
               placeholder="16 digit, sesuai KTP">
      </div>
      <div>
        <label class="label label--gelap" for="a-nohp">No. HP</label>
        <input class="isian isian--terang mono" id="a-nohp"
               inputmode="tel" value="${aman(a.noHp || "")}" placeholder="08…">
      </div>
    </div>

    <label class="label label--gelap" for="a-email">Email</label>
    <input class="isian isian--terang" id="a-email" type="email"
           value="${aman(a.email || "")}"
           placeholder="Dipakai nanti untuk akun login portal agen">

    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-agen">Batal</button>
    </div>
  </form>`;
}

export async function halamanAgen(wadah) {
  const bisaUbah = bolehAkses("kelola.pengguna"); // owner-only, sama seperti Pengguna

  if (!bisaUbah) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Hanya Owner yang bisa melihat Master Agen.</p></div>
    </section>`;
    return;
  }

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Master Agen</h2>
      <button class="tombol tombol--kecil tombol--isi" id="tambah-agen">Tambah</button>
    </div>
    <p class="petunjuk">Data agen penjualan — dipakai nanti sebagai pilihan
      Fee Agen di SPK (cuma terlihat Owner), dan jadi dasar akun login
      portal agen pada tahap berikutnya.</p>
    <div id="form-agen-wadah"></div>
    <div id="daftar-agen" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-agen");
  const formEl = wadah.querySelector("#form-agen-wadah");

  async function gambar() {
    const semua = await muatAgen(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((a) => kartuAgen(a, true)).join("")
      : `<div class="hampa"><p>Belum ada agen terdaftar.</p></div>`;
    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => buka(agenDari(b.dataset.ubah))));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
  }

  function buka(a) {
    formEl.innerHTML = formAgen(a || {});
    pasangHurufBesar(formEl.querySelector("#a-nama"));
    formEl.querySelector("#batal-agen")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-agen").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = formEl.querySelector("#a-id").value;
      const idAgen = formEl.querySelector("#a-idagen").value.trim();
      const nama = formEl.querySelector("#a-nama").value.trim();
      const nik = formEl.querySelector("#a-nik").value.trim();
      const noHp = formEl.querySelector("#a-nohp").value.trim();
      const email = formEl.querySelector("#a-email").value.trim();
      if (!idAgen || !nama || !nik || !noHp) {
        kabar("ID Agen, Nama, NIK, dan No. HP wajib diisi.", "rem");
        return;
      }
      // ID Agen harus unik — cek dulu sebelum disimpan (cuma perlu
      // dicek saat menambah baru; yang sudah ada tidak bisa diubah
      // ID-nya lagi, lihat atribut disabled di formAgen()).
      if (!id) {
        const bentrok = (await muatAgen()).some(
          (a) => a.idAgen.toLowerCase() === idAgen.toLowerCase());
        if (bentrok) {
          kabar("ID Agen ini sudah dipakai agen lain.", "rem");
          return;
        }
      }
      const data = {
        idAgen, nama, nik, noHp, email,
        aktif: a && a.id ? a.aktif !== false : true,
        diubahPada: serverTimestamp(),
      };
      try {
        const ref = id ? doc(dbase, "agen", id) : doc(collection(dbase, "agen"));
        if (!id) Object.assign(data, tandaBaru());
        await setDoc(ref, data, { merge: true });
        await catat(id ? "agen_diubah" : "agen_ditambah", {
          koleksi: "agen", docId: ref.id, ringkas: `${idAgen} · ${nama}`,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar(id ? "Agen diperbarui." : "Agen ditambahkan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahStatus(id) {
    const a = agenDari(id);
    try {
      await updateDoc(doc(dbase, "agen", id), { aktif: a.aktif === false });
      await catat("agen_status_diubah", { koleksi: "agen", docId: id });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  wadah.querySelector("#tambah-agen").addEventListener("click", () => buka(null));
  await gambar();
}

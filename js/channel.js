// channel.js — master data Channel: tujuan Transfer Unit (cabang,
// sub-dealer, showroom rekanan, gudang, dst). Dipakai sebagai
// pilihan "Channel tujuan" di menu Inventory → Transfer Unit, dan
// datanya (nama, PIC, alamat, telepon) ikut tercetak di BAST
// Kendaraan / Surat Jalan.

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.15.1";
import { bolehAkses } from "./auth.js?v=3.15.1";
import { aman, kabar, pasangHurufBesar } from "./ui.js?v=3.15.1";

let cache = [];

const JENIS_CHANNEL = ["Cabang", "Sub-dealer", "Showroom Rekanan", "Gudang", "Lainnya"];

export async function muatChannel(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "channel"), orderBy("nama"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

export function channelAktif() {
  return cache.filter((s) => s.aktif !== false);
}

export function channelDari(id) {
  return cache.find((s) => s.id === id);
}

function kartuChannel(s, bisaUbah) {
  return `<article class="kartu ${s.aktif === false ? "kartu--batal" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(s.nama)}</h3>
        <p class="kartu-sub">${aman(s.jenis || "Channel")} · <span class="mono">${aman(s.kontak || "-")}</span></p>
      </div>
      <span class="tanda ${s.aktif === false ? "tanda--batal" : "tanda--ready"}">
        ${s.aktif === false ? "Nonaktif" : "Aktif"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>PIC</dt><dd>${aman(s.pic || "-")}</dd></div>
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

function formChannel(s = {}) {
  return `<form id="form-channel" class="form">
    <input type="hidden" id="ch-id" value="${aman(s.id || "")}">
    <label class="label label--gelap" for="ch-nama">Nama Channel</label>
    <input class="isian isian--terang" id="ch-nama"
           value="${aman(s.nama || "")}" placeholder="mis. CABANG BIREUEN">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="ch-jenis">Jenis</label>
        <select class="isian isian--terang" id="ch-jenis">
          ${JENIS_CHANNEL.map((j) => `<option ${s.jenis === j ? "selected" : ""}>${j}</option>`).join("")}
        </select>
      </div>
      <div>
        <label class="label label--gelap" for="ch-pic">Nama PIC / Penerima</label>
        <input class="isian isian--terang" id="ch-pic" value="${aman(s.pic || "")}"
               placeholder="Orang yang menerima unit">
      </div>
    </div>
    <label class="label label--gelap" for="ch-kontak">Kontak (No. HP)</label>
    <input class="isian isian--terang mono" id="ch-kontak"
           inputmode="tel" value="${aman(s.kontak || "")}" placeholder="08…">
    <label class="label label--gelap" for="ch-alamat">Alamat</label>
    <input class="isian isian--terang" id="ch-alamat" value="${aman(s.alamat || "")}">
    <label class="label label--gelap" for="ch-email">Email</label>
    <input class="isian isian--terang" id="ch-email" type="email"
           value="${aman(s.email || "")}" placeholder="Opsional">
    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-channel">Batal</button>
    </div>
  </form>`;
}

export async function halamanChannel(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Master Channel</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="tambah-channel">Tambah</button>` : ""}
    </div>
    <p class="petunjuk">Tujuan pengiriman unit (cabang, sub-dealer,
      showroom rekanan, gudang) — dipakai di Inventory → Transfer Unit
      dan tercetak di BAST Kendaraan / Surat Jalan.</p>
    <div id="form-channel-wadah"></div>
    <div id="daftar-channel" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-channel");
  const formEl = wadah.querySelector("#form-channel-wadah");

  async function gambar() {
    const semua = await muatChannel(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((s) => kartuChannel(s, bisaUbah)).join("")
      : `<div class="hampa"><p>Belum ada channel terdaftar.</p></div>`;
    if (!bisaUbah) return;
    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => buka(channelDari(b.dataset.ubah))));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
  }

  function buka(s) {
    formEl.innerHTML = formChannel(s || {});
    pasangHurufBesar(formEl.querySelector("#ch-nama"));
    pasangHurufBesar(formEl.querySelector("#ch-pic"));
    formEl.querySelector("#batal-channel")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-channel").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = formEl.querySelector("#ch-id").value;
      const nama = formEl.querySelector("#ch-nama").value.trim();
      if (!nama) {
        kabar("Nama channel wajib diisi.", "rem");
        return;
      }
      const data = {
        nama,
        jenis: formEl.querySelector("#ch-jenis").value,
        pic: formEl.querySelector("#ch-pic").value.trim(),
        kontak: formEl.querySelector("#ch-kontak").value.replace(/\s/g, ""),
        alamat: formEl.querySelector("#ch-alamat").value.trim(),
        email: formEl.querySelector("#ch-email").value.trim(),
        aktif: s && s.id ? s.aktif !== false : true,
        diubahPada: serverTimestamp(),
      };
      try {
        const ref = id ? doc(dbase, "channel", id) : doc(collection(dbase, "channel"));
        if (!id) Object.assign(data, tandaBaru());
        await setDoc(ref, data, { merge: true });
        await catat(id ? "channel_diubah" : "channel_ditambah", {
          koleksi: "channel", docId: ref.id, ringkas: nama,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar(id ? "Channel diperbarui." : "Channel ditambahkan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahStatus(id) {
    const s = channelDari(id);
    try {
      await updateDoc(doc(dbase, "channel", id), { aktif: s.aktif === false });
      await catat("channel_status_diubah", { koleksi: "channel", docId: id });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-channel").addEventListener("click", () => buka(null));
  }
  await gambar();
}

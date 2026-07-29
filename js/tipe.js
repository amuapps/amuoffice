// tipe.js — master tipe motor.
// Satu tipe dipakai berulang oleh banyak unit fisik, jadi
// spesifikasi cukup diisi sekali. Ini yang membuat input unit
// masuk nanti hanya butuh dua nomor.

import {
  dbase, collection, doc, getDocs, setDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js";
import { bolehAkses } from "./auth.js";
import { pecahHarga } from "./config.js";
import {
  rupiah, aman, kabar, pasangFormatUang, bacaAngka,
} from "./ui.js";

let cache = [];

export async function muatTipe(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "tipe_motor"), orderBy("merek"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

export function tipeDari(id) {
  return cache.find((t) => t.id === id);
}

// ── Katalog publik ────────────────────────────────────────────
// Seluruh katalog ditulis ke SATU dokumen. Pengunjung web membuka
// halaman katalog = 1 pembacaan, bukan satu per motor.
// Hanya field aman yang masuk — tidak ada harga tebus di sini.
export async function sinkronKatalog() {
  const semua = await muatTipe(true);
  const item = semua
    .filter((t) => t.aktif !== false)
    .map((t) => ({
      id: t.id,
      merek: t.merek,
      tipe: t.tipe,
      varian: t.varian || "",
      cc: t.cc || null,
      transmisi: t.transmisi || "",
      warna: t.warna || [],
      hargaOtr: t.hargaOtr || 0,
      foto: t.foto || "",
      tersedia: t.jumlahReady || 0,
    }));
  await setDoc(doc(dbase, "katalog", "list"), {
    item,
    diperbarui: serverTimestamp(),
  });
}

// ── Tampilan ──────────────────────────────────────────────────
function kartuTipe(t, bisaUbah) {
  const pecah = pecahHarga(t.hargaOtr, t.mewah);
  return `<article class="kartu">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(t.merek)} ${aman(t.tipe)}</h3>
        <p class="kartu-sub">${aman(t.varian || "")}${
          t.cc ? ` · ${aman(t.cc)} cc` : ""
        }${t.transmisi ? ` · ${aman(t.transmisi)}` : ""}</p>
      </div>
      <span class="tanda ${t.jumlahReady ? "tanda--ada" : "tanda--habis"}">
        ${t.jumlahReady || 0} ready
      </span>
    </div>
    <p class="angka-besar">${rupiah(t.hargaOtr)}</p>
    <p class="kartu-rinci">
      DPP ${rupiah(pecah.dpp)} · PPN ${rupiah(pecah.ppn)}
      ${t.mewah ? " · kena PPnBM" : ""}
    </p>
    ${
      (t.warna || []).length
        ? `<p class="kartu-rinci">Warna: ${aman((t.warna || []).join(", "))}</p>`
        : ""
    }
    ${
      bisaUbah
        ? `<button class="tombol tombol--kecil" data-ubah="${t.id}">Ubah</button>`
        : ""
    }
  </article>`;
}

function formTipe(t = {}) {
  return `<form id="form-tipe" class="form">
    <input type="hidden" id="t-id" value="${aman(t.id || "")}">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="t-merek">Merek</label>
        <input class="isian isian--terang" id="t-merek"
               value="${aman(t.merek || "")}" placeholder="Honda">
      </div>
      <div>
        <label class="label label--gelap" for="t-tipe">Tipe</label>
        <input class="isian isian--terang" id="t-tipe"
               value="${aman(t.tipe || "")}" placeholder="Beat">
      </div>
    </div>
    <label class="label label--gelap" for="t-varian">Varian</label>
    <input class="isian isian--terang" id="t-varian"
           value="${aman(t.varian || "")}" placeholder="Deluxe CBS">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="t-cc">Isi silinder (cc)</label>
        <input class="isian isian--terang" id="t-cc" inputmode="numeric"
               value="${aman(t.cc || "")}" placeholder="110">
      </div>
      <div>
        <label class="label label--gelap" for="t-transmisi">Transmisi</label>
        <input class="isian isian--terang" id="t-transmisi"
               value="${aman(t.transmisi || "")}" placeholder="Otomatis">
      </div>
    </div>
    <label class="label label--gelap" for="t-warna">Warna tersedia</label>
    <input class="isian isian--terang" id="t-warna"
           value="${aman((t.warna || []).join(", "))}"
           placeholder="Hitam, Merah, Putih">
    <label class="label label--gelap" for="t-harga">Harga OTR</label>
    <input class="isian isian--terang" id="t-harga" inputmode="numeric"
           value="${t.hargaOtr ? Number(t.hargaOtr).toLocaleString("id-ID") : ""}"
           placeholder="18.500.000">
    <label class="pilihan">
      <input type="checkbox" id="t-mewah" ${t.mewah ? "checked" : ""}>
      <span>Di atas 250 cc (kena PPnBM, PPN dihitung 12% penuh)</span>
    </label>
    <label class="label label--gelap" for="t-foto">Tautan foto</label>
    <input class="isian isian--terang" id="t-foto"
           value="${aman(t.foto || "")}" placeholder="https://…">
    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan tipe</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-tipe">Batal</button>
    </div>
  </form>`;
}

export async function halamanTipe(wadah, hanyaLihat = false) {
  const bisaUbah = !hanyaLihat && bolehAkses("stok.ubah");
  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">${hanyaLihat ? "Katalog" : "Tipe motor"}</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="tambah-tipe">Tambah</button>` : ""}
    </div>
    <div id="wadah-form"></div>
    <div id="daftar-tipe" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-tipe");
  const formEl = wadah.querySelector("#wadah-form");

  async function gambar() {
    const semua = await muatTipe(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((t) => kartuTipe(t, bisaUbah)).join("")
      : `<div class="hampa"><p>Belum ada tipe motor.
         ${bisaUbah ? "Tambahkan tipe dulu sebelum memasukkan unit."
                    : "Hubungi admin."}</p></div>`;
    if (bisaUbah) {
      daftarEl.querySelectorAll("[data-ubah]").forEach((b) => {
        b.addEventListener("click", () => bukaForm(tipeDari(b.dataset.ubah)));
      });
    }
  }

  function bukaForm(t) {
    formEl.innerHTML = formTipe(t || {});
    const harga = formEl.querySelector("#t-harga");
    pasangFormatUang(harga);
    formEl.querySelector("#batal-tipe")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-tipe")
      .addEventListener("submit", (e) => simpan(e));
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function simpan(e) {
    e.preventDefault();
    const id = formEl.querySelector("#t-id").value;
    const merek = formEl.querySelector("#t-merek").value.trim();
    const tipe = formEl.querySelector("#t-tipe").value.trim();
    if (!merek || !tipe) {
      kabar("Merek dan tipe wajib diisi.", "rem");
      return;
    }
    const data = {
      merek, tipe,
      varian: formEl.querySelector("#t-varian").value.trim(),
      cc: Number(formEl.querySelector("#t-cc").value || 0) || null,
      transmisi: formEl.querySelector("#t-transmisi").value.trim(),
      warna: formEl.querySelector("#t-warna").value
        .split(",").map((s) => s.trim()).filter(Boolean),
      hargaOtr: bacaAngka(formEl.querySelector("#t-harga")),
      mewah: formEl.querySelector("#t-mewah").checked,
      foto: formEl.querySelector("#t-foto").value.trim(),
      aktif: true,
      diubahPada: serverTimestamp(),
    };

    try {
      const ref = id
        ? doc(dbase, "tipe_motor", id)
        : doc(collection(dbase, "tipe_motor"));
      if (!id) Object.assign(data, tandaBaru(), { jumlahReady: 0 });
      await setDoc(ref, data, { merge: true });
      await catat(id ? "tipe_diubah" : "tipe_ditambah", {
        koleksi: "tipe_motor", docId: ref.id,
        ringkas: `${merek} ${tipe}`,
      });
      await sinkronKatalog();
      formEl.innerHTML = "";
      await gambar();
      kabar(id ? "Tipe diperbarui." : "Tipe ditambahkan.", "netral");
    } catch (err) {
      kabar("Gagal menyimpan: " + err.message, "rem");
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-tipe")
      .addEventListener("click", () => bukaForm(null));
  }
  await gambar();
}

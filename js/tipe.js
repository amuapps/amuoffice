// tipe.js — master tipe motor.
// Satu tipe dipakai berulang oleh banyak unit fisik, jadi
// spesifikasi cukup diisi sekali. Ini yang membuat input unit
// masuk nanti hanya butuh dua nomor.

import {
  dbase, collection, doc, getDocs, setDoc, query, orderBy,
  serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.10.1";
import { bolehAkses } from "./auth.js?v=3.10.1";
import { MEREK_UTAMA } from "./config.js?v=3.10.1";
import { muatSaranTipe, muatSaranWarna } from "./referensi.js?v=3.10.1";
import {
  rupiah, aman, kabar, pasangFormatUang, bacaAngka,
} from "./ui.js?v=3.10.1";

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
function tabelTipe(daftar, bisaUbah) {
  return `<div style="overflow-x:auto">
    <table class="tabel">
      <thead>
        <tr>
          <th>No.</th><th>Merek</th><th>Tipe</th><th>Varian</th><th>CC</th>
          <th>Transmisi</th><th>Warna</th><th>Harga OTR</th><th>Ready</th>
          ${bisaUbah ? "<th></th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${daftar.map((t, i) => `<tr>
          <td class="mono">${i + 1}</td>
          <td>${aman(t.merek)}</td>
          <td>${aman(t.tipe)}</td>
          <td>${aman(t.varian || "-")}</td>
          <td>${aman(t.cc || "-")}</td>
          <td>${aman(t.transmisi || "-")}</td>
          <td>${aman((t.warna || []).join(", ") || "-")}</td>
          <td>${rupiah(t.hargaOtr)}</td>
          <td><span class="tanda ${t.jumlahReady ? "tanda--ada" : "tanda--habis"}">
            ${t.jumlahReady || 0}</span></td>
          ${bisaUbah ? `<td><button class="tombol tombol--kecil"
              data-ubah="${t.id}">Ubah</button></td>` : ""}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function formTipe(t = {}, saranTipe = [], saranWarna = [], bisaLihatBiayaInternal = false) {
  return `<form id="form-tipe" class="form">
    <input type="hidden" id="t-id" value="${aman(t.id || "")}">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="t-merek">Merek</label>
        <input class="isian isian--terang" id="t-merek"
               value="${aman(t.merek || MEREK_UTAMA)}"
               placeholder="${MEREK_UTAMA}">
      </div>
      <div>
        <label class="label label--gelap" for="t-tipe">Tipe</label>
        <input class="isian isian--terang" id="t-tipe" list="daftar-tipe"
               value="${aman(t.tipe || "")}" placeholder="Primavera">
        <datalist id="daftar-tipe">
          ${saranTipe.map((x) => `<option value="${aman(x)}">`).join("")}
        </datalist>
      </div>
    </div>
    <label class="label label--gelap" for="t-varian">Varian</label>
    <input class="isian isian--terang" id="t-varian"
           value="${aman(t.varian || "")}" placeholder="150 i-get ABS">
    <div class="dua">
      <div>
        <label class="label label--gelap" for="t-cc">Isi silinder (cc)</label>
        <input class="isian isian--terang" id="t-cc" inputmode="numeric"
               value="${aman(t.cc || "")}" placeholder="150">
      </div>
      <div>
        <label class="label label--gelap" for="t-transmisi">Transmisi</label>
        <input class="isian isian--terang" id="t-transmisi"
               value="${aman(t.transmisi || "Otomatis CVT")}"
               placeholder="Otomatis CVT">
      </div>
    </div>
    <label class="label label--gelap" for="t-warna">Warna tersedia</label>
    <input class="isian isian--terang" id="t-warna" list="daftar-warna"
           value="${aman((t.warna || []).join(", "))}"
           placeholder="${aman(saranWarna.slice(0, 3).join(", "))}">
    <datalist id="daftar-warna">
      ${saranWarna.map((x) => `<option value="${aman(x)}">`).join("")}
    </datalist>
    <p class="petunjuk">Pisahkan dengan koma. Daftar sarannya bisa
      ditambah/dihapus sendiri lewat menu Referensi.</p>
    ${bisaLihatBiayaInternal ? `
    <p class="pemisah">Catatan Biaya Internal
      <span class="kunci">cuma terlihat Owner</span></p>
    <label class="label label--gelap" for="t-tebus">Harga Tebus (standar tipe ini)</label>
    <input class="isian isian--terang" id="t-tebus" inputmode="numeric"
           value="${t.hargaTebusTipe ? Number(t.hargaTebusTipe).toLocaleString("id-ID") : ""}"
           placeholder="Opsional, 0 kalau tidak ada">
    <p class="petunjuk">Beda dari "Harga Tebus" per unit yang sudah ada
      (itu buat lacak laba per unit terjual) — ini standar/acuan
      tipenya, dipakai buat hitung Harga Offroad di bawah.</p>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="t-kirim">Biaya Pengiriman</label>
        <input class="isian isian--terang" id="t-kirim" inputmode="numeric"
               value="${t.biayaKirim ? Number(t.biayaKirim).toLocaleString("id-ID") : ""}"
               placeholder="Opsional, 0 kalau tidak ada">
      </div>
      <div>
        <label class="label label--gelap" for="t-aksesoris">Aksesoris</label>
        <input class="isian isian--terang" id="t-aksesoris" inputmode="numeric"
               value="${t.aksesoris ? Number(t.aksesoris).toLocaleString("id-ID") : ""}"
               placeholder="Opsional, 0 kalau tidak ada">
      </div>
    </div>
    <label class="label label--gelap" for="t-lain">Lain-lain</label>
    <input class="isian isian--terang" id="t-lain" inputmode="numeric"
           value="${t.lainLain ? Number(t.lainLain).toLocaleString("id-ID") : ""}"
           placeholder="Opsional, 0 kalau tidak ada">
    <p class="petunjuk">Harga Offroad di bawah dihitung OTOMATIS dari
      jumlah 4 angka di atas (Harga Tebus + Kirim + Aksesoris + Lain-lain)
      — tidak diisi manual lagi.</p>
    ` : ""}

    <div class="dua">
      <div>
        <label class="label label--gelap" for="t-offroad">Harga Offroad
          ${bisaLihatBiayaInternal ? `<span class="kunci">otomatis</span>` : ""}</label>
        <input class="isian isian--terang" id="t-offroad" inputmode="numeric" readonly
               value="${t.hargaOffroad ? Number(t.hargaOffroad).toLocaleString("id-ID") : "0"}">
      </div>
      <div>
        <label class="label label--gelap" for="t-bbn">BBN</label>
        <input class="isian isian--terang" id="t-bbn" inputmode="numeric"
               value="${t.bbn ? Number(t.bbn).toLocaleString("id-ID") : ""}"
               placeholder="3.500.000">
        <p class="petunjuk">Ini nominal yang ditransfer ke Biro Jasa
          buat urus STNK/BPKB — Admin perlu tahu angkanya.</p>
      </div>
    </div>
    <label class="label label--gelap" for="t-harga">Harga OTR (jual)
      <span class="kunci">otomatis: offroad + BBN</span></label>
    <input class="isian isian--terang" id="t-harga" inputmode="numeric" readonly
           value="${t.hargaOtr ? Number(t.hargaOtr).toLocaleString("id-ID") : "0"}">

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
      <div style="display:flex;gap:8px">
        <button class="tombol tombol--kecil" id="toggle-filter-tipe">Filter</button>
        ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
          id="tambah-tipe">Tambah</button>` : ""}
      </div>
    </div>

    <div id="panel-filter-tipe" class="lembar" style="margin-top:10px" hidden>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="f-cari-tipe">Cari (Merek/Tipe/Varian)</label>
          <input class="isian isian--terang" id="f-cari-tipe" placeholder="mis. Primavera">
        </div>
        <div>
          <label class="label label--gelap" for="f-status-tipe">Stok</label>
          <select class="isian isian--terang" id="f-status-tipe">
            <option value="">— semua —</option>
            <option value="ready">Ada Ready</option>
            <option value="habis">Habis (0 ready)</option>
          </select>
        </div>
      </div>
    </div>

    <div id="wadah-form"></div>
    <div id="daftar-tipe" class="daftar" style="margin-top:10px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-tipe");
  const formEl = wadah.querySelector("#wadah-form");
  const cariEl = wadah.querySelector("#f-cari-tipe");
  const statusEl = wadah.querySelector("#f-status-tipe");
  let semuaTipe = [];

  wadah.querySelector("#toggle-filter-tipe").addEventListener("click", () => {
    const p = wadah.querySelector("#panel-filter-tipe");
    p.hidden = !p.hidden;
  });

  function tampilkanTersaring() {
    const kata = cariEl.value.trim().toLowerCase();
    const status = statusEl.value;
    const hasil = semuaTipe.filter((t) => {
      if (kata) {
        const gabung = `${t.merek} ${t.tipe} ${t.varian || ""}`.toLowerCase();
        if (!gabung.includes(kata)) return false;
      }
      if (status === "ready" && !(t.jumlahReady > 0)) return false;
      if (status === "habis" && t.jumlahReady > 0) return false;
      return true;
    });
    daftarEl.innerHTML = hasil.length
      ? tabelTipe(hasil, bisaUbah)
      : `<div class="hampa"><p>Tidak ada tipe yang cocok.</p></div>`;
    if (bisaUbah) {
      daftarEl.querySelectorAll("[data-ubah]").forEach((b) => {
        b.addEventListener("click", () => bukaForm(tipeDari(b.dataset.ubah)));
      });
    }
  }
  [cariEl, statusEl].forEach((el) => el.addEventListener("input", tampilkanTersaring));

  async function gambar() {
    semuaTipe = await muatTipe(true);
    if (!semuaTipe.length) {
      daftarEl.innerHTML = `<div class="hampa"><p>Belum ada tipe motor.
         ${bisaUbah ? "Tambahkan tipe dulu sebelum memasukkan unit."
                    : "Hubungi admin."}</p></div>`;
      return;
    }
    tampilkanTersaring();
  }

  let sedangDiubah = null; // referensi tipe yang lagi diedit, dipakai bareng oleh bukaForm() & simpan()

  async function bukaForm(t) {
    sedangDiubah = t || null;
    formEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    let saranTipe = [], saranWarna = [];
    try {
      [saranTipe, saranWarna] = await Promise.all([
        muatSaranTipe(), muatSaranWarna(),
      ]);
    } catch (err) {
      formEl.innerHTML = `<div class="hampa">
        <p>Gagal memuat saran Tipe/Warna: ${aman(err.message)}</p>
        <p>Formnya tetap bisa dipakai, cuma tanpa saran otomatis. Kalau
           pesannya soal izin (permission-denied), kemungkinan
           <b>firestore.rules</b> belum di-deploy ke Firebase.</p>
      </div>`;
      kabar("Gagal memuat saran Tipe/Warna: " + err.message, "rem");
    }
    formEl.innerHTML = formTipe(t || {}, saranTipe, saranWarna,
      bolehAkses("kelola.pengguna"));
    const offroad = formEl.querySelector("#t-offroad");
    const bbn = formEl.querySelector("#t-bbn");
    const tebus = formEl.querySelector("#t-tebus");
    const kirim = formEl.querySelector("#t-kirim");
    const aksesoris = formEl.querySelector("#t-aksesoris");
    const lain = formEl.querySelector("#t-lain");
    const otr = formEl.querySelector("#t-harga");
    [bbn, tebus, kirim, aksesoris, lain].filter(Boolean).forEach(pasangFormatUang);

    // OTR (harga jual, dilihat semua yang bisa akses form ini) =
    // Offroad + BBN — dibaca dari NILAI YANG SEDANG TAMPIL di kotak
    // Offroad, apa pun cara kotak itu terisi.
    function hitungOtr() {
      otr.value = (bacaAngka(offroad) + bacaAngka(bbn)).toLocaleString("id-ID");
    }
    bbn.addEventListener("input", hitungOtr);

    // Offroad cuma bisa dihitung ulang kalau elemen-elemen biaya
    // internal itu ADA di form ini (artinya yang buka Owner) — Admin
    // tidak punya elemen ini sama sekali, jadi kotak Offroad-nya
    // cuma menampilkan angka yang sudah tersimpan, tidak berubah
    // sampai Owner yang mengubahnya lain waktu.
    if (tebus) {
      const hitungOffroad = () => {
        offroad.value = (bacaAngka(tebus) + bacaAngka(kirim) +
          bacaAngka(aksesoris) + bacaAngka(lain)).toLocaleString("id-ID");
        hitungOtr();
      };
      [tebus, kirim, aksesoris, lain].forEach((el) =>
        el.addEventListener("input", hitungOffroad));
    }

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
    const bbn = bacaAngka(formEl.querySelector("#t-bbn"));
    // Field biaya internal cuma ada di form kalau Owner — kalau
    // Admin yang submit, elemennya tidak ada sama sekali di DOM,
    // jadi dijaga null-safe (pakai nilai lama yang tersimpan).
    const elTebus = formEl.querySelector("#t-tebus");
    const elKirim = formEl.querySelector("#t-kirim");
    const elAksesoris = formEl.querySelector("#t-aksesoris");
    const elLain = formEl.querySelector("#t-lain");
    const hargaTebusTipe = elTebus ? bacaAngka(elTebus) : (sedangDiubah?.hargaTebusTipe || 0);
    const biayaKirim = elKirim ? bacaAngka(elKirim) : (sedangDiubah?.biayaKirim || 0);
    const aksesoris = elAksesoris ? bacaAngka(elAksesoris) : (sedangDiubah?.aksesoris || 0);
    const lainLain = elLain ? bacaAngka(elLain) : (sedangDiubah?.lainLain || 0);
    // Offroad SELALU dihitung ulang di sini dari komponen internal
    // (bukan dipercaya dari nilai kotak readonly-nya) — supaya tidak
    // bisa diakali walau kotak readonly itu somehow diutak-atik.
    const hargaOffroad = hargaTebusTipe + biayaKirim + aksesoris + lainLain;
    const data = {
      merek, tipe,
      varian: formEl.querySelector("#t-varian").value.trim(),
      cc: Number(formEl.querySelector("#t-cc").value || 0) || null,
      transmisi: formEl.querySelector("#t-transmisi").value.trim(),
      warna: formEl.querySelector("#t-warna").value
        .split(",").map((s) => s.trim()).filter(Boolean),
      hargaOffroad,
      bbn,
      // Catatan biaya internal — dipakai buat hitung hargaOffroad di atas.
      hargaTebusTipe, biayaKirim, aksesoris, lainLain,
      // Harga jual = Offroad (hasil hitungan) + BBN.
      hargaOtr: hargaOffroad + bbn,
      mewah: false,
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

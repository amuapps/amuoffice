// akses.js — owner menentukan menu apa saja yang boleh dilihat
// tiap peran (Admin/Sales/Kasir). Owner sendiri selalu akses penuh,
// tidak bisa dibatasi (izin: ["*"] di roles.js, itu tetap aturan
// terakhir kalau semuanya salah konfigurasi).
//
// Disimpan satu dokumen: /pengaturan/akses_kustom
//   { admin: ["SYS-01","INV-06",...], sales: [...], kasir: [...] }
// Peran yang belum punya entri di sini (belum pernah diatur owner)
// otomatis pakai daftar bawaan peran itu dari roles.js — jadi aman
// dicoba, tidak langsung mengunci siapa pun sebelum owner benar-
// benar menyimpan sesuatu.

import { dbase, doc, getDoc, setDoc, serverTimestamp, catat } from "./db.js?v=3.7.0";
import { bolehAkses } from "./auth.js?v=3.7.0";
import { aman, kabar } from "./ui.js?v=3.7.0";

let override = null; // null = belum dimuat sama sekali
let sudahDimuat = false;

export async function muatAksesKustom(paksa = false) {
  if (sudahDimuat && !paksa) return override;
  try {
    const snap = await getDoc(doc(dbase, "pengaturan", "akses_kustom"));
    override = snap.exists() ? snap.data() : {};
  } catch {
    override = {}; // gagal baca → semua peran pakai bawaan, jangan macet
  }
  sudahDimuat = true;
  return override;
}

// Dipakai roles.js — sinkron, karena override sudah dimuat lebih
// dulu (dipanggil bareng muatLabelKustom di app.js sebelum login
// selesai digambar). Kembalikan null kalau peran ini belum pernah
// diatur ulang oleh owner (roles.js lalu pakai daftar bawaan).
export function daftarKodeUntuk(peran) {
  if (!override || !Array.isArray(override[peran])) return null;
  return override[peran];
}

async function simpanAkses(peran, daftarKode) {
  const isi = { ...(override || {}), [peran]: daftarKode };
  await setDoc(doc(dbase, "pengaturan", "akses_kustom"), {
    ...isi, diubahPada: serverTimestamp(),
  });
  await catat("akses_diubah", { koleksi: "pengaturan", docId: "akses_kustom",
    ringkas: peran });
  override = isi;
}

const PERAN_DIATUR = [
  { kunci: "admin", label: "Admin" },
  { kunci: "sales", label: "Sales" },
  { kunci: "kasir", label: "Kasir" },
];

export async function halamanAkses(wadah, PERAN) {
  if (!bolehAkses("kelola.pengguna")) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Hanya Owner yang bisa mengatur Panel Akses.</p></div>
    </section>`;
    return;
  }

  await muatAksesKustom(true);
  let peranAktif = "admin";

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">Panel Akses</h2></div>
    <p class="petunjuk">Atur menu apa saja yang boleh dilihat &amp; dibuka tiap
      peran. Owner sendiri selalu akses penuh dan tidak diatur di sini.
      Peran yang belum pernah disimpan di sini tetap pakai pengaturan
      bawaan — aman dicoba dulu sebelum disimpan.</p>
    <p class="petunjuk">Panel ini cuma bisa <b>menyembunyikan</b> menu yang
      sudah ada di peran itu, bukan meminjam menu dari peran lain (mis.
      Sales tidak bisa diberi akses Master Rekening lewat sini, karena itu
      memang bukan bagian menu bawaan Sales).</p>

    <label class="pilihan" style="margin:10px 0">
      <input type="checkbox" id="gembok-akses">
      <span><b>Buka kunci untuk mengedit.</b> Terkunci secara default
        supaya tidak berubah tidak sengaja.</span>
    </label>

    <div class="chip-baris" id="tab-peran">
      ${PERAN_DIATUR.map((p, i) => `<button type="button"
          class="chip ${i === 0 ? "aktif" : ""}" data-peran="${p.kunci}">
          ${aman(p.label)}</button>`).join("")}
    </div>

    <div id="wadah-checklist" style="margin-top:14px"></div>

    <div class="aksi" style="margin-top:14px">
      <button class="tombol tombol--utama" id="simpan-akses" disabled>Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" id="reset-akses" disabled>
        Kembalikan peran ini ke bawaan</button>
    </div>
  </section>`;

  const checklistEl = wadah.querySelector("#wadah-checklist");
  const gembokEl = wadah.querySelector("#gembok-akses");
  const tombolSimpan = wadah.querySelector("#simpan-akses");
  const tombolReset = wadah.querySelector("#reset-akses");

  function kodeAktifUntuk(peran) {
    const kustom = daftarKodeUntuk(peran);
    if (kustom) return new Set(kustom);
    // Belum diatur — tandai sesuai menu bawaan peran itu.
    const bawaan = new Set();
    PERAN[peran].menu.forEach((g) => g.butir.forEach((b) => {
      if (b.kode) bawaan.add(b.kode);
    }));
    return bawaan;
  }

  function gambarChecklist() {
    // Daftar per peran diambil dari MENU BAWAAN peran itu sendiri —
    // Panel Akses cuma bisa MENYEMBUNYIKAN dari yang sudah ada,
    // bukan meminjam menu dari peran lain. Kalau peran tertentu
    // butuh menu yang sekarang cuma ada di peran lain, itu perlu
    // diubah di kode (roles.js), bukan lewat panel ini.
    const semuaButirPeran = [];
    PERAN[peranAktif].menu.forEach((g) => {
      g.butir.forEach((b) => {
        if (b.kode) semuaButirPeran.push({ kode: b.kode, label: b.label, grup: g.grup });
      });
    });

    const aktifSet = kodeAktifUntuk(peranAktif);
    const perGrup = {};
    semuaButirPeran.forEach((b) => {
      (perGrup[b.grup] = perGrup[b.grup] || []).push(b);
    });
    checklistEl.innerHTML = Object.keys(perGrup).length
      ? Object.entries(perGrup).map(([grup, butir]) => `
        <div class="pemisah">${aman(grup)}</div>
        ${butir.map((b) => `
          <label class="pilihan" style="display:flex;margin:4px 0">
            <input type="checkbox" data-kode="${aman(b.kode)}"
                   ${aktifSet.has(b.kode) ? "checked" : ""} disabled>
            <span>${aman(b.label)}</span>
          </label>`).join("")}
      `).join("")
      : `<p class="hampa">Peran ini belum punya menu bawaan.</p>`;
    terapkanKunci();
  }

  function terapkanKunci() {
    const buka = gembokEl.checked;
    checklistEl.querySelectorAll("input[type=checkbox]")
      .forEach((i) => (i.disabled = !buka));
    tombolSimpan.disabled = !buka;
    tombolReset.disabled = !buka;
  }

  gembokEl.addEventListener("change", terapkanKunci);

  wadah.querySelector("#tab-peran").addEventListener("click", (e) => {
    const t = e.target.closest("[data-peran]");
    if (!t) return;
    peranAktif = t.dataset.peran;
    wadah.querySelectorAll("#tab-peran .chip").forEach((c) =>
      c.classList.toggle("aktif", c === t));
    gambarChecklist();
  });

  tombolSimpan.addEventListener("click", async () => {
    const dipilih = [...checklistEl.querySelectorAll("input[type=checkbox]:checked")]
      .map((i) => i.dataset.kode);
    if (!dipilih.length) {
      kabar("Pilih minimal satu menu — kalau kosong, peran ini tidak bisa " +
            "buka apa pun sama sekali.", "rem");
      return;
    }
    try {
      await simpanAkses(peranAktif, dipilih);
      kabar("Akses tersimpan. Muat ulang halaman untuk lihat perubahannya" +
            " di sidebar peran terkait.", "netral");
    } catch (err) {
      kabar("Gagal menyimpan: " + err.message, "rem");
    }
  });

  tombolReset.addEventListener("click", async () => {
    try {
      const isi = { ...(override || {}) };
      delete isi[peranAktif];
      await setDoc(doc(dbase, "pengaturan", "akses_kustom"), isi);
      override = isi;
      kabar(`Peran ${peranAktif} dikembalikan ke bawaan. Muat ulang halaman.`,
            "netral");
      gambarChecklist();
    } catch (err) {
      kabar("Gagal reset: " + err.message, "rem");
    }
  });

  gambarChecklist();
}

// ringkasan.js — beranda owner.
//
// Semua angka dibaca dari satu dokumen ringkasan bulanan yang
// diperbarui pakai increment tiap transaksi. Membuka halaman ini
// = beberapa pembacaan, bukan ratusan — itu yang menjaga tagihan
// Firestore tetap mendekati nol.

import {
  dbase, collection, getDocs, query, where, orderBy, limit,
} from "./db.js";
import { bolehAkses } from "./auth.js";
import { SHOWROOM } from "./config.js";
import { ringkasanBulan } from "./kas.js";
import { blokSerah } from "./serah.js";
import { rupiah, aman, kabar, kunciBulan, tanggal } from "./ui.js";

// ── Ekspor ────────────────────────────────────────────────────
// CSV untuk dibuka di Excel dan diserahkan ke akuntan.
// JSON untuk cadangan sesungguhnya — CSV itu tabel datar dan tidak
// menyimpan subkoleksi, jadi tidak bisa dipulihkan kembali.
const KOLEKSI = [
  "tipe_motor", "units", "pelanggan", "transaksi",
  "kuitansi", "kas", "ringkasan",
];

function unduh(nama, isi, tipe) {
  const b = new Blob([isi], { type: tipe });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = nama;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function keCsv(baris) {
  if (!baris.length) return "";
  const kolom = [...new Set(baris.flatMap((b) => Object.keys(b)))];
  const sel = (v) => {
    if (v == null) return "";
    if (v.toDate) v = v.toDate().toISOString();
    if (typeof v === "object") v = JSON.stringify(v);
    return `"${String(v).replace(/"/g, '""')}"`;
  };
  return [
    kolom.join(","),
    ...baris.map((b) => kolom.map((k) => sel(b[k])).join(",")),
  ].join("\n");
}

async function ambilSemua(nama) {
  const snap = await getDocs(collection(dbase, nama));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function eksporJson() {
  const isi = {};
  for (const k of KOLEKSI) isi[k] = await ambilSemua(k);
  unduh(
    `cadangan-${SHOWROOM.namaPendek || "showroom"}-${kunciBulan()}.json`,
    JSON.stringify(isi, null, 2),
    "application/json"
  );
}

async function eksporCsv(nama) {
  const baris = await ambilSemua(nama);
  if (!baris.length) { kabar("Belum ada data untuk diekspor.", "rem"); return; }
  unduh(`${nama}-${kunciBulan()}.csv`, keCsv(baris), "text/csv;charset=utf-8");
}

// ── Halaman ───────────────────────────────────────────────────
export async function halamanRingkasan(wadah) {
  const r = await ringkasanBulan();
  const bisaEkspor = bolehAkses("ekspor");

  // Dua angka yang paling menentukan tindakan hari ini.
  const spkSnap = await getDocs(query(
    collection(dbase, "transaksi"),
    where("statusSPK", "==", "menunggu_persetujuan"), limit(20)
  ));
  const unitSnap = await getDocs(query(
    collection(dbase, "units"), where("status", "==", "ready"), limit(200)
  ));

  const bulan = await (async () => {
    const s = await getDocs(query(
      collection(dbase, "ringkasan"), orderBy("diubah", "desc"), limit(1)
    ));
    return s.empty ? {} : s.docs[0].data();
  })();

  wadah.innerHTML = `<section class="lembar">
    <h2 class="judul">Ringkasan</h2>

    <div class="papan">
      <div class="papan-utama">
        <span class="papan-label">Kas tersedia</span>
        <b class="papan-angka">${rupiah(r.tersedia)}</b>
      </div>
      <div class="papan-baris">
        <span>DP tertahan — belum boleh dipakai</span>
        <b class="mono">${rupiah(r.tertahan)}</b>
      </div>
    </div>

    <div class="petak">
      <div class="petak-sel">
        <span class="petak-label">Stok ready</span>
        <b class="petak-angka mono">${unitSnap.size}</b>
      </div>
      <div class="petak-sel ${spkSnap.size ? "petak-sel--sorot" : ""}">
        <span class="petak-label">Perlu persetujuan</span>
        <b class="petak-angka mono">${spkSnap.size}</b>
      </div>
      <div class="petak-sel">
        <span class="petak-label">Terjual bulan ini</span>
        <b class="petak-angka mono">${bulan.unitTerjual || 0}</b>
      </div>
      <div class="petak-sel">
        <span class="petak-label">Laba kotor</span>
        <b class="petak-angka mono">${rupiah(bulan.labaKotor || 0)}</b>
      </div>
    </div>

    ${bulan.piutangProgram
      ? `<p class="peringatan">Klaim program ATPM belum cair:
         ${rupiah(bulan.piutangProgram)}. Uang ini sudah ditalangi showroom.</p>`
      : ""}

    <div class="pemisah">Perlu dikerjakan</div>
    <div id="kerja-ringkas" class="daftar"><p class="hampa">Memuat…</p></div>

    ${bisaEkspor ? `
      <div class="pemisah">Cadangan &amp; ekspor</div>
      <p class="petunjuk">Firestore paket gratis tidak punya pemulihan
        otomatis. Unduh cadangan JSON secara berkala — hanya format ini
        yang bisa dikembalikan utuh.</p>
      <div class="chip-baris" style="margin-top:10px">
        <button class="chip" id="ek-json">Cadangan JSON</button>
        <button class="chip" id="ek-kas">CSV kas</button>
        <button class="chip" id="ek-kuitansi">CSV kuitansi</button>
        <button class="chip" id="ek-transaksi">CSV SPK</button>
      </div>` : ""}
  </section>`;

  await blokSerah(wadah.querySelector("#kerja-ringkas"), true);

  if (bisaEkspor) {
    const pasang = (id, fn) =>
      wadah.querySelector(id).addEventListener("click", async (e) => {
        e.target.disabled = true;
        const asli = e.target.textContent;
        e.target.textContent = "Menyiapkan…";
        try { await fn(); } catch (err) {
          kabar("Gagal mengekspor: " + err.message, "rem");
        }
        e.target.disabled = false;
        e.target.textContent = asli;
      });
    pasang("#ek-json", eksporJson);
    pasang("#ek-kas", () => eksporCsv("kas"));
    pasang("#ek-kuitansi", () => eksporCsv("kuitansi"));
    pasang("#ek-transaksi", () => eksporCsv("transaksi"));
  }
}

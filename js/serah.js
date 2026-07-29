// serah.js — menjembatani SPK dengan unit fisik.
//
// Di sub-dealer, unit ditebus SETELAH leasing menyetujui. Jadi di
// sinilah SPK akhirnya bertemu nomor rangka, lalu diserahkan ke
// pembeli. Unit baru berstatus terjual saat serah terima — bukan
// saat approval — supaya stok tidak berbohong.

import {
  dbase, collection, doc, getDoc, getDocs, query, where, orderBy,
  limit, writeBatch, increment, serverTimestamp, sertakanLog,
} from "./db.js";
import { sesi, bolehAkses } from "./auth.js";
import { lepaskanTertahan } from "./kas.js";
import { pecahHarga } from "./config.js";
import { rupiah, aman, kabar, tanggal, kunciBulan } from "./ui.js";
import { konfirmasi, tanya } from "./dialog.js";

// Laba dihitung dari harga TANPA PPN di kedua sisi. Kalau memakai
// angka bruto, selisih 11% bisa membalik untung jadi rugi di atas
// kertas — dan di margin tipis sub-dealer itu fatal.
export function hitungLaba(trx, hargaTebus, mewah) {
  const tebus = pecahHarga(hargaTebus || 0, mewah);
  const feeAgen = Number(trx.agen?.fee || 0);
  const hadiah = (trx.potongan || [])
    .filter((p) => p.jenis === "barang" && p.sumber === "showroom")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const laba = Number(trx.dpp || 0) - tebus.dpp - feeAgen - hadiah;
  return { dppTebus: tebus.dpp, feeAgen, hadiah, laba };
}

async function hargaTebusUnit(unitId) {
  try {
    const s = await getDoc(doc(dbase, "units", unitId, "rahasia", "harga"));
    return s.exists() ? Number(s.data().hargaTebus || 0) : 0;
  } catch {
    return 0; // sales dan kasir memang tidak boleh membacanya
  }
}

// ── Tetapkan unit ─────────────────────────────────────────────
async function tetapkanUnit(trx, unit) {
  const tebus = await hargaTebusUnit(unit.id);
  const h = hitungLaba(trx, tebus, trx.tipeSnapshot?.mewah);

  if (tebus && h.laba < 0) {
    const lanjut = await konfirmasi({
      judul: "Penjualan ini rugi",
      pesan: `Setelah dikurangi harga tebus, fee agen, dan hadiah, ` +
             `penjualan ini rugi ${rupiah(Math.abs(h.laba))}.`,
      oke: "Tetap lanjutkan",
      bahaya: true,
    });
    if (!lanjut) return false;
  }

  const batch = writeBatch(dbase);
  batch.update(doc(dbase, "transaksi", trx.id), {
    unitId: unit.id,
    unitSnapshot: {
      noRangka: unit.noRangka, noMesin: unit.noMesin || "",
      warna: unit.warna || "", tahun: unit.tahun || null,
    },
    hargaTebus: tebus || null,
    labaKotor: tebus ? h.laba : null,
    ditetapkanPada: serverTimestamp(),
  });
  batch.update(doc(dbase, "units", unit.id), { status: "booked" });
  batch.update(doc(dbase, "tipe_motor", unit.tipeId), {
    jumlahReady: increment(-1),
  });
  sertakanLog(batch, "unit_ditetapkan", {
    koleksi: "transaksi", docId: trx.id,
    ringkas: `${trx.kode} → ${unit.noRangka}`,
    labaKotor: tebus ? h.laba : null,
  });
  await batch.commit();
  return true;
}

// ── Serah terima ──────────────────────────────────────────────
async function serahTerima(trx, kelengkapan) {
  const batch = writeBatch(dbase);
  batch.update(doc(dbase, "transaksi", trx.id), {
    statusSPK: "selesai",
    serahTerima: {
      pada: serverTimestamp(),
      oleh: sesi.nama,
      kelengkapan,
    },
    dokumen: {
      status: "berkas_ke_biro_jasa",
      bpkbUntuk: trx.metode === "kredit" ? "leasing" : "pembeli",
    },
  });
  batch.update(doc(dbase, "units", trx.unitId), { status: "terjual" });

  // DP berhenti jadi kewajiban begitu unit berpindah tangan.
  lepaskanTertahan(batch, Number(trx.totalDibayar || 0));

  batch.set(doc(dbase, "ringkasan", kunciBulan()), {
    unitTerjual: increment(1),
    omzet: increment(Number(trx.hargaNet || 0)),
    labaKotor: increment(Number(trx.labaKotor || 0)),
    piutangProgram: increment(Number(trx.piutangProgram || 0)),
    diubah: serverTimestamp(),
  }, { merge: true });

  sertakanLog(batch, "serah_terima", {
    koleksi: "transaksi", docId: trx.id,
    ringkas: `${trx.kode} · ${trx.unitSnapshot?.noRangka || ""}`,
  });
  await batch.commit();
}

// ── Halaman ───────────────────────────────────────────────────
export async function halamanBerkas(wadah) {
  const bisa = bolehAkses("stok.ubah");

  wadah.innerHTML = `<section class="lembar">
    <h2 class="judul">Berkas &amp; serah terima</h2>
    <p class="petunjuk">SPK yang sudah disetujui menunggu unit ditetapkan,
      lalu diserahkan ke pembeli.</p>
    <div id="kerja" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  await blokSerah(wadah.querySelector("#kerja"), bisa);
}

export async function blokSerah(wadah, bisa = true) {
  const snap = await getDocs(query(
    collection(dbase, "transaksi"), orderBy("dibuatPada", "desc"), limit(60)
  ));
  const semua = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const kerja = semua.filter((t) =>
    ["approve", "diajukan"].includes(t.statusSPK));

  if (!kerja.length) {
    wadah.innerHTML = `<div class="hampa">
      <p>Tidak ada pekerjaan tertunda.</p></div>`;
    return;
  }

  const unitSnap = await getDocs(query(
    collection(dbase, "units"), where("status", "==", "ready"), limit(100)
  ));
  const unitReady = unitSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  wadah.innerHTML = kerja.map((t) => {
    const cocok = unitReady.filter((u) => u.tipeId === t.tipeId);
    const sudahPunyaUnit = !!t.unitId;
    return `<article class="kartu">
      <div class="kartu-atas">
        <div>
          <h3 class="kartu-judul mono">${aman(t.kode)}</h3>
          <p class="kartu-sub">${aman(t.pelangganSnapshot?.nama || "-")}</p>
        </div>
        <span class="tanda ${sudahPunyaUnit ? "tanda--booked" : "tanda--diajukan"}">
          ${sudahPunyaUnit ? "Siap serah" : "Butuh unit"}
        </span>
      </div>
      <p class="kartu-rinci">${aman(t.tipeSnapshot?.nama || "")}
        · ${aman(t.warna || "")}</p>
      ${sudahPunyaUnit
        ? `<dl class="rinci">
             <div><dt>Rangka</dt>
               <dd class="mono">${aman(t.unitSnapshot?.noRangka || "")}</dd></div>
             <div><dt>Sudah dibayar</dt>
               <dd class="mono">${rupiah(t.totalDibayar)}</dd></div>
             <div><dt>Sisa</dt>
               <dd class="mono">${rupiah(t.sisa)}</dd></div>
           </dl>
           ${bisa ? `<div class="aksi aksi--rapat">
             <button class="tombol tombol--kecil tombol--isi"
                     data-serah="${t.id}">Serah terima</button></div>` : ""}`
        : `${cocok.length
             ? `<label class="label label--gelap">Pilih unit</label>
                <select class="isian isian--terang kecil" data-unit="${t.id}">
                  <option value="">— pilih nomor rangka —</option>
                  ${cocok.map((u) => `<option value="${u.id}">
                    ${aman(u.noRangka)} · ${aman(u.warna || "")}</option>`).join("")}
                </select>
                ${bisa ? `<div class="aksi aksi--rapat">
                  <button class="tombol tombol--kecil tombol--isi"
                          data-tetapkan="${t.id}">Tetapkan unit</button></div>` : ""}`
             : `<p class="peringatan">Belum ada unit ready untuk tipe ini.
                Tebus dulu ke main dealer, lalu masukkan di menu Stok.</p>`}`}
    </article>`;
  }).join("");

  wadah.querySelectorAll("[data-tetapkan]").forEach((b) =>
    b.addEventListener("click", async () => {
      const t = kerja.find((x) => x.id === b.dataset.tetapkan);
      const pilih = wadah.querySelector(`[data-unit="${t.id}"]`);
      if (!pilih.value) { kabar("Pilih nomor rangkanya dulu.", "rem"); return; }
      const u = unitReady.find((x) => x.id === pilih.value);
      b.disabled = true;
      try {
        const jadi = await tetapkanUnit(t, u);
        if (jadi) {
          kabar(`Unit ${u.noRangka} ditetapkan ke ${t.kode}.`, "netral");
          await blokSerah(wadah, bisa);
        } else { b.disabled = false; }
      } catch (err) {
        kabar("Gagal: " + err.message, "rem");
        b.disabled = false;
      }
    }));

  wadah.querySelectorAll("[data-serah]").forEach((b) =>
    b.addEventListener("click", async () => {
      const t = kerja.find((x) => x.id === b.dataset.serah);
      if (Number(t.sisa || 0) > 0) {
        const lanjut = await konfirmasi({
          judul: "Belum lunas",
          pesan: `Sisa pembayaran ${rupiah(t.sisa)} belum diterima. ` +
                 `Unit tetap akan tercatat sebagai terjual.`,
          oke: "Tetap serahkan",
          bahaya: true,
        });
        if (!lanjut) return;
      }
      const kelengkapan = await tanya({
        judul: "Serah terima unit",
        pesan: "Catat kelengkapan yang ikut diserahkan ke pembeli.",
        nilai: "Helm, toolkit, buku servis",
      });
      if (kelengkapan === null) return;
      b.disabled = true;
      try {
        await serahTerima(t, kelengkapan);
        kabar("Serah terima tercatat.", "netral");
        await blokSerah(wadah, bisa);
      } catch (err) {
        kabar("Gagal: " + err.message, "rem");
        b.disabled = false;
      }
    }));
}

// faktur.js — Dokumen → Pengajuan Faktur.
//
// Daftar SPK (yang tidak batal) untuk dicetakkan lembar "Pengajuan
// Faktur Kendaraan" — isinya seperti SPK tapi TANPA No. HP, harga,
// diskon, DP, dan hal lain yang tidak perlu untuk faktur (lihat
// cetakPengajuanFaktur di cetak.js). Bisa centang banyak SPK dan
// dicetak sekaligus (satu SPK satu halaman).
//
// Tanggal terakhir diajukan dicatat di dokumen_kendaraan/{spkId}
// (fakturDiajukanPada/Oleh) — koleksi yang sama dengan Tracking
// Dokumen, jadi tidak butuh koleksi/rules baru.

import {
  dbase, collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, limit,
  serverTimestamp, catat,
} from "./db.js?v=3.16.0";
import { bolehAkses, sesi } from "./auth.js?v=3.16.0";
import { muatLeasing, leasingDari } from "./leasing.js?v=3.16.0";
import { cetakPengajuanFaktur } from "./cetak.js?v=3.16.0";
import { aman, kabar, tanggal } from "./ui.js?v=3.16.0";

// Isi awal dokumen_kendaraan kalau SPK ini belum pernah punya —
// harus sama dengan dataDefault() di dokumen.js supaya Tracking
// Dokumen tetap membaca status berkasnya dengan benar.
function dataDefaultDokumen(t) {
  return {
    id: t.id, transaksiId: t.id, spkNo: t.spkNo,
    pembeliNama: t.pembeli?.nama || "-",
    tipeNama: t.tipeNama, warna: t.warna,
    biroJasaId: null, biroJasaNama: null,
    berkasStatus: "belum_diserahkan",
    stnkStatus: "belum", bpkbStatus: "belum", platStatus: "belum",
  };
}

async function tandaiDiajukan(t) {
  const ref = doc(dbase, "dokumen_kendaraan", t.id);
  const snap = await getDoc(ref);
  const tanda = {
    fakturDiajukanPada: serverTimestamp(),
    fakturDiajukanOleh: sesi?.uid || null,
    fakturDiajukanOlehNama: sesi?.nama || "",
  };
  if (snap.exists()) await updateDoc(ref, tanda);
  else await setDoc(ref, { ...dataDefaultDokumen(t), ...tanda });
}

export async function halamanFaktur(wadah) {
  if (!bolehAkses("cetak.dokumen")) {
    wadah.innerHTML = `<section class="lembar"><div class="hampa">
      <p>Anda tidak punya akses ke Pengajuan Faktur.</p></div></section>`;
    return;
  }
  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Pengajuan Faktur</h2>
      <button class="tombol tombol--kecil" id="fk-cetak-terpilih"
        style="background:#0F7B0F;color:#fff;border-color:#0F7B0F" disabled>
        Cetak terpilih (0)</button>
    </div>
    <p class="petunjuk">Lembar pengajuan faktur (warna <b style="color:#0F7B0F">hijau</b>,
      beda dari SPK) berisi data atas nama sesuai KTP, pemakai, dan unit —
      <b>tanpa</b> No. HP, harga, diskon, dan DP. Centang beberapa SPK untuk
      dicetak sekaligus.</p>
    <div class="chip-baris" id="fk-saring">
      <button class="chip aktif" data-saring="siap">Siap diajukan</button>
      <button class="chip" data-saring="belum">Belum pernah diajukan</button>
      <button class="chip" data-saring="sudah">Sudah diajukan</button>
      <button class="chip" data-saring="indent">Indent (belum ada unit)</button>
      <button class="chip" data-saring="semua">Semua</button>
    </div>
    <input class="isian isian--terang" id="fk-cari" style="margin-bottom:10px"
      placeholder="Cari No. SPK / nama / NIK / No. Rangka…">
    <div id="fk-daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#fk-daftar");
  const cariEl = wadah.querySelector("#fk-cari");
  const tombolTerpilih = wadah.querySelector("#fk-cetak-terpilih");
  let semua = [];          // [{ t, unit, dok }]
  let saring = "siap";
  const terpilih = new Set();

  async function muat() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    const [snapT, snapU, snapD] = await Promise.all([
      getDocs(collection(dbase, "transaksi")),
      getDocs(query(collection(dbase, "units"), where("status", "in", ["booked", "terjual"]), limit(2000))),
      getDocs(collection(dbase, "dokumen_kendaraan")),
      muatLeasing().catch(() => []),
    ]);
    const petaUnit = new Map(snapU.docs.map((d) => [d.id, d.data()]));
    const petaDok = new Map(snapD.docs.map((d) => [d.id, d.data()]));
    semua = snapT.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((t) => t.status !== "batal")
      .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0))
      .map((t) => ({ t, unit: t.unitId ? petaUnit.get(t.unitId) || null : null,
        dok: petaDok.get(t.id) || null }));
    tampil();
  }

  function cocok({ t, unit, dok }) {
    const sudah = !!dok?.fakturDiajukanPada;
    if (saring === "siap" && !unit) return false;
    if (saring === "belum" && sudah) return false;
    if (saring === "sudah" && !sudah) return false;
    if (saring === "indent" && unit) return false;
    const kata = cariEl.value.trim().toLowerCase();
    if (!kata) return true;
    return [t.spkNo, t.pembeli?.nama, t.pembeli?.nik, unit?.noRangka, unit?.noMesin, t.tipeNama]
      .some((x) => String(x || "").toLowerCase().includes(kata));
  }

  function perbaruiTombol() {
    tombolTerpilih.disabled = !terpilih.size;
    tombolTerpilih.textContent = `Cetak terpilih (${terpilih.size})`;
  }

  function tampil() {
    const hasil = semua.filter(cocok);
    if (!hasil.length) {
      daftarEl.innerHTML = `<div class="hampa"><p>Tidak ada SPK di kategori ini.</p></div>`;
      return;
    }
    daftarEl.innerHTML = `<div style="overflow-x:auto"><table class="tabel">
      <thead><tr>
        <th><input type="checkbox" id="fk-semua" title="Pilih semua yang tampil"></th>
        <th>No. SPK</th><th>Tanggal</th><th>Atas Nama (KTP)</th><th>NIK</th>
        <th>Unit / Warna</th><th>No. Rangka</th><th>No. Mesin</th><th>Penjualan</th>
        <th>Diajukan</th><th></th>
      </tr></thead>
      <tbody>
        ${hasil.map(({ t, unit, dok }) => {
          const kredit = (t.caraBayar || []).includes("kredit");
          return `<tr>
            <td><input type="checkbox" class="fk-pilih" value="${t.id}"
              ${terpilih.has(t.id) ? "checked" : ""}></td>
            <td class="mono">${aman(t.spkNo)}</td>
            <td>${tanggal(t.dibuatPada)}</td>
            <td>${aman(t.pembeli?.nama || "-")}</td>
            <td class="mono">${aman(t.pembeli?.nik || "-")}</td>
            <td>${aman(t.tipeNama)}<br><span class="petunjuk" style="margin:0">${aman(t.warna || "")}</span></td>
            <td class="mono">${unit ? aman(unit.noRangka || "-") : `<span class="tanda tanda--booked">Indent</span>`}</td>
            <td class="mono">${aman(unit?.noMesin || "-")}</td>
            <td>${kredit ? `Kredit<br><span class="petunjuk" style="margin:0">${
              aman(leasingDari(t.kredit?.leasingId)?.nama || "-")}</span>` : "Cash"}</td>
            <td>${dok?.fakturDiajukanPada
              ? `<span class="tanda tanda--ready">${tanggal(dok.fakturDiajukanPada)}</span>`
              : `<span class="tanda tanda--batal">Belum</span>`}</td>
            <td><button class="tombol tombol--kecil" data-cetak="${t.id}"
              style="background:#0F7B0F;color:#fff;border-color:#0F7B0F">Cetak</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table></div>`;

    const kotakSemua = daftarEl.querySelector("#fk-semua");
    const kotak = [...daftarEl.querySelectorAll(".fk-pilih")];
    kotakSemua.checked = kotak.length > 0 && kotak.every((k) => k.checked);
    kotakSemua.addEventListener("change", () => {
      kotak.forEach((k) => {
        k.checked = kotakSemua.checked;
        if (k.checked) terpilih.add(k.value); else terpilih.delete(k.value);
      });
      perbaruiTombol();
    });
    kotak.forEach((k) => k.addEventListener("change", () => {
      if (k.checked) terpilih.add(k.value); else terpilih.delete(k.value);
      kotakSemua.checked = kotak.every((x) => x.checked);
      perbaruiTombol();
    }));
    daftarEl.querySelectorAll("[data-cetak]").forEach((b) =>
      b.addEventListener("click", () => cetak([b.dataset.cetak])));
    perbaruiTombol();
  }

  async function cetak(ids) {
    const data = ids.map((id) => semua.find((x) => x.t.id === id)).filter(Boolean);
    if (!data.length) return;
    const indent = data.filter((x) => !x.unit);
    if (indent.length) {
      kabar(`${indent.length} SPK belum punya unit (Indent) — No. Rangka/Mesin di lembarnya masih kosong.`, "rem");
    }
    await cetakPengajuanFaktur(data.map((x) => x.t));
    // Catat tanggal diajukan (gagal mencatat tidak menggagalkan cetak).
    try {
      await Promise.all(data.map((x) => tandaiDiajukan(x.t)));
      await catat("faktur_diajukan", {
        koleksi: "dokumen_kendaraan", ringkas: data.map((x) => x.t.spkNo).join(", "),
      });
      terpilih.clear();
      await muat();
    } catch (err) {
      kabar("Lembar tercetak, tapi gagal mencatat status diajukan: " + err.message, "rem");
    }
  }

  wadah.querySelector("#fk-saring").addEventListener("click", (e) => {
    const c = e.target.closest("[data-saring]");
    if (!c) return;
    saring = c.dataset.saring;
    wadah.querySelectorAll("#fk-saring .chip").forEach((x) => x.classList.toggle("aktif", x === c));
    tampil();
  });
  cariEl.addEventListener("input", tampil);
  tombolTerpilih.addEventListener("click", () => cetak([...terpilih]));

  try {
    await muat();
  } catch (err) {
    daftarEl.innerHTML = `<div class="hampa"><p>Gagal memuat: ${aman(err.message)}</p></div>`;
  }
}

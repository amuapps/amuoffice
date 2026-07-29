// kas.js — jurnal uang masuk dan keluar.
// Pemisahan terpenting di file ini: DP yang sudah diterima BELUM
// jadi milik showroom selama unit belum diserahkan. Kalau dua
// angka itu digabung, kas terlihat gemuk lalu kurang saat menebus
// unit ke main dealer.

import {
  dbase, collection, doc, getDoc, getDocs, query, where, orderBy,
  limit, writeBatch, increment, serverTimestamp, sertakanLog, tandaBaru,
} from "./db.js";
import { sesi, bolehAkses } from "./auth.js";
import {
  rupiah, aman, kabar, tanggal, kunciBulan,
  pasangFormatUang, bacaAngka,
} from "./ui.js";

export const KATEGORI = {
  tanda_jadi:   { label: "Tanda jadi",        arah: "masuk",  tertahan: true },
  dp:           { label: "DP pembeli",        arah: "masuk",  tertahan: true },
  pelunasan:    { label: "Pelunasan",         arah: "masuk",  tertahan: false },
  cair_leasing: { label: "Pencairan leasing", arah: "masuk",  tertahan: false },
  refund_leasing:{ label: "Refund leasing",   arah: "masuk",  tertahan: false },
  program_atpm: { label: "Klaim program ATPM",arah: "masuk",  tertahan: false },
  pengembalian: { label: "Pengembalian DP",   arah: "keluar", tertahan: false },
  tebus_unit:   { label: "Tebus unit",        arah: "keluar", tertahan: false },
  fee_agen:     { label: "Fee agen",          arah: "keluar", tertahan: false },
  komisi_sales: { label: "Komisi sales",      arah: "keluar", tertahan: false },
  biro_jasa:    { label: "Biro jasa",         arah: "keluar", tertahan: false },
  operasional:  { label: "Operasional",       arah: "keluar", tertahan: false },
};

// Menyisipkan satu baris kas ke dalam batch yang sedang berjalan,
// supaya kas dan kuitansi selalu lahir bersamaan atau tidak sama
// sekali.
export function sisipkanKas(batch, { kategori, nominal, keterangan,
                                     refType, refId, metode }) {
  const k = KATEGORI[kategori];
  const ref = doc(collection(dbase, "kas"));
  batch.set(ref, {
    kategori,
    jenis: k.arah,
    nominal: Number(nominal || 0),
    keterangan: keterangan || "",
    metode: metode || "tunai",
    refType: refType || null,
    refId: refId || null,
    kasirId: sesi ? sesi.uid : null,
    kasirNama: sesi ? sesi.nama : "",
    tanggal: serverTimestamp(),
    ...tandaBaru(),
  });

  // Ringkasan bulanan diperbarui dengan increment, bukan dihitung
  // ulang. Membuka dashboard jadi satu pembacaan, bukan ratusan.
  const bulan = doc(dbase, "ringkasan", kunciBulan());
  const nilai = Number(nominal || 0);
  const naik = {};
  if (k.arah === "masuk") naik.kasMasuk = increment(nilai);
  else naik.kasKeluar = increment(nilai);
  if (k.tertahan) naik.dpTertahan = increment(nilai);
  batch.set(bulan, { ...naik, diubah: serverTimestamp() }, { merge: true });
  return ref;
}

// Dipanggil saat unit diserahkan: DP berhenti jadi kewajiban.
export function lepaskanTertahan(batch, nominal) {
  batch.set(doc(dbase, "ringkasan", kunciBulan()), {
    dpTertahan: increment(-Number(nominal || 0)),
    diubah: serverTimestamp(),
  }, { merge: true });
}

export async function ringkasanBulan() {
  const snap = await getDoc(doc(dbase, "ringkasan", kunciBulan()));
  const d = snap.exists() ? snap.data() : {};
  const masuk = d.kasMasuk || 0;
  const keluar = d.kasKeluar || 0;
  const tertahan = d.dpTertahan || 0;
  return {
    masuk, keluar, tertahan,
    saldo: masuk - keluar,
    tersedia: masuk - keluar - tertahan,
  };
}

function barisKas(k) {
  const info = KATEGORI[k.kategori] || { label: k.kategori };
  const masuk = k.jenis === "masuk";
  return `<article class="kartu kartu--kas">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(info.label)}</h3>
        <p class="kartu-sub">${aman(k.keterangan || "-")}</p>
      </div>
      <b class="mono ${masuk ? "naik" : "turun"}">
        ${masuk ? "+" : "−"} ${rupiah(k.nominal)}
      </b>
    </div>
    <p class="kartu-rinci">${tanggal(k.tanggal)} · ${aman(k.kasirNama || "")}
      · ${aman(k.metode || "tunai")}</p>
  </article>`;
}

export async function halamanKas(wadah) {
  const bisaInput = bolehAkses("kas.input");
  const r = await ringkasanBulan();

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Kas</h2>
      ${bisaInput ? `<button class="tombol tombol--kecil tombol--isi"
        id="catat-kas">Catat kas keluar</button>` : ""}
    </div>

    <div class="papan">
      <div class="papan-utama">
        <span class="papan-label">Kas tersedia</span>
        <b class="papan-angka">${rupiah(r.tersedia)}</b>
      </div>
      <div class="papan-baris">
        <span>DP tertahan — belum boleh dipakai</span>
        <b class="mono">${rupiah(r.tertahan)}</b>
      </div>
      <div class="papan-baris">
        <span>Masuk bulan ini</span><b class="mono">${rupiah(r.masuk)}</b>
      </div>
      <div class="papan-baris">
        <span>Keluar bulan ini</span><b class="mono">${rupiah(r.keluar)}</b>
      </div>
    </div>

    <div id="form-kas"></div>
    <div id="daftar-kas" class="daftar" style="margin-top:16px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-kas");
  const formEl = wadah.querySelector("#form-kas");

  async function gambar() {
    const snap = await getDocs(query(
      collection(dbase, "kas"), orderBy("tanggal", "desc"), limit(40)
    ));
    const isi = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    daftarEl.innerHTML = isi.length
      ? isi.map(barisKas).join("")
      : `<div class="hampa"><p>Belum ada pergerakan kas.</p></div>`;
  }

  if (bisaInput) {
    wadah.querySelector("#catat-kas").addEventListener("click", () => {
      const opsi = Object.entries(KATEGORI)
        .filter(([, v]) => v.arah === "keluar")
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
      formEl.innerHTML = `<form class="form" id="f-kas">
        <label class="label label--gelap" for="k-kategori">Untuk apa</label>
        <select class="isian isian--terang" id="k-kategori">${opsi}</select>
        <label class="label label--gelap" for="k-nominal">Nominal</label>
        <input class="isian isian--terang" id="k-nominal" inputmode="numeric">
        <label class="label label--gelap" for="k-ket">Keterangan</label>
        <input class="isian isian--terang" id="k-ket"
               placeholder="Contoh: fee agen SPK/2026/0003">
        <div class="aksi">
          <button class="tombol tombol--utama" type="submit">Catat</button>
          <button class="tombol tombol--sunyi tombol--gelap" type="button"
                  id="batal-kas">Batal</button>
        </div>
      </form>`;
      pasangFormatUang(formEl.querySelector("#k-nominal"));
      formEl.querySelector("#batal-kas")
        .addEventListener("click", () => (formEl.innerHTML = ""));
      formEl.querySelector("#f-kas").addEventListener("submit", async (e) => {
        e.preventDefault();
        const nominal = bacaAngka(formEl.querySelector("#k-nominal"));
        if (!nominal) { kabar("Nominal belum diisi.", "rem"); return; }
        const kategori = formEl.querySelector("#k-kategori").value;
        try {
          const batch = writeBatch(dbase);
          sisipkanKas(batch, {
            kategori, nominal,
            keterangan: formEl.querySelector("#k-ket").value.trim(),
          });
          sertakanLog(batch, "kas_keluar", {
            koleksi: "kas", ringkas: `${KATEGORI[kategori].label} ${rupiah(nominal)}`,
          });
          await batch.commit();
          formEl.innerHTML = "";
          kabar("Kas keluar tercatat.", "netral");
          await halamanKas(wadah);
        } catch (err) {
          kabar("Gagal mencatat: " + err.message, "rem");
        }
      });
    });
  }

  await gambar();
}

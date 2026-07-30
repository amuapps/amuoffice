// pembelian.js — modul Pembelian.
//
// Ini pintu masuk stok dan harga tebus. Sebelum modul ini ada,
// harga tebus diketik manual di menu Stok — sekarang terisi
// sendiri dari harga di order pembelian, jadi laba per unit
// dihitung dari angka yang benar.
//
// Sub-dealer sering menebus dengan tempo, karena itu tiap order
// menyimpan jatuh tempo dan sisa utangnya. Tanpa ini kas terlihat
// sehat padahal sedang berutang unit ke main dealer.

import {
  dbase, collection, doc, getDocs, query, orderBy, limit,
  writeBatch, increment, serverTimestamp, nomorBerikutnya,
  pakaiNilaiUnik, sertakanLog, tandaBaru, catat,
} from "./db.js";
import { sesi, bolehAkses } from "./auth.js";
import { pecahHarga, MAIN_DEALER } from "./config.js";
import { muatTipe, tipeDari, sinkronKatalog } from "./tipe.js";
import { sisipkanKas } from "./kas.js";
import { konfirmasi, tanya } from "./dialog.js";
import {
  rupiah, aman, kabar, tanggal, kunciHari,
  pasangFormatUang, bacaAngka,
} from "./ui.js";

const LABEL_BAYAR = {
  belum: "Belum dibayar",
  sebagian: "Sebagian",
  lunas: "Lunas",
};

function hitungPo(item) {
  const total = (item || []).reduce(
    (a, b) => a + Number(b.jumlah || 0) * Number(b.hargaSatuan || 0), 0);
  const unit = (item || []).reduce((a, b) => a + Number(b.jumlah || 0), 0);
  return { total, unit };
}

function telat(po) {
  if (!po.jatuhTempo || po.statusBayar === "lunas") return false;
  return po.jatuhTempo < kunciHari();
}

function kartuPo(po, bisaUbah) {
  const lewat = telat(po);
  return `<article class="kartu ${lewat ? "kartu--sorot" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(po.kode)}</h3>
        <p class="kartu-sub">${aman(po.mainDealer || "-")}</p>
      </div>
      <span class="tanda tanda--${
        po.statusBayar === "lunas" ? "ready"
        : po.statusBayar === "sebagian" ? "sebagian" : "belum"}">
        ${LABEL_BAYAR[po.statusBayar] || po.statusBayar}
      </span>
    </div>
    <p class="kartu-rinci">${(po.item || []).map((i) =>
      `${aman(i.tipeNama)} ${aman(i.warna || "")} × ${i.jumlah}`)
      .join(" · ")}</p>
    <dl class="rinci">
      <div><dt>Nilai order</dt><dd class="mono">${rupiah(po.total)}</dd></div>
      <div><dt>Sudah dibayar</dt>
        <dd class="mono">${rupiah(po.totalDibayar)}</dd></div>
      <div><dt>Sisa utang</dt><dd class="mono">${rupiah(po.sisa)}</dd></div>
      <div><dt>Jatuh tempo</dt><dd>${
        po.jatuhTempo ? tanggal(new Date(po.jatuhTempo)) : "-"}${
        lewat ? " — terlambat" : ""}</dd></div>
      ${po.noDo ? `<div><dt>No. DO</dt>
        <dd class="mono">${aman(po.noDo)}</dd></div>` : ""}
      <div><dt>Unit diterima</dt>
        <dd>${po.diterima ? "Sudah" : "Belum"}</dd></div>
    </dl>
    ${bisaUbah ? `<div class="aksi aksi--rapat">
      ${!po.diterima ? `<button class="tombol tombol--kecil tombol--isi"
        data-terima="${po.id}">Terima unit</button>` : ""}
      ${po.statusBayar !== "lunas" ? `<button class="tombol tombol--kecil"
        data-bayar="${po.id}">Catat pembayaran</button>` : ""}
    </div>` : ""}
  </article>`;
}

export async function halamanPembelian(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");
  let saring = "belum";

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Order Pembelian</h2>
      ${bisaUbah ? `<button class="tombol tombol--kecil tombol--isi"
        id="buat-po">Buat order</button>` : ""}
    </div>
    <div id="papan-utang"></div>
    <div class="chip-baris" id="saring-po" style="margin-top:14px">
      <button class="chip aktif" data-s="belum">Belum lunas</button>
      <button class="chip" data-s="semua">Semua</button>
      <button class="chip" data-s="lunas">Lunas</button>
    </div>
    <div id="form-po"></div>
    <div id="daftar-po" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-po");
  const formEl = wadah.querySelector("#form-po");
  const papanEl = wadah.querySelector("#papan-utang");
  let semua = [];

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    const snap = await getDocs(query(
      collection(dbase, "pembelian"), orderBy("dibuatPada", "desc"), limit(60)
    ));
    semua = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const utang = semua.reduce((a, b) => a + Number(b.sisa || 0), 0);
    const jatuh = semua.filter(telat)
      .reduce((a, b) => a + Number(b.sisa || 0), 0);
    const belumTerima = semua.filter((p) => !p.diterima).length;

    papanEl.innerHTML = `<div class="papan">
      <div class="papan-utama">
        <span class="papan-label">Total utang ke main dealer</span>
        <b class="papan-angka">${rupiah(utang)}</b>
      </div>
      <div class="papan-baris">
        <span>Sudah lewat jatuh tempo</span>
        <b class="mono">${rupiah(jatuh)}</b>
      </div>
      <div class="papan-baris">
        <span>Order yang unitnya belum diterima</span>
        <b class="mono">${belumTerima}</b>
      </div>
    </div>`;

    const tampil = saring === "semua" ? semua
      : saring === "lunas" ? semua.filter((p) => p.statusBayar === "lunas")
      : semua.filter((p) => p.statusBayar !== "lunas");

    daftarEl.innerHTML = tampil.length
      ? tampil.map((p) => kartuPo(p, bisaUbah)).join("")
      : `<div class="hampa"><p>Tidak ada order di kelompok ini.</p></div>`;

    daftarEl.querySelectorAll("[data-terima]").forEach((b) =>
      b.addEventListener("click", () =>
        bukaTerima(semua.find((x) => x.id === b.dataset.terima))));
    daftarEl.querySelectorAll("[data-bayar]").forEach((b) =>
      b.addEventListener("click", () =>
        bayar(semua.find((x) => x.id === b.dataset.bayar))));
  }

  wadah.querySelector("#saring-po").addEventListener("click", (e) => {
    const t = e.target.closest("[data-s]");
    if (!t) return;
    saring = t.dataset.s;
    wadah.querySelectorAll("#saring-po .chip")
      .forEach((c) => c.classList.toggle("aktif", c === t));
    gambar();
  });

  // ── Buat order ──────────────────────────────────────────────
  async function bukaForm() {
    const daftarTipe = await muatTipe();
    if (!daftarTipe.length) {
      kabar("Tambahkan tipe motor dulu di Data Induk.", "rem");
      return;
    }
    const item = [];
    const hariIni = new Date().toISOString().slice(0, 10);

    formEl.innerHTML = `<form class="form" id="f-po">
      <label class="label label--gelap" for="po-dealer">Main dealer</label>
      <input class="isian isian--terang" id="po-dealer"
             value="${MAIN_DEALER}" placeholder="Nama main dealer">
      <div class="dua">
        <div>
          <label class="label label--gelap" for="po-do">No. DO</label>
          <input class="isian isian--terang kecil mono" id="po-do">
        </div>
        <div>
          <label class="label label--gelap" for="po-faktur">No. faktur</label>
          <input class="isian isian--terang kecil mono" id="po-faktur">
        </div>
      </div>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="po-tanggal">Tanggal order</label>
          <input class="isian isian--terang kecil" id="po-tanggal"
                 type="date" value="${hariIni}">
        </div>
        <div>
          <label class="label label--gelap" for="po-tempo">Jatuh tempo</label>
          <input class="isian isian--terang kecil" id="po-tempo" type="date">
        </div>
      </div>

      <div class="pemisah">Unit yang ditebus</div>
      <div id="daftar-item"></div>
      <button class="tombol tombol--kecil" type="button" id="tambah-item">
        Tambah baris
      </button>

      <div id="ringkas-po" class="ringkas"></div>
      <label class="label label--gelap" for="po-catatan">Catatan</label>
      <input class="isian isian--terang" id="po-catatan" placeholder="Opsional">
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">Simpan order</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-po">Batal</button>
      </div>
    </form>`;

    const itemEl = formEl.querySelector("#daftar-item");

    function barisItem(it, i) {
      const t = tipeDari(it.tipeId);
      return `<div class="potongan" data-ii="${i}">
        <select class="isian isian--terang kecil" data-if="tipeId">
          <option value="">— pilih tipe —</option>
          ${daftarTipe.map((x) => `<option value="${x.id}" ${
            it.tipeId === x.id ? "selected" : ""}>${aman(x.merek)} ${
            aman(x.tipe)} ${aman(x.varian || "")}</option>`).join("")}
        </select>
        <div class="tiga" style="margin-top:8px">
          <select class="isian isian--terang kecil" data-if="warna">
            <option value="">Warna</option>
            ${((t && t.warna) || []).map((w) => `<option value="${aman(w)}" ${
              it.warna === w ? "selected" : ""}>${aman(w)}</option>`).join("")}
          </select>
          <input class="isian isian--terang kecil" data-if="jumlah"
                 inputmode="numeric" placeholder="Qty"
                 value="${it.jumlah || ""}">
          <input class="isian isian--terang kecil" data-if="hargaSatuan"
                 inputmode="numeric" placeholder="Harga tebus"
                 value="${it.hargaSatuan
                   ? Number(it.hargaSatuan).toLocaleString("id-ID") : ""}">
        </div>
        <button class="tautan-batal" type="button" data-ihapus="${i}">
          Hapus baris
        </button>
      </div>`;
    }

    function gambarItem() {
      itemEl.innerHTML = item.map(barisItem).join("");
      itemEl.querySelectorAll("[data-ii]").forEach((b) => {
        b.querySelectorAll("[data-if]").forEach((f) => {
          f.addEventListener("input", () => {
            const i = Number(b.dataset.ii);
            const k = f.dataset.if;
            if (k === "hargaSatuan") {
              const bersih = f.value.replace(/\D/g, "");
              f.value = bersih ? Number(bersih).toLocaleString("id-ID") : "";
              item[i][k] = Number(bersih || 0);
            } else if (k === "jumlah") {
              item[i][k] = Number(f.value.replace(/\D/g, "") || 0);
            } else {
              item[i][k] = f.value;
              if (k === "tipeId") { gambarItem(); return; }
            }
            ringkas();
          });
        });
      });
      itemEl.querySelectorAll("[data-ihapus]").forEach((b) =>
        b.addEventListener("click", () => {
          item.splice(Number(b.dataset.ihapus), 1);
          gambarItem(); ringkas();
        }));
      ringkas();
    }

    function ringkas() {
      const h = hitungPo(item);
      const p = pecahHarga(h.total, false);
      formEl.querySelector("#ringkas-po").innerHTML = `
        <div class="ringkas-baris"><span>Jumlah unit</span>
          <span class="mono">${h.unit}</span></div>
        <div class="ringkas-baris ringkas-total"><span>Nilai order</span>
          <b class="mono">${rupiah(h.total)}</b></div>
        <div class="ringkas-baris"><span>DPP / PPN masukan</span>
          <span class="mono">${rupiah(p.dpp)} / ${rupiah(p.ppn)}</span></div>`;
    }

    formEl.querySelector("#tambah-item").addEventListener("click", () => {
      item.push({ tipeId: "", warna: "", jumlah: 1, hargaSatuan: 0 });
      gambarItem();
    });
    formEl.querySelector("#batal-po")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    item.push({ tipeId: "", warna: "", jumlah: 1, hargaSatuan: 0 });
    gambarItem();

    formEl.querySelector("#f-po").addEventListener("submit", async (e) => {
      e.preventDefault();
      const dealer = formEl.querySelector("#po-dealer").value.trim();
      const isi = item.filter((i) => i.tipeId && i.jumlah > 0);
      if (!dealer) { kabar("Nama main dealer wajib diisi.", "rem"); return; }
      if (!isi.length) { kabar("Belum ada unit yang diisi.", "rem"); return; }

      const tombol = e.target.querySelector('button[type="submit"]');
      tombol.disabled = true;
      tombol.textContent = "Menyimpan…";
      try {
        const h = hitungPo(isi);
        const p = pecahHarga(h.total, false);
        const kode = await nomorBerikutnya(
          `po_${new Date().getFullYear()}`, "PO");
        const ref = doc(collection(dbase, "pembelian"));
        const batch = writeBatch(dbase);
        batch.set(ref, {
          kode,
          mainDealer: dealer,
          noDo: formEl.querySelector("#po-do").value.trim(),
          noFaktur: formEl.querySelector("#po-faktur").value.trim(),
          tanggal: formEl.querySelector("#po-tanggal").value,
          jatuhTempo: formEl.querySelector("#po-tempo").value || null,
          item: isi.map((i) => ({
            tipeId: i.tipeId,
            tipeNama: (() => {
              const t = tipeDari(i.tipeId);
              return `${t.merek} ${t.tipe} ${t.varian || ""}`.trim();
            })(),
            warna: i.warna,
            jumlah: Number(i.jumlah),
            hargaSatuan: Number(i.hargaSatuan),
          })),
          jumlahUnit: h.unit,
          total: h.total,
          dpp: p.dpp,
          ppnMasukan: p.ppn,
          totalDibayar: 0,
          sisa: h.total,
          statusBayar: "belum",
          diterima: false,
          catatan: formEl.querySelector("#po-catatan").value.trim(),
          ...tandaBaru(),
        });
        sertakanLog(batch, "pembelian_dibuat", {
          koleksi: "pembelian", docId: ref.id,
          ringkas: `${kode} · ${dealer} · ${rupiah(h.total)}`,
        });
        await batch.commit();
        formEl.innerHTML = "";
        kabar(`${kode} tersimpan.`, "netral");
        await gambar();
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
        tombol.disabled = false;
        tombol.textContent = "Simpan order";
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Terima unit: nomor rangka masuk ke stok ─────────────────
  async function bukaTerima(po) {
    // Satu baris per unit fisik, tipenya sudah ditentukan order.
    const baris = [];
    (po.item || []).forEach((it) => {
      for (let n = 0; n < Number(it.jumlah || 0); n++) {
        baris.push({
          tipeId: it.tipeId, tipeNama: it.tipeNama, warna: it.warna,
          hargaSatuan: it.hargaSatuan, noRangka: "", noMesin: "",
        });
      }
    });

    formEl.innerHTML = `<form class="form" id="f-terima">
      <p class="pemisah">Terima unit — ${aman(po.kode)}</p>
      <p class="petunjuk">Harga tebus tiap unit terisi otomatis dari
        order, jadi laba per unit nanti dihitung dari angka yang benar.
        Nomor rangka wajib; nomor mesin boleh menyusul.</p>
      <div id="baris-unit" style="margin-top:12px">
        ${baris.map((b, i) => `<div class="potongan" data-ui="${i}">
          <p class="kartu-sub">${aman(b.tipeNama)} · ${aman(b.warna || "-")}
            · ${rupiah(b.hargaSatuan)}</p>
          <div class="dua" style="margin-top:8px">
            <input class="isian isian--terang kecil mono" data-uf="noRangka"
                   autocapitalize="characters" placeholder="Nomor rangka">
            <input class="isian isian--terang kecil mono" data-uf="noMesin"
                   autocapitalize="characters" placeholder="Nomor mesin">
          </div>
        </div>`).join("")}
      </div>
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">
          Terima ${baris.length} unit
        </button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-terima">Batal</button>
      </div>
    </form>`;

    formEl.querySelector("#batal-terima")
      .addEventListener("click", () => (formEl.innerHTML = ""));

    formEl.querySelector("#f-terima").addEventListener("submit", async (e) => {
      e.preventDefault();
      formEl.querySelectorAll("[data-ui]").forEach((b) => {
        const i = Number(b.dataset.ui);
        b.querySelectorAll("[data-uf]").forEach((f) => {
          baris[i][f.dataset.uf] = f.value.trim().toUpperCase();
        });
      });
      const kosong = baris.filter((b) => !b.noRangka).length;
      if (kosong) {
        kabar(`${kosong} nomor rangka belum diisi.`, "rem");
        return;
      }
      const unik = new Set(baris.map((b) => b.noRangka));
      if (unik.size !== baris.length) {
        kabar("Ada nomor rangka yang kembar di formulir ini.", "rem");
        return;
      }

      const tombol = e.target.querySelector('button[type="submit"]');
      tombol.disabled = true;
      tombol.textContent = "Memproses…";
      try {
        // Semua nomor rangka ditahan lebih dulu. Kalau ada yang sudah
        // terdaftar, tidak ada satu pun unit yang tersimpan.
        const ref = baris.map(() => doc(collection(dbase, "units")));
        for (let i = 0; i < baris.length; i++) {
          await pakaiNilaiUnik("indeks_rangka", baris[i].noRangka, ref[i].id);
        }

        const batch = writeBatch(dbase);
        const perTipe = {};
        baris.forEach((b, i) => {
          batch.set(ref[i], {
            tipeId: b.tipeId, tipeNama: b.tipeNama, warna: b.warna,
            tahun: new Date().getFullYear(),
            noRangka: b.noRangka, noMesin: b.noMesin,
            noDo: po.noDo || "", pembelianId: po.id, pembelianKode: po.kode,
            tglMasuk: new Date(po.tanggal || Date.now()),
            status: "ready",
            ...tandaBaru(),
          });
          const p = pecahHarga(b.hargaSatuan, false);
          batch.set(doc(dbase, "units", ref[i].id, "rahasia", "harga"), {
            hargaTebus: b.hargaSatuan, dpp: p.dpp, ppnMasukan: p.ppn,
            sumber: po.kode, dicatatPada: serverTimestamp(),
          });
          perTipe[b.tipeId] = (perTipe[b.tipeId] || 0) + 1;
        });
        Object.entries(perTipe).forEach(([tipeId, n]) => {
          batch.update(doc(dbase, "tipe_motor", tipeId),
            { jumlahReady: increment(n) });
        });
        batch.update(doc(dbase, "pembelian", po.id), {
          diterima: true, diterimaPada: serverTimestamp(),
          diterimaOleh: sesi.nama,
        });
        sertakanLog(batch, "unit_diterima", {
          koleksi: "pembelian", docId: po.id,
          ringkas: `${po.kode} · ${baris.length} unit`,
        });
        await batch.commit();
        await sinkronKatalog();
        formEl.innerHTML = "";
        kabar(`${baris.length} unit masuk ke stok.`, "netral");
        await gambar();
      } catch (err) {
        kabar(err.message || "Gagal menerima unit.", "rem");
        tombol.disabled = false;
        tombol.textContent = `Terima ${baris.length} unit`;
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Catat pembayaran ke main dealer ─────────────────────────
  async function bayar(po) {
    const nilai = await tanya({
      judul: `Pembayaran ${po.kode}`,
      pesan: `Sisa utang ${rupiah(po.sisa)}. Isi nominal yang dibayarkan ` +
             `ke ${po.mainDealer}.`,
      nilai: String(po.sisa || 0),
      petunjuk: "Nominal",
    });
    if (nilai === null) return;
    const nominal = Number(String(nilai).replace(/\D/g, ""));
    if (!nominal) { kabar("Nominal tidak terbaca.", "rem"); return; }
    if (nominal > Number(po.sisa || 0)) {
      kabar("Nominal melebihi sisa utang.", "rem");
      return;
    }
    try {
      const dibayar = Number(po.totalDibayar || 0) + nominal;
      const sisa = Number(po.total || 0) - dibayar;
      const batch = writeBatch(dbase);
      sisipkanKas(batch, {
        kategori: "tebus_unit", nominal,
        keterangan: `${po.kode} · ${po.mainDealer}`,
        refType: "pembelian", refId: po.id,
      });
      batch.update(doc(dbase, "pembelian", po.id), {
        totalDibayar: dibayar, sisa,
        statusBayar: sisa === 0 ? "lunas" : "sebagian",
      });
      sertakanLog(batch, "pembelian_dibayar", {
        koleksi: "pembelian", docId: po.id,
        ringkas: `${po.kode} · ${rupiah(nominal)}`,
      });
      await batch.commit();
      kabar("Pembayaran tercatat.", "netral");
      await gambar();
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#buat-po").addEventListener("click", bukaForm);
  }
  await gambar();
}

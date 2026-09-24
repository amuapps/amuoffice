// transfer.js — Inventory → Transfer / Tarik Unit.
//
// PRINSIP (sejak v3.16.0): transfer HANYA memindahkan LOKASI unit,
// BUKAN mengubah stok. Unit di Channel tetap stok milik showroom —
// status tetap "ready" (tetap bisa dijual lewat SPK) dan jumlahReady
// di Tipe Motor TIDAK berubah. Yang berubah cuma field lokasi:
//   units/{id}.lokasiId   = id channel, atau null = Showroom (pusat)
//   units/{id}.lokasiNama = nama channel, atau null
//
// Satu fitur untuk dua arah:
//   • Transfer  : Showroom → Channel, atau Channel → Channel lain
//   • Tarik unit: Channel → Showroom (atau ke channel lain)
// Satu dokumen transfer = satu lokasi ASAL → satu lokasi TUJUAN,
// supaya BAST / Surat Jalan-nya jelas dari mana ke mana.
//
// Dokumen /transfer_unit/{id}:
//   { noTransfer, tanggal, jenis: "transfer" | "tarik",
//     dariId, dariNama, dariJenis, dariPic, dariKontak, dariAlamat,
//     channelId, channelNama, channelJenis, channelPic, channelKontak,
//     channelAlamat,   ← data TUJUAN (nama field lama dipertahankan)
//     pengemudi, noPolisi, keterangan,
//     unit: [{ unitId, tipeId, tipeNama, warna, tahun, noRangka, noMesin }],
//     status: "dikirim", ...tandaBaru() }

import {
  dbase, collection, doc, getDocs, query, where, limit, orderBy,
  runTransaction, increment, nomorBerikutnya, catat, tandaBaru,
} from "./db.js?v=3.16.0";
import { bolehAkses, sesi } from "./auth.js?v=3.16.0";
import { muatChannel, channelDari } from "./channel.js?v=3.16.0";
import { muatTipe, sinkronKatalog } from "./tipe.js?v=3.16.0";
import { konfirmasi } from "./dialog.js?v=3.16.0";
import { SHOWROOM } from "./config.js?v=3.16.0";
import { aman, kabar, tanggal, kunciHari, pasangHurufBesar } from "./ui.js?v=3.16.0";

// "" = Showroom (pusat). Dipakai sebagai nilai <option> & pembanding.
const PUSAT = "";

function namaPusat() {
  return `${SHOWROOM.namaPendek || SHOWROOM.nama} (Showroom)`;
}

function dataLokasi(id) {
  if (!id) {
    return {
      id: PUSAT, nama: namaPusat(), jenis: "Showroom", pic: "",
      kontak: SHOWROOM.telepon || "",
      alamat: [SHOWROOM.alamat, SHOWROOM.kota].filter(Boolean).join(", "),
    };
  }
  const c = channelDari(id) || {};
  return {
    id, nama: c.nama || "(channel dihapus)", jenis: c.jenis || "Channel",
    pic: c.pic || "", kontak: c.kontak || "", alamat: c.alamat || "",
  };
}

// ── Migrasi sekali jalan ──────────────────────────────────────────
// Versi 3.15.0 sempat menandai unit yang ditransfer dengan status
// "transfer" DAN mengurangi jumlahReady. Itu keliru — unit di channel
// tetap stok. Fungsi ini mengembalikan unit-unit tersebut ke "ready"
// (lokasi tetap di channel-nya) dan memulihkan jumlahReady. Aman
// dijalankan berkali-kali: tiap unit dicek ulang di dalam transaksi.
export async function migrasiStatusTransfer() {
  if (!bolehAkses("stok.ubah")) return 0;
  const snap = await getDocs(query(collection(dbase, "units"),
    where("status", "==", "transfer"), limit(300)));
  let n = 0;
  for (const d of snap.docs) {
    try {
      const ok = await runTransaction(dbase, async (trx) => {
        const s = await trx.get(d.ref);
        if (!s.exists() || s.data().status !== "transfer") return false;
        const u = s.data();
        trx.update(d.ref, {
          status: "ready",
          lokasiId: u.channelId || null,
          lokasiNama: u.channelNama || null,
          channelId: null, channelNama: null,
        });
        if (u.tipeId) trx.update(doc(dbase, "tipe_motor", u.tipeId), { jumlahReady: increment(1) });
        return true;
      });
      if (ok) n++;
    } catch { /* lanjut unit berikutnya */ }
  }
  if (n) {
    await catat("transfer_unit_migrasi", { koleksi: "units", ringkas: `${n} unit` });
    try { await muatTipe(true); await sinkronKatalog(); } catch { /* menyusul */ }
  }
  return n;
}

// ── Tabel daftar transfer ─────────────────────────────────────────
function labelJenis(t) {
  return t.jenis === "tarik" ? "Tarik Unit" : "Transfer";
}

function tabelTransfer(daftar) {
  return `<div style="overflow-x:auto">
    <table class="tabel">
      <thead><tr>
        <th>No.</th><th>No. Transfer</th><th>Tanggal</th><th>Jenis</th>
        <th>Dari</th><th>Ke</th><th>Jumlah Unit</th><th>Pengemudi</th><th></th>
      </tr></thead>
      <tbody>
        ${daftar.map((t, i) => `<tr>
          <td class="mono">${i + 1}</td>
          <td class="mono">${aman(t.noTransfer)}</td>
          <td>${tanggal(t.tanggal)}</td>
          <td><span class="tanda tanda--${t.jenis === "tarik" ? "booked" : "transfer"}">
            ${labelJenis(t)}</span></td>
          <td>${aman(t.dariNama || namaPusat())}</td>
          <td>${aman(t.channelNama)}</td>
          <td>${(t.unit || []).length} unit</td>
          <td>${aman(t.pengemudi || "-")}</td>
          <td style="white-space:nowrap">
            <button class="tombol tombol--kecil" data-detail="${t.id}">Detail</button>
            <button class="tombol tombol--kecil tombol--isi" data-cetak="${t.id}">Cetak BAST</button>
          </td>
        </tr>
        <tr data-rinci="${t.id}" hidden>
          <td></td>
          <td colspan="8" style="white-space:normal;background:var(--lapis)">
            ${(t.unit || []).map((u, j) => `<div style="padding:2px 0">
              ${j + 1}. <b>${aman(u.tipeNama)}</b> · ${aman(u.warna || "-")} · ${aman(u.tahun || "-")}
              · Rangka <span class="mono">${aman(u.noRangka)}</span>
              · Mesin <span class="mono">${aman(u.noMesin)}</span></div>`).join("")}
            ${t.noPolisi ? `<div class="petunjuk">No. Polisi pengangkut: ${aman(t.noPolisi)}</div>` : ""}
            ${t.keterangan ? `<div class="petunjuk">Keterangan: ${aman(t.keterangan)}</div>` : ""}
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

// ── Form ─────────────────────────────────────────────────────────
function opsiLokasi(daftarChannel, pilih) {
  return `<option value="${PUSAT}" ${pilih === PUSAT ? "selected" : ""}>${aman(namaPusat())}</option>` +
    daftarChannel.map((c) => `<option value="${c.id}" ${pilih === c.id ? "selected" : ""}>
      ${aman(c.nama)}${c.jenis ? ` (${aman(c.jenis)})` : ""}${c.aktif === false ? " — nonaktif" : ""}</option>`).join("");
}

function formTransfer(daftarChannel, jumlahPerLokasi, dariAwal) {
  const aktif = daftarChannel.filter((c) => c.aktif !== false);
  // Asal: showroom + semua channel yang sedang memegang unit
  // (termasuk channel nonaktif, supaya unitnya tetap bisa ditarik).
  const asal = daftarChannel.filter((c) => c.aktif !== false || jumlahPerLokasi.get(c.id));
  const labelJumlah = (id) => ` — ${jumlahPerLokasi.get(id) || 0} unit`;
  return `<form id="form-transfer" class="form" style="max-width:none">
    <p class="pemisah" style="margin-top:0">Transfer / Tarik Unit</p>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="tr-dari">Dari lokasi (posisi unit sekarang)</label>
        <select class="isian isian--terang" id="tr-dari">
          <option value="${PUSAT}" ${dariAwal === PUSAT ? "selected" : ""}>${aman(namaPusat())}${labelJumlah(PUSAT)}</option>
          ${asal.map((c) => `<option value="${c.id}" ${dariAwal === c.id ? "selected" : ""}>
            ${aman(c.nama)}${labelJumlah(c.id)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label class="label label--gelap" for="tr-ke">Ke lokasi (tujuan)</label>
        <select class="isian isian--terang" id="tr-ke">
          <option value="-">— pilih tujuan —</option>
          ${opsiLokasi(aktif, "-")}
        </select>
      </div>
    </div>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="tr-tanggal">Tanggal kirim</label>
        <input class="isian isian--terang" id="tr-tanggal" type="date" value="${kunciHari()}">
      </div>
      <div>
        <label class="label label--gelap" for="tr-pengemudi">Nama pengemudi / pengirim</label>
        <input class="isian isian--terang" id="tr-pengemudi" placeholder="Opsional">
      </div>
    </div>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="tr-nopol">No. Polisi kendaraan pengangkut</label>
        <input class="isian isian--terang mono" id="tr-nopol" placeholder="Opsional, mis. BL 1234 AB">
      </div>
      <div>
        <label class="label label--gelap" for="tr-ket">Keterangan</label>
        <input class="isian isian--terang" id="tr-ket" placeholder="Opsional">
      </div>
    </div>

    <p class="pemisah">Pilih unit yang dipindah</p>
    <input class="isian isian--terang" id="tr-cari"
           placeholder="Cari tipe / warna / No. Rangka / No. Mesin…">
    <p class="petunjuk" id="tr-jumlah">0 unit dipilih</p>
    <div id="tr-unit" style="max-height:360px;overflow:auto;border:1px solid var(--garis);
         border-radius:var(--r)"></div>

    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button" id="tr-batal">Batal</button>
    </div>
  </form>`;
}

function tabelPilihUnit(daftar) {
  if (!daftar.length) {
    return `<div class="hampa"><p>Tidak ada unit Ready di lokasi ini.</p></div>`;
  }
  return `<table class="tabel">
    <thead><tr>
      <th><input type="checkbox" id="tr-semua" title="Pilih semua yang tampil"></th>
      <th>Tipe</th><th>Warna</th><th>Tahun</th><th>No. Rangka</th><th>No. Mesin</th><th>Masuk</th>
    </tr></thead>
    <tbody>
      ${daftar.map((u) => `<tr data-cari="${aman(
        `${u.tipeNama} ${u.warna} ${u.noRangka} ${u.noMesin}`.toLowerCase())}">
        <td><input type="checkbox" class="tr-pilih" value="${u.id}" id="tr-u-${u.id}"></td>
        <td><label for="tr-u-${u.id}">${aman(u.tipeNama)}</label></td>
        <td>${aman(u.warna || "-")}</td>
        <td>${aman(u.tahun || "-")}</td>
        <td class="mono">${aman(u.noRangka || "-")}</td>
        <td class="mono">${aman(u.noMesin || "-")}</td>
        <td>${tanggal(u.tglMasuk)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

// ── Halaman ───────────────────────────────────────────────────────
export async function halamanTransfer(wadah) {
  const bisaUbah = bolehAkses("stok.ubah");
  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Transfer / Tarik Unit</h2>
      ${bisaUbah ? `<div style="display:flex;gap:8px">
        <button class="tombol tombol--kecil" id="tarik-unit">Tarik unit</button>
        <button class="tombol tombol--kecil tombol--isi" id="tambah-transfer">Transfer unit</button>
      </div>` : ""}
    </div>
    <p class="petunjuk">Memindahkan <b>lokasi</b> unit — dari Showroom ke Channel,
      antar Channel, atau menarik kembali ke Showroom. <b>Stok tidak berubah</b>:
      unit tetap Ready, tetap bisa dijual lewat SPK, hanya lokasinya yang
      tercatat. Setiap pemindahan bisa dicetak sebagai BAST Kendaraan / Surat Jalan.</p>
    <div class="chip-baris" id="saring-trf">
      <button class="chip aktif" data-jenis="">Semua</button>
      <button class="chip" data-jenis="transfer">Transfer</button>
      <button class="chip" data-jenis="tarik">Tarik Unit</button>
    </div>
    <div id="wadah-form-transfer"></div>
    <div id="daftar-transfer" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-transfer");
  const formEl = wadah.querySelector("#wadah-form-transfer");
  let semua = [];
  let saring = "";

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    try {
      const snap = await getDocs(query(collection(dbase, "transfer_unit"),
        orderBy("dibuatPada", "desc"), limit(300)));
      semua = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (err) {
      daftarEl.innerHTML = `<div class="hampa"><p>Gagal memuat data transfer:
        ${aman(err.message)}</p><p>Kalau pesannya soal izin (permission-denied),
        <b>firestore.rules</b> terbaru belum di-Publish ke Firebase.</p></div>`;
      return;
    }
    tampil();
  }

  function tampil() {
    const hasil = saring
      ? semua.filter((t) => (t.jenis || "transfer") === saring) : semua;
    daftarEl.innerHTML = hasil.length
      ? tabelTransfer(hasil)
      : `<div class="hampa"><p>Belum ada data.</p></div>`;
    daftarEl.querySelectorAll("[data-detail]").forEach((b) =>
      b.addEventListener("click", () => {
        const r = daftarEl.querySelector(`[data-rinci="${b.dataset.detail}"]`);
        if (r) r.hidden = !r.hidden;
      }));
    daftarEl.querySelectorAll("[data-cetak]").forEach((b) =>
      b.addEventListener("click", () =>
        cetakBastTransfer(semua.find((t) => t.id === b.dataset.cetak))));
  }

  wadah.querySelector("#saring-trf").addEventListener("click", (e) => {
    const c = e.target.closest("[data-jenis]");
    if (!c) return;
    saring = c.dataset.jenis;
    wadah.querySelectorAll("#saring-trf .chip").forEach((x) => x.classList.toggle("aktif", x === c));
    tampil();
  });

  // ── Form ────────────────────────────────────────────────────
  // modeTarik = dibuka dari tombol "Tarik unit": asal default ke
  // channel pertama yang memegang unit, tujuan default ke Showroom.
  async function bukaForm(modeTarik = false) {
    formEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    let daftarChannel = [], unitReady = [];
    try {
      const [, snapUnit] = await Promise.all([
        muatChannel(true),
        getDocs(query(collection(dbase, "units"), where("status", "==", "ready"), limit(1000))),
      ]);
      daftarChannel = (await muatChannel()).slice();
      unitReady = snapUnit.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.tipeNama).localeCompare(String(b.tipeNama)) ||
          String(a.warna || "").localeCompare(String(b.warna || "")));
    } catch (err) {
      formEl.innerHTML = "";
      kabar("Gagal memuat data: " + err.message, "rem");
      return;
    }
    const lokasiUnit = (u) => u.lokasiId || PUSAT;
    const jumlahPerLokasi = new Map();
    unitReady.forEach((u) => jumlahPerLokasi.set(lokasiUnit(u), (jumlahPerLokasi.get(lokasiUnit(u)) || 0) + 1));

    if (modeTarik && ![...jumlahPerLokasi.keys()].some((k) => k !== PUSAT)) {
      formEl.innerHTML = "";
      kabar("Tidak ada unit Ready yang sedang berada di Channel.", "rem");
      return;
    }
    if (!modeTarik && !daftarChannel.some((c) => c.aktif !== false)) {
      formEl.innerHTML = `<div class="hampa"><p>Belum ada Channel aktif. Tambahkan dulu
        lewat <b>Master Data → Master Channel</b>.</p></div>`;
      return;
    }
    const dariAwal = modeTarik
      ? [...jumlahPerLokasi.keys()].find((k) => k !== PUSAT) : PUSAT;
    formEl.innerHTML = formTransfer(daftarChannel, jumlahPerLokasi, dariAwal);

    const dariEl = formEl.querySelector("#tr-dari");
    const keEl = formEl.querySelector("#tr-ke");
    const wadahUnit = formEl.querySelector("#tr-unit");
    const jumlahEl = formEl.querySelector("#tr-jumlah");
    const cariEl = formEl.querySelector("#tr-cari");
    pasangHurufBesar(formEl.querySelector("#tr-pengemudi"));
    pasangHurufBesar(formEl.querySelector("#tr-nopol"));

    const hitung = () => {
      const n = wadahUnit.querySelectorAll(".tr-pilih:checked").length;
      jumlahEl.innerHTML = `<b>${n}</b> unit dipilih`;
    };
    function gambarUnit() {
      const dari = dariEl.value;
      wadahUnit.innerHTML = tabelPilihUnit(unitReady.filter((u) => lokasiUnit(u) === dari));
      cariEl.value = "";
      hitung();
      // Tujuan tidak boleh sama dengan asal.
      [...keEl.options].forEach((o) => { o.disabled = o.value === dari; });
      if (keEl.value === dari) keEl.value = "-";
      if (modeTarik && keEl.value === "-" && dari !== PUSAT) keEl.value = PUSAT;
    }
    gambarUnit();
    dariEl.addEventListener("change", gambarUnit);

    wadahUnit.addEventListener("change", (e) => {
      if (e.target.id === "tr-semua") {
        wadahUnit.querySelectorAll("tbody tr").forEach((tr) => {
          if (!tr.hidden) tr.querySelector(".tr-pilih").checked = e.target.checked;
        });
      }
      hitung();
    });
    cariEl.addEventListener("input", () => {
      const kata = cariEl.value.trim().toLowerCase().replace(/\s+/g, " ");
      wadahUnit.querySelectorAll("tbody tr").forEach((tr) => {
        tr.hidden = !!kata && !tr.dataset.cari.includes(kata);
      });
    });
    formEl.querySelector("#tr-batal").addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-transfer").addEventListener("submit", (e) => simpan(e, unitReady));
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function simpan(e, unitReady) {
    e.preventDefault();
    const tombol = formEl.querySelector('button[type="submit"]');
    const dariId = formEl.querySelector("#tr-dari").value;
    const keId = formEl.querySelector("#tr-ke").value;
    const tgl = formEl.querySelector("#tr-tanggal").value;
    const idDipilih = [...formEl.querySelectorAll(".tr-pilih:checked")].map((x) => x.value);
    if (keId === "-") { kabar("Lokasi tujuan wajib dipilih.", "rem"); return; }
    if (keId === dariId) { kabar("Lokasi tujuan tidak boleh sama dengan asal.", "rem"); return; }
    if (!tgl) { kabar("Tanggal kirim wajib diisi.", "rem"); return; }
    if (!idDipilih.length) { kabar("Pilih minimal satu unit.", "rem"); return; }
    if (idDipilih.length > 100) { kabar("Maksimal 100 unit sekali pindah.", "rem"); return; }

    const dari = dataLokasi(dariId);
    const ke = dataLokasi(keId);
    const jenis = keId === PUSAT ? "tarik" : "transfer";
    const yakin = await konfirmasi({
      judul: jenis === "tarik" ? "Tarik unit" : "Transfer unit",
      pesan: `Pindahkan <b>${idDipilih.length} unit</b> dari <b>${aman(dari.nama)}</b>
        ke <b>${aman(ke.nama)}</b>? Stok tidak berubah, hanya lokasi unit.`,
      oke: "Simpan",
    });
    if (!yakin) return;

    tombol.disabled = true;
    try {
      const noTransfer = await nomorBerikutnya("transfer", "TRF");
      const refTrf = doc(collection(dbase, "transfer_unit"));
      const petaUnit = new Map(unitReady.map((u) => [u.id, u]));

      // Baca ULANG semua unit di dalam transaksi — kalau ada yang sudah
      // tidak Ready (baru dipesan SPK) atau lokasinya sudah berubah
      // (dipindah dari perangkat lain), seluruh pemindahan dibatalkan.
      const daftarUnit = await runTransaction(dbase, async (trx) => {
        const snaps = await Promise.all(idDipilih.map((id) => trx.get(doc(dbase, "units", id))));
        const bentrok = snaps.filter((s) => !s.exists() || s.data().status !== "ready" ||
          (s.data().lokasiId || PUSAT) !== dariId);
        if (bentrok.length) {
          const nama = bentrok.map((s) => petaUnit.get(s.id)?.noRangka || s.id).join(", ");
          throw new Error(`Unit berikut sudah tidak Ready / sudah pindah lokasi: ${nama}. Muat ulang form.`);
        }
        const isi = snaps.map((s) => {
          const u = s.data();
          return {
            unitId: s.id, tipeId: u.tipeId || "", tipeNama: u.tipeNama || "",
            warna: u.warna || "", tahun: u.tahun || "",
            noRangka: u.noRangka || "", noMesin: u.noMesin || "",
          };
        });
        isi.forEach((u) => trx.update(doc(dbase, "units", u.unitId), {
          lokasiId: keId || null,
          lokasiNama: keId ? ke.nama : null,
          transferId: refTrf.id,
          transferNo: noTransfer,
        }));
        trx.set(refTrf, {
          noTransfer, jenis,
          tanggal: new Date(`${tgl}T12:00:00`),
          dariId: dariId || null, dariNama: dari.nama, dariJenis: dari.jenis,
          dariPic: dari.pic, dariKontak: dari.kontak, dariAlamat: dari.alamat,
          channelId: keId || null, channelNama: ke.nama, channelJenis: ke.jenis,
          channelPic: ke.pic, channelKontak: ke.kontak, channelAlamat: ke.alamat,
          pengemudi: formEl.querySelector("#tr-pengemudi").value.trim(),
          noPolisi: formEl.querySelector("#tr-nopol").value.trim().toUpperCase(),
          keterangan: formEl.querySelector("#tr-ket").value.trim(),
          unit: isi,
          status: "dikirim",
          dibuatOlehNama: sesi?.nama || "",
          ...tandaBaru(),
        });
        return isi;
      });

      await catat(jenis === "tarik" ? "tarik_unit_dibuat" : "transfer_unit_dibuat", {
        koleksi: "transfer_unit", docId: refTrf.id,
        ringkas: `${noTransfer}: ${dari.nama} → ${ke.nama} (${daftarUnit.length} unit)`,
      });
      formEl.innerHTML = "";
      kabar(`${noTransfer} tersimpan.`, "netral");
      await gambar();
      const baru = semua.find((t) => t.id === refTrf.id);
      if (baru && await konfirmasi({
        judul: "Cetak BAST / Surat Jalan",
        pesan: `<b>${aman(noTransfer)}</b> tersimpan. Cetak BAST Kendaraan sekarang?`,
        oke: "Cetak",
      })) cetakBastTransfer(baru);
    } catch (err) {
      kabar(err.message || "Gagal menyimpan.", "rem");
    } finally {
      if (tombol.isConnected) tombol.disabled = false;
    }
  }

  if (bisaUbah) {
    wadah.querySelector("#tambah-transfer").addEventListener("click", () => bukaForm(false));
    wadah.querySelector("#tarik-unit").addEventListener("click", () => bukaForm(true));
    // Perbaiki data dari v3.16.0 (status "transfer" + stok berkurang).
    try {
      const n = await migrasiStatusTransfer();
      if (n) kabar(`${n} unit di Channel dipulihkan: status kembali Ready & stok dikembalikan.`, "netral");
    } catch { /* tidak menghalangi halaman */ }
  }
  await gambar();
}

// ── Cetak BAST Kendaraan / Surat Jalan ────────────────────────────
// Satu lembar A4 portrait. Tiga kolom tanda tangan: yang menyerahkan
// (lokasi asal), pengemudi, dan penerima (lokasi tujuan).
export function cetakBastTransfer(t) {
  if (!t) return;
  const tab = window.open("", "_blank");
  if (!tab) {
    alert("Browser memblokir tab baru. Izinkan pop-up untuk situs ini, lalu coba lagi.");
    return;
  }
  const unit = t.unit || [];
  const kopAlamat = [SHOWROOM.alamat, SHOWROOM.kota].filter(Boolean).join(", ");
  const kopTelp = SHOWROOM.telepon ? `Telp. ${SHOWROOM.telepon}` : "";
  // Transfer lama (v3.16.0) belum punya data asal = dari Showroom.
  const dari = {
    nama: t.dariNama || namaPusat(),
    jenis: t.dariJenis || "Showroom",
    pic: t.dariPic || "",
    kontak: t.dariKontak || (t.dariId ? "" : SHOWROOM.telepon || ""),
    alamat: t.dariAlamat || (t.dariId ? "" : kopAlamat),
  };
  const judulJenis = t.jenis === "tarik" ? "PENARIKAN UNIT" : "TRANSFER UNIT";
  const baris = (label, isi) => `<tr><td class="lbl">${label}</td><td class="tt">:</td>
    <td>${isi || "-"}</td></tr>`;
  tab.document.open();
  tab.document.write(`<!DOCTYPE html><html lang="id"><head>
  <meta charset="utf-8"><title>BAST Kendaraan — ${aman(t.noTransfer)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; background: #f3f3f3; color: #000;
      font-family: "Segoe UI", Arial, Helvetica, sans-serif; }
    .lembar { max-width: 800px; margin: 0 auto 14px; background: #fff; padding: 22px 26px;
      box-shadow: 0 1px 3px rgba(0,0,0,.15); font-size: 12px; line-height: 1.45;
      position: relative; overflow: hidden; }
    .lembar > * { position: relative; z-index: 1; }
    /* Watermark: nama perusahaan miring besar di tengah + logo samar. */
    .lembar > .wm { position: absolute; inset: 0; z-index: 0; pointer-events: none;
      display: flex; align-items: center; justify-content: center; }
    .wm-teks { transform: rotate(-30deg); font-size: 58px; font-weight: 800;
      color: rgba(0,0,0,.07); white-space: nowrap; letter-spacing: .04em; text-align: center; }
    .wm-teks small { display: block; font-size: 26px; letter-spacing: .3em; }
    .wm-logo { position: absolute; width: 320px; height: 320px; object-fit: contain; opacity: .05; }
    .wm, .wm * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .kop { display: flex; align-items: center; gap: 12px; border-bottom: 2.5px solid #000;
      padding-bottom: 8px; }
    .kop img { width: 54px; height: 54px; object-fit: contain; }
    .kop .pt { font-size: 17px; font-weight: 700; margin: 0; }
    .kop .kecil { font-size: 11px; color: #333; margin: 1px 0 0; }
    h1 { text-align: center; font-size: 15.5px; margin: 14px 0 2px; letter-spacing: .03em; }
    .sub { text-align: center; font-size: 12px; margin: 0 0 12px; }
    .dua { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 10px; }
    .kotak { border: 1px solid #000; padding: 7px 9px; }
    .kotak h3 { font-size: 11px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: .05em; }
    table.info { border-collapse: collapse; width: 100%; }
    table.info td { padding: 1px 0; vertical-align: top; }
    .lbl { width: 38%; } .tt { width: 10px; }
    table.unit { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table.unit th, table.unit td { border: 1px solid #000; padding: 5px 6px; text-align: left; }
    table.unit th { background: #d9d9d9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .mono { font-family: "Courier New", monospace; font-size: 12px; white-space: nowrap; }
    .kel { font-size: 10.5px; }
    .kel span { display: inline-block; margin-right: 10px; white-space: nowrap; }
    .pernyataan { margin: 12px 0 0; }
    .ttd { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: center;
      margin-top: 18px; }
    .ttd .ruang { height: 64px; }
    .ttd .nama { border-top: 1px solid #000; padding-top: 3px; font-weight: 600; min-height: 18px; }
    .kaki { font-size: 10px; color: #444; margin-top: 14px; text-align: center; }
    .aksi { text-align: center; }
    .aksi button { padding: 10px 22px; border: 0; border-radius: 8px; background: #0067C0;
      color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
    @page { size: A4 portrait; margin: 12mm; }
    @media print {
      body { background: #fff; padding: 0; }
      .lembar { box-shadow: none; margin: 0; padding: 0; max-width: none; }
      .aksi { display: none; }
    }
  </style></head><body>
  <div class="lembar">
    <div class="wm" aria-hidden="true">
      <img class="wm-logo" src="${location.origin}/logo.png" alt="" onerror="this.remove()">
      <div class="wm-teks">${aman(SHOWROOM.nama)}<small>BAST KENDARAAN</small></div>
    </div>
    <div class="kop">
      <img src="${location.origin}/logo.png" alt="" onerror="this.style.display='none'">
      <div>
        <p class="pt">${aman(SHOWROOM.nama)}</p>
        ${kopAlamat ? `<p class="kecil">${aman(kopAlamat)}</p>` : ""}
        ${kopTelp ? `<p class="kecil">${aman(kopTelp)}</p>` : ""}
      </div>
    </div>

    <h1>BERITA ACARA SERAH TERIMA KENDARAAN</h1>
    <p class="sub"><b>SURAT JALAN — ${judulJenis}</b> · No. <span class="mono">${aman(t.noTransfer)}</span>
      · Tanggal ${tanggal(t.tanggal)}</p>

    <div class="dua">
      <div class="kotak">
        <h3>Dari (Pengirim)</h3>
        <table class="info">
          ${baris("Lokasi", `${aman(dari.nama)}${dari.jenis ? ` (${aman(dari.jenis)})` : ""}`)}
          ${baris("PIC", aman(dari.pic || "-"))}
          ${baris("Telepon", `<span class="mono">${aman(dari.kontak || "-")}</span>`)}
          ${baris("Alamat", aman(dari.alamat || "-"))}
        </table>
      </div>
      <div class="kotak">
        <h3>Kepada (Penerima)</h3>
        <table class="info">
          ${baris("Lokasi", `${aman(t.channelNama)}${t.channelJenis ? ` (${aman(t.channelJenis)})` : ""}`)}
          ${baris("PIC", aman(t.channelPic || "-"))}
          ${baris("Telepon", `<span class="mono">${aman(t.channelKontak || "-")}</span>`)}
          ${baris("Alamat", aman(t.channelAlamat || "-"))}
        </table>
      </div>
    </div>
    <table class="info" style="margin:0 0 8px">
      ${baris("Pengemudi", aman(t.pengemudi || "-"))}
      ${baris("No. Polisi pengangkut", `<span class="mono">${aman(t.noPolisi || "-")}</span>`)}
    </table>

    <p style="margin:0 0 4px">Dengan ini diserahterimakan kendaraan sebagai berikut:</p>
    <table class="unit">
      <thead><tr>
        <th style="width:5%">No.</th><th>Tipe / Warna</th><th style="width:7%">Tahun</th>
        <th>No. Rangka</th><th>No. Mesin</th><th style="width:27%">Kelengkapan</th>
      </tr></thead>
      <tbody>
        ${unit.map((u, i) => `<tr>
          <td>${i + 1}</td>
          <td>${aman(u.tipeNama)}<br><span class="kel">${aman(u.warna || "-")}</span></td>
          <td>${aman(u.tahun || "-")}</td>
          <td class="mono">${aman(u.noRangka || "-")}</td>
          <td class="mono">${aman(u.noMesin || "-")}</td>
          <td class="kel"><span>☐ Kunci</span><span>☐ Buku Servis</span><br>
            <span>☐ Toolkit</span><span>☐ Spion</span></td>
        </tr>`).join("")}
        <tr><td colspan="6"><b>Jumlah: ${unit.length} unit</b></td></tr>
      </tbody>
    </table>
    ${t.keterangan ? `<p style="margin:8px 0 0"><b>Keterangan:</b> ${aman(t.keterangan)}</p>` : ""}

    <p class="pernyataan">Setelah BAST ini ditandatangani penerima, maka segala kerusakan
      dan kekurangan dari unit kendaraan yang diterima menjadi tanggung jawab pihak penerima.</p>

    <div class="ttd">
      <div>Diserahkan oleh,<div class="ruang"></div>
        <div class="nama">${aman(dari.pic || t.dibuatOlehNama || "")}</div>${aman(dari.nama)}</div>
      <div>Pengemudi,<div class="ruang"></div>
        <div class="nama">${aman(t.pengemudi || "")}</div>&nbsp;</div>
      <div>Diterima oleh,<div class="ruang"></div>
        <div class="nama">${aman(t.channelPic || "")}</div>${aman(t.channelNama)}</div>
    </div>
    <p class="kaki">Lembar 1: Penerima · Lembar 2: Pengemudi · Lembar 3: Arsip Showroom<br>
      Dicetak otomatis oleh sistem — ${tanggal(new Date())}</p>
  </div>
  <div class="aksi"><button type="button" onclick="window.print()">Cetak / Simpan PDF</button></div>
  </body></html>`);
  tab.document.close();
}

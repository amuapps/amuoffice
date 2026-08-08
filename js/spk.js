// spk.js — Surat Pesanan Kendaraan. Tiga tab dalam satu form:
// Customer Info (pembeli & pemakai), Internal Info (sales & diskon),
// Payment Info (unit yang dipesan & cara bayar).
//
// Titik paling penting di modul ini: begitu tipe+warna dipilih,
// sistem CEK ke Data Unit apakah ada yang ready. Ada → unit itu
// dikunci ke SPK ini (jadi Dipesan). Tidak ada → SPK-nya sendiri
// yang berstatus Indent, tanpa membuat unit palsu di Data Unit.

import {
  dbase, doc, collection, setDoc, getDoc, updateDoc, getDocs, query, where,
  limit, writeBatch, serverTimestamp, increment, catat,
  sertakanLog, tandaBaru, nomorBerikutnya,
} from "./db.js";
import { sesi, bolehAkses, konfirmasiPassword } from "./auth.js";
import { batasDiskon, PERAN } from "./roles.js";
import { muatTipe, tipeDari } from "./tipe.js";
import { cariUnitReady, muatSemuaUnitReadyRingkas, kunciUnitKeBatch } from "./stok.js";
import { formPelanggan, bacaFormPelanggan, simpanPelangganOtomatis,
         pasangHurufBesarPelanggan } from "./pelanggan.js";
import { muatSaranKecamatan, muatSaranKota } from "./referensi.js";
import { muatLeasing, leasingAktif } from "./leasing.js";
import { muatRekening, rekeningAktif } from "./rekening.js";
import { muatAgen, agenAktif } from "./agen.js";
import { cetakSpk, mintaCetakKuitansi as catatPembayaran, labelTombolKuitansi,
  hitungTotalDibayar } from "./cetak.js";
import { konfirmasi, tanya, beritahu } from "./dialog.js";
import { buatNotifikasi, beriTahuSemuaOwner } from "./notifikasi.js";
import { rupiah, aman, kabar, pasangFormatUang, bacaAngka, namaTampilan } from "./ui.js";

function opsiTipe(daftarTipe) {
  return daftarTipe.map((t) =>
    `<option value="${t.id}">${aman(t.merek)} ${aman(t.tipe)} ${
      aman(t.varian || "")}</option>`).join("");
}

function panelCustomer(saranKecamatan, saranKota) {
  return `<div class="tab-panel" data-panel="customer">
    <h3 class="judul" style="font-size:16px">Pembeli</h3>
    ${formPelanggan({}, "pembeli", saranKecamatan, saranKota)}
    <label class="pilihan" style="margin-top:8px">
      <input type="checkbox" id="s-sama" checked>
      <span>Pemakai kendaraan sama dengan pembeli di atas</span>
    </label>
    <div id="wadah-pemakai" hidden>
      <h3 class="judul" style="font-size:16px;margin-top:10px">
        Pemakai <span class="kunci">sesuai STNK/BPKB nanti</span></h3>
      ${formPelanggan({}, "pemakai", saranKecamatan, saranKota)}
    </div>
  </div>`;
}

function panelInternal(daftarAgen, daftarSales) {
  // Pilih agen (siapa yang bawa konsumen) boleh siapa saja yang
  // buat SPK — nominal Fee-nya yang dirahasiakan (cuma Owner &
  // Admin, karena mereka yang membayarkan ke rekening agennya).
  const bisaLihatFeeAgen = bolehAkses("agen.lihat") || bolehAkses("kelola.pengguna");
  const owner = sesi && sesi.peran === "owner";
  return `<div class="tab-panel" data-panel="internal" hidden>
    ${owner ? `
    <label class="label label--gelap" for="s-sales">Atas nama karyawan
      <span class="kunci">Owner bisa input atas nama siapa saja, tidak
        cuma Sales</span></label>
    <select class="isian isian--terang" id="s-sales">
      <option value="">OWNER (saya sendiri)</option>
      ${daftarSales.map((s) =>
        `<option value="${s.id}">${aman(s.nama)} — ${aman(PERAN[s.peran]?.label || s.peran)}</option>`).join("")}
    </select>
    <p class="petunjuk">Dipakai buat laporan/komisi penjualan — siapa
      yang SEBENARNYA input SPK ini (Anda, Owner) tetap tercatat
      terpisah di Log Aktivitas &amp; tersimpan di data SPK-nya,
      berapa pun karyawan yang dipilih di atas.</p>
    ` : `
    <label class="label label--gelap">Sales</label>
    <input class="isian isian--terang" value="${aman(sesi ? namaTampilan(sesi.peran, sesi.nama) : "-")}" disabled>
    `}
    <label class="label label--gelap" for="s-diskon">Diskon (Rp)</label>
    <input class="isian isian--terang" id="s-diskon" inputmode="numeric"
           value="0">
    <p class="petunjuk" id="petunjuk-diskon"></p>

    <label class="label label--gelap" for="s-cashback">Cashback (Rp)
      <span class="kunci">opsional, perlu persetujuan Owner</span></label>
    <input class="isian isian--terang" id="s-cashback" inputmode="numeric" value="0">
    <p class="petunjuk">Harga OTR tidak berubah — ini uang terpisah yang
      diberikan ke konsumen. Baru berlaku setelah Owner menyetujui di
      halaman Persetujuan Perubahan.</p>

    <label class="label label--gelap" for="s-agen">Agen
      <span class="kunci">opsional — kalau konsumen ini dibawa agen</span></label>
    <select class="isian isian--terang" id="s-agen">
      <option value="">— tidak ada agen —</option>
      ${daftarAgen.map((a) =>
        `<option value="${a.id}">${aman(a.idAgen)} · ${aman(a.nama)}</option>`).join("")}
    </select>
    ${bisaLihatFeeAgen ? `
    <label class="label label--gelap" for="s-fee-agen">Fee Agen (Rp)
      <span class="kunci">Owner &amp; Admin</span></label>
    <input class="isian isian--terang" id="s-fee-agen" inputmode="numeric" value="0">
    <p class="petunjuk">Fee ini yang nanti dibayarkan Admin/Kasir ke
      rekening agen yang dipilih di atas.</p>
    ` : ""}

    <label class="label label--gelap" for="s-catatan">Catatan internal</label>
    <input class="isian isian--terang" id="s-catatan"
           placeholder="Opsional — tidak dicetak di SPK">
  </div>`;
}

function panelPayment(daftarTipe, daftarLeasing, daftarRekening) {
  return `<div class="tab-panel" data-panel="payment" hidden>
    <label class="label label--gelap" for="s-tipe">Tipe motor</label>
    <select class="isian isian--terang" id="s-tipe">
      <option value="">— pilih tipe —</option>${opsiTipe(daftarTipe)}
    </select>

    <p class="petunjuk" id="cek-stok">&nbsp;</p>
    <div id="wadah-tabel-unit"></div>

    <div id="wadah-warna-manual">
      <label class="label label--gelap" for="s-warna">Warna</label>
      <select class="isian isian--terang" id="s-warna">
        <option value="">— pilih tipe dulu —</option>
      </select>
    </div>

    <label class="label label--gelap">Harga OTR</label>
    <input class="isian isian--terang" id="s-otr" value="Rp 0" disabled>

    <label class="label label--gelap">Cara bayar</label>
    <div class="chip-baris">
      <label class="pilihan"><input type="checkbox" id="s-tunai"> Tunai</label>
      <label class="pilihan"><input type="checkbox" id="s-transfer"> Transfer</label>
      <label class="pilihan"><input type="checkbox" id="s-kredit"> Kredit (Leasing)</label>
    </div>

    <label class="label label--gelap" for="s-bayar">Jumlah dibayar sekarang
      <span class="kunci">total tunai + transfer</span></label>
    <input class="isian isian--terang" id="s-bayar" inputmode="numeric"
           value="0">

    <div id="wadah-tunai-transfer" hidden>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="s-jml-tunai">Jumlah tunai</label>
          <input class="isian isian--terang" id="s-jml-tunai" inputmode="numeric" value="0">
        </div>
        <div>
          <label class="label label--gelap" for="s-jml-transfer">Jumlah transfer</label>
          <input class="isian isian--terang" id="s-jml-transfer" inputmode="numeric" value="0">
        </div>
      </div>
    </div>

    <div id="wadah-rekening" hidden>
      <label class="label label--gelap" for="s-rekening">Rekening tujuan</label>
      <select class="isian isian--terang" id="s-rekening">
        <option value="">— pilih rekening —</option>
        ${daftarRekening.map((r) =>
          `<option value="${r.id}">${aman(r.bank)} ${aman(r.nomor)} a.n ${aman(r.atasNama)}</option>`
        ).join("")}
      </select>
    </div>

    <div id="wadah-kredit" hidden>
      <label class="label label--gelap" for="s-leasing">Leasing</label>
      <select class="isian isian--terang" id="s-leasing">
        <option value="">— pilih leasing —</option>
        ${daftarLeasing.map((l) =>
          `<option value="${l.id}">${aman(l.nama)}</option>`).join("")}
      </select>
      <p class="petunjuk">"Jumlah dibayar sekarang" di atas diterima
        showroom sebagai Uang Muka (DP), lalu dilaporkan ke leasing
        sebagai dasar hitung plafon kredit.</p>

      <label class="label label--gelap">Tagihan ke Leasing
        <span class="kunci">OTR &minus; jumlah dibayar sekarang</span></label>
      <input class="isian isian--terang" id="s-tagihan-leasing" value="Rp 0" disabled>

      <div class="dua">
        <div>
          <label class="label label--gelap" for="s-cicilan">Cicilan per bulan</label>
          <input class="isian isian--terang" id="s-cicilan" inputmode="numeric" value="0">
        </div>
        <div>
          <label class="label label--gelap" for="s-tenor">Lama cicilan (bulan)</label>
          <input class="isian isian--terang" id="s-tenor" inputmode="numeric">
        </div>
      </div>
      <label class="label label--gelap" for="s-survey">Tanggal survey
        <span class="kunci">opsional</span></label>
      <input class="isian isian--terang" id="s-survey" type="date">
    </div>
  </div>`;
}

export async function halamanSpk(wadah) {
  wadah.innerHTML = `<p class="hampa">Memuat…</p>`;
  let daftarTipe = [], daftarLeasing = [], daftarRekening = [];
  let daftarAgen = [], daftarUnitReady = [], daftarSales = [];
  let saranKecamatan = [], saranKota = [];
  try {
    [daftarTipe, daftarLeasing, daftarRekening, saranKecamatan, saranKota,
      daftarAgen, daftarUnitReady] =
      await Promise.all([
        muatTipe(), muatLeasing(), muatRekening(),
        muatSaranKecamatan(), muatSaranKota(), muatAgen(),
        muatSemuaUnitReadyRingkas(),
      ]);
    if (sesi && sesi.peran === "owner") {
      // SEMUA karyawan (Admin, Sales, Kasir, dst — bukan cuma Sales)
      // ditawarkan sebagai pilihan "atas nama siapa" — Owner yang
      // paling tahu siapa yang sebenarnya menangani penjualan ini,
      // apa pun jabatannya.
      const snapKaryawan = await getDocs(collection(dbase, "users"));
      daftarSales = snapKaryawan.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => u.aktif !== false && u.peran !== "owner")
        .sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
    }
  } catch (err) {
    wadah.innerHTML = `<div class="hampa">
      <p><b>Gagal memuat data SPK.</b></p>
      <p>${aman(err.message)}</p>
      <p>Kalau pesannya soal izin (permission-denied), kemungkinan
        <b>firestore.rules</b> yang terbaru belum di-deploy ke Firebase
        — file di repo tidak otomatis aktif, harus ditempel manual ke
        Firebase Console → Firestore Database → tab Rules → Publish.</p>
    </div>`;
    return;
  }
  const leasingPilihan = leasingAktif().length ? leasingAktif() : daftarLeasing;
  const rekeningPilihan = rekeningAktif().length ? rekeningAktif() : daftarRekening;
  const agenPilihan = agenAktif().length ? agenAktif() : daftarAgen;
  const tanggalHariIni = new Date().toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">SPK Baru</h2></div>
    <div class="kartu" style="margin-bottom:14px">
      <dl class="rinci">
        <div><dt>Nomor SPK</dt>
          <dd>dibuat otomatis saat disimpan</dd></div>
        <div><dt>Tanggal</dt><dd>${aman(tanggalHariIni)}</dd></div>
      </dl>
    </div>
    <div class="chip-baris" id="tab-spk">
      <button type="button" class="chip aktif" data-tab="customer">Customer Info</button>
      <button type="button" class="chip" data-tab="internal">Internal Info</button>
      <button type="button" class="chip" data-tab="payment">Payment Info</button>
    </div>
    <form id="form-spk" class="form">
      ${panelCustomer(saranKecamatan, saranKota)}
      ${panelInternal(agenPilihan, daftarSales)}
      ${panelPayment(daftarTipe, leasingPilihan, rekeningPilihan)}
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">Simpan SPK</button>
      </div>
    </form>
  </section>`;

  pasangHurufBesarPelanggan(wadah, "pembeli");
  pasangHurufBesarPelanggan(wadah, "pemakai");

  // ── Tab ──────────────────────────────────────────────────────
  wadah.querySelector("#tab-spk").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (!t) return;
    wadah.querySelectorAll(".chip").forEach((c) => c.classList.toggle("aktif", c === t));
    wadah.querySelectorAll(".tab-panel").forEach((p) =>
      (p.hidden = p.dataset.panel !== t.dataset.tab));
  });

  // ── Customer: pemakai sama/tidak sama dengan pembeli ─────────
  const samaEl = wadah.querySelector("#s-sama");
  const wadahPemakai = wadah.querySelector("#wadah-pemakai");
  samaEl.addEventListener("change", () => {
    wadahPemakai.hidden = samaEl.checked;
  });

  // ── Internal: batas diskon per peran ─────────────────────────
  const diskonEl = wadah.querySelector("#s-diskon");
  const petunjukDiskon = wadah.querySelector("#petunjuk-diskon");
  const batas = sesi ? batasDiskon(sesi.peran) : 0;
  petunjukDiskon.textContent = batas === null
    ? "Peran Anda tidak dibatasi diskon."
    : `Batas diskon Anda: ${rupiah(batas)}. Lebih dari ini akan otomatis ` +
      `diajukan ke Owner untuk disetujui dulu, tidak langsung berlaku.`;
  pasangFormatUang(diskonEl);

  // ── Payment: pilih tipe → tabel unit + cek stok ────────────────
  const pilihTipe = wadah.querySelector("#s-tipe");
  const otrEl = wadah.querySelector("#s-otr");
  const cekStokEl = wadah.querySelector("#cek-stok");
  const wadahTabelUnit = wadah.querySelector("#wadah-tabel-unit");
  const wadahWarnaManual = wadah.querySelector("#wadah-warna-manual");
  let unitDipilihId = null; // diisi dari centang tabel, atau null kalau Indent

  function tabelPilihUnit(daftarUnit) {
    return `<div style="overflow-x:auto;margin:8px 0">
      <table class="tabel">
        <thead><tr>
          <th></th><th>No.</th><th>Rangka</th><th>Mesin</th>
          <th>Warna</th><th>Tahun</th>
        </tr></thead>
        <tbody>
          ${daftarUnit.map((u, i) => `<tr>
            <td><input type="radio" name="s-pilih-unit" value="${u.id}"
                  id="unit-${u.id}" ${i === 0 ? "checked" : ""}></td>
            <td>${i + 1}</td>
            <td class="mono"><label for="unit-${u.id}">${aman(u.noRangka)}</label></td>
            <td class="mono">${aman(u.noMesin)}</td>
            <td>${aman(u.warna)}</td>
            <td>${aman(u.tahun || "-")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  async function tampilkanUnitUntukTipe(tipeId) {
    wadahTabelUnit.innerHTML = "";
    unitDipilihId = null;
    if (!tipeId) {
      wadahWarnaManual.hidden = true;
      cekStokEl.textContent = "";
      return;
    }
    cekStokEl.textContent = "Mengecek stok…";
    const daftarUnit = daftarUnitReady.filter((u) => u.tipeId === tipeId);

    if (!daftarUnit.length) {
      // Tidak ada stok Ready sama sekali — biarkan pilih Warna manual,
      // SPK-nya nanti otomatis berstatus Indent.
      wadahWarnaManual.hidden = false;
      const t = tipeDari(tipeId);
      wadah.querySelector("#s-warna").innerHTML =
        `<option value="">— pilih warna —</option>` +
        ((t && t.warna) || []).map((w) =>
          `<option value="${aman(w)}">${aman(w)}</option>`).join("");
      cekStokEl.innerHTML = `<span style="color:var(--kuning)">Stok kosong — pilih warna
        yang diinginkan, SPK ini akan otomatis berstatus Indent.</span>`;
      return;
    }

    // Ada stok — tampilkan tabel, sembunyikan pilihan warna manual
    // (warnanya otomatis ikut baris yang dicentang).
    wadahWarnaManual.hidden = true;
    cekStokEl.innerHTML = `<span style="color:var(--hijau)">✓ ${daftarUnit.length}
      unit Ready tersedia — centang salah satu:</span>`;
    wadahTabelUnit.innerHTML = tabelPilihUnit(daftarUnit);
    unitDipilihId = daftarUnit[0].id; // default: baris pertama (paling lama masuk)
    wadahTabelUnit.querySelectorAll('input[name="s-pilih-unit"]').forEach((r) =>
      r.addEventListener("change", (e) => { unitDipilihId = e.target.value; }));
  }

  let hargaOtrTerpilih = 0;
  pilihTipe.addEventListener("change", () => {
    const t = tipeDari(pilihTipe.value);
    hargaOtrTerpilih = t ? (t.hargaOtr || 0) : 0;
    otrEl.value = t ? rupiah(t.hargaOtr) : "Rp 0";
    tampilkanUnitUntukTipe(pilihTipe.value);
    perbaruiTagihanLeasing();
  });

  // ── Payment: cara bayar ────────────────────────────────────────
  const tunaiEl = wadah.querySelector("#s-tunai");
  const transferEl = wadah.querySelector("#s-transfer");
  const kreditEl = wadah.querySelector("#s-kredit");
  const wadahTT = wadah.querySelector("#wadah-tunai-transfer");
  const wadahRekening = wadah.querySelector("#wadah-rekening");
  const wadahKredit = wadah.querySelector("#wadah-kredit");
  const bayarEl = wadah.querySelector("#s-bayar");
  const jmlTunaiEl = wadah.querySelector("#s-jml-tunai");
  const jmlTransferEl = wadah.querySelector("#s-jml-transfer");
  const tagihanLeasingEl = wadah.querySelector("#s-tagihan-leasing");

  // "Tagihan ke Leasing" = OTR − jumlah dibayar sekarang (DP). Hitung
  // ulang otomatis tiap kali OTR atau jumlah DP berubah, supaya sales
  // tidak perlu hitung manual (mis. OTR 10jt, DP 3jt → tagihan 7jt).
  function perbaruiTagihanLeasing() {
    if (!kreditEl.checked) return;
    const bayarTunaiTransferSama = !wadahTT.hidden;
    const jumlahBayarSaatIni = bayarTunaiTransferSama
      ? bacaAngka(jmlTunaiEl) + bacaAngka(jmlTransferEl)
      : bacaAngka(bayarEl);
    const tagihan = Math.max(hargaOtrTerpilih - jumlahBayarSaatIni, 0);
    tagihanLeasingEl.value = rupiah(tagihan);
  }

  function perbaruiCaraBayar() {
    const tunai = tunaiEl.checked, transfer = transferEl.checked;
    wadahTT.hidden = !(tunai && transfer); // cuma perlu dipecah kalau dua-duanya
    wadahRekening.hidden = !transfer;
    wadahKredit.hidden = !kreditEl.checked;
    perbaruiTagihanLeasing();
  }
  [tunaiEl, transferEl, kreditEl].forEach((el) =>
    el.addEventListener("change", perbaruiCaraBayar));

  [bayarEl, jmlTunaiEl, jmlTransferEl, wadah.querySelector("#s-cicilan"),
  ].forEach(pasangFormatUang);
  [bayarEl, jmlTunaiEl, jmlTransferEl].forEach((el) =>
    el.addEventListener("input", perbaruiTagihanLeasing));

  // ── Simpan ──────────────────────────────────────────────────
  wadah.querySelector("#form-spk").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tombol = e.target.querySelector('button[type="submit"]');

    const pembeli = bacaFormPelanggan(wadah, "pembeli");
    if (!pembeli.nama) {
      kabar("Nama pembeli wajib diisi.", "rem");
      return;
    }
    const pemakaiSama = samaEl.checked;
    const pemakai = pemakaiSama ? null : bacaFormPelanggan(wadah, "pemakai");
    if (!pemakaiSama && !pemakai.nama) {
      kabar("Nama pemakai wajib diisi, atau centang \"sama dengan pembeli\".", "rem");
      return;
    }

    const tipeId = pilihTipe.value;
    // Warna ikut unit yang dicentang di tabel (kalau ada stok), atau
    // dari dropdown manual (kalau Indent/stok kosong).
    const unitDariTabel = unitDipilihId
      ? daftarUnitReady.find((u) => u.id === unitDipilihId) : null;
    const warna = unitDariTabel ? unitDariTabel.warna : wadah.querySelector("#s-warna").value;
    if (!tipeId || !warna) {
      kabar("Pilih tipe motor, lalu centang unit atau pilih warna di tab Payment Info.", "rem");
      return;
    }

    const caraBayar = [];
    if (tunaiEl.checked) caraBayar.push("tunai");
    if (transferEl.checked) caraBayar.push("transfer");
    if (kreditEl.checked) caraBayar.push("kredit");
    if (!caraBayar.length) {
      kabar("Pilih minimal satu cara bayar di tab Payment Info.", "rem");
      return;
    }
    if (transferEl.checked && !wadah.querySelector("#s-rekening").value) {
      kabar("Pilih rekening tujuan transfer.", "rem");
      return;
    }
    if (kreditEl.checked && !wadah.querySelector("#s-leasing").value) {
      kabar("Pilih leasing untuk pembayaran kredit.", "rem");
      return;
    }

    tombol.disabled = true;
    tombol.textContent = "Menyimpan…";

    try {
      const t = tipeDari(tipeId);
      // Pakai unit yang SPESIFIK dipilih di form (kalau stok >1 tadi
      // sempat dipilih) — dicek ulang statusnya masih "ready" di
      // Firestore dulu (jaga-jaga kalau keburu diambil transaksi lain
      // di saat yang hampir bersamaan). Kalau tidak ada yang dipilih
      // sama sekali (misalnya stok kosong dari awal), fallback ke
      // cariUnitReady biasa seperti sebelumnya.
      let unit = null;
      if (unitDipilihId) {
        const snapUnitPilihan = await getDoc(doc(dbase, "units", unitDipilihId));
        if (snapUnitPilihan.exists() && snapUnitPilihan.data().status === "ready") {
          unit = { id: snapUnitPilihan.id, ...snapUnitPilihan.data() };
        }
      }
      if (!unit) unit = await cariUnitReady(tipeId, warna);
      const kondisiUnit = unit ? "ready" : "indent";

      const pembeliId = await simpanPelangganOtomatis(pembeli);
      const pemakaiId = pemakaiSama ? pembeliId : await simpanPelangganOtomatis(pemakai);

      const bayarTunaiTransferSama = !wadahTT.hidden;
      const jumlahTunai = bayarTunaiTransferSama
        ? bacaAngka(wadah.querySelector("#s-jml-tunai"))
        : (tunaiEl.checked ? bacaAngka(wadah.querySelector("#s-bayar")) : 0);
      const jumlahTransfer = bayarTunaiTransferSama
        ? bacaAngka(wadah.querySelector("#s-jml-transfer"))
        : (transferEl.checked ? bacaAngka(wadah.querySelector("#s-bayar")) : 0);
      // Kalau mode Tunai+Transfer sekaligus, "Dibayar sekarang" WAJIB
      // dijumlah dari dua kotak itu — jangan dibaca dari kotak #s-bayar
      // yang di mode ini memang tidak pernah diisi (bug lama: nilainya
      // kebawa 0, padahal Tunai/Transfer-nya sudah benar keisi).
      const jumlahBayar = bayarTunaiTransferSama
        ? jumlahTunai + jumlahTransfer
        : bacaAngka(wadah.querySelector("#s-bayar"));

      const spkNo = await nomorBerikutnya("spk", "SPK");
      const ref = doc(collection(dbase, "transaksi"));

      const cashbackDiajukan = bacaAngka(wadah.querySelector("#s-cashback"));
      const elAgen = wadah.querySelector("#s-agen");
      const agenId = elAgen ? elAgen.value : "";
      const agenTerpilih = agenId ? agenAktif().find((a) => a.id === agenId) : null;
      // Field Fee Agen cuma ada di DOM kalau Owner/Admin (lihat
      // panelInternal) — Sales bisa pilih agennya, tapi nominal fee
      // tetap 0 dari sisinya, biar tidak bisa diintip/diisi sendiri.
      const elFeeAgen = wadah.querySelector("#s-fee-agen");
      const feeAgen = elFeeAgen ? bacaAngka(elFeeAgen) : 0;

      // Kalau Owner input atas nama Sales lain (dropdown #s-sales
      // cuma ada di DOM buat Owner) — salesUid/Nama/Peran ikut pilihan
      // itu buat keperluan laporan/komisi. Tapi siapa yang BENAR-BENAR
      // input tetap direkam terpisah lewat dibuatOlehUid/Nama/Peran,
      // supaya jejaknya tidak pernah hilang biar dropdown-nya diisi
      // apa pun.
      const elSales = wadah.querySelector("#s-sales");
      const salesIdDipilih = elSales ? elSales.value : "";
      const salesTerpilih = salesIdDipilih
        ? daftarSales.find((s) => s.id === salesIdDipilih) : null;

      // Diskon yang MELEBIHI batas peran ini butuh persetujuan Owner
      // dulu — tidak langsung berlaku. Kalau masih dalam batas (atau
      // perannya Owner sendiri, batasnya null = tanpa batas), langsung
      // berlaku seperti biasa.
      const diskonDiisi = bacaAngka(diskonEl);
      const perluPersetujuanDiskon = batas !== null && diskonDiisi > batas;
      const diskonLangsung = perluPersetujuanDiskon ? 0 : diskonDiisi;

      const data = {
        spkNo,
        pembeliId, pembeli,
        pemakaiSamaDenganPembeli: pemakaiSama,
        pemakaiId, pemakai: pemakaiSama ? null : pemakai,
        salesUid: salesTerpilih ? salesTerpilih.id : (sesi ? sesi.uid : null),
        salesNama: salesTerpilih ? salesTerpilih.nama : (sesi ? sesi.nama : "-"),
        salesPeran: salesTerpilih ? salesTerpilih.peran : (sesi ? sesi.peran : null),
        // Siapa yang BENAR-BENAR mengoperasikan sistem saat SPK ini
        // dibuat — selalu identitas sesi asli, tidak peduli salesUid
        // di atas diisi siapa. Dipakai buat jejak audit.
        dibuatOlehUid: sesi ? sesi.uid : null,
        dibuatOlehNama: sesi ? sesi.nama : "-",
        dibuatOlehPeran: sesi ? sesi.peran : null,
        diskon: diskonLangsung,
        catatan: wadah.querySelector("#s-catatan").value.trim(),
        tipeId, tipeNama: `${t.merek} ${t.tipe} ${t.varian || ""}`.trim(),
        warna, hargaOtr: t.hargaOtr || 0,
        kondisiUnit,
        unitId: unit ? unit.id : null,
        caraBayar,
        jumlahBayar,
        jumlahTunai, jumlahTransfer,
        rekeningId: transferEl.checked ? wadah.querySelector("#s-rekening").value : null,
        kredit: kreditEl.checked ? {
          leasingId: wadah.querySelector("#s-leasing").value,
          cicilan: bacaAngka(wadah.querySelector("#s-cicilan")),
          tenor: Number(wadah.querySelector("#s-tenor").value || 0),
          tanggalSurvey: wadah.querySelector("#s-survey").value || null,
        } : null,
        // Fee Agen — Owner & Admin (Sales tidak lihat field ini sama
        // sekali, lihat panelInternal). Ini yang jadi acuan Admin/Kasir
        // waktu bayarkan feenya ke rekening agen.
        agenId: agenTerpilih ? agenTerpilih.id : null,
        agenNama: agenTerpilih ? agenTerpilih.nama : null,
        feeAgen: agenTerpilih ? feeAgen : 0,
        feeAgenStatus: (agenTerpilih && feeAgen > 0) ? "belum_dibayar" : null,
        // Cashback BELUM berlaku sampai Owner menyetujui — lihat
        // pengajuan yang dibuat setelah batch ini kalau nilainya > 0.
        cashbackDiajukan,
        cashbackDisetujui: 0,
        cashbackStatus: cashbackDiajukan > 0 ? "menunggu" : null,
        // Diskon yang melebihi batas — sama seperti cashback, BELUM
        // berlaku sampai disetujui Owner.
        diskonDiajukan: perluPersetujuanDiskon ? diskonDiisi : 0,
        diskonStatus: perluPersetujuanDiskon ? "menunggu" : null,
        status: "berjalan",
        ...tandaBaru(),
      };

      const batch = writeBatch(dbase);
      batch.set(ref, data);
      if (unit) kunciUnitKeBatch(batch, unit, ref.id);
      sertakanLog(batch, "spk_dibuat", {
        koleksi: "transaksi", docId: ref.id,
        ringkas: `${spkNo} · ${pembeli.nama} · ${kondisiUnit}`,
      });
      if (cashbackDiajukan > 0) {
        sertakanLog(batch, "cashback_diajukan", {
          koleksi: "transaksi", docId: ref.id,
          ringkas: `${spkNo} · ${rupiah(cashbackDiajukan)}`,
        });
        batch.set(doc(collection(dbase, "pengajuan")), {
          jenis: "cashback_spk",
          transaksiId: ref.id, spkNo,
          diajukanOlehUid: sesi ? sesi.uid : null,
          diajukanOlehNama: sesi ? sesi.nama : "-",
          diajukanOlehPeran: sesi ? sesi.peran : null,
          status: "menunggu",
          dataBaru: { cashback: cashbackDiajukan },
          catatan: `Pengajuan cashback sebesar ${rupiah(cashbackDiajukan)} ` +
                   `untuk SPK ${spkNo} (${pembeli.nama}).`,
          ...tandaBaru(),
        });
      }
      if (perluPersetujuanDiskon) {
        sertakanLog(batch, "diskon_diajukan", {
          koleksi: "transaksi", docId: ref.id,
          ringkas: `${spkNo} · ${rupiah(diskonDiisi)}`,
        });
        batch.set(doc(collection(dbase, "pengajuan")), {
          jenis: "diskon_spk",
          transaksiId: ref.id, spkNo,
          diajukanOlehUid: sesi ? sesi.uid : null,
          diajukanOlehNama: sesi ? sesi.nama : "-",
          diajukanOlehPeran: sesi ? sesi.peran : null,
          status: "menunggu",
          dataBaru: { diskon: diskonDiisi },
          catatan: `Pengajuan diskon ${rupiah(diskonDiisi)} untuk SPK ${spkNo} ` +
                   `(${pembeli.nama}) — melebihi batas ${rupiah(batas)} ` +
                   `untuk peran ini.`,
          ...tandaBaru(),
        });
      }
      await batch.commit();
      if (cashbackDiajukan > 0) {
        await beriTahuSemuaOwner("Pengajuan Cashback",
          `${sesi.nama} mengajukan cashback ${rupiah(cashbackDiajukan)} ` +
          `untuk SPK ${spkNo} (${pembeli.nama}).`);
      }
      if (perluPersetujuanDiskon) {
        await beriTahuSemuaOwner("Pengajuan Diskon Melebihi Batas",
          `${sesi.nama} mengajukan diskon ${rupiah(diskonDiisi)} ` +
          `untuk SPK ${spkNo} (${pembeli.nama}) — melebihi batas.`);
      }

      wadah.innerHTML = `<section class="lembar">
        <div class="lembar-atas"><h2 class="judul">SPK Tersimpan</h2></div>
        <div class="kartu">
          <dl class="rinci">
            <div><dt>Nomor SPK</dt><dd class="mono">${aman(spkNo)}</dd></div>
            <div><dt>Pembeli</dt><dd>${aman(pembeli.nama)}</dd></div>
            <div><dt>Unit</dt><dd>${aman(data.tipeNama)} · ${aman(warna)}</dd></div>
            <div><dt>Status</dt><dd>
              <span class="tanda ${kondisiUnit === "ready" ? "tanda--ready" : "tanda--uji"}">
                ${kondisiUnit === "ready" ? "Dipesan (unit terkunci)" : "Indent"}
              </span>
            </dd></div>
          </dl>
        </div>
        <div class="aksi" style="margin-top:14px">
          ${bolehAkses("cetak.dokumen") ? `
            <button class="tombol tombol--utama" type="button" id="cetak-spk-baru">
              Cetak SPK</button>
            <button class="tombol tombol--utama" type="button" id="cetak-kuitansi-baru">
              ${labelTombolKuitansi(data)}</button>` : `
            <p class="petunjuk">Pencetakan SPK/Kuitansi cuma bisa dilakukan
              Owner/Admin.</p>`}
          <button class="tombol tombol--sunyi tombol--gelap" type="button" id="spk-baru">
            Buat SPK Baru</button>
        </div>
      </section>`;
      if (bolehAkses("cetak.dokumen")) {
        wadah.querySelector("#cetak-spk-baru").addEventListener("click", () =>
          cetakSpk({ id: ref.id, ...data, spkNo, dibuatPada: new Date() }));
        wadah.querySelector("#cetak-kuitansi-baru").addEventListener("click", () =>
          catatPembayaran({ id: ref.id, ...data, spkNo, dibuatPada: new Date() }));
      }
      wadah.querySelector("#spk-baru")
        .addEventListener("click", () => halamanSpk(wadah));
      kabar(`SPK ${spkNo} tersimpan.`, "netral");
    } catch (err) {
      kabar(err.message || "Gagal menyimpan SPK.", "rem");
      tombol.disabled = false;
      tombol.textContent = "Simpan SPK";
    }
  });
}

// ── Ajukan Perubahan Data Pembeli/Pemakai ───────────────────────
// SENGAJA dibatasi cuma bagian ini (Customer Info) — tidak
// termasuk unit/harga/cara bayar, karena itu menyangkut status
// stok & pembayaran yang butuh alur lebih hati-hati.
//
// Sales/Admin cuma bisa MENGAJUKAN — perubahan baru benar-benar
// tersimpan ke SPK setelah disetujui Owner lewat halaman
// Persetujuan Perubahan (persetujuan.js). Dipanggil dari halaman
// lain (Riwayat SPK, Lihat Pesanan) dengan kontainer kosong untuk
// diisi form-nya.
export async function pasangEditPelangganSpk(kontainer, t, muatUlang) {
  if (t.status === "batal") {
    kontainer.innerHTML = `<div class="lembar" style="margin-top:10px">
      <p class="hampa">SPK ini sudah dibatalkan, tidak bisa diajukan
        perubahan apa pun lagi.</p>
    </div>`;
    return;
  }
  const owner = sesi && sesi.peran === "owner";
  // Owner SENGAJA dikecualikan dari kunci ini — Admin/Sales tetap
  // terkunci begitu kuitansi tercetak. No. kuitansi TIDAK berubah
  // sama sekali kalau Owner yang mengedit (lihat submit handler di
  // bawah — field kuitansiNo/Kode/Tercetak tidak pernah disentuh).
  if (t.kuitansiTercetak && !owner) {
    kontainer.innerHTML = `<div class="lembar" style="margin-top:10px">
      <p class="hampa">Kuitansi untuk SPK ini sudah dicetak (${aman(t.kuitansiNo || "")})
        — data pembeli, pemakai, dan unit sudah terkunci, tidak bisa diajukan
        perubahan lagi lewat sistem. Hubungi Owner kalau memang perlu diubah.</p>
    </div>`;
    return;
  }

  kontainer.innerHTML = `<p class="hampa">Memeriksa status pengajuan…</p>`;

  // Owner selalu langsung terap — tidak ada pengajuan yang perlu
  // dicek dobel (dia toh yang akan menyetujui pengajuannya sendiri
  // kalau lewat jalur itu, jadi percuma). Cek dobel cuma relevan
  // buat Admin/Sales yang memang harus lewat persetujuan.
  if (!owner) {
    try {
      const sedangMenunggu = await getDocs(query(
        collection(dbase, "pengajuan"),
        where("transaksiId", "==", t.id),
        where("status", "==", "menunggu"),
        limit(1)
      ));
      if (!sedangMenunggu.empty) {
        kontainer.innerHTML = `<div class="lembar" style="margin-top:10px">
          <p class="hampa">Sudah ada pengajuan perubahan untuk SPK ini yang
            masih menunggu persetujuan Owner. Tunggu diproses dulu sebelum
            mengajukan lagi.</p>
          <button class="tombol tombol--kecil" id="tutup-edit-${t.id}">Tutup</button>
        </div>`;
        kontainer.querySelector(`#tutup-edit-${t.id}`)
          .addEventListener("click", () => (kontainer.innerHTML = ""));
        return;
      }
    } catch { /* kalau gagal cek, tetap lanjut tampilkan form — jangan macet */ }
  }

  const [saranKecamatan, saranKota] = await Promise.all([
    muatSaranKecamatan(), muatSaranKota(),
  ]).catch(() => [[], []]);

  const pemakaiSama = t.pemakaiSamaDenganPembeli !== false;
  const terkunci = t.kuitansiTercetak && owner; // Owner ubah data yang sudah terkunci

  kontainer.innerHTML = `<div class="lembar" style="margin-top:10px">
    <h3 class="judul" style="font-size:15px">
      ${owner ? "Ubah" : "Ajukan Perubahan"} Data Pembeli/Pemakai —
      <span class="mono">${aman(t.spkNo)}</span>
    </h3>
    <p class="petunjuk">Cuma data pembeli &amp; pemakai yang bisa diubah di
      sini. Unit, harga, dan cara bayar tidak bisa diubah lewat form ini.
      ${owner
        ? (terkunci
            ? `<b>Kuitansi SPK ini sudah dicetak (${aman(t.kuitansiNo || "")})</b> — ` +
              `sebagai Owner Anda tetap bisa mengubahnya, tapi pastikan dulu ` +
              `memang perlu (mis. salah ketik alamat/telepon). Nomor kuitansi ` +
              `TIDAK akan berubah.`
            : "Karena Anda Owner, perubahan langsung tersimpan tanpa perlu persetujuan.")
        : "Perubahan baru berlaku setelah <b>disetujui Owner</b>."}</p>
    <form id="form-edit-${t.id}" class="form">
      <h4 class="judul" style="font-size:14px">Pembeli</h4>
      ${formPelanggan(t.pembeli || {}, "epembeli", saranKecamatan, saranKota)}

      <label class="pilihan" style="margin-top:8px">
        <input type="checkbox" id="e-sama-${t.id}" ${pemakaiSama ? "checked" : ""}>
        <span>Pemakai kendaraan sama dengan pembeli di atas</span>
      </label>
      <div id="e-wadah-pemakai-${t.id}" ${pemakaiSama ? "hidden" : ""}>
        <h4 class="judul" style="font-size:14px;margin-top:8px">Pemakai</h4>
        ${formPelanggan(t.pemakai || {}, "epemakai", saranKecamatan, saranKota)}
      </div>

      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">
          ${owner ? "Simpan Perubahan" : "Kirim Pengajuan"}</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-edit-${t.id}">Batal</button>
      </div>
    </form>
  </div>`;

  pasangHurufBesarPelanggan(kontainer, "epembeli");
  pasangHurufBesarPelanggan(kontainer, "epemakai");

  const samaEl = kontainer.querySelector(`#e-sama-${t.id}`);
  const wadahPemakai = kontainer.querySelector(`#e-wadah-pemakai-${t.id}`);
  samaEl.addEventListener("change", () => { wadahPemakai.hidden = samaEl.checked; });

  kontainer.querySelector(`#batal-edit-${t.id}`)
    .addEventListener("click", () => { kontainer.innerHTML = ""; });

  kontainer.querySelector(`#form-edit-${t.id}`).addEventListener("submit", async (e) => {
    e.preventDefault();
    const pembeli = bacaFormPelanggan(kontainer, "epembeli");
    if (!pembeli.nama) {
      kabar("Nama pembeli wajib diisi.", "rem");
      return;
    }
    const sama = samaEl.checked;
    const pemakai = sama ? null : bacaFormPelanggan(kontainer, "epemakai");
    if (!sama && !pemakai.nama) {
      kabar("Nama pemakai wajib diisi, atau centang \"sama dengan pembeli\".", "rem");
      return;
    }

    const tombol = e.target.querySelector('button[type="submit"]');
    tombol.disabled = true;
    tombol.textContent = owner ? "Menyimpan…" : "Mengirim…";

    const dataLama = {
      pembeli: t.pembeli || null, pemakai: t.pemakai || null,
      pemakaiSamaDenganPembeli: pemakaiSama,
    };
    const dataBaru = {
      pembeli, pemakai: sama ? null : pemakai, pemakaiSamaDenganPembeli: sama,
    };
    const catatanPerubahan = buatCatatanPerubahan(dataLama, dataBaru);

    // Owner: langsung terap ke SPK-nya, TANPA pengajuan (dia toh yang
    // akan menyetujui pengajuannya sendiri, jadi diterapkan langsung).
    // kuitansiNo/Kode/Tercetak SENGAJA tidak disentuh sama sekali di
    // sini — jadi nomor kuitansi tetap sama persis walau datanya diubah.
    if (owner) {
      try {
        await updateDoc(doc(dbase, "transaksi", t.id), dataBaru);
        await catat("perubahan_spk_diterapkan_owner", {
          koleksi: "transaksi", docId: t.id,
          ringkas: `${t.spkNo} · ${catatanPerubahan}`,
        });
        kabar("Perubahan tersimpan.", "netral");
        kontainer.innerHTML = "";
        if (muatUlang) await muatUlang();
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
        tombol.disabled = false;
        tombol.textContent = "Simpan Perubahan";
      }
      return;
    }

    try {
      const ref = doc(collection(dbase, "pengajuan"));
      await setDoc(ref, {
        jenis: "pelanggan_spk",
        transaksiId: t.id, spkNo: t.spkNo,
        diajukanOlehUid: sesi ? sesi.uid : null,
        diajukanOlehNama: sesi ? sesi.nama : "-",
        diajukanOlehPeran: sesi ? sesi.peran : null,
        status: "menunggu",
        dataLama, dataBaru,
        catatan: catatanPerubahan,
        ...tandaBaru(),
      });
      await catat("perubahan_spk_diajukan", {
        koleksi: "transaksi", docId: t.id, ringkas: t.spkNo,
      });
      // Sebutkan rincian field yang berubah, bukan cuma "ada perubahan".
      await beriTahuSemuaOwner("Pengajuan Perubahan Data",
        `${sesi.nama} — SPK ${t.spkNo}: ${catatanPerubahan}`);

      kabar("Pengajuan terkirim, menunggu persetujuan Owner.", "netral");
      kontainer.innerHTML = "";
      if (muatUlang) await muatUlang();
    } catch (err) {
      kabar("Gagal mengirim pengajuan: " + err.message, "rem");
      tombol.disabled = false;
      tombol.textContent = "Kirim Pengajuan";
    }
  });
}

// Bandingkan data lama vs baru jadi kalimat yang gampang dibaca
// Owner — supaya jelas apa yang sebenarnya berubah tanpa perlu
// bongkar dua obyek JSON sendiri.
const LABEL_FIELD = {
  nama: "Nama", telepon: "Telepon", nik: "NIK", alamat: "Alamat",
  kelurahan: "Kelurahan", kecamatan: "Kecamatan", kota: "Kabupaten/Kota",
  provinsi: "Provinsi", kodePos: "Kode Pos", email: "Email",
};

export function buatCatatanPerubahan(dataLama, dataBaru) {
  const baris = [];
  if ((dataLama.pemakaiSamaDenganPembeli !== false) !==
      (dataBaru.pemakaiSamaDenganPembeli !== false)) {
    baris.push(`"Pemakai sama dengan pembeli": ${
      dataLama.pemakaiSamaDenganPembeli !== false ? "Ya" : "Tidak"} → ${
      dataBaru.pemakaiSamaDenganPembeli !== false ? "Ya" : "Tidak"}`);
  }
  ["pembeli", "pemakai"].forEach((sisi) => {
    const lama = dataLama[sisi] || {};
    const baruObj = dataBaru[sisi] || {};
    Object.keys(LABEL_FIELD).forEach((f) => {
      const v1 = (lama[f] || "").toString().trim();
      const v2 = (baruObj[f] || "").toString().trim();
      if (v1 !== v2) {
        baris.push(`${sisi === "pembeli" ? "Pembeli" : "Pemakai"} — ` +
          `${LABEL_FIELD[f]}: "${v1 || "-"}" → "${v2 || "-"}"`);
      }
    });
  });
  return baris.length ? baris.join("\n") : "Tidak ada perubahan data yang terdeteksi.";
}

// ── Batalkan SPK ─────────────────────────────────────────────
// SENGAJA tidak semua SPK boleh dibatalkan lewat sini — kalau
// sudah Lunas & unitnya sudah Terjual (fisik sudah keluar
// showroom), itu bukan lagi urusan "batal SPK" tapi retur/tukar
// unit yang lebih rumit, di luar cakupan tombol ini.
//
// Owner: langsung dibatalkan (pakai password kalau kuitansinya
// sudah pernah dicetak). Admin/Sales: cuma bisa MENGAJUKAN,
// Owner yang memutuskan lewat Persetujuan Perubahan — sama pola
// dengan Cashback/Diskon/Ubah Unit.
export async function mintaBatalkanSpk(t, muatUlang) {
  if (!t) return;
  if (t.status === "batal") {
    kabar("SPK ini sudah dibatalkan sebelumnya.", "rem");
    return;
  }

  const totalDibayar = hitungTotalDibayar(t);
  const lunas = (t.hargaOtr || 0) > 0 && totalDibayar >= (t.hargaOtr || 0);
  if (lunas) {
    await beritahu({
      judul: "Tidak Bisa Dibatalkan",
      pesan: `SPK ${t.spkNo} sudah Lunas dan unitnya sudah Terjual — ` +
             `pembatalan lewat sistem tidak tersedia untuk kondisi ini. ` +
             `Kalau memang perlu, hubungi Owner untuk penanganan ` +
             `retur/tukar unit di luar sistem.`,
    });
    return;
  }

  const owner = sesi && sesi.peran === "owner";

  const alasan = await tanya({
    judul: owner ? "Batalkan SPK" : "Ajukan Pembatalan SPK",
    pesan: `Alasan pembatalan SPK ${t.spkNo} (wajib diisi, akan tercatat).`,
    petunjuk: "mis. Konsumen batal, salah input data, dsb.",
  });
  if (alasan === null) return;
  if (!alasan.trim()) {
    kabar("Alasan wajib diisi.", "rem");
    return;
  }

  if (totalDibayar > 0) {
    const lanjut = await konfirmasi({
      judul: "Sudah Ada Pembayaran Diterima",
      pesan: `SPK ini sudah menerima ${rupiah(totalDibayar)}. Pastikan ` +
             `pengembaliannya sudah/akan diurus di luar sistem sebelum ` +
             `lanjut membatalkan. Lanjutkan?`,
      oke: "Tetap Lanjutkan", bahaya: true,
    });
    if (!lanjut) return;
  } else {
    const lanjut = await konfirmasi({
      judul: owner ? "Batalkan SPK ini?" : "Ajukan pembatalan SPK ini?",
      pesan: `SPK ${t.spkNo} (${t.pembeli?.nama || "-"}) akan ` +
             `${owner ? "dibatalkan" : "diajukan pembatalannya ke Owner"}.`,
      oke: owner ? "Batalkan" : "Ajukan", bahaya: true,
    });
    if (!lanjut) return;
  }

  if (owner && t.kuitansiTercetak) {
    const password = await tanya({
      judul: "Konfirmasi Password",
      pesan: `Data SPK ${t.spkNo} sudah terkunci (kuitansi pernah ` +
             `dicetak). Masukkan password untuk konfirmasi pembatalan.`,
      petunjuk: "Password", tipeIsian: "password",
    });
    if (password === null) return;
    try {
      await konfirmasiPassword(password);
    } catch {
      kabar("Password salah. Pembatalan dibatalkan.", "rem");
      return;
    }
  }

  try {
    if (owner) {
      const batch = writeBatch(dbase);
      batch.update(doc(dbase, "transaksi", t.id), {
        status: "batal",
        alasanBatal: alasan.trim(),
        dibatalkanPada: serverTimestamp(),
        dibatalkanOleh: sesi.uid,
      });
      // Unit yang masih terkunci (Dipesan, belum Lunas) dikembalikan
      // ke Ready — dicek langsung ke dokumen unitnya, bukan cuma
      // percaya field kondisiUnit yang tersimpan di SPK (bisa saja
      // sudah tidak sinkron).
      if (t.unitId) {
        try {
          const snapUnit = await getDoc(doc(dbase, "units", t.unitId));
          if (snapUnit.exists() && snapUnit.data().status === "booked") {
            batch.update(doc(dbase, "units", t.unitId), {
              status: "ready", spkId: null,
            });
            batch.update(doc(dbase, "tipe_motor", t.tipeId), {
              jumlahReady: increment(1),
            });
          }
        } catch { /* kalau gagal cek unit, tetap lanjut batalkan SPK-nya */ }
      }
      sertakanLog(batch, "spk_dibatalkan", {
        koleksi: "transaksi", docId: t.id,
        ringkas: `${t.spkNo} · ${alasan.trim()}`,
      });
      await batch.commit();
      kabar(`SPK ${t.spkNo} dibatalkan.`, "netral");
      // Beri tahu sales pemilik SPK ini, kalau bukan dia sendiri yang
      // membatalkan (mis. Owner yang membatalkan SPK milik Sales lain).
      if (t.salesUid && t.salesUid !== sesi.uid) {
        await buatNotifikasi(t.salesUid, "SPK Dibatalkan",
          `SPK ${t.spkNo} (${t.pembeli?.nama || "-"}) dibatalkan Owner. ` +
          `Alasan: ${alasan.trim()}`, "#/laporan");
      }
    } else {
      await setDoc(doc(collection(dbase, "pengajuan")), {
        jenis: "batal_spk",
        transaksiId: t.id, spkNo: t.spkNo,
        diajukanOlehUid: sesi ? sesi.uid : null,
        diajukanOlehNama: sesi ? sesi.nama : "-",
        diajukanOlehPeran: sesi ? sesi.peran : null,
        status: "menunggu",
        dataBaru: { alasan: alasan.trim() },
        catatan: `Pengajuan pembatalan SPK ${t.spkNo} ` +
                 `(${t.pembeli?.nama || "-"}). Alasan: ${alasan.trim()}`,
        ...tandaBaru(),
      });
      await catat("batal_spk_diajukan", {
        koleksi: "transaksi", docId: t.id, ringkas: t.spkNo,
      });
      await beriTahuSemuaOwner("Pengajuan Pembatalan SPK",
        `${sesi.nama} mengajukan pembatalan SPK ${t.spkNo} ` +
        `(${t.pembeli?.nama || "-"}). Alasan: ${alasan.trim()}`);
      kabar("Pengajuan pembatalan terkirim, menunggu persetujuan Owner.", "netral");
    }
    if (muatUlang) await muatUlang();
  } catch (err) {
    kabar("Gagal: " + err.message, "rem");
  }
}

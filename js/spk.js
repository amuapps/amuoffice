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
} from "./db.js?v=3.6.1";
import { sesi, bolehAkses, konfirmasiPassword } from "./auth.js?v=3.6.1";
import { batasDiskon, PERAN } from "./roles.js?v=3.6.1";
import { DP_MINIMUM } from "./config.js?v=3.6.1";
import { muatTipe, tipeDari } from "./tipe.js?v=3.6.1";
import { cariUnitReady, muatSemuaUnitReadyRingkas,
  kunciUnitTransaksi, lepasUnitTransaksi } from "./stok.js?v=3.6.1";
import { formPelanggan, bacaFormPelanggan, simpanPelangganOtomatis,
         pasangHurufBesarPelanggan } from "./pelanggan.js?v=3.6.1";
import { muatSaranKecamatan, muatSaranKota } from "./referensi.js?v=3.6.1";
import { muatLeasing, leasingAktif, leasingDari } from "./leasing.js?v=3.6.1";
import { muatRekening, rekeningAktif, rekeningDari } from "./rekening.js?v=3.6.1";
import { muatAgen, agenAktif } from "./agen.js?v=3.6.1";
import { cetakSpk, mintaCetakKuitansi as catatPembayaran, labelTombolKuitansi,
  hitungTotalDibayar, resolveNamaSales, cetakKuitansiRevisi, hargaEfektif } from "./cetak.js?v=3.6.1";
import { konfirmasi, tanya, beritahu } from "./dialog.js?v=3.6.1";
import { buatNotifikasi, beriTahuSemuaOwner } from "./notifikasi.js?v=3.6.1";
import { rupiah, aman, kabar, pasangFormatUang, bacaAngka, namaTampilan, tanggal } from "./ui.js?v=3.6.1";

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

    // WAJIB ada uang muka minimal Rp1.000.000 — sesuai Syarat &
    // Ketentuan di dokumen SPK sendiri (poin 4: "SPK sah apabila
    // uang muka telah dibayar"). Sebelumnya sistem membiarkan SPK
    // tersimpan & tercetak dengan DP Rp0, yang berarti SPK-nya
    // sendiri belum sah menurut aturannya sendiri — celah ini yang
    // ditutup di sini. Angka minimumnya diatur di config.js
    // (DP_MINIMUM), bukan angka mati di sini.
    const bttSblmSimpan = !wadahTT.hidden;
    const jumlahBayarCek = bttSblmSimpan
      ? bacaAngka(wadah.querySelector("#s-jml-tunai")) + bacaAngka(wadah.querySelector("#s-jml-transfer"))
      : bacaAngka(wadah.querySelector("#s-bayar"));
    if (jumlahBayarCek < DP_MINIMUM) {
      kabar(`SPK wajib ada uang muka (DP) minimal ${rupiah(DP_MINIMUM)} ` +
        `sebelum bisa disimpan — isi "Jumlah dibayar sekarang" di tab ` +
        `Payment Info.`, "rem");
      return;
    }

    tombol.disabled = true;
    tombol.textContent = "Menyimpan…";

    try {
      const t = tipeDari(tipeId);
      const spkNo = await nomorBerikutnya("spk", "SPK");
      const ref = doc(collection(dbase, "transaksi")); // ID-nya dipakai buat kunci unit di bawah

      // ── Cari & KUNCI unit ready SECARA ATOMIK ──────────────────
      // Sebelumnya: unit dicari (baca), baru BELAKANGAN dikunci
      // (tulis) bareng batch SPK — ada JEDA di antara baca & tulis
      // yang bisa membuat DUA sales lolos mengunci unit yang SAMA
      // kalau kebetulan pilih di detik yang hampir bersamaan.
      // Sekarang: kunciUnitTransaksi baca ULANG + tulis dalam SATU
      // runTransaction, jadi kalau ada yang "menang" duluan, yang
      // kalah otomatis gagal (bukan dua-duanya berhasil) — lalu di
      // sini kita coba cari unit ready LAIN sampai 3x sebelum
      // menyerah dan menjadikan SPK ini Indent.
      let kandidat = null;
      if (unitDipilihId) {
        const snapUnitPilihan = await getDoc(doc(dbase, "units", unitDipilihId));
        if (snapUnitPilihan.exists() && snapUnitPilihan.data().status === "ready") {
          kandidat = { id: snapUnitPilihan.id, ...snapUnitPilihan.data() };
        }
      }
      if (!kandidat) kandidat = await cariUnitReady(tipeId, warna);

      let unit = null;
      for (let sisaCoba = 3; kandidat && sisaCoba > 0; sisaCoba--) {
        try {
          await kunciUnitTransaksi(kandidat.id, kandidat.tipeId, ref.id);
          unit = kandidat;
          break;
        } catch {
          // Unit ini baru saja "direbut" transaksi lain — cari unit
          // ready lain untuk tipe/warna yang sama (query otomatis
          // sudah tidak menyertakan yang barusan berubah status).
          kandidat = await cariUnitReady(tipeId, warna);
        }
      }
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
      // TIDAK ada kunciUnitKeBatch di sini lagi — unit (kalau ada)
      // SUDAH dikunci lewat kunciUnitTransaksi di atas. Menguncinya
      // lagi di sini akan mengurangi jumlahReady DUA KALI.
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
      // Kalau unit SUDAH terlanjur dikunci (kunciUnitTransaksi
      // berhasil) tapi batch SPK-nya gagal karena sebab lain
      // (mis. jaringan putus di tengah), lepas lagi kuncinya —
      // supaya unit itu tidak "menggantung" terkunci ke SPK yang
      // sebenarnya gagal tersimpan.
      if (typeof unit !== "undefined" && unit) {
        try { await lepasUnitTransaksi(unit.id); } catch { /* biarkan, tidak fatal */ }
      }
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

  // ── Bagian tambahan KHUSUS Owner: Unit, Cara Bayar, Kredit,
  // Diskon/Cashback, Catatan. Admin/Sales tetap cuma bisa mengajukan
  // perubahan data pembeli/pemakai seperti sebelumnya — field lain
  // (unit, harga, cara bayar) terlalu berdampak (stok & keuangan)
  // untuk dibuka lewat jalur pengajuan biasa.
  let daftarTipe = [], daftarLeasingAktif = [], daftarRekeningAktif = [];
  let unitSekarangNoRangka = "";
  let daftarUnitReady = [];
  let daftarAgenPilihan = [], daftarSalesPilihan = [];
  if (owner) {
    const [, , , unitSnap, unitReadySnap] = await Promise.all([
      muatTipe().then((d) => { daftarTipe = d; }),
      muatLeasing(), muatRekening(),
      t.unitId ? getDoc(doc(dbase, "units", t.unitId)) : Promise.resolve(null),
      muatSemuaUnitReadyRingkas(),
      muatAgen(),
    ]);
    daftarLeasingAktif = leasingAktif();
    daftarRekeningAktif = rekeningAktif();
    if (unitSnap && unitSnap.exists()) unitSekarangNoRangka = unitSnap.data().noRangka || "";
    daftarUnitReady = unitReadySnap;
    daftarAgenPilihan = agenAktif();
    const snapKaryawan = await getDocs(collection(dbase, "users"));
    daftarSalesPilihan = snapKaryawan.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u.aktif !== false && u.peran !== "owner")
      .sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
  }
  const kredit = t.kredit || {};
  const caraBayarLama = t.caraBayar || [];
  const bisaLihatFeeAgen = true; // form ini SELALU owner-only

  // Jumlah dibayar sekarang (DP) — beda perlakuan tergantung apakah
  // kuitansi pertama SUDAH tercetak atau belum (lihat submit handler
  // di bawah untuk alur revisinya).
  const dpSaatIni = t.jumlahBayar || 0;
  // Entri riwayat SELAIN DP (index 0) — pembayaran ke-2 dst, yang
  // baru bisa dihapus/diubah lewat panel Detail sebelum ini. Field
  // "index" di sini dipakai buat cocokkan kembali ke posisi ASLI di
  // riwayatBayar saat submit (lihat penjelasan idxAsli di bawah).
  const riwayatBayarLain = (Array.isArray(t.riwayatBayar) ? t.riwayatBayar : [])
    .slice(1);

  // ── TAB: Customer Info ─────────────────────────────────────────
  const tabCustomer = `<div class="tab-panel" data-panel="ecustomer">
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
  </div>`;

  // ── TAB: Internal Info ─────────────────────────────────────────
  const tabInternal = !owner ? "" : `<div class="tab-panel" data-panel="einternal" hidden>
    <label class="label label--gelap" for="e-sales-${t.id}">Atas nama karyawan
      <span class="kunci">pindahkan SPK ini ke sales lain kalau perlu</span></label>
    <select class="isian" id="e-sales-${t.id}">
      <option value="" ${!t.salesUid || t.salesUid === sesi.uid ? "selected" : ""}>
        OWNER (saya sendiri)</option>
      ${daftarSalesPilihan.map((s) => `<option value="${s.id}"
        ${s.id === t.salesUid ? "selected" : ""}>
        ${aman(s.nama)} — ${aman(PERAN[s.peran]?.label || s.peran)}</option>`).join("")}
    </select>
    <p class="petunjuk">Sekarang tercatat atas nama: <b>${aman(t.salesNama || "-")}</b>.
      Mengubah ini memindahkan SPK (dan biasanya komisi/laporan penjualannya)
      ke karyawan lain — jejak siapa yang BENAR-BENAR input tetap tersimpan
      terpisah, tidak ikut berubah.</p>

    <label class="label label--gelap" for="e-diskon-${t.id}">Diskon (Rp)</label>
    <input class="isian" id="e-diskon-${t.id}" value="${rupiah(t.diskon || 0)}">
    <p class="petunjuk">Sebagai Owner, diskon tidak dibatasi — langsung
      berlaku setelah disimpan, ikut mengurangi Harga Efektif (dipakai
      untuk hitung Lunas, Sisa Tagihan, dan Tagihan Leasing).</p>

    <label class="label label--gelap" for="e-cashback-${t.id}">Cashback (Rp)
      <span class="kunci">langsung berlaku — Owner tidak perlu proses persetujuan</span></label>
    <input class="isian" id="e-cashback-${t.id}" value="${rupiah(t.cashbackDisetujui || 0)}">

    <label class="label label--gelap" for="e-agen-${t.id}">Agen
      <span class="kunci">opsional</span></label>
    <select class="isian" id="e-agen-${t.id}">
      <option value="" ${!t.agenId ? "selected" : ""}>— tidak ada agen —</option>
      ${daftarAgenPilihan.map((a) => `<option value="${a.id}"
        ${a.id === t.agenId ? "selected" : ""}>${aman(a.idAgen)} · ${aman(a.nama)}</option>`).join("")}
    </select>
    <label class="label label--gelap" for="e-fee-agen-${t.id}">Fee Agen (Rp)</label>
    <input class="isian" id="e-fee-agen-${t.id}" value="${rupiah(t.feeAgen || 0)}">

    <label class="label label--gelap" for="e-catatan-${t.id}">Catatan internal</label>
    <textarea class="isian" id="e-catatan-${t.id}" rows="2"
      >${aman(t.catatan || "")}</textarea>
  </div>`;

  // ── TAB: Payment Info ───────────────────────────────────────────
  const tabPayment = !owner ? "" : `<div class="tab-panel" data-panel="epayment" hidden>
    <h4 class="judul" style="font-size:14px">Unit &amp; Harga</h4>
    <p class="petunjuk">Unit sekarang: <b>${aman(t.tipeNama)} ${aman(t.warna)}</b>
      ${unitSekarangNoRangka ? ` — No. Rangka ${aman(unitSekarangNoRangka)}` : ""}</p>
    <label class="label">Tipe motor
      <select id="e-tipe-${t.id}" class="isian">
        ${daftarTipe.map((tp) => `<option value="${tp.id}"
          ${tp.id === t.tipeId ? "selected" : ""}>
          ${aman(tp.merek)} ${aman(tp.tipe)} ${aman(tp.varian || "")}</option>`).join("")}
      </select>
    </label>
    <label class="label">Harga OTR
      <input class="isian" id="e-otr-${t.id}" value="${rupiah(t.hargaOtr || 0)}">
    </label>

    <p class="label label--gelap" style="margin-top:10px">Ganti unit fisik
      <span class="kunci">sama seperti SPK Baru — pilih tipe, tabel unit
        ready langsung muncul, tinggal pilih</span></p>
    <label class="pilihan">
      <input type="checkbox" id="e-unit-semua-tipe-${t.id}">
      <span>Tampilkan semua tipe (bukan cuma tipe yang dipilih di atas)</span>
    </label>
    <div id="e-tabel-unit-${t.id}" style="max-height:260px; overflow:auto;
      border:1px solid #ddd; border-radius:6px; margin-top:6px">
      <p class="hampa" style="margin:10px">Memuat unit ready…</p>
    </div>
    <div id="e-wadah-warna-manual-${t.id}" hidden style="margin-top:8px">
      <label class="label">Warna
        <span class="kunci">stok kosong untuk tipe ini — SPK akan jadi Indent</span>
        <select id="e-warna-manual-${t.id}" class="isian">
          <option value="">— pilih warna —</option>
        </select>
      </label>
    </div>
    <p class="petunjuk">Pilih SATU unit di tabel untuk mengunci SPK ini
      langsung ke unit fisik itu. Kalau tidak pilih apa pun dan stok kosong
      untuk tipe ini, pilih Warna manual di atas — SPK ini otomatis jadi
      Indent (menunggu unit datang).</p>

    <label class="pilihan" style="margin-top:6px">
      <input type="checkbox" id="e-lepas-unit-${t.id}">
      <span>Lepas unit ini kembali ke stok (SPK jadi Indent)</span>
    </label>
    <p class="petunjuk">SPK ini <b>TIDAK dibatalkan</b> — pembeli, pembayaran,
      dan riwayatnya tetap tersimpan apa adanya. Yang berubah cuma status
      unit fisiknya: kembali jadi <b>Ready</b> (bisa dipakai SPK lain), dan
      SPK ini berubah status jadi <b>Indent</b> (menunggu unit lain masuk).</p>

    <h4 class="judul" style="font-size:14px;margin-top:14px">Cara Bayar</h4>
    <label class="pilihan"><input type="checkbox" id="e-tunai-${t.id}"
      ${caraBayarLama.includes("tunai") ? "checked" : ""}><span>Tunai</span></label>
    <label class="pilihan"><input type="checkbox" id="e-transfer-${t.id}"
      ${caraBayarLama.includes("transfer") ? "checked" : ""}><span>Transfer</span></label>
    <label class="pilihan"><input type="checkbox" id="e-kredit-${t.id}"
      ${caraBayarLama.includes("kredit") ? "checked" : ""}><span>Kredit (Leasing)</span></label>

    <label class="label label--gelap" for="e-bayar-${t.id}" style="margin-top:8px">
      Jumlah Dibayar Sekarang (DP)</label>
    <input class="isian" id="e-bayar-${t.id}" value="${rupiah(dpSaatIni)}">
    ${!t.kuitansiTercetak ? `<p class="petunjuk">Kuitansi belum pernah dicetak
        untuk SPK ini — angka ini masih bisa diubah bebas, langsung tersimpan.</p>`
      : `<p class="petunjuk"><b>Kuitansi pertama SUDAH pernah dicetak</b>
        (${aman(t.kuitansiNo || "")}). Kalau angka ini diubah, sistem TIDAK
        menimpa kuitansi lama — melainkan mencatatnya sebagai
        <b>revisi</b> (alasan wajib diisi) dan otomatis mencetak
        <b>Kuitansi Revisi</b> bernomor sama + kode REV, supaya kuitansi asli
        yang sudah di tangan konsumen tetap punya jejak riwayatnya.</p>`}

    ${riwayatBayarLain.length ? `
    <h4 class="judul" style="font-size:14px;margin-top:14px">Riwayat Pembayaran Lainnya</h4>
    <p class="petunjuk">Selain DP di atas. Ubah angkanya kalau salah ketik,
      atau centang "Hapus" kalau entrinya memang tidak seharusnya ada
      (mis. tercatat dobel). Wajib alasan + password, sama seperti koreksi
      DP — kuitansi kertas yang sudah tercetak TIDAK ikut ditarik.</p>
    ${riwayatBayarLain.map((r, i) => `<div class="dua" style="align-items:flex-end">
      <div>
        <label class="label label--gelap">${aman(r.keterangan)} ·
          ${r.tanggal ? tanggal(r.tanggal) : "-"} (${aman(r.kuitansiNo || "-")})</label>
        <input class="isian" id="e-riwayat-${i}-${t.id}" value="${rupiah(r.jumlah || 0)}">
      </div>
      <label class="pilihan" style="margin-top:0;margin-bottom:8px">
        <input type="checkbox" id="e-riwayat-hapus-${i}-${t.id}">
        <span>Hapus entri ini</span>
      </label>
    </div>`).join("")}
    ` : ""}

    <div id="e-wadah-rekening-${t.id}" ${!caraBayarLama.includes("transfer") ? "hidden" : ""}>
      <label class="label">Rekening tujuan
        <select id="e-rekening-${t.id}" class="isian">
          ${daftarRekeningAktif.map((r) => `<option value="${r.id}"
            ${r.id === t.rekeningId ? "selected" : ""}>
            ${aman(r.bank)} ${aman(r.nomor)} a.n ${aman(r.atasNama)}</option>`).join("")}
        </select>
      </label>
    </div>

    <div id="e-wadah-kredit-${t.id}" ${!caraBayarLama.includes("kredit") ? "hidden" : ""}>
      <label class="label">Leasing
        <select id="e-leasing-${t.id}" class="isian">
          ${daftarLeasingAktif.map((l) => `<option value="${l.id}"
            ${l.id === kredit.leasingId ? "selected" : ""}>${aman(l.nama)}</option>`).join("")}
        </select>
      </label>
      <label class="label">Tagihan ke Leasing
        <span class="kunci">OTR &minus; DP</span></label>
      <input class="isian" id="e-tagihan-leasing-${t.id}"
        value="${rupiah(Math.max((t.hargaOtr || 0) - dpSaatIni, 0))}" disabled>
      <div class="dua">
        <label class="label">Cicilan per bulan
          <input class="isian" id="e-cicilan-${t.id}" value="${rupiah(kredit.cicilan || 0)}">
        </label>
        <label class="label">Lama cicilan (bulan)
          <input class="isian" id="e-tenor-${t.id}" type="number"
            value="${kredit.tenor || ""}">
        </label>
      </div>
      <label class="label">Tanggal survey
        <input class="isian" id="e-survey-${t.id}" type="date"
          value="${kredit.tanggalSurvey ? kredit.tanggalSurvey.toDate?.()
            .toISOString().slice(0, 10) || "" : ""}">
      </label>
    </div>
  </div>`;

  kontainer.innerHTML = `<div class="lembar" style="margin-top:10px">
    <h3 class="judul" style="font-size:15px">
      ${owner ? "Ubah" : "Ajukan Perubahan"} Data —
      <span class="mono">${aman(t.spkNo)}</span>
    </h3>
    <p class="petunjuk">${owner
      ? `Sebagai Owner, Anda bisa mengubah SEMUA data SPK ini — sama seperti ` +
        `saat pertama kali input, termasuk unit, harga, cara bayar, DP, sampai ` +
        `siapa sales-nya. `
      : "Cuma data pembeli &amp; pemakai yang bisa diajukan di sini. Unit, harga, " +
        "dan cara bayar tidak bisa diubah lewat form ini."}
      ${owner
        ? (terkunci
            ? `<b>Kuitansi SPK ini sudah dicetak (${aman(t.kuitansiNo || "")})</b> — ` +
              `perubahan yang berdampak ke keuangan/stok akan diminta konfirmasi ` +
              `password sebelum tersimpan. Nomor kuitansi asli TIDAK akan berubah.`
            : "Perubahan yang berdampak ke keuangan/stok (unit, harga, cara bayar, " +
              "DP, kredit, diskon, cashback) akan diminta konfirmasi password " +
              "sebelum tersimpan. Perubahan data pembeli saja tidak perlu password.")
        : "Perubahan baru berlaku setelah <b>disetujui Owner</b>."}</p>

    ${owner ? `<div class="chip-baris" id="e-tab-${t.id}">
      <button type="button" class="chip aktif" data-etab="ecustomer">Customer Info</button>
      <button type="button" class="chip" data-etab="einternal">Internal Info</button>
      <button type="button" class="chip" data-etab="epayment">Payment Info</button>
    </div>` : ""}

    <form id="form-edit-${t.id}" class="form">
      ${tabCustomer}
      ${tabInternal}
      ${tabPayment}

      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">
          ${owner ? "Simpan Perubahan" : "Kirim Pengajuan"}</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-edit-${t.id}">Batal</button>
      </div>
    </form>
  </div>`;

  if (owner) {
    kontainer.querySelector(`#e-tab-${t.id}`).addEventListener("click", (e) => {
      const b = e.target.closest("[data-etab]");
      if (!b) return;
      kontainer.querySelectorAll(`#e-tab-${t.id} .chip`)
        .forEach((c) => c.classList.toggle("aktif", c === b));
      kontainer.querySelectorAll(`#form-edit-${t.id} .tab-panel`).forEach((p) =>
        (p.hidden = p.dataset.panel !== b.dataset.etab));
    });
  }

  pasangHurufBesarPelanggan(kontainer, "epembeli");
  pasangHurufBesarPelanggan(kontainer, "epemakai");

  const samaEl = kontainer.querySelector(`#e-sama-${t.id}`);
  const wadahPemakai = kontainer.querySelector(`#e-wadah-pemakai-${t.id}`);
  samaEl.addEventListener("change", () => { wadahPemakai.hidden = samaEl.checked; });

  if (owner) {
    const otrEl = kontainer.querySelector(`#e-otr-${t.id}`);
    const diskonEl = kontainer.querySelector(`#e-diskon-${t.id}`);
    const cashbackEl = kontainer.querySelector(`#e-cashback-${t.id}`);
    const cicilanEl = kontainer.querySelector(`#e-cicilan-${t.id}`);
    const bayarEl = kontainer.querySelector(`#e-bayar-${t.id}`);
    const feeAgenEl = kontainer.querySelector(`#e-fee-agen-${t.id}`);
    const tagihanLeasingEl = kontainer.querySelector(`#e-tagihan-leasing-${t.id}`);
    const riwayatEls = riwayatBayarLain.map((_, i) =>
      kontainer.querySelector(`#e-riwayat-${i}-${t.id}`));
    [otrEl, diskonEl, cashbackEl, cicilanEl, bayarEl, feeAgenEl, ...riwayatEls]
      .forEach(pasangFormatUang);

    function perbaruiTagihanLeasingEdit() {
      const otr = bacaAngka(otrEl);
      const bayar = bacaAngka(bayarEl);
      tagihanLeasingEl.value = rupiah(Math.max(otr - bayar, 0));
    }
    [otrEl, bayarEl].forEach((el) => el.addEventListener("input", perbaruiTagihanLeasingEdit));

    const tunaiEl = kontainer.querySelector(`#e-tunai-${t.id}`);
    const transferEl = kontainer.querySelector(`#e-transfer-${t.id}`);
    const kreditEl = kontainer.querySelector(`#e-kredit-${t.id}`);
    const wadahRekening = kontainer.querySelector(`#e-wadah-rekening-${t.id}`);
    const wadahKredit = kontainer.querySelector(`#e-wadah-kredit-${t.id}`);
    [tunaiEl, transferEl, kreditEl].forEach((el) => el.addEventListener("change", () => {
      wadahRekening.hidden = !transferEl.checked;
      wadahKredit.hidden = !kreditEl.checked;
    }));

    // ── Tabel pilih unit fisik (persis pola SPK Baru: pilih tipe →
    // tabel unit ready muncul otomatis, tinggal pilih; kalau stok
    // kosong untuk tipe itu, jatuh ke dropdown Warna manual → Indent) ──
    const tipeSelEl = kontainer.querySelector(`#e-tipe-${t.id}`);
    const semuaTipeEl = kontainer.querySelector(`#e-unit-semua-tipe-${t.id}`);
    const lepasUnitEl = kontainer.querySelector(`#e-lepas-unit-${t.id}`);
    const tabelUnitEl = kontainer.querySelector(`#e-tabel-unit-${t.id}`);
    const wadahWarnaManual = kontainer.querySelector(`#e-wadah-warna-manual-${t.id}`);
    const warnaManualEl = kontainer.querySelector(`#e-warna-manual-${t.id}`);

    function gambarTabelUnit() {
      const semuaTipe = semuaTipeEl.checked;
      const tipeAktif = tipeSelEl.value;
      let daftar = daftarUnitReady.filter((u) => u.id !== t.unitId); // unit sekarang tidak usah dipilih ulang
      if (!semuaTipe) daftar = daftar.filter((u) => u.tipeId === tipeAktif);

      if (!daftar.length) {
        // Sama seperti SPK Baru: stok kosong → tampilkan dropdown
        // Warna manual dari daftar warna Tipe ini, SPK jadi Indent
        // kalau Tipe/Warna ini yang dipakai.
        tabelUnitEl.innerHTML = `<p class="hampa" style="margin:10px">
          ${semuaTipe ? "Tidak ada unit ready lain sama sekali."
            : "Stok kosong untuk tipe ini — pilih Warna manual di bawah."}
        </p>`;
        if (!semuaTipe) {
          const tp = tipeDari(tipeAktif);
          warnaManualEl.innerHTML = `<option value="">— pilih warna —</option>` +
            ((tp && tp.warna) || []).map((w) => `<option value="${aman(w)}"
              ${w === t.warna ? "selected" : ""}>${aman(w)}</option>`).join("");
          wadahWarnaManual.hidden = false;
        } else {
          wadahWarnaManual.hidden = true;
        }
        return;
      }
      wadahWarnaManual.hidden = true;
      tabelUnitEl.innerHTML = `<table class="tabel" style="font-size:11.5px">
        <thead><tr><th></th><th>Tipe</th><th>Warna</th>
          <th>No. Rangka</th><th>Tahun</th></tr></thead>
        <tbody>${daftar.map((u) => {
          const tp = tipeDari(u.tipeId);
          const namaTipe = tp ? `${tp.merek} ${tp.tipe} ${tp.varian || ""}`.trim() : u.tipeId;
          return `<tr>
            <td><input type="radio" name="e-unit-pilihan-${t.id}" value="${u.id}"
              data-tipe-id="${u.tipeId}" data-tipe-nama="${aman(namaTipe)}"
              data-warna="${aman(u.warna || "")}"></td>
            <td>${aman(namaTipe)}</td><td>${aman(u.warna || "-")}</td>
            <td class="mono">${aman(u.noRangka || "-")}</td>
            <td>${aman(u.tahun || "-")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    }
    gambarTabelUnit();
    [tipeSelEl, semuaTipeEl].forEach((el) =>
      el.addEventListener("change", gambarTabelUnit));

    // Lepas Unit & pilih-unit-di-tabel itu dua cara berbeda buat
    // "ganti apa yang terjadi ke unit" — tidak masuk akal aktif
    // dua-duanya sekaligus, jadi saling menonaktifkan otomatis.
    lepasUnitEl.addEventListener("change", () => {
      tabelUnitEl.closest("div").style.opacity = "";
      if (lepasUnitEl.checked) {
        kontainer.querySelectorAll(`input[name="e-unit-pilihan-${t.id}"]`)
          .forEach((r) => { r.checked = false; });
      }
    });
    tabelUnitEl.addEventListener("change", (ev) => {
      if (ev.target.matches(`input[name="e-unit-pilihan-${t.id}"]`) && ev.target.checked) {
        lepasUnitEl.checked = false;
      }
    });
  }

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

    let fatal = false; // apa pun di luar pembeli/pemakai dianggap "fatal"
    let perluGantiUnit = false, lepasUnitDiminta = false, unitIdDipilihManual = null;
    let dpBerubah = false, dpBaru = 0, dpLama = 0;
    let riwayatLainAksi = [];
    if (owner) {
      // Internal Info: Sales, Diskon, Cashback, Agen/Fee Agen, Catatan
      const salesIdBaru = kontainer.querySelector(`#e-sales-${t.id}`).value;
      const salesDipilih = salesIdBaru
        ? daftarSalesPilihan.find((s) => s.id === salesIdBaru) : null;
      const salesUidBaru = salesDipilih ? salesDipilih.id : sesi.uid;
      const salesNamaBaru = salesDipilih ? salesDipilih.nama : sesi.nama;
      const salesPeranBaru = salesDipilih ? salesDipilih.peran : sesi.peran;
      const agenIdBaru = kontainer.querySelector(`#e-agen-${t.id}`).value || null;
      const agenDipilih = agenIdBaru ? daftarAgenPilihan.find((a) => a.id === agenIdBaru) : null;
      const feeAgenBaru = bacaAngka(kontainer.querySelector(`#e-fee-agen-${t.id}`));

      let tipeBaru = kontainer.querySelector(`#e-tipe-${t.id}`).value;
      // Warna sekarang ikut tabel pilih unit (radio) — kalau tidak ada
      // yang dipilih di tabel, jatuh ke dropdown Warna manual (cuma
      // ada kalau stok kosong untuk tipe ini), atau tetap warna lama
      // kalau Tipe tidak diganti sama sekali.
      const warnaManualElCek = kontainer.querySelector(`#e-warna-manual-${t.id}`);
      const wadahWarnaManualCek = kontainer.querySelector(`#e-wadah-warna-manual-${t.id}`);
      let warnaBaru = (wadahWarnaManualCek && !wadahWarnaManualCek.hidden)
        ? warnaManualElCek.value : (t.warna || "");
      const otrBaru = bacaAngka(kontainer.querySelector(`#e-otr-${t.id}`));
      const caraBayarBaru = ["tunai", "transfer", "kredit"].filter((c) =>
        kontainer.querySelector(`#e-${c}-${t.id}`).checked);
      const rekeningBaru = caraBayarBaru.includes("transfer")
        ? kontainer.querySelector(`#e-rekening-${t.id}`)?.value || null : null;
      const diskonBaru = bacaAngka(kontainer.querySelector(`#e-diskon-${t.id}`));
      const cashbackBaru = bacaAngka(kontainer.querySelector(`#e-cashback-${t.id}`));
      const catatanBaru = kontainer.querySelector(`#e-catatan-${t.id}`).value.trim();
      const kreditBaru = caraBayarBaru.includes("kredit") ? {
        leasingId: kontainer.querySelector(`#e-leasing-${t.id}`)?.value || null,
        cicilan: bacaAngka(kontainer.querySelector(`#e-cicilan-${t.id}`)),
        tenor: Number(kontainer.querySelector(`#e-tenor-${t.id}`).value) || 0,
        tanggalSurvey: kontainer.querySelector(`#e-survey-${t.id}`).value || null,
      } : null;

      if (!caraBayarBaru.length) {
        kabar("Pilih minimal satu cara bayar.", "rem");
        tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
        return;
      }

      const tipeBerubah = tipeBaru !== t.tipeId;
      const warnaBerubah = warnaBaru !== (t.warna || "");

      const lepasUnitCek = kontainer.querySelector(`#e-lepas-unit-${t.id}`).checked;
      const radioUnitCek = kontainer.querySelector(
        `input[name="e-unit-pilihan-${t.id}"]:checked`);
      // Prioritas aksi unit: (1) Lepas unit eksplisit → (2) pilih unit
      // spesifik di tabel → (3) fallback lama: auto-cari berdasar
      // field Tipe/Warna kalau salah satunya diganti.
      lepasUnitDiminta = lepasUnitCek;
      unitIdDipilihManual = radioUnitCek ? radioUnitCek.value : null;
      perluGantiUnit = lepasUnitDiminta || !!unitIdDipilihManual ||
        tipeBerubah || warnaBerubah;
      if (perluGantiUnit) fatal = true;

      // Kalau pilih unit SPESIFIK yang tipe/warnanya beda dari field
      // Tipe/Warna di atas (mis. pakai "semua tipe"), field Tipe/Warna
      // SPK ini ikut disesuaikan ke unit yang benar-benar dipilih —
      // supaya data SPK tidak pernah menyimpang dari unit fisiknya.
      if (radioUnitCek) {
        tipeBaru = radioUnitCek.dataset.tipeId;
        warnaBaru = radioUnitCek.dataset.warna;
      }

      dataBaru.tipeId = tipeBaru;
      dataBaru.tipeNama = tipeDari(tipeBaru)
        ? `${tipeDari(tipeBaru).merek} ${tipeDari(tipeBaru).tipe} ${tipeDari(tipeBaru).varian || ""}`.trim()
        : t.tipeNama;
      dataBaru.warna = warnaBaru;
      dataBaru.hargaOtr = otrBaru;
      dataBaru.caraBayar = caraBayarBaru;
      dataBaru.rekeningId = rekeningBaru;
      dataBaru.kredit = kreditBaru;
      dataBaru.diskon = diskonBaru;
      dataBaru.cashbackDisetujui = cashbackBaru;
      // Owner mengedit langsung tanpa lewat alur pengajuan — begitu
      // disimpan, cashback ini otomatis dianggap "disetujui" (bukan
      // "menunggu"), konsisten dengan cashbackDiajukan/Status yang
      // dipakai alur SPK Baru & Persetujuan Perubahan.
      dataBaru.cashbackStatus = cashbackBaru > 0 ? "disetujui" : null;
      dataBaru.catatan = catatanBaru;
      dataBaru.salesUid = salesUidBaru;
      dataBaru.salesNama = salesNamaBaru;
      dataBaru.salesPeran = salesPeranBaru;
      dataBaru.agenId = agenIdBaru;
      dataBaru.agenNama = agenDipilih ? agenDipilih.nama : null;
      dataBaru.feeAgen = feeAgenBaru;

      // ── DP (Jumlah Dibayar Sekarang) ────────────────────────────
      dpLama = t.jumlahBayar || 0;
      dpBaru = bacaAngka(kontainer.querySelector(`#e-bayar-${t.id}`));
      dpBerubah = dpBaru !== dpLama;
      if (dpBerubah) fatal = true;
      if (!t.kuitansiTercetak) {
        // Belum ada kuitansi sama sekali — aman diedit bebas,
        // dipakai nanti sebagai DP saat kuitansi pertama dicetak.
        dataBaru.jumlahBayar = dpBaru;
      }
      // Kalau kuitansiTercetak TRUE, dataBaru.jumlahBayar SENGAJA
      // tidak diisi di sini — koreksinya lewat riwayatBayar[0] +
      // dialog revisi (lihat blok setelah password di bawah), supaya
      // kuitansi ASLI yang sudah di tangan konsumen tidak diam-diam
      // "berubah" tanpa jejak.

      // ── Riwayat Pembayaran Lainnya (index 1 dst) — hapus/ubah ────
      // Baca perubahan dari field-field yang tadi dibuat per entri.
      // Disimpan sebagai daftar "aksi" dulu, baru benar-benar
      // diterapkan ke riwayatBayar setelah password (di bawah),
      // supaya urutan konfirmasinya konsisten dengan aksi lain.
      riwayatLainAksi = riwayatBayarLain.map((r, i) => {
        const hapusEl = kontainer.querySelector(`#e-riwayat-hapus-${i}-${t.id}`);
        const jumlahEl = kontainer.querySelector(`#e-riwayat-${i}-${t.id}`);
        const jumlahBaruEntri = jumlahEl ? bacaAngka(jumlahEl) : (r.jumlah || 0);
        const hapus = hapusEl ? hapusEl.checked : false;
        const berubah = hapus || jumlahBaruEntri !== (r.jumlah || 0);
        return { asli: r, jumlahBaru: jumlahBaruEntri, hapus, berubah };
      }).filter((a) => a.berubah);
      if (riwayatLainAksi.length) fatal = true;

      if (otrBaru !== (t.hargaOtr || 0)) fatal = true;
      if (JSON.stringify([...caraBayarBaru].sort()) !==
          JSON.stringify([...caraBayarLama].sort())) fatal = true;
      if ((kreditBaru?.leasingId || null) !== (kredit.leasingId || null)) fatal = true;
      if (diskonBaru !== (t.diskon || 0)) fatal = true;
      if (cashbackBaru !== (t.cashbackDisetujui || 0)) fatal = true;
      if (tipeBerubah || warnaBerubah) fatal = true;
      if (salesUidBaru !== (t.salesUid || sesi.uid)) fatal = true;
      if (agenIdBaru !== (t.agenId || null)) fatal = true;
      if (feeAgenBaru !== (t.feeAgen || 0)) fatal = true;
    }

    const catatanPerubahan = buatCatatanPerubahan(dataLama, dataBaru);

    // Owner: langsung terap ke SPK-nya, TANPA pengajuan (dia toh yang
    // akan menyetujui pengajuannya sendiri, jadi diterapkan langsung).
    // Kalau ada perubahan "fatal" (unit/harga/cara bayar/kredit/
    // diskon/cashback), wajib konfirmasi password dulu — perubahan
    // data pembeli/pemakai/catatan saja tidak perlu.
    if (owner) {
      if (perluGantiUnit) {
        const namaSalesInput = await resolveNamaSales(t);
        let judulKonteks, pesanKonteks;
        if (lepasUnitDiminta) {
          judulKonteks = "Lepas Unit — SPK Jadi Indent?";
          pesanKonteks = `SPK ${t.spkNo} — pembeli ${aman(pembeli.nama)}, ` +
            `di-input oleh ${aman(namaSalesInput)}, unit ${aman(t.tipeNama)} ` +
            `${aman(t.warna)}. SPK ini TIDAK dibatalkan — pembeli, pembayaran, ` +
            `dan riwayatnya tetap tersimpan. Unit fisiknya kembali jadi Ready ` +
            `(bisa dipakai SPK lain), dan SPK ini jadi status Indent.`;
        } else if (unitIdDipilihManual) {
          judulKonteks = "Ganti Unit Fisik?";
          pesanKonteks = `SPK ${t.spkNo} — pembeli ${aman(pembeli.nama)}, ` +
            `di-input oleh ${aman(namaSalesInput)}. Unit lama (${aman(t.tipeNama)} ` +
            `${aman(t.warna)}) akan dilepas ke stok Ready, digantikan unit baru ` +
            `yang Anda pilih di tabel.`;
        } else {
          judulKonteks = "Ganti Tipe/Warna Unit?";
          pesanKonteks = `SPK ${t.spkNo} — pembeli ${aman(pembeli.nama)}, ` +
            `di-input oleh ${aman(namaSalesInput)}. Unit lama (${aman(t.tipeNama)} ` +
            `${aman(t.warna)}) akan dilepas, sistem akan mencari unit ready lain ` +
            `otomatis untuk tipe/warna baru. Kalau tidak ada, SPK ini jadi Indent.`;
        }
        const lanjutUnit = await konfirmasi({
          judul: judulKonteks, pesan: pesanKonteks,
          oke: "Lanjutkan", bahaya: true,
        });
        if (!lanjutUnit) {
          tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
          return;
        }
      }
      // ── Revisi DP (kalau kuitansi pertama sudah tercetak) ────────
      let alasanRevisiDp = "";
      const perluRevisiDp = dpBerubah && t.kuitansiTercetak;
      if (perluRevisiDp) {
        alasanRevisiDp = await tanya({
          judul: "Alasan Koreksi DP",
          pesan: `Kuitansi asli (${aman(t.kuitansiNo || "")}) sudah tercatat ` +
                 `${rupiah(dpLama)}, akan dikoreksi jadi ${rupiah(dpBaru)}. ` +
                 `Kuitansi Revisi akan otomatis dicetak dengan nomor sama + ` +
                 `kode REV — kuitansi asli tetap tersimpan sebagai riwayat, ` +
                 `tidak dihapus. Jelaskan alasan koreksinya (wajib).`,
          petunjuk: "mis. Salah ketik, seharusnya Rp3.000.000 bukan Rp300.000",
        });
        if (alasanRevisiDp === null) {
          tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
          return;
        }
        if (!alasanRevisiDp.trim()) {
          kabar("Alasan koreksi wajib diisi.", "rem");
          tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
          return;
        }
      }

      // ── Alasan untuk perubahan/hapus di Riwayat Pembayaran Lainnya ──
      let alasanRiwayatLain = "";
      if (riwayatLainAksi.length) {
        const ringkasAksi = riwayatLainAksi.map((a) =>
          a.hapus
            ? `Hapus ${rupiah(a.asli.jumlah)} (${a.asli.kuitansiNo || "-"})`
            : `${rupiah(a.asli.jumlah)} → ${rupiah(a.jumlahBaru)} (${a.asli.kuitansiNo || "-"})`
        ).join("; ");
        alasanRiwayatLain = await tanya({
          judul: "Alasan Koreksi Riwayat Pembayaran",
          pesan: `Perubahan: ${ringkasAksi}. Kuitansi kertas yang sudah ` +
                 `tercetak TIDAK ikut ditarik — ini cuma koreksi catatan di ` +
                 `sistem. Jelaskan alasannya (wajib).`,
          petunjuk: "mis. Salah ketik, tercatat dua kali",
        });
        if (alasanRiwayatLain === null) {
          tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
          return;
        }
        if (!alasanRiwayatLain.trim()) {
          kabar("Alasan wajib diisi.", "rem");
          tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
          return;
        }
      }
      if (fatal) {
        const password = await tanya({
          judul: "Konfirmasi Password",
          pesan: `Perubahan pada SPK ${t.spkNo} (${aman(pembeli.nama)}) ini ` +
                 `berdampak ke keuangan dan/atau stok unit. Masukkan password ` +
                 `untuk konfirmasi.`,
          petunjuk: "Password", tipeIsian: "password",
        });
        if (password === null) {
          tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
          return;
        }
        try {
          await konfirmasiPassword(password);
        } catch {
          kabar("Password salah. Perubahan dibatalkan.", "rem");
          tombol.disabled = false; tombol.textContent = "Simpan Perubahan";
          return;
        }
      }
      try {
        // ── Ganti unit (kalau tipe/warna berubah) — SECARA ATOMIK,
        // sama seperti perbaikan di alur bikin SPK baru. Dilakukan
        // di LUAR writeBatch (Firestore tidak bisa baca-ulang di
        // tengah batch), pakai kunciUnitTransaksi/lepasUnitTransaksi
        // yang masing-masing sudah baca-ulang + tulis dalam satu
        // runTransaction sendiri.
        let unitLamaDilepas = false;
        let unitBaruDikunci = null;
        if (perluGantiUnit) {
          if (t.unitId) {
            try { await lepasUnitTransaksi(t.unitId); unitLamaDilepas = true; }
            catch { /* unit lama sudah bukan booked, abaikan */ }
          }
          if (lepasUnitDiminta) {
            // (1) Lepas eksplisit — SPK jadi Indent, TIDAK cari unit
            // pengganti sama sekali (itu maksudnya "lepas").
            dataBaru.unitId = null;
            dataBaru.kondisiUnit = "indent";
          } else if (unitIdDipilihManual) {
            // (2) Unit SPESIFIK dipilih Owner di tabel — kunci PERSIS
            // unit itu (bukan cari yang lain), supaya sesuai pilihan
            // Owner. Kalau ternyata baru saja direbut proses lain,
            // SPK ini jatuh ke Indent (tidak diam-diam ganti ke unit
            // lain yang tidak dipilih Owner).
            try {
              await kunciUnitTransaksi(unitIdDipilihManual, dataBaru.tipeId, t.id);
              unitBaruDikunci = { id: unitIdDipilihManual };
              dataBaru.unitId = unitIdDipilihManual;
              dataBaru.kondisiUnit = "ready";
            } catch {
              kabar("Unit pilihan Anda baru saja terpakai proses lain — " +
                "SPK ini jadi Indent, silakan pilih unit lain.", "rem");
              dataBaru.unitId = null;
              dataBaru.kondisiUnit = "indent";
            }
          } else {
            // (3) Fallback lama — Tipe/Warna diganti tanpa pilih unit
            // spesifik: cari unit ready pertama yang cocok, retry 3x.
            let kandidat = await cariUnitReady(dataBaru.tipeId, dataBaru.warna);
            for (let sisaCoba = 3; kandidat && sisaCoba > 0; sisaCoba--) {
              try {
                await kunciUnitTransaksi(kandidat.id, kandidat.tipeId, t.id);
                unitBaruDikunci = kandidat;
                break;
              } catch {
                kandidat = await cariUnitReady(dataBaru.tipeId, dataBaru.warna);
              }
            }
            dataBaru.unitId = unitBaruDikunci ? unitBaruDikunci.id : null;
            dataBaru.kondisiUnit = unitBaruDikunci ? "ready" : "indent";
          }
        }

        // ── Riwayat Pembayaran: Revisi DP + Hapus/Ubah entri lain ────
        // Digabung satu tempat supaya keduanya (kalau dua-duanya
        // terjadi sekaligus) diterapkan konsisten ke array yang sama,
        // bukan saling menimpa. Revisi DP TIDAK menimpa kuitansi asli
        // (kertas di tangan konsumen tetap sah) — cuma catatan sistem
        // yang dikoreksi, dan dokumen Kuitansi Revisi dicetak sebagai
        // bukti resmi tiap koreksi.
        let entriRevisiUntukCetak = null;
        if (perluRevisiDp || riwayatLainAksi.length) {
          let riwayatBaru = Array.isArray(t.riwayatBayar) && t.riwayatBayar.length
            ? [...t.riwayatBayar]
            : [{ kuitansiNo: t.kuitansiNo, kodeAman: t.kuitansiKode, jumlah: dpLama || t.jumlahBayar || 0,
                 sumber: "konsumen", sumberNama: t.pembeli?.nama || "-",
                 keterangan: sudahLunas(t) ? "Lunas" : "DP", tanggal: t.kuitansiTercetakPada || new Date() }];

          if (perluRevisiDp) {
            riwayatBaru[0] = { ...riwayatBaru[0], jumlah: dpBaru };
            const revisiLama = Array.isArray(t.kuitansiRevisi) ? t.kuitansiRevisi : [];
            const revKe = revisiLama.length + 1;
            const catatanRevisi = {
              revKe, nomorRevisi: `${t.kuitansiNo}-REV${revKe}`,
              dariJumlah: dpLama, keJumlah: dpBaru,
              alasan: alasanRevisiDp.trim(), olehUid: sesi.uid, olehNama: sesi.nama,
              pada: new Date(),
            };
            dataBaru.kuitansiRevisi = [...revisiLama, catatanRevisi];
            entriRevisiUntukCetak = catatanRevisi;
            dataBaru.jumlahBayar = dpBaru; // supaya cetak ULANG dokumen SPK ikut tampilkan angka terkoreksi
          }

          if (riwayatLainAksi.length) {
            // Cocokkan tiap aksi kembali ke entri ASLINYA di array (bukan
            // asumsi index tetap) — pakai referensi obyek yang sama
            // persis (r.asli === entri di riwayatBaru) supaya aman
            // walau index-nya bergeser gara-gara entri lain dihapus.
            riwayatLainAksi.forEach((aksi) => {
              const idx = riwayatBaru.findIndex((r) => r && (r === aksi.asli ||
                (r.kuitansiNo === aksi.asli.kuitansiNo && r.jumlah === aksi.asli.jumlah)));
              if (idx === -1) return;
              if (aksi.hapus) riwayatBaru[idx] = null; // ditandai dulu, difilter di bawah
              else riwayatBaru[idx] = { ...riwayatBaru[idx], jumlah: aksi.jumlahBaru };
            });
            riwayatBaru = riwayatBaru.filter((r) => r !== null);
            dataBaru.riwayatKoreksi = [
              ...(Array.isArray(t.riwayatKoreksi) ? t.riwayatKoreksi : []),
              ...riwayatLainAksi.map((a) => ({
                kuitansiNo: a.asli.kuitansiNo || null,
                aksi: a.hapus ? "hapus" : "ubah_jumlah",
                dariJumlah: a.asli.jumlah || 0,
                keJumlah: a.hapus ? null : a.jumlahBaru,
                alasan: alasanRiwayatLain.trim(),
                olehUid: sesi.uid, olehNama: sesi.nama, pada: new Date(),
              })),
            ];
          }

          const totalBaru = riwayatBaru.reduce((s, r) => s + (r.jumlah || 0), 0);
          dataBaru.riwayatBayar = riwayatBaru;
          dataBaru.totalDibayar = totalBaru;
          // PAKAI Harga Efektif (OTR − Diskon), BUKAN OTR mentah —
          // konsisten dengan sudahLunas()/hargaEfektif() di cetak.js.
          const efektifSaatIni = Math.max(
            (dataBaru.hargaOtr ?? t.hargaOtr ?? 0) - (dataBaru.diskon ?? t.diskon ?? 0), 0);
          dataBaru.statusBayar = efektifSaatIni > 0 && totalBaru >= efektifSaatIni ? "lunas" : "dp";
          // Kalau koreksi ini bikin SPK jadi Lunas, unit fisiknya (kalau
          // ada) ikut ditandai Terjual — konsisten dengan alur "Terima
          // Pembayaran" biasa yang juga melakukan ini otomatis.
          if (dataBaru.statusBayar === "lunas") {
            const unitIdEfektif = dataBaru.unitId !== undefined ? dataBaru.unitId : t.unitId;
            if (unitIdEfektif) {
              try {
                await updateDoc(doc(dbase, "units", unitIdEfektif), { status: "terjual" });
              } catch { /* tidak fatal, lanjut simpan SPK-nya */ }
            }
          }
        }

        try {
          const batch = writeBatch(dbase);
          batch.update(doc(dbase, "transaksi", t.id), dataBaru);
          sertakanLog(batch, fatal ? "perubahan_spk_fatal_owner" : "perubahan_spk_diterapkan_owner", {
            koleksi: "transaksi", docId: t.id,
            ringkas: `${t.spkNo} · ${catatanPerubahan}` +
                     (riwayatLainAksi.length ? ` · Koreksi riwayat: ${alasanRiwayatLain.trim()}` : ""),
          });
          await batch.commit();
        } catch (errBatch) {
          // Batch gagal SETELAH unit sempat diubah — balikkan lagi
          // supaya tidak ada unit menggantung salah status.
          if (unitBaruDikunci) {
            try { await lepasUnitTransaksi(unitBaruDikunci.id); } catch { /* biarkan */ }
          }
          if (unitLamaDilepas && t.unitId) {
            try { await kunciUnitTransaksi(t.unitId, t.tipeId, t.id); } catch { /* biarkan */ }
          }
          throw errBatch;
        }
        kabar("Perubahan tersimpan.", "netral");
        kontainer.innerHTML = "";
        if (muatUlang) await muatUlang();
        if (entriRevisiUntukCetak) {
          await cetakKuitansiRevisi({ ...t, ...dataBaru, id: t.id }, entriRevisiUntukCetak);
        }
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
  const namaSalesInput = await resolveNamaSales(t);
  const konteksSpk = `SPK ${t.spkNo} — pembeli ${aman(t.pembeli?.nama || "-")}, ` +
    `di-input oleh ${aman(namaSalesInput)}, unit ${aman(t.tipeNama)} ${aman(t.warna)}.`;

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
      pesan: `${konteksSpk} Sudah menerima ${rupiah(totalDibayar)}. Pastikan ` +
             `pengembaliannya sudah/akan diurus di luar sistem sebelum ` +
             `lanjut membatalkan. Kalau dilanjutkan: unit kembali jadi ` +
             `Ready (bisa dipakai SPK lain), SPK ini pindah ke daftar ` +
             `SPK Batal — riwayatnya tetap bisa dilihat tapi tidak bisa ` +
             `diaktifkan lagi. Lanjutkan?`,
      oke: "Tetap Lanjutkan", bahaya: true,
    });
    if (!lanjut) return;
  } else {
    const lanjut = await konfirmasi({
      judul: owner ? "Batalkan SPK ini?" : "Ajukan pembatalan SPK ini?",
      pesan: `${konteksSpk} Kalau ${owner ? "dibatalkan" : "disetujui pembatalannya"}: ` +
             `unit kembali jadi Ready (bisa dipakai SPK lain), SPK ini pindah ` +
             `ke daftar SPK Batal — riwayatnya tetap bisa dilihat tapi tidak ` +
             `bisa diaktifkan lagi.`,
      oke: owner ? "Batalkan" : "Ajukan", bahaya: true,
    });
    if (!lanjut) return;
  }

  if (owner && t.kuitansiTercetak) {
    const password = await tanya({
      judul: "Konfirmasi Password",
      pesan: `${konteksSpk} Data SPK ini sudah terkunci (kuitansi pernah ` +
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

// dashboard.js — ringkasan visual penjualan, khusus Owner. Filter
// (Tahun/Bulan/Tipe/Sales) sengaja disembunyikan di balik satu
// tombol, biar tampilan utamanya bersih — baru muncul kalau memang
// mau menyaring datanya.

import { dbase, collection, getDocs, query, where, orderBy } from "./db.js?v=3.7.2";
import { sesi } from "./auth.js?v=3.7.2";
import { muatTipe } from "./tipe.js?v=3.7.2";
import { rupiah, aman, namaTampilan } from "./ui.js?v=3.7.2";
import { resolveNamaSales, hargaEfektif } from "./cetak.js?v=3.7.2";

const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const IKON_KPI = ["📄", "💰", "✅", "📈"];
const WARNA_KPI = ["#5B8DEF", "#7C5CFC", "#22B07D", "#F5A623"];

function kartuKpi(judul, nilai, sub, idx) {
  return `<article class="kartu kartu--klik" data-kpi="${idx}"
              style="border-top:3px solid ${WARNA_KPI[idx]};cursor:pointer">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div style="width:34px;height:34px;border-radius:9px;
                  background:${WARNA_KPI[idx]}22;color:${WARNA_KPI[idx]};
                  display:flex;align-items:center;justify-content:center;
                  font-size:17px">${IKON_KPI[idx]}</div>
      <p class="kartu-sub" style="margin:0">${aman(judul)}</p>
    </div>
    <p class="angka-besar" style="color:${WARNA_KPI[idx]}">${nilai}</p>
    ${sub ? `<p class="kartu-rinci">${aman(sub)}</p>` : ""}
    <p class="kunci" style="margin:4px 0 0">Klik untuk lihat detail →</p>
  </article>`;
}

// Bar horizontal sederhana pakai CSS — tanpa library grafik, biar
// ringan dan tidak nambah dependensi eksternal cuma buat ini.
function barisBar(label, nilai, maks, warna) {
  const persen = maks > 0 ? Math.round((nilai / maks) * 100) : 0;
  return `<div class="baris-klik" data-bar-tipe="${aman(label)}"
              style="margin-bottom:10px;cursor:pointer">
    <div style="display:flex;justify-content:space-between;font-size:12.5px;
                margin-bottom:3px">
      <span>${aman(label)}</span><span style="font-weight:600">${nilai}</span>
    </div>
    <div style="background:var(--lapis);border-radius:6px;height:10px;overflow:hidden">
      <div style="width:${persen}%;height:100%;background:${warna};
                  border-radius:6px"></div>
    </div>
  </div>`;
}

// Grafik tren garis halus pakai SVG polos — tanpa library grafik.
// Areanya diberi gradasi supaya kesannya lebih "hidup", mirip
// grafik tren di dashboard Excel.
function grafikTren(perBulan) {
  const lebar = 600, tinggi = 160, pad = 8;
  const maks = Math.max(...perBulan, 1);
  const langkah = (lebar - pad * 2) / (perBulan.length - 1);
  const titik = perBulan.map((n, i) => {
    const x = pad + i * langkah;
    const y = tinggi - pad - (n / maks) * (tinggi - pad * 2);
    return [x, y];
  });
  const garis = titik.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${pad},${tinggi - pad} ${garis} ${lebar - pad},${tinggi - pad}`;
  return `<svg viewBox="0 0 ${lebar} ${tinggi}" style="width:100%;height:auto;display:block">
    <defs>
      <linearGradient id="gTren" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7C5CFC" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#7C5CFC" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#gTren)"/>
    <polyline points="${garis}" fill="none" stroke="#7C5CFC" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round"/>
    ${titik.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="7" fill="transparent"
        style="cursor:pointer" data-bar-bulan="${i}">
      <title>${NAMA_BULAN[i]}: ${perBulan[i]} — klik untuk detail</title></circle>
      <circle cx="${x}" cy="${y}" r="3.2" fill="#7C5CFC" style="pointer-events:none"/>`).join("")}
  </svg>
  <div style="display:flex;justify-content:space-between;font-size:10px;
              color:var(--abu-2);margin-top:2px">
    ${NAMA_BULAN.map((b) => `<span>${b}</span>`).join("")}
  </div>`;
}

const WARNA_PERINGKAT = ["#22B07D", "#5B8DEF", "#C0392B"];

// Tabel detail lengkap — dipakai bareng oleh SEMUA titik interaktif
// di dashboard (klik KPI, klik bar tipe, klik titik tren, klik
// kartu peringkat) supaya konsisten satu bentuk tabel saja.
function tabelDetailSpk(daftar) {
  if (!daftar.length) return `<p class="hampa">Tidak ada data untuk ini.</p>`;
  return `<div style="overflow-x:auto">
    <table class="tabel">
      <thead><tr>
        <th>No. SPK</th><th>Tanggal</th><th>Sales</th><th>Input Oleh</th>
        <th>Pembeli</th><th>Unit</th><th>Rangka/Mesin</th><th>Agen</th>
        <th>Cara Bayar</th><th>Harga OTR</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${daftar.map((t) => {
          const diinputOrangLain = t.dibuatOlehUid && t.dibuatOlehUid !== t.salesUid;
          return `<tr>
            <td class="mono">${aman(t.spkNo)}</td>
            <td>${t.dibuatPada?.toDate
              ? t.dibuatPada.toDate().toLocaleDateString("id-ID") : "-"}</td>
            <td>${aman(t.salesNamaTampil || t.salesNama || "-")}</td>
            <td>${diinputOrangLain
              ? aman(namaTampilan(t.dibuatOlehPeran, t.dibuatOlehNama))
              : `<span class="kunci">sama</span>`}</td>
            <td>${aman(t.pembeli?.nama || "-")}</td>
            <td>${aman(t.tipeNama)} · ${aman(t.warna)}</td>
            <td class="mono" style="font-size:11px">
              ${aman(t.unitId ? "terkunci" : "indent")}</td>
            <td>${aman(t.agenNama || "-")}</td>
            <td>${aman((t.caraBayar || []).join(", ") || "-")}</td>
            <td>${rupiah(t.hargaOtr)}</td>
            <td><span class="tanda ${
              t.status === "batal" ? "tanda--batal"
              : t.statusBayar === "lunas" ? "tanda--ready" : "tanda--uji"
            }">${t.status === "batal" ? "Batal"
              : t.statusBayar === "lunas" ? "Lunas"
              : t.statusBayar === "dp" ? "DP" : (t.kondisiUnit === "ready" ? "Ready" : "Indent")}
            </span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}

function barisPeringkat(nama, jumlah, posisi, jumlahMaks) {
  const warna = WARNA_PERINGKAT[posisi - 1] || "var(--abu-2)";
  const inisial = (nama || "-").trim().charAt(0).toUpperCase() || "-";
  const persen = jumlahMaks > 0 ? Math.round((jumlah / jumlahMaks) * 100) : 0;
  const medali = posisi <= 3 ? ["🥇", "🥈", "🥉"][posisi - 1] : null;
  return `<div class="peringkat-baris" data-peringkat-sales="${aman(nama)}"
              style="cursor:pointer">
    <span class="peringkat-no" style="${medali ? "" : `color:${warna}`}">
      ${medali || `#${posisi}`}</span>
    <span class="peringkat-avatar" style="background:${warna}">${aman(inisial)}</span>
    <div class="peringkat-tengah">
      <p class="peringkat-nama">${aman(nama)}</p>
      <div class="peringkat-bar"><span style="width:${persen}%;background:${warna}"></span></div>
    </div>
    <span class="peringkat-jumlah">${jumlah} <span class="kunci" style="margin:0">SPK</span></span>
  </div>`;
}

export async function halamanDashboard(wadah) {
  if (!sesi || sesi.peran !== "owner") {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Dashboard cuma tersedia untuk Owner.</p></div>
    </section>`;
    return;
  }

  const daftarTipe = await muatTipe();
  const tahunSekarang = new Date().getFullYear();
  const daftarTahun = [tahunSekarang, tahunSekarang - 1, tahunSekarang - 2];

  wadah.innerHTML = `<section class="lembar">
    <div style="background:linear-gradient(120deg,#4A2FBD,#5B8DEF);
                border-radius:14px;padding:18px 20px;color:#fff;
                display:flex;justify-content:space-between;align-items:center;
                margin-bottom:16px">
      <div>
        <h2 class="judul" style="color:#fff;margin:0">📊 Dashboard Penjualan</h2>
        <p style="margin:4px 0 0;opacity:.85;font-size:12.5px">
          ${aman(daftarTahun[0])} · Ringkasan performa showroom</p>
      </div>
      <button class="tombol tombol--kecil" id="toggle-filter"
              style="background:rgba(255,255,255,.18);color:#fff;border:0">Filter</button>
    </div>

    <div id="panel-filter" class="lembar" style="margin-top:10px" hidden>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="d-tahun">Tahun</label>
          <select class="isian isian--terang" id="d-tahun">
            ${daftarTahun.map((y) => `<option value="${y}"
              ${y === tahunSekarang ? "selected" : ""}>${y}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="label label--gelap" for="d-bulan">Bulan</label>
          <select class="isian isian--terang" id="d-bulan">
            <option value="">— semua bulan —</option>
            ${NAMA_BULAN.map((b, i) => `<option value="${i}">${b}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="d-tipe">Tipe Motor</label>
          <select class="isian isian--terang" id="d-tipe">
            <option value="">— semua tipe —</option>
            ${daftarTipe.map((t) => `<option value="${t.id}">
              ${aman(t.merek)} ${aman(t.tipe)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="label label--gelap" for="d-sales">Sales</label>
          <select class="isian isian--terang" id="d-sales">
            <option value="">— semua sales —</option>
          </select>
        </div>
      </div>
      <button class="tombol tombol--kecil tombol--isi" id="d-terapkan">Terapkan</button>
    </div>

    <div id="d-kpi" class="tiga" style="margin-top:16px">
      <p class="hampa">Memuat…</p>
    </div>

    <div class="dua" style="margin-top:16px;align-items:start">
      <div class="lembar">
        <h3 class="judul" style="font-size:15px">Unit Terjual per Tipe</h3>
        <div id="d-bar-tipe" style="margin-top:10px"><p class="hampa">Memuat…</p></div>
      </div>
      <div class="lembar">
        <h3 class="judul" style="font-size:15px">Tren Bulanan (jumlah SPK)</h3>
        <div id="d-bar-bulan" style="margin-top:10px"><p class="hampa">Memuat…</p></div>
      </div>
    </div>

    <div class="lembar" style="margin-top:16px">
      <h3 class="judul" style="font-size:15px">Sales Penjualan Terbanyak</h3>
      <div id="d-peringkat" class="peringkat-daftar">
        <p class="hampa">Memuat…</p>
      </div>
    </div>

    <div class="lembar" id="d-detail-wadah" style="margin-top:16px" hidden>
      <div class="lembar-atas">
        <h3 class="judul" style="font-size:15px" id="d-detail-judul">Detail</h3>
        <button class="tombol tombol--kecil" id="d-detail-tutup">Tutup</button>
      </div>
      <div id="d-detail-isi" style="margin-top:10px"></div>
    </div>
  </section>`;

  wadah.querySelector("#toggle-filter").addEventListener("click", () => {
    const p = wadah.querySelector("#panel-filter");
    p.hidden = !p.hidden;
  });

  const detailWadah = wadah.querySelector("#d-detail-wadah");
  const detailJudul = wadah.querySelector("#d-detail-judul");
  const detailIsi = wadah.querySelector("#d-detail-isi");

  function tampilkanDetail(judul, daftar) {
    detailJudul.textContent = `${judul} (${daftar.length})`;
    detailIsi.innerHTML = tabelDetailSpk(daftar);
    detailWadah.hidden = false;
    detailWadah.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  wadah.querySelector("#d-detail-tutup")
    .addEventListener("click", () => { detailWadah.hidden = true; });

  let dataSpk = [];

  async function muatSemua(tahun) {
    const dari = new Date(tahun, 0, 1);
    const sampai = new Date(tahun, 11, 31, 23, 59, 59);
    const snap = await getDocs(query(
      collection(dbase, "transaksi"),
      where("dibuatPada", ">=", dari),
      where("dibuatPada", "<=", sampai),
      orderBy("dibuatPada", "desc")
    ));
    dataSpk = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Nama sales yang tampil — untuk SPK baru cukup namaTampilan()
    // (langsung tahu dari salesPeran). SPK LAMA (sebelum salesPeran
    // ada) perlu dicek ulang ke data pengguna dulu — dilakukan
    // SEKALI per orang saja (bukan per SPK), baru diterapkan ke semua.
    const perluDicek = [...new Set(
      dataSpk.filter((t) => t.salesUid && !t.salesPeran).map((t) => t.salesUid)
    )];
    const hasilCek = await Promise.all(perluDicek.map(async (uid) => {
      const contoh = dataSpk.find((t) => t.salesUid === uid);
      return [uid, await resolveNamaSales(contoh)];
    }));
    const petaNama = new Map(hasilCek);
    dataSpk.forEach((t) => {
      t.salesNamaTampil = t.salesPeran
        ? namaTampilan(t.salesPeran, t.salesNama)
        : (petaNama.get(t.salesUid) || t.salesNama || "-");
    });

    // Isi opsi Sales dari data yang benar-benar ada, sekali saja.
    const pilihSales = wadah.querySelector("#d-sales");
    if (pilihSales.children.length <= 1) {
      const unik = new Map();
      dataSpk.forEach((t) => {
        if (t.salesUid) unik.set(t.salesUid, t.salesNamaTampil);
      });
      pilihSales.innerHTML += [...unik.entries()]
        .map(([uid, nama]) => `<option value="${uid}">${aman(nama)}</option>`).join("");
    }
  }

  function terapkanFilter() {
    const bulan = wadah.querySelector("#d-bulan").value;
    const tipeId = wadah.querySelector("#d-tipe").value;
    const salesUid = wadah.querySelector("#d-sales").value;

    return dataSpk.filter((t) => {
      if (bulan !== "" && t.dibuatPada?.toDate &&
          t.dibuatPada.toDate().getMonth() !== Number(bulan)) return false;
      if (tipeId && t.tipeId !== tipeId) return false;
      if (salesUid && t.salesUid !== salesUid) return false;
      return true;
    });
  }

  function gambarUlang() {
    const terpilih = terapkanFilter();

    const totalNilai = terpilih.reduce((s, t) => s + hargaEfektif(t), 0);
    const lunas = terpilih.filter((t) => t.statusBayar === "lunas").length;
    const rata = terpilih.length ? Math.round(totalNilai / terpilih.length) : 0;
    wadah.querySelector("#d-kpi").innerHTML =
      kartuKpi("Total SPK", terpilih.length, null, 0) +
      kartuKpi("Total Nilai", rupiah(totalNilai), "Setelah diskon", 1) +
      kartuKpi("Unit Lunas", lunas, `dari ${terpilih.length} SPK`, 2) +
      kartuKpi("Rata-rata / SPK", rupiah(rata), null, 3);

    wadah.querySelectorAll("[data-kpi]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = el.dataset.kpi;
        if (idx === "2") {
          tampilkanDetail("Unit Lunas", terpilih.filter((t) => t.statusBayar === "lunas"));
        } else {
          tampilkanDetail("Semua SPK (sesuai filter)", terpilih);
        }
      });
    });

    // Per tipe
    const perTipe = {};
    terpilih.forEach((t) => {
      perTipe[t.tipeNama] = (perTipe[t.tipeNama] || 0) + 1;
    });
    const listTipe = Object.entries(perTipe).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maksTipe = listTipe.length ? listTipe[0][1] : 0;
    wadah.querySelector("#d-bar-tipe").innerHTML = listTipe.length
      ? listTipe.map(([nama, n]) => barisBar(nama, n, maksTipe, "#5B8DEF")).join("")
      : `<p class="hampa">Belum ada data.</p>`;
    wadah.querySelectorAll("[data-bar-tipe]").forEach((el) => {
      el.addEventListener("click", () => {
        const namaTipe = el.dataset.barTipe;
        tampilkanDetail(`Unit Terjual — ${namaTipe}`,
          terpilih.filter((t) => t.tipeNama === namaTipe));
      });
    });

    // Per bulan
    const perBulan = new Array(12).fill(0);
    terpilih.forEach((t) => {
      if (t.dibuatPada?.toDate) perBulan[t.dibuatPada.toDate().getMonth()]++;
    });
    wadah.querySelector("#d-bar-bulan").innerHTML = grafikTren(perBulan);
    wadah.querySelectorAll("[data-bar-bulan]").forEach((el) => {
      el.addEventListener("click", () => {
        const bulanIdx = Number(el.dataset.barBulan);
        tampilkanDetail(`SPK — ${NAMA_BULAN[bulanIdx]}`, terpilih.filter((t) =>
          t.dibuatPada?.toDate && t.dibuatPada.toDate().getMonth() === bulanIdx));
      });
    });

    // Peringkat sales
    const perSales = {};
    terpilih.forEach((t) => {
      if (!t.salesUid) return;
      const nama = t.salesNamaTampil || t.salesNama || "-";
      perSales[nama] = (perSales[nama] || 0) + 1;
    });
    const semuaSales = Object.entries(perSales).sort((a, b) => b[1] - a[1]);
    const top8 = semuaSales.slice(0, 8);
    const jumlahMaks = top8.length ? top8[0][1] : 0;
    wadah.querySelector("#d-peringkat").innerHTML = top8.length
      ? top8.map(([nama, n], i) => barisPeringkat(nama, n, i + 1, jumlahMaks)).join("")
      : `<p class="hampa">Belum ada data.</p>`;
    wadah.querySelectorAll("[data-peringkat-sales]").forEach((el) => {
      el.addEventListener("click", () => {
        const namaSales = el.dataset.peringkatSales;
        tampilkanDetail(`SPK — ${namaSales}`, terpilih.filter((t) =>
          (t.salesNamaTampil || t.salesNama || "-") === namaSales));
      });
    });

    detailWadah.hidden = true; // reset tiap kali filter/tahun berganti
  }

  wadah.querySelector("#d-terapkan").addEventListener("click", async () => {
    await muatSemua(Number(wadah.querySelector("#d-tahun").value));
    gambarUlang();
  });
  wadah.querySelector("#d-tahun").addEventListener("change", async (e) => {
    await muatSemua(Number(e.target.value));
    gambarUlang();
  });

  await muatSemua(tahunSekarang);
  gambarUlang();
}

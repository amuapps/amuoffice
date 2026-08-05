// dashboard.js — ringkasan visual penjualan, khusus Owner. Filter
// (Tahun/Bulan/Tipe/Sales) sengaja disembunyikan di balik satu
// tombol, biar tampilan utamanya bersih — baru muncul kalau memang
// mau menyaring datanya.

import { dbase, collection, getDocs, query, where, orderBy } from "./db.js";
import { sesi } from "./auth.js";
import { muatTipe } from "./tipe.js";
import { rupiah, aman } from "./ui.js";

const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function kartuKpi(judul, nilai, sub) {
  return `<article class="kartu">
    <p class="kartu-sub">${aman(judul)}</p>
    <p class="angka-besar">${nilai}</p>
    ${sub ? `<p class="kartu-rinci">${aman(sub)}</p>` : ""}
  </article>`;
}

// Bar horizontal sederhana pakai CSS — tanpa library grafik, biar
// ringan dan tidak nambah dependensi eksternal cuma buat ini.
function barisBar(label, nilai, maks, warna) {
  const persen = maks > 0 ? Math.round((nilai / maks) * 100) : 0;
  return `<div style="margin-bottom:10px">
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

function kartuPeringkat(nama, jumlah, posisi) {
  const warna = ["#D4AF37", "#9AA0A6", "#B08D57"][posisi - 1] || "var(--abu-2)";
  return `<article class="kartu" style="text-align:center;flex:1">
    <div style="width:40px;height:40px;border-radius:50%;background:${warna};
                color:#fff;display:flex;align-items:center;justify-content:center;
                font-weight:700;margin:0 auto 8px">${posisi}</div>
    <p class="kartu-judul" style="font-size:14px">${aman(nama)}</p>
    <p class="kartu-rinci">${jumlah} SPK</p>
  </article>`;
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
    <div class="lembar-atas">
      <h2 class="judul">Dashboard Penjualan</h2>
      <button class="tombol tombol--kecil" id="toggle-filter">Filter</button>
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
      <div id="d-peringkat" style="display:flex;gap:10px;margin-top:10px">
        <p class="hampa">Memuat…</p>
      </div>
    </div>
  </section>`;

  wadah.querySelector("#toggle-filter").addEventListener("click", () => {
    const p = wadah.querySelector("#panel-filter");
    p.hidden = !p.hidden;
  });

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

    // Isi opsi Sales dari data yang benar-benar ada, sekali saja.
    const pilihSales = wadah.querySelector("#d-sales");
    if (pilihSales.children.length <= 1) {
      const unik = new Map();
      dataSpk.forEach((t) => {
        if (t.salesUid) unik.set(t.salesUid, t.salesNama || "-");
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

    const totalNilai = terpilih.reduce((s, t) => s + (t.hargaOtr || 0), 0);
    const lunas = terpilih.filter((t) => t.statusBayar === "lunas").length;
    const rata = terpilih.length ? Math.round(totalNilai / terpilih.length) : 0;
    wadah.querySelector("#d-kpi").innerHTML =
      kartuKpi("Total SPK", terpilih.length) +
      kartuKpi("Total Nilai", rupiah(totalNilai)) +
      kartuKpi("Unit Lunas", lunas, `dari ${terpilih.length} SPK`) +
      kartuKpi("Rata-rata / SPK", rupiah(rata));

    // Per tipe
    const perTipe = {};
    terpilih.forEach((t) => {
      perTipe[t.tipeNama] = (perTipe[t.tipeNama] || 0) + 1;
    });
    const listTipe = Object.entries(perTipe).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maksTipe = listTipe.length ? listTipe[0][1] : 0;
    wadah.querySelector("#d-bar-tipe").innerHTML = listTipe.length
      ? listTipe.map(([nama, n]) => barisBar(nama, n, maksTipe, "var(--biru)")).join("")
      : `<p class="hampa">Belum ada data.</p>`;

    // Per bulan
    const perBulan = new Array(12).fill(0);
    terpilih.forEach((t) => {
      if (t.dibuatPada?.toDate) perBulan[t.dibuatPada.toDate().getMonth()]++;
    });
    const maksBulan = Math.max(...perBulan, 1);
    wadah.querySelector("#d-bar-bulan").innerHTML = NAMA_BULAN
      .map((b, i) => barisBar(b, perBulan[i], maksBulan, "var(--hijau)")).join("");

    // Peringkat sales
    const perSales = {};
    terpilih.forEach((t) => {
      if (!t.salesUid) return;
      perSales[t.salesNama || "-"] = (perSales[t.salesNama || "-"] || 0) + 1;
    });
    const top3 = Object.entries(perSales).sort((a, b) => b[1] - a[1]).slice(0, 3);
    wadah.querySelector("#d-peringkat").innerHTML = top3.length
      ? top3.map(([nama, n], i) => kartuPeringkat(nama, n, i + 1)).join("")
      : `<p class="hampa">Belum ada data.</p>`;
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

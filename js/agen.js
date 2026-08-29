// agen.js — master data agen penjualan. Dipakai nanti sebagai
// pilihan "Fee Agen" di SPK (khusus terlihat oleh Owner), dan jadi
// dasar portal login agen di tahap berikutnya (belum dibangun).
//
// SELURUH halaman ini (baca & tulis) sengaja dibatasi cuma Owner —
// konsisten dengan aturan "Fee Agen cuma Owner yang lihat". Admin
// dan Sales tidak tahu daftar agen ini sama sekali.

import {
  dbase, collection, doc, getDocs, setDoc, updateDoc, query, orderBy, where,
  serverTimestamp, catat, tandaBaru,
} from "./db.js?v=3.9.0";
import { bolehAkses } from "./auth.js?v=3.9.0";
import { aman, kabar, rupiah, tanggal, pasangHurufBesar } from "./ui.js?v=3.9.0";

let cache = [];

export async function muatAgen(paksa = false) {
  if (cache.length && !paksa) return cache;
  const snap = await getDocs(
    query(collection(dbase, "agen"), orderBy("nama"))
  );
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

// Dipakai nanti di SPK — cuma agen aktif yang ditawarkan.
export function agenAktif() {
  return cache.filter((a) => a.aktif !== false);
}

export function agenDari(id) {
  return cache.find((a) => a.id === id);
}

function kartuAgen(a, bisaUbah) {
  return `<article class="kartu ${a.aktif === false ? "kartu--batal" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(a.nama)}</h3>
        <p class="kartu-sub mono">ID: ${aman(a.idAgen)}</p>
      </div>
      <span class="tanda ${a.aktif === false ? "tanda--batal" : "tanda--ready"}">
        ${a.aktif === false ? "Nonaktif" : "Aktif"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>NIK</dt><dd class="mono">${aman(a.nik || "-")}</dd></div>
      <div><dt>No. HP</dt><dd class="mono">${aman(a.noHp || "-")}</dd></div>
      <div><dt>Email</dt><dd>${aman(a.email || "-")}</dd></div>
      <div><dt>Alamat</dt><dd>${aman(a.alamat || "-")}</dd></div>
      <div><dt>Rekening</dt><dd class="mono">
        ${a.namaBank ? `${aman(a.namaBank)} · ${aman(a.noRekening || "-")}
          a.n. ${aman(a.namaPemilikRekening || a.nama)}` : "-"}</dd></div>
    </dl>
    <div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-detail="${a.id}">
        Lihat Penjualan &amp; Fee</button>
      ${bisaUbah ? `
        <button class="tombol tombol--kecil" data-ubah="${a.id}">Ubah</button>
        <button class="tombol tombol--kecil" data-status="${a.id}">
          ${a.aktif === false ? "Aktifkan" : "Nonaktifkan"}</button>
      ` : ""}
    </div>
    <div data-wadah-detail="${a.id}"></div>
  </article>`;
}

function formAgen(a = {}) {
  return `<form id="form-agen" class="form">
    <input type="hidden" id="a-id" value="${aman(a.id || "")}">
    <label class="label label--gelap" for="a-idagen">ID Agen</label>
    <input class="isian isian--terang mono" id="a-idagen"
           value="${aman(a.idAgen || "")}" placeholder="AGN-001"
           ${a.id ? "disabled" : ""}>
    <p class="petunjuk">Wajib diisi, dipakai juga nanti sebagai identitas
      login portal agen. ${a.id ? "Tidak bisa diubah setelah dibuat." : ""}</p>

    <label class="label label--gelap" for="a-nama">Nama lengkap</label>
    <input class="isian isian--terang" id="a-nama"
           value="${aman(a.nama || "")}" placeholder="Sesuai KTP">

    <div class="dua">
      <div>
        <label class="label label--gelap" for="a-nik">NIK</label>
        <input class="isian isian--terang mono" id="a-nik"
               inputmode="numeric" value="${aman(a.nik || "")}"
               placeholder="16 digit, sesuai KTP">
      </div>
      <div>
        <label class="label label--gelap" for="a-nohp">No. HP</label>
        <input class="isian isian--terang mono" id="a-nohp"
               inputmode="tel" value="${aman(a.noHp || "")}" placeholder="08…">
      </div>
    </div>

    <div class="dua">
      <div>
        <label class="label label--gelap" for="a-tempatlahir">Tempat lahir</label>
        <input class="isian isian--terang" id="a-tempatlahir"
               value="${aman(a.tempatLahir || "")}" placeholder="Sesuai KTP">
      </div>
      <div>
        <label class="label label--gelap" for="a-tgllahir">Tanggal lahir</label>
        <input class="isian isian--terang" id="a-tgllahir" type="date"
               value="${aman(a.tanggalLahir || "")}">
      </div>
    </div>

    <label class="label label--gelap" for="a-alamat">Alamat</label>
    <input class="isian isian--terang" id="a-alamat"
           value="${aman(a.alamat || "")}" placeholder="Sesuai KTP">

    <label class="label label--gelap" for="a-email">Email</label>
    <input class="isian isian--terang" id="a-email" type="email"
           value="${aman(a.email || "")}"
           placeholder="Dipakai nanti untuk akun login portal agen">

    <p class="pemisah">Rekening untuk Transfer Fee</p>
    <div class="dua">
      <div>
        <label class="label label--gelap" for="a-bank">Nama Bank</label>
        <input class="isian isian--terang" id="a-bank"
               value="${aman(a.namaBank || "")}" placeholder="mis. BCA">
      </div>
      <div>
        <label class="label label--gelap" for="a-rekening">No. Rekening</label>
        <input class="isian isian--terang mono" id="a-rekening"
               inputmode="numeric" value="${aman(a.noRekening || "")}">
      </div>
    </div>
    <label class="label label--gelap" for="a-pemilikrekening">
      Nama Pemilik Rekening (a.n.)</label>
    <input class="isian isian--terang" id="a-pemilikrekening"
           value="${aman(a.namaPemilikRekening || "")}"
           placeholder="Kosongkan kalau sama dengan nama di atas">

    <div class="aksi">
      <button class="tombol tombol--utama" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-agen">Batal</button>
    </div>
  </form>`;
}

// ── Panel detail: penjualan & status pembayaran fee per agen ──────
function kartuFeeSpk(t) {
  const dibayar = t.feeAgenStatus === "sudah_dibayar";
  return `<article class="kartu" style="margin-top:8px">
    <div class="kartu-atas">
      <div>
        <h4 class="kartu-judul mono" style="font-size:14px">${aman(t.spkNo)}</h4>
        <p class="kartu-sub">${aman(t.pembeli?.nama || "-")} ·
          ${aman(t.tipeNama)} ${aman(t.warna || "")}</p>
      </div>
      <span class="tanda ${dibayar ? "tanda--ready" : "tanda--uji"}">
        ${dibayar ? "Sudah Dibayar" : "Belum Dibayar"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>Tanggal SPK</dt><dd>${tanggal(t.dibuatPada)}</dd></div>
      <div><dt>Fee Agen</dt><dd>${rupiah(t.feeAgen)}</dd></div>
      ${dibayar ? `
        <div><dt>Dibayar tanggal</dt><dd>${aman(t.feeAgenTanggalBayar || "-")}</dd></div>
        <div><dt>Via Bank</dt><dd>${aman(t.feeAgenBank || "-")}</dd></div>
        ${t.feeAgenCatatan ? `<div><dt>Catatan</dt><dd>${aman(t.feeAgenCatatan)}</dd></div>` : ""}
      ` : ""}
    </dl>
    ${!dibayar ? `<div data-wadah-bayar-fee="${t.id}"></div>
      <button class="tombol tombol--kecil" data-tandai-bayar="${t.id}">
        Tandai Sudah Dibayar</button>` : ""}
  </article>`;
}

function formBayarFee(id) {
  return `<form id="form-bayar-${id}" class="form" style="margin-top:8px">
    <label class="label label--gelap" for="bf-tanggal-${id}">Tanggal dibayar</label>
    <input class="isian isian--terang" id="bf-tanggal-${id}" type="date"
           value="${new Date().toISOString().slice(0, 10)}">
    <label class="label label--gelap" for="bf-bank-${id}">Via Bank</label>
    <input class="isian isian--terang" id="bf-bank-${id}" placeholder="mis. Transfer BCA">
    <label class="label label--gelap" for="bf-catatan-${id}">Catatan (opsional)</label>
    <input class="isian isian--terang" id="bf-catatan-${id}" placeholder="No. referensi transfer, dsb.">
    <div class="aksi">
      <button class="tombol tombol--kecil tombol--isi" type="submit">Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" type="button"
              id="batal-bayar-${id}">Batal</button>
    </div>
  </form>`;
}


export async function halamanAgen(wadah) {
  const bisaUbah = bolehAkses("kelola.pengguna"); // owner-only, sama seperti Pengguna

  if (!bisaUbah) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Hanya Owner yang bisa melihat Master Agen.</p></div>
    </section>`;
    return;
  }

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Master Agen</h2>
      <button class="tombol tombol--kecil tombol--isi" id="tambah-agen">Tambah</button>
    </div>
    <p class="petunjuk">Data agen penjualan — dipakai nanti sebagai pilihan
      Fee Agen di SPK (cuma terlihat Owner), dan jadi dasar akun login
      portal agen pada tahap berikutnya.</p>
    <div id="form-agen-wadah"></div>
    <div id="daftar-agen" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-agen");
  const formEl = wadah.querySelector("#form-agen-wadah");

  async function gambar() {
    const semua = await muatAgen(true);
    daftarEl.innerHTML = semua.length
      ? semua.map((a) => kartuAgen(a, true)).join("")
      : `<div class="hampa"><p>Belum ada agen terdaftar.</p></div>`;
    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => buka(agenDari(b.dataset.ubah))));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
    daftarEl.querySelectorAll("[data-detail]").forEach((b) =>
      b.addEventListener("click", () => bukaDetail(b.dataset.detail)));
  }

  async function bukaDetail(agenId) {
    const wadahDetail = daftarEl.querySelector(`[data-wadah-detail="${agenId}"]`);
    // Toggle: klik lagi untuk menutup.
    if (wadahDetail.dataset.terbuka === "1") {
      wadahDetail.innerHTML = "";
      wadahDetail.dataset.terbuka = "0";
      return;
    }
    wadahDetail.innerHTML = `<p class="hampa">Memuat…</p>`;
    wadahDetail.dataset.terbuka = "1";
    try {
      const snap = await getDocs(query(
        collection(dbase, "transaksi"), where("agenId", "==", agenId)
      ));
      const daftar = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.status !== "batal")
        .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
      const totalBelumBayar = daftar
        .filter((t) => t.feeAgenStatus !== "sudah_dibayar")
        .reduce((s, t) => s + (t.feeAgen || 0), 0);
      wadahDetail.innerHTML = daftar.length
        ? `${totalBelumBayar > 0 ? `<p class="petunjuk" style="margin-top:8px">
             <b>Total fee belum dibayar: ${rupiah(totalBelumBayar)}</b></p>` : ""}
           ${daftar.map(kartuFeeSpk).join("")}`
        : `<p class="hampa" style="margin-top:8px">Belum ada SPK yang
           membawa agen ini.</p>`;
      wadahDetail.querySelectorAll("[data-tandai-bayar]").forEach((b) =>
        b.addEventListener("click", () => {
          const target = wadahDetail.querySelector(
            `[data-wadah-bayar-fee="${b.dataset.tandaiBayar}"]`);
          bukaFormBayar(target, b.dataset.tandaiBayar, agenId);
        }));
    } catch (err) {
      wadahDetail.innerHTML = `<p class="hampa">Gagal memuat: ${aman(err.message)}</p>`;
    }
  }

  function bukaFormBayar(target, transaksiId, agenId) {
    target.innerHTML = formBayarFee(transaksiId);
    target.querySelector(`#batal-bayar-${transaksiId}`)
      .addEventListener("click", () => (target.innerHTML = ""));
    target.querySelector(`#form-bayar-${transaksiId}`)
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const tgl = target.querySelector(`#bf-tanggal-${transaksiId}`).value;
        const bank = target.querySelector(`#bf-bank-${transaksiId}`).value.trim();
        const catatan = target.querySelector(`#bf-catatan-${transaksiId}`).value.trim();
        if (!tgl || !bank) {
          kabar("Tanggal dan Bank wajib diisi.", "rem");
          return;
        }
        try {
          await updateDoc(doc(dbase, "transaksi", transaksiId), {
            feeAgenStatus: "sudah_dibayar",
            feeAgenTanggalBayar: tgl,
            feeAgenBank: bank,
            feeAgenCatatan: catatan,
          });
          await catat("fee_agen_dibayar", {
            koleksi: "transaksi", docId: transaksiId, ringkas: `${bank} · ${tgl}`,
          });
          kabar("Fee agen ditandai sudah dibayar.", "netral");
          const wadahDetail = daftarEl.querySelector(`[data-wadah-detail="${agenId}"]`);
          wadahDetail.dataset.terbuka = "0";
          await bukaDetail(agenId);
        } catch (err) {
          kabar("Gagal menyimpan: " + err.message, "rem");
        }
      });
  }

  function buka(a) {
    formEl.innerHTML = formAgen(a || {});
    pasangHurufBesar(formEl.querySelector("#a-nama"));
    formEl.querySelector("#batal-agen")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#form-agen").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = formEl.querySelector("#a-id").value;
      const idAgen = formEl.querySelector("#a-idagen").value.trim();
      const nama = formEl.querySelector("#a-nama").value.trim();
      const nik = formEl.querySelector("#a-nik").value.trim();
      const noHp = formEl.querySelector("#a-nohp").value.trim();
      const email = formEl.querySelector("#a-email").value.trim();
      const tempatLahir = formEl.querySelector("#a-tempatlahir").value.trim();
      const tanggalLahir = formEl.querySelector("#a-tgllahir").value || null;
      const alamat = formEl.querySelector("#a-alamat").value.trim();
      const namaBank = formEl.querySelector("#a-bank").value.trim();
      const noRekening = formEl.querySelector("#a-rekening").value.trim();
      const namaPemilikRekening = formEl.querySelector("#a-pemilikrekening").value.trim();
      if (!idAgen || !nama || !nik || !noHp) {
        kabar("ID Agen, Nama, NIK, dan No. HP wajib diisi.", "rem");
        return;
      }
      // ID Agen harus unik — cek dulu sebelum disimpan (cuma perlu
      // dicek saat menambah baru; yang sudah ada tidak bisa diubah
      // ID-nya lagi, lihat atribut disabled di formAgen()).
      if (!id) {
        const bentrok = (await muatAgen()).some(
          (a) => a.idAgen.toLowerCase() === idAgen.toLowerCase());
        if (bentrok) {
          kabar("ID Agen ini sudah dipakai agen lain.", "rem");
          return;
        }
      }
      const data = {
        idAgen, nama, nik, noHp, email,
        tempatLahir, tanggalLahir, alamat,
        namaBank, noRekening, namaPemilikRekening,
        aktif: a && a.id ? a.aktif !== false : true,
        diubahPada: serverTimestamp(),
      };
      try {
        const ref = id ? doc(dbase, "agen", id) : doc(collection(dbase, "agen"));
        if (!id) Object.assign(data, tandaBaru());
        await setDoc(ref, data, { merge: true });
        await catat(id ? "agen_diubah" : "agen_ditambah", {
          koleksi: "agen", docId: ref.id, ringkas: `${idAgen} · ${nama}`,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar(id ? "Agen diperbarui." : "Agen ditambahkan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahStatus(id) {
    const a = agenDari(id);
    try {
      await updateDoc(doc(dbase, "agen", id), { aktif: a.aktif === false });
      await catat("agen_status_diubah", { koleksi: "agen", docId: id });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  wadah.querySelector("#tambah-agen").addEventListener("click", () => buka(null));
  await gambar();
}

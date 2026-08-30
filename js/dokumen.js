// dokumen.js — Tracking Dokumen Kendaraan (STNK/BPKB/Plat & serah
// terima berkas ke Biro Jasa).
//
// TAHAP 2 (sekarang): alur serah-terima BERKAS AWAL (KTP + Faktur)
// dari Admin ke Biro Jasa — serahkan, batalkan (sebelum konfirmasi),
// konfirmasi terima (Biro Jasa), tarik kembali (sesudah konfirmasi).
// TAHAP 3 (menyusul): serah-terima dokumen JADI (STNK/BPKB/Plat)
// dari Biro Jasa balik ke Admin.
//
// Satu dokumen tracking per SPK, ID-nya SAMA PERSIS dengan ID
// dokumen SPK-nya di "transaksi" — gampang dicari-silang.

import { dbase, collection, doc, getDocs, setDoc, updateDoc, query, where,
  serverTimestamp, catat } from "./db.js?v=3.10.2";
import { sesi, bolehAkses, konfirmasiPassword } from "./auth.js?v=3.10.2";
import { aman, tanggal, kabar } from "./ui.js?v=3.10.2";
import { konfirmasi, tanya } from "./dialog.js?v=3.10.2";
import { muatBiro, biroAktif } from "./biro.js?v=3.10.2";
import { cetakBastBerkas } from "./cetak.js?v=3.10.2";
import { SHOWROOM } from "./config.js?v=3.10.2";
import { muatRiwayatDokumen, htmlRiwayatDokumen } from "./log.js?v=3.10.2";

export const LABEL_BERKAS = {
  belum_diserahkan: "Belum Diserahkan",
  diserahkan: "Menunggu Konfirmasi Biro Jasa",
  dikonfirmasi: "Diterima Biro Jasa",
  ditarik_kembali: "Ditarik Kembali",
};
export const LABEL_DOKUMEN = {
  belum: "Belum Dikerjakan",
  diproses: "Sedang Diproses",
  selesai: "Selesai — Menunggu Diserahkan",
  diserahkan: "Menunggu Konfirmasi Admin",
  dikonfirmasi: "Diterima Admin",
};
const WARNA_BERKAS = {
  belum_diserahkan: "batal", diserahkan: "booked",
  dikonfirmasi: "ready", ditarik_kembali: "belum",
};

function dataDefault(t) {
  return {
    id: t.id, transaksiId: t.id, spkNo: t.spkNo,
    pembeliNama: t.pembeli?.nama || "-",
    tipeNama: t.tipeNama, warna: t.warna,
    biroJasaId: null, biroJasaNama: null,
    berkasStatus: "belum_diserahkan",
    stnkStatus: "belum", bpkbStatus: "belum", platStatus: "belum",
  };
}

// Dipakai dua kali (Owner/Admin lihat semua yang boleh, Biro Jasa
// cuma lihat yang ditugaskan ke mereka) — pembedanya sudah
// ditegakkan di firestore.rules, jadi query di sini SENGAJA tidak
// pakai where() tambahan buat Owner/Admin (mereka boleh lihat semua),
// TAPI Biro Jasa WAJIB pakai where("biroJasaId","==",...) — bukan
// cuma soal privasi, tapi Firestore memang MENOLAK TOTAL query
// daftar tanpa where() kalau rule-nya bergantung pada field spesifik
// begini (lihat catatan panjang di firestore.rules).
async function muatDaftar() {
  const qTransaksi = sesi.peran === "biro_jasa"
    ? query(collection(dbase, "transaksi"), where("biroJasaId", "==", sesi.biroJasaId))
    : collection(dbase, "transaksi");
  const snapT = await getDocs(qTransaksi);
  const semuaTransaksi = snapT.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.status !== "batal")
    .sort((a, b) => (b.spkNo || "").localeCompare(a.spkNo || ""));

  const snapD = await getDocs(sesi.peran === "biro_jasa"
    ? query(collection(dbase, "dokumen_kendaraan"), where("biroJasaId", "==", sesi.biroJasaId))
    : collection(dbase, "dokumen_kendaraan"));
  const petaDok = new Map(snapD.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  return semuaTransaksi.map((t) => ({ t, dok: petaDok.get(t.id) || dataDefault(t) }));
}

export async function halamanDokumen(wadah) {
  const bisaAksiAdmin = bolehAkses("dokumen.konfirmasi") && sesi.peran !== "biro_jasa";
  const bisaAksiBiro = sesi.peran === "biro_jasa";

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">Tracking Dokumen Kendaraan</h2></div>
    <div id="d-filter" class="tiga" style="margin-bottom:12px">
      <button class="tombol tombol--kecil tombol--isi" data-filter="semua">Semua</button>
      <button class="tombol tombol--kecil" data-filter="belum_diserahkan">Belum Diserahkan</button>
      <button class="tombol tombol--kecil" data-filter="diserahkan">Menunggu Konfirmasi</button>
      <button class="tombol tombol--kecil" data-filter="dikonfirmasi">Sudah di Biro Jasa</button>
    </div>
    <div id="d-daftar" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#d-daftar");
  let semuaData = [];
  let filterAktif = "semua";

  await muatBiro();

  function baris({ t, dok }) {
    return `<article class="kartu">
      <div class="kartu-atas">
        <div>
          <h3 class="kartu-judul">${aman(t.spkNo)}</h3>
          <p class="kartu-sub">${aman(t.pembeli?.nama || "-")} — ${aman(t.tipeNama)} · ${aman(t.warna)}</p>
        </div>
        <span class="tanda tanda--${WARNA_BERKAS[dok.berkasStatus] || "netral"}">
          ${LABEL_BERKAS[dok.berkasStatus] || dok.berkasStatus}
        </span>
      </div>
      <dl class="rinci">
        <div><dt>Biro Jasa</dt><dd>${aman(dok.biroJasaNama || "— belum ditugaskan —")}</dd></div>
        ${dok.berkasDiserahkanPada ? `<div><dt>Diserahkan</dt>
          <dd>${tanggal(dok.berkasDiserahkanPada)} oleh ${aman(dok.berkasDiserahkanOlehNama)}</dd></div>` : ""}
        ${dok.berkasDikonfirmasiPada ? `<div><dt>Dikonfirmasi</dt>
          <dd>${tanggal(dok.berkasDikonfirmasiPada)}</dd></div>` : ""}
        ${dok.berkasDitarikPada ? `<div><dt>Ditarik Kembali</dt>
          <dd>${tanggal(dok.berkasDitarikPada)} — ${aman(dok.berkasDitarikAlasan)}</dd></div>` : ""}
      </dl>
      <div class="aksi aksi--rapat" data-aksi-wadah="${t.id}"></div>
      <div data-log-wadah="${t.id}"></div>
    </article>`;
  }

  function pasangAksi(t, dok, wadahAksi) {
    const tombol = [];
    if (bisaAksiAdmin) {
      if (dok.berkasStatus === "belum_diserahkan" || dok.berkasStatus === "ditarik_kembali") {
        tombol.push(`<button class="tombol tombol--kecil tombol--isi" data-serahkan="${t.id}">
          Serahkan ke Biro Jasa</button>`);
      }
      if (dok.berkasStatus === "diserahkan") {
        tombol.push(`<button class="tombol tombol--kecil" data-batalkan="${t.id}">
          Batalkan (Belum Dikonfirmasi)</button>`);
      }
      if (dok.berkasStatus === "dikonfirmasi") {
        tombol.push(`<button class="tombol tombol--kecil tombol--bahaya" data-tarik="${t.id}">
          Tarik Kembali</button>`);
        tombol.push(`<button class="tombol tombol--kecil" data-cetak-bast="${t.id}">
          Cetak BAST</button>`);
      }
    }
    if (bisaAksiBiro && dok.biroJasaId === sesi.biroJasaId) {
      if (dok.berkasStatus === "diserahkan") {
        tombol.push(`<button class="tombol tombol--kecil tombol--isi" data-konfirmasi="${t.id}">
          Konfirmasi Terima Berkas</button>`);
      }
      if (dok.berkasStatus === "dikonfirmasi") {
        tombol.push(`<button class="tombol tombol--kecil" data-cetak-bast="${t.id}">
          Cetak BAST</button>`);
      }
    }
    wadahAksi.innerHTML = tombol.join("");

    const btnSerahkan = wadahAksi.querySelector(`[data-serahkan]`);
    if (btnSerahkan) btnSerahkan.addEventListener("click", () => aksiSerahkan(t, dok, wadahAksi));
    const btnBatalkan = wadahAksi.querySelector(`[data-batalkan]`);
    if (btnBatalkan) btnBatalkan.addEventListener("click", () => aksiBatalkan(t, dok));
    const btnKonfirmasi = wadahAksi.querySelector(`[data-konfirmasi]`);
    if (btnKonfirmasi) btnKonfirmasi.addEventListener("click", () => aksiKonfirmasi(t, dok));
    const btnTarik = wadahAksi.querySelector(`[data-tarik]`);
    if (btnTarik) btnTarik.addEventListener("click", () => aksiTarikKembali(t, dok));
    const btnCetak = wadahAksi.querySelector(`[data-cetak-bast]`);
    if (btnCetak) btnCetak.addEventListener("click", () => cetakBastBerkas(t, dok));
  }

  async function gambarUlang() {
    const dataTampil = filterAktif === "semua"
      ? semuaData : semuaData.filter((x) => x.dok.berkasStatus === filterAktif);
    daftarEl.innerHTML = dataTampil.length
      ? dataTampil.map(baris).join("")
      : `<div class="hampa"><p>Tidak ada SPK di kategori ini.</p></div>`;
    dataTampil.forEach(({ t, dok }) => {
      const wadahAksi = daftarEl.querySelector(`[data-aksi-wadah="${t.id}"]`);
      if (wadahAksi) pasangAksi(t, dok, wadahAksi);
      const wadahLog = daftarEl.querySelector(`[data-log-wadah="${t.id}"]`);
      if (wadahLog) {
        muatRiwayatDokumen("dokumen_kendaraan", t.id, 8).then((riw) => {
          wadahLog.innerHTML = htmlRiwayatDokumen(riw);
        });
      }
    });
  }

  async function muat() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    semuaData = await muatDaftar();
    await gambarUlang();
  }

  wadah.querySelectorAll("[data-filter]").forEach((b) => {
    b.addEventListener("click", () => {
      filterAktif = b.dataset.filter;
      wadah.querySelectorAll("[data-filter]").forEach((x) =>
        x.classList.toggle("tombol--isi", x === b));
      gambarUlang();
    });
  });

  // ── Aksi: Serahkan ke Biro Jasa ─────────────────────────────
  // Pilih Biro Jasa lewat dropdown beneran (bukan ketik nama) —
  // form kecil disisipkan langsung di kartunya, mirip pola "Buat
  // Akses Login" di halaman Master Biro Jasa.
  function aksiSerahkan(t, dok, wadahAksi) {
    const daftarBiro = biroAktif();
    if (!daftarBiro.length) {
      kabar("Belum ada Biro Jasa aktif di Master Biro Jasa.", "rem");
      return;
    }
    const wadahForm = document.createElement("div");
    wadahAksi.insertAdjacentElement("afterend", wadahForm);
    wadahForm.innerHTML = `<form id="form-serahkan-${t.id}" class="form" style="margin-top:8px">
      <p class="petunjuk">Serahkan berkas (KTP + Faktur) SPK <b>${aman(t.spkNo)}</b>
        — ${aman(t.pembeli?.nama || "-")} ke Biro Jasa mana?</p>
      <label class="label label--gelap" for="sb-biro-${t.id}">Biro Jasa</label>
      <select class="isian isian--terang" id="sb-biro-${t.id}">
        <option value="">— pilih —</option>
        ${daftarBiro.map((b) => `<option value="${b.id}">${aman(b.nama)}</option>`).join("")}
      </select>
      <div class="aksi">
        <button class="tombol tombol--kecil tombol--isi" type="submit">Lanjut</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-serahkan-${t.id}">Batal</button>
      </div>
    </form>`;
    wadahForm.querySelector(`#batal-serahkan-${t.id}`)
      .addEventListener("click", () => wadahForm.remove());
    wadahForm.querySelector(`#form-serahkan-${t.id}`).addEventListener("submit", async (e) => {
      e.preventDefault();
      const idBiro = wadahForm.querySelector(`#sb-biro-${t.id}`).value;
      if (!idBiro) { kabar("Pilih Biro Jasa dulu.", "rem"); return; }
      const biro = daftarBiro.find((b) => b.id === idBiro);

      const lanjut = await konfirmasi({
        judul: "Konfirmasi Serah Berkas",
        pesan: `Menyerahkan berkas (KTP + Faktur) SPK ${t.spkNo} — ` +
               `${t.pembeli?.nama || "-"} ke Biro Jasa ${biro.nama}. Yakin?`,
        oke: "Ya, Serahkan",
      });
      if (!lanjut) return;
      const password = await tanya({
        judul: "Konfirmasi Password", pesan: "Masukkan password Anda.",
        petunjuk: "Password", tipeIsian: "password",
      });
      if (password === null) return;
      try {
        await konfirmasiPassword(password);
        await setDoc(doc(dbase, "dokumen_kendaraan", t.id), {
          ...dataDefault(t),
          biroJasaId: biro.id, biroJasaNama: biro.nama,
          berkasStatus: "diserahkan",
          berkasDiserahkanPada: serverTimestamp(),
          berkasDiserahkanOleh: sesi.uid, berkasDiserahkanOlehNama: sesi.nama,
        }, { merge: true });
        // biroJasaId JUGA disimpan langsung di dokumen transaksi-nya
        // (didobel, bukan cuma di dokumen_kendaraan) — supaya query
        // daftar SPK Biro Jasa bisa pakai where() yang valid, lihat
        // catatan di firestore.rules.
        await updateDoc(doc(dbase, "transaksi", t.id), {
          biroJasaId: biro.id, biroJasaNama: biro.nama,
        });
        await catat("berkas_diserahkan_biro", {
          koleksi: "dokumen_kendaraan", docId: t.id,
          ringkas: `${t.spkNo} · diserahkan ke ${biro.nama}`,
        });
        kabar("Berkas ditandai diserahkan. Menunggu konfirmasi Biro Jasa.", "netral");
        await muat();
      } catch (err) {
        kabar("Gagal: " + (["auth/wrong-password", "auth/invalid-credential"].includes(err.code)
          ? "Password salah." : err.message), "rem");
      }
    });
  }

  // ── Aksi: Batalkan (sebelum dikonfirmasi Biro Jasa) ─────────
  async function aksiBatalkan(t) {
    const alasan = await tanya({
      judul: "Batalkan Serah Berkas",
      pesan: `SPK ${t.spkNo} akan dikembalikan ke "Belum Diserahkan". ` +
             `Wajib isi alasan.`,
      petunjuk: "mis. Salah pilih Biro Jasa",
    });
    if (alasan === null) return;
    if (!alasan.trim()) { kabar("Alasan wajib diisi.", "rem"); return; }
    const password = await tanya({
      judul: "Konfirmasi Password", pesan: "Masukkan password Anda.",
      petunjuk: "Password", tipeIsian: "password",
    });
    if (password === null) return;
    try {
      await konfirmasiPassword(password);
      await updateDoc(doc(dbase, "dokumen_kendaraan", t.id), {
        berkasStatus: "belum_diserahkan",
        biroJasaId: null, biroJasaNama: null,
      });
      await updateDoc(doc(dbase, "transaksi", t.id), {
        biroJasaId: null, biroJasaNama: null,
      });
      await catat("berkas_batal_serah", {
        koleksi: "dokumen_kendaraan", docId: t.id,
        ringkas: `${t.spkNo} · dibatalkan sebelum dikonfirmasi · Alasan: ${alasan.trim()}`,
      });
      kabar("Serah berkas dibatalkan.", "netral");
      await muat();
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  // ── Aksi: Konfirmasi Terima (Biro Jasa) ─────────────────────
  async function aksiKonfirmasi(t, dok) {
    const lanjut = await konfirmasi({
      judul: "Konfirmasi Terima Berkas",
      pesan: `Anda mengonfirmasi telah menerima berkas (KTP + Faktur) ` +
             `untuk SPK ${t.spkNo} — ${t.pembeli?.nama || "-"} dari ${aman(SHOWROOM.nama)}.`,
      oke: "Ya, Sudah Terima",
    });
    if (!lanjut) return;
    const password = await tanya({
      judul: "Konfirmasi Password", pesan: "Masukkan password Anda.",
      petunjuk: "Password", tipeIsian: "password",
    });
    if (password === null) return;
    try {
      await konfirmasiPassword(password);
      await updateDoc(doc(dbase, "dokumen_kendaraan", t.id), {
        berkasStatus: "dikonfirmasi",
        berkasDikonfirmasiPada: serverTimestamp(),
        berkasDikonfirmasiOleh: sesi.uid, berkasDikonfirmasiOlehNama: sesi.nama,
      });
      await catat("berkas_dikonfirmasi_biro", {
        koleksi: "dokumen_kendaraan", docId: t.id, ringkas: `${t.spkNo} · dikonfirmasi diterima`,
      });
      kabar("Konfirmasi tersimpan. Mencetak BAST…", "netral");
      const dokTerbaru = { ...dok, berkasStatus: "dikonfirmasi",
        berkasDikonfirmasiPada: new Date() };
      await cetakBastBerkas(t, dokTerbaru);
      await muat();
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  // ── Aksi: Tarik Kembali (sesudah dikonfirmasi) ──────────────
  async function aksiTarikKembali(t, dok) {
    const alasan = await tanya({
      judul: "⚠️ Tarik Kembali Berkas",
      pesan: `Berkas SPK ${t.spkNo} sudah DIKONFIRMASI DITERIMA oleh ` +
             `${dok.biroJasaNama}. "Tarik Kembali" cuma mencatat status di ` +
             `sistem — pastikan berkas FISIKNYA memang benar-benar sudah ` +
             `diambil kembali dari Biro Jasa. Wajib isi alasan.`,
      petunjuk: "mis. Batal urus dokumen, dialihkan ke Biro Jasa lain",
    });
    if (alasan === null) return;
    if (!alasan.trim()) { kabar("Alasan wajib diisi.", "rem"); return; }
    const password = await tanya({
      judul: "Konfirmasi Password", pesan: "Masukkan password Anda.",
      petunjuk: "Password", tipeIsian: "password",
    });
    if (password === null) return;
    try {
      await konfirmasiPassword(password);
      await updateDoc(doc(dbase, "dokumen_kendaraan", t.id), {
        berkasStatus: "ditarik_kembali",
        berkasDitarikPada: serverTimestamp(),
        berkasDitarikOleh: sesi.uid, berkasDitarikOlehNama: sesi.nama,
        berkasDitarikAlasan: alasan.trim(),
      });
      await catat("berkas_ditarik_kembali", {
        koleksi: "dokumen_kendaraan", docId: t.id,
        ringkas: `${t.spkNo} · ditarik dari ${dok.biroJasaNama} · Alasan: ${alasan.trim()}`,
      });
      kabar("Berkas ditandai ditarik kembali.", "netral");
      await muat();
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  await muat();
}

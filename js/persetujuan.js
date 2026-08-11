// persetujuan.js — Owner menyetujui atau menolak pengajuan
// perubahan data Pembeli/Pemakai yang dikirim Sales/Admin lewat
// spk.js (pasangEditPelangganSpk). Perubahan BARU benar-benar
// masuk ke SPK begitu Owner klik Setujui — sebelum itu, SPK-nya
// tidak berubah sama sekali.

import {
  dbase, doc, collection, getDoc, getDocs, updateDoc, query, where,
  writeBatch, catat, sertakanLog, serverTimestamp, increment,
} from "./db.js?v=3.5.0";
import { bolehAkses, konfirmasiPassword, sesi } from "./auth.js?v=3.5.0";
import { simpanPelangganOtomatis } from "./pelanggan.js?v=3.5.0";
import { terapkanPerubahanUnit } from "./stok.js?v=3.5.0";
import { hitungTotalDibayar } from "./cetak.js?v=3.5.0";
import { buatNotifikasi } from "./notifikasi.js?v=3.5.0";
import { tanya, konfirmasi } from "./dialog.js?v=3.5.0";
import { aman, kabar, tanggalJam, namaTampilan } from "./ui.js?v=3.5.0";

const LABEL_JENIS = {
  pelanggan_spk: "Perubahan Data Pembeli/Pemakai",
  cashback_spk: "Pengajuan Cashback",
  diskon_spk: "Pengajuan Diskon Melebihi Batas",
  unit_diubah: "Perubahan Data Unit",
  batal_spk: "Pengajuan Pembatalan SPK",
};

function kartuPengajuan(p) {
  const judul = p.spkNo || (p.jenis === "unit_diubah"
    ? `Unit ${p.dataBaru?.noRangka || "-"}` : "-");
  return `<article class="kartu">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(judul)}</h3>
        <p class="kartu-sub">${aman(LABEL_JENIS[p.jenis] || p.jenis)} ·
          diajukan oleh ${aman(namaTampilan(p.diajukanOlehPeran, p.diajukanOlehNama))}
          · ${tanggalJam(p.dibuatPada)}</p>
      </div>
      <span class="tanda tanda--uji">Menunggu</span>
    </div>
    <pre style="white-space:pre-wrap;font-size:12.5px;background:var(--lapis);
                padding:8px;border-radius:6px;margin:8px 0">${aman(p.catatan)}</pre>
    <div class="aksi aksi--rapat">
      <button class="tombol tombol--utama" data-setuju="${p.id}">Setujui</button>
      <button class="tombol tombol--sunyi tombol--gelap" data-tolak="${p.id}">Tolak</button>
    </div>
  </article>`;
}

export async function halamanPersetujuan(wadah) {
  if (!bolehAkses("kelola.pengguna")) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Hanya Owner yang bisa memproses persetujuan
        perubahan.</p></div>
    </section>`;
    return;
  }

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">Persetujuan Perubahan</h2></div>
    <p class="petunjuk">Pengajuan perubahan data Pembeli/Pemakai dari Sales
      atau Admin menunggu di sini. Menyetujui perlu konfirmasi password
      Anda, dan tercatat di Log Aktivitas.</p>
    <div id="daftar-pengajuan" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-pengajuan");
  let data = [];

  async function muat() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    try {
      // Tanpa orderBy di query — supaya tidak butuh index gabungan
      // di Firestore. Diurutkan di sini saja, di sisi aplikasi;
      // jumlah pengajuan yang menunggu biasanya kecil, jadi ringan.
      const snap = await getDocs(query(
        collection(dbase, "pengajuan"),
        where("status", "==", "menunggu")
      ));
      data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
    } catch (err) {
      daftarEl.innerHTML = `<div class="hampa"><p>Gagal memuat: ${
        aman(err.message)}</p></div>`;
      return;
    }

    daftarEl.innerHTML = data.length
      ? data.map(kartuPengajuan).join("")
      : `<div class="hampa"><p>Tidak ada pengajuan yang menunggu.</p></div>`;

    daftarEl.querySelectorAll("[data-setuju]").forEach((b) =>
      b.addEventListener("click", () => setujui(b.dataset.setuju)));
    daftarEl.querySelectorAll("[data-tolak]").forEach((b) =>
      b.addEventListener("click", () => tolak(b.dataset.tolak)));
  }

  async function setujui(id) {
    const p = data.find((x) => x.id === id);
    if (!p) return;

    const label = p.jenis === "unit_diubah" ? `unit ${p.dataBaru?.noRangka || ""}`
      : `SPK ${p.spkNo}`;
    const password = await tanya({
      judul: "Konfirmasi persetujuan",
      pesan: `Masukkan password Anda untuk menyetujui perubahan pada ${label}.`,
      petunjuk: "Password",
      tipeIsian: "password",
    });
    if (password === null) return; // dibatalkan

    try {
      await konfirmasiPassword(password);
    } catch {
      kabar("Password salah. Persetujuan dibatalkan.", "rem");
      return;
    }

    try {
      if (p.jenis === "unit_diubah") {
        // Fungsi ini punya batch & transaksi sendiri (jaga rangka
        // unik), jadi dijalankan terpisah — bukan digabung ke satu
        // batch seperti dua jenis lain.
        const snapUnit = await getDoc(doc(dbase, "units", p.unitId));
        if (!snapUnit.exists()) throw new Error("Unit ini sudah tidak ada.");
        const unitSekarang = { id: p.unitId, ...snapUnit.data() };
        await terapkanPerubahanUnit(unitSekarang, p.dataBaru);
        await updateDoc(doc(dbase, "pengajuan", p.id), { status: "disetujui" });
        await catat("perubahan_unit_disetujui", {
          koleksi: "units", docId: p.unitId,
          ringkas: p.dataBaru?.noRangka || "-",
        });
      } else if (p.jenis === "batal_spk") {
        // Cek ulang statusnya SAAT INI (bisa saja berubah sejak
        // pengajuan dikirim, mis. sudah keburu dibayar lunas) —
        // jangan cuma percaya kondisi waktu diajukan dulu.
        const snapTrx = await getDoc(doc(dbase, "transaksi", p.transaksiId));
        if (!snapTrx.exists()) throw new Error("SPK ini sudah tidak ada.");
        const trx = { id: p.transaksiId, ...snapTrx.data() };
        if (trx.status === "batal") throw new Error("SPK ini sudah dibatalkan.");
        const totalDibayar = hitungTotalDibayar(trx);
        const lunas = (trx.hargaOtr || 0) > 0 && totalDibayar >= (trx.hargaOtr || 0);
        if (lunas) {
          throw new Error("SPK ini sudah Lunas sejak pengajuan dikirim — " +
            "tidak bisa dibatalkan lewat sistem lagi.");
        }

        const batch = writeBatch(dbase);
        batch.update(doc(dbase, "transaksi", p.transaksiId), {
          status: "batal",
          alasanBatal: p.dataBaru?.alasan || "-",
          dibatalkanPada: serverTimestamp(),
          dibatalkanOleh: sesi.uid,
        });
        if (trx.unitId) {
          const snapUnit = await getDoc(doc(dbase, "units", trx.unitId));
          if (snapUnit.exists() && snapUnit.data().status === "booked") {
            batch.update(doc(dbase, "units", trx.unitId), {
              status: "ready", spkId: null,
            });
            batch.update(doc(dbase, "tipe_motor", trx.tipeId), {
              jumlahReady: increment(1),
            });
          }
        }
        batch.update(doc(dbase, "pengajuan", p.id), { status: "disetujui" });
        sertakanLog(batch, "spk_dibatalkan", {
          koleksi: "transaksi", docId: p.transaksiId,
          ringkas: `${p.spkNo} · ${p.dataBaru?.alasan || "-"}`,
        });
        await batch.commit();
      } else {
        const batch = writeBatch(dbase);

        if (p.jenis === "cashback_spk") {
          batch.update(doc(dbase, "transaksi", p.transaksiId), {
            cashbackDisetujui: p.dataBaru.cashback,
            cashbackStatus: "disetujui",
          });
          sertakanLog(batch, "cashback_disetujui", {
            koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
          });
        } else if (p.jenis === "diskon_spk") {
          batch.update(doc(dbase, "transaksi", p.transaksiId), {
            diskon: p.dataBaru.diskon,
            diskonStatus: "disetujui",
          });
          sertakanLog(batch, "diskon_disetujui", {
            koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
          });
        } else {
          // pelanggan_spk (bawaan): ubah data pembeli/pemakai
          const { pembeli, pemakai, pemakaiSamaDenganPembeli } = p.dataBaru;
          const pembeliId = await simpanPelangganOtomatis(pembeli);
          const pemakaiId = pemakaiSamaDenganPembeli
            ? pembeliId
            : await simpanPelangganOtomatis(pemakai);
          batch.update(doc(dbase, "transaksi", p.transaksiId), {
            pembeli, pembeliId,
            pemakaiSamaDenganPembeli,
            pemakai: pemakaiSamaDenganPembeli ? null : pemakai,
            pemakaiId,
          });
          sertakanLog(batch, "perubahan_spk_disetujui", {
            koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
          });
        }

        batch.update(doc(dbase, "pengajuan", p.id), { status: "disetujui" });
        await batch.commit();
      }

      kabar(`Pengajuan untuk ${label} disetujui & tersimpan.`, "netral");
      const linkNotif = p.jenis === "unit_diubah" ? "#/stok"
        : (p.jenis === "cashback_spk" ? "#/laporan" : "#/laporan");
      await buatNotifikasi(p.diajukanOlehUid, "Pengajuan Disetujui",
        `Pengajuan Anda untuk ${label} sudah disetujui Owner.`, linkNotif);
      // Riwayat buat Owner sendiri juga — supaya keputusan yang sudah
      // diambil tetap tercatat & terlihat di Inbox-nya sendiri, tidak
      // cuma satu arah ke pemohon.
      if (sesi.uid !== p.diajukanOlehUid) {
        await buatNotifikasi(sesi.uid, "Anda Menyetujui Pengajuan",
          `${p.diajukanOlehNama} — ${LABEL_JENIS[p.jenis] || p.jenis} ` +
          `untuk ${label}. Sudah Anda setujui.`, linkNotif);
      }
      await muat();
    } catch (err) {
      kabar("Gagal menyetujui: " + err.message, "rem");
    }
  }

  async function tolak(id) {
    const p = data.find((x) => x.id === id);
    if (!p) return;
    const label = p.jenis === "unit_diubah" ? `unit ${p.dataBaru?.noRangka || ""}`
      : `SPK ${p.spkNo}`;
    const yakin = await konfirmasi({
      judul: "Tolak pengajuan?",
      pesan: `Pengajuan untuk ${label} akan ditolak. Datanya tidak berubah sama sekali.`,
      oke: "Tolak", bahaya: true,
    });
    if (!yakin) return;

    try {
      const batch = writeBatch(dbase);
      batch.update(doc(dbase, "pengajuan", id), { status: "ditolak" });
      if (p.jenis === "cashback_spk") {
        batch.update(doc(dbase, "transaksi", p.transaksiId), {
          cashbackStatus: "ditolak",
        });
        sertakanLog(batch, "cashback_ditolak", {
          koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
        });
      } else if (p.jenis === "diskon_spk") {
        batch.update(doc(dbase, "transaksi", p.transaksiId), {
          diskonStatus: "ditolak",
        });
        sertakanLog(batch, "diskon_ditolak", {
          koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
        });
      } else if (p.jenis === "batal_spk") {
        // Ditolak = SPK-nya TIDAK berubah sama sekali, cuma
        // pengajuannya yang ditandai selesai.
        sertakanLog(batch, "batal_spk_ditolak", {
          koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
        });
      } else if (p.jenis === "unit_diubah") {
        sertakanLog(batch, "perubahan_unit_ditolak", {
          koleksi: "units", docId: p.unitId, ringkas: p.dataBaru?.noRangka || "-",
        });
      } else {
        sertakanLog(batch, "perubahan_spk_ditolak", {
          koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
        });
      }
      await batch.commit();
      kabar("Pengajuan ditolak.", "netral");
      const linkTolak = p.jenis === "unit_diubah" ? "#/stok" : "#/laporan";
      await buatNotifikasi(p.diajukanOlehUid, "Pengajuan Ditolak",
        `Pengajuan Anda untuk ${label} ditolak Owner.`, linkTolak);
      if (sesi.uid !== p.diajukanOlehUid) {
        await buatNotifikasi(sesi.uid, "Anda Menolak Pengajuan",
          `${p.diajukanOlehNama} — ${LABEL_JENIS[p.jenis] || p.jenis} ` +
          `untuk ${label}. Sudah Anda tolak.`, linkTolak);
      }
      await muat();
    } catch (err) {
      kabar("Gagal menolak: " + err.message, "rem");
    }
  }

  await muat();
}

// ── Riwayat Pengajuan Saya ─────────────────────────────────────
// Kebalikan dari halamanPersetujuan di atas: ini buat SIAPA SAJA
// yang login (Sales/Admin/Owner) lihat riwayat pengajuan yang MEREKA
// SENDIRI ajukan — menunggu, disetujui, atau ditolak. Read-only,
// tidak ada tombol Setujui/Tolak (itu cuma tanggung jawab Owner di
// halamanPersetujuan).
const TANDA_STATUS = {
  menunggu: "tanda--uji", disetujui: "tanda--ready", ditolak: "tanda--batal",
};
const LABEL_STATUS = {
  menunggu: "Menunggu", disetujui: "Disetujui", ditolak: "Ditolak",
};

function kartuPengajuanSaya(p, tampilkanPemohon) {
  const judul = p.spkNo || (p.jenis === "unit_diubah"
    ? `Unit ${p.dataBaru?.noRangka || "-"}` : "-");
  return `<article class="kartu">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(judul)}</h3>
        <p class="kartu-sub">${aman(LABEL_JENIS[p.jenis] || p.jenis)}
          ${tampilkanPemohon ? ` · diajukan oleh
            ${aman(namaTampilan(p.diajukanOlehPeran, p.diajukanOlehNama))}` : ""}
          · ${tanggalJam(p.dibuatPada)}</p>
      </div>
      <span class="tanda ${TANDA_STATUS[p.status] || ""}">
        ${LABEL_STATUS[p.status] || p.status}
      </span>
    </div>
    <pre style="white-space:pre-wrap;font-size:12.5px;background:var(--lapis);
                padding:8px;border-radius:6px;margin:8px 0">${aman(p.catatan)}</pre>
  </article>`;
}

export async function halamanPengajuanSaya(wadah) {
  if (!sesi) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Sesi tidak valid, coba masuk ulang.</p></div>
    </section>`;
    return;
  }

  // Owner jarang (kalau pernah) mengajukan sesuatu ke dirinya sendiri
  // — dia yang MEMUTUSKAN, bukan yang mengajukan. Jadi buat Owner,
  // halaman ini menampilkan SEMUA pengajuan dari siapa pun (jadi
  // riwayat keputusannya sendiri juga kelihatan, termasuk yang sudah
  // Disetujui/Ditolak — karena halaman Persetujuan Perubahan CUMA
  // menampilkan yang masih Menunggu, begitu diputuskan datanya hilang
  // dari sana). Buat Sales/Admin, tetap cuma pengajuan milik sendiri.
  const untukOwner = sesi.peran === "owner";

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">${untukOwner ? "Riwayat Semua Pengajuan" : "Pengajuan Saya"}</h2>
    </div>
    <p class="petunjuk">${untukOwner
      ? "Riwayat lengkap semua pengajuan dari siapa pun — termasuk yang " +
        "sudah Disetujui/Ditolak (yang sudah tidak tampil lagi di " +
        "halaman Persetujuan Perubahan)."
      : "Riwayat semua pengajuan (ubah data, cashback, diskon, batal SPK, " +
        "ubah unit) yang pernah Anda ajukan — lengkap status terakhirnya."
    }</p>
    <div class="chip-baris" id="saring-status">
      <button class="chip aktif" data-status="">Semua</button>
      <button class="chip" data-status="menunggu">Menunggu</button>
      <button class="chip" data-status="disetujui">Disetujui</button>
      <button class="chip" data-status="ditolak">Ditolak</button>
    </div>
    <div id="daftar-pengajuan-saya" class="daftar" style="margin-top:10px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-pengajuan-saya");
  let semua = [];

  async function muat() {
    const snap = untukOwner
      ? await getDocs(collection(dbase, "pengajuan"))
      : await getDocs(query(
          collection(dbase, "pengajuan"), where("diajukanOlehUid", "==", sesi.uid)
        ));
    semua = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
    tampilkan("");
  }

  function tampilkan(status) {
    const hasil = status ? semua.filter((p) => p.status === status) : semua;
    daftarEl.innerHTML = hasil.length
      ? hasil.map((p) => kartuPengajuanSaya(p, untukOwner)).join("")
      : `<div class="hampa"><p>Belum ada pengajuan${status ? " dengan status ini" : ""}.</p></div>`;
  }

  wadah.querySelectorAll("#saring-status .chip").forEach((c) => {
    c.addEventListener("click", () => {
      wadah.querySelectorAll("#saring-status .chip").forEach((x) => x.classList.remove("aktif"));
      c.classList.add("aktif");
      tampilkan(c.dataset.status);
    });
  });

  try {
    await muat();
  } catch (err) {
    daftarEl.innerHTML = `<div class="hampa">
      <p>Gagal memuat: ${aman(err.message)}</p></div>`;
  }
}

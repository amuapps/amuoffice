// persetujuan.js — Owner menyetujui atau menolak pengajuan
// perubahan data Pembeli/Pemakai yang dikirim Sales/Admin lewat
// spk.js (pasangEditPelangganSpk). Perubahan BARU benar-benar
// masuk ke SPK begitu Owner klik Setujui — sebelum itu, SPK-nya
// tidak berubah sama sekali.

import {
  dbase, doc, collection, getDocs, updateDoc, query, where, orderBy,
  writeBatch, catat, sertakanLog,
} from "./db.js";
import { bolehAkses, konfirmasiPassword } from "./auth.js";
import { simpanPelangganOtomatis } from "./pelanggan.js";
import { tanya, konfirmasi } from "./dialog.js";
import { aman, kabar, tanggalJam } from "./ui.js";

function kartuPengajuan(p) {
  return `<article class="kartu">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(p.spkNo)}</h3>
        <p class="kartu-sub">Diajukan oleh ${aman(p.diajukanOlehNama)}
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
      const snap = await getDocs(query(
        collection(dbase, "pengajuan"),
        where("status", "==", "menunggu"),
        orderBy("dibuatPada", "desc")
      ));
      data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

    const password = await tanya({
      judul: "Konfirmasi persetujuan",
      pesan: `Masukkan password Anda untuk menyetujui perubahan pada ` +
             `SPK ${p.spkNo}.`,
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
      const { pembeli, pemakai, pemakaiSamaDenganPembeli } = p.dataBaru;
      const pembeliId = await simpanPelangganOtomatis(pembeli);
      const pemakaiId = pemakaiSamaDenganPembeli
        ? pembeliId
        : await simpanPelangganOtomatis(pemakai);

      const batch = writeBatch(dbase);
      batch.update(doc(dbase, "transaksi", p.transaksiId), {
        pembeli, pembeliId,
        pemakaiSamaDenganPembeli,
        pemakai: pemakaiSamaDenganPembeli ? null : pemakai,
        pemakaiId,
      });
      batch.update(doc(dbase, "pengajuan", p.id), { status: "disetujui" });
      sertakanLog(batch, "perubahan_spk_disetujui", {
        koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
      });
      await batch.commit();

      kabar(`Perubahan untuk SPK ${p.spkNo} disetujui & tersimpan.`, "netral");
      await muat();
    } catch (err) {
      kabar("Gagal menyetujui: " + err.message, "rem");
    }
  }

  async function tolak(id) {
    const p = data.find((x) => x.id === id);
    if (!p) return;
    const yakin = await konfirmasi({
      judul: "Tolak pengajuan?",
      pesan: `Pengajuan perubahan untuk SPK ${p.spkNo} akan ditolak. ` +
             `SPK-nya tidak berubah sama sekali.`,
      oke: "Tolak", bahaya: true,
    });
    if (!yakin) return;

    try {
      await updateDoc(doc(dbase, "pengajuan", id), { status: "ditolak" });
      await catat("perubahan_spk_ditolak", {
        koleksi: "transaksi", docId: p.transaksiId, ringkas: p.spkNo,
      });
      kabar("Pengajuan ditolak.", "netral");
      await muat();
    } catch (err) {
      kabar("Gagal menolak: " + err.message, "rem");
    }
  }

  await muat();
}

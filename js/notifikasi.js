// notifikasi.js — inbox notifikasi ringan. Dibuat otomatis dari
// modul lain (persetujuan.js, cetak.js) tiap ada kejadian yang
// relevan buat orang tertentu:
//   - Sales: pembayaran konsumennya dicatat, unitnya jadi Terjual.
//   - Admin: pengajuan perubahan yang dia kirim disetujui/ditolak.
//
// Sengaja SATU koleksi datar (bukan per-peran) — lebih gampang
// dibaca ulang & dites, dan aturan keamanannya cuma satu baris:
// setiap orang cuma boleh baca notifikasi buat dirinya sendiri.

import {
  dbase, doc, collection, addDoc, getDoc, getDocs, updateDoc, query, where,
  limit, serverTimestamp, onSnapshot,
} from "./db.js?v=3.7.2";
import { sesi } from "./auth.js?v=3.7.2";
import { aman, tanggalJam } from "./ui.js?v=3.7.2";

// Dipanggil dari modul lain begitu ada kejadian yang perlu
// diberitahukan ke seseorang. Gagal diam-diam kalau ada masalah —
// notifikasi itu pemanis, tidak boleh sampai menggagalkan aksi
// utamanya (mis. approve/reject tetap harus jalan walau ini gagal).
export async function buatNotifikasi(untukUid, judul, pesan, link = "") {
  if (!untukUid) return;
  try {
    await addDoc(collection(dbase, "notifikasi"), {
      untukUid, judul, pesan, link, dibaca: false, dibuatPada: serverTimestamp(),
    });
  } catch { /* diam-diam saja, ini bukan bagian penting alur utama */ }
}

// Dipanggil begitu ada PENGAJUAN BARU (cashback, diskon, batal SPK,
// ubah data pembeli/pemakai, ubah unit) — supaya Owner tahu ada yang
// menunggu keputusannya, tanpa perlu bolak-balik cek halaman
// Persetujuan Perubahan sendiri. Daftar UID Owner diambil dari
// pengaturan/pemilik (lihat sinkronDaftarOwner di pengaturan.js) —
// bukan query langsung ke koleksi "users" yang memang dibatasi.
export async function beriTahuSemuaOwner(judul, pesan, link = "#/persetujuan") {
  try {
    const snap = await getDoc(doc(dbase, "pengaturan", "pemilik"));
    const uids = snap.exists() ? (snap.data().uids || []) : [];
    await Promise.all(uids.map((uid) => buatNotifikasi(uid, judul, pesan, link)));
  } catch { /* diam-diam saja, sama seperti buatNotifikasi */ }
}

let lepasPantau = null;

// Lencana jumlah belum dibaca di panel atas — dipasang sekali per
// sesi login, dipantau langsung (bukan tarik manual) supaya
// muncul detik itu juga tanpa perlu refresh.
export function pasangLencana(elLencana) {
  if (!sesi) return;
  if (lepasPantau) lepasPantau();
  const q = query(
    collection(dbase, "notifikasi"),
    where("untukUid", "==", sesi.uid),
    where("dibaca", "==", false)
  );
  lepasPantau = onSnapshot(q, (snap) => {
    const n = snap.size;
    elLencana.hidden = n === 0;
    elLencana.textContent = n > 9 ? "9+" : String(n);
  }, () => { elLencana.hidden = true; });
}

function kartuNotif(n) {
  return `<article class="kartu ${n.dibaca ? "" : "kartu--tandai"}"
             data-notif="${n.id}" style="cursor:${n.link ? "pointer" : "default"}">
    <div class="kartu-atas">
      <h3 class="kartu-judul" style="font-size:14px">${aman(n.judul)}</h3>
      ${!n.dibaca ? `<span class="tanda tanda--ready" style="font-size:10px">Baru</span>` : ""}
    </div>
    <p class="kartu-rinci">${aman(n.pesan)}</p>
    <p class="kartu-rinci" style="opacity:.65">${tanggalJam(n.dibuatPada)}</p>
  </article>`;
}

export async function halamanInbox(wadah) {
  if (!sesi) return;
  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Inbox</h2>
      <button class="tombol tombol--kecil" id="tandai-semua">Tandai semua dibaca</button>
    </div>
    <div id="daftar-notif" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-notif");
  let data = [];

  async function muat() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    try {
      // Tanpa orderBy di query — supaya tidak butuh index gabungan
      // (equality + orderBy field beda = butuh index khusus di
      // Firestore). Diurutkan di sini saja, di sisi aplikasi.
      const snap = await getDocs(query(
        collection(dbase, "notifikasi"),
        where("untukUid", "==", sesi.uid),
        limit(100)
      ));
      data = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));
    } catch (err) {
      daftarEl.innerHTML = `<div class="hampa"><p>Gagal memuat: ${aman(err.message)}</p></div>`;
      return;
    }
    daftarEl.innerHTML = data.length
      ? data.map(kartuNotif).join("")
      : `<div class="hampa"><p>Belum ada notifikasi.</p></div>`;

    daftarEl.querySelectorAll("[data-notif]").forEach((el) =>
      el.addEventListener("click", async () => {
        const n = data.find((x) => x.id === el.dataset.notif);
        if (!n) return;
        if (!n.dibaca) {
          try {
            await updateDoc(doc(dbase, "notifikasi", n.id), { dibaca: true });
          } catch { /* tidak fatal */ }
        }
        if (n.link) location.hash = n.link;
      }));
  }

  wadah.querySelector("#tandai-semua").addEventListener("click", async () => {
    await Promise.all(data.filter((n) => !n.dibaca).map((n) =>
      updateDoc(doc(dbase, "notifikasi", n.id), { dibaca: true }).catch(() => {})));
    await muat();
  });

  await muat();
}

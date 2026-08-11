// db.js — semua akses Firestore lewat file ini.
// Tidak ada file lain yang boleh memanggil Firestore langsung,
// supaya log aktivitas tidak pernah terlewat.

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, runTransaction,
  serverTimestamp, writeBatch, query, where, orderBy, limit, onSnapshot,
  getDocs, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, EmailAuthProvider, reauthenticateWithCredential, updatePassword }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { FIREBASE, MODE_UJI } from "./config.js?v=3.5.0";

export const app = initializeApp(FIREBASE);
export const auth = getAuth(app);

// Cache lokal permanen — inilah yang membuat aplikasi tetap bisa
// dipakai sales di lapangan saat sinyal hilang.
export const dbase = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, runTransaction,
  serverTimestamp, writeBatch, query, where, orderBy, limit, onSnapshot,
  getDocs, increment, EmailAuthProvider, reauthenticateWithCredential,
  updatePassword,
};

// ── Status koneksi ────────────────────────────────────────────
const pendengarKoneksi = [];
export function saatKoneksiBerubah(fn) {
  pendengarKoneksi.push(fn);
  fn(navigator.onLine);
}
function siarkan() {
  pendengarKoneksi.forEach((fn) => fn(navigator.onLine));
}
window.addEventListener("online", siarkan);
window.addEventListener("offline", siarkan);

// ── Log aktivitas ─────────────────────────────────────────────
// Dicatat untuk semua tindakan tanpa kecuali. Dokumen log tidak
// bisa diubah atau dihapus siapa pun — diatur di firestore.rules.
export function barisLog(aksi, detail = {}) {
  const u = auth.currentUser;
  return {
    uid: u ? u.uid : "anonim",
    email: u ? u.email : "",
    aksi,
    ...detail,
    uji: MODE_UJI,
    pada: serverTimestamp(),
  };
}

export async function catat(aksi, detail = {}) {
  try {
    await addDoc(collection(dbase, "audit_log"), barisLog(aksi, detail));
  } catch (e) {
    // Log gagal tidak boleh menggagalkan pekerjaan pengguna.
    console.warn("Log gagal:", e);
  }
}

// Untuk aksi penting: log ditulis dalam batch yang sama dengan
// perubahannya, supaya keduanya berhasil atau keduanya batal.
export function sertakanLog(batch, aksi, detail = {}) {
  batch.set(doc(collection(dbase, "audit_log")), barisLog(aksi, detail));
}

// ── Penomoran berurutan ───────────────────────────────────────
// Nomor SPK dan kuitansi tidak boleh loncat atau kembar.
export async function nomorBerikutnya(kunci, awalan) {
  const ref = doc(dbase, "counters", kunci);
  const angka = await runTransaction(dbase, async (t) => {
    const snap = await t.get(ref);
    const berikut = (snap.exists() ? snap.data().terakhir : 0) + 1;
    t.set(ref, { terakhir: berikut, diubah: serverTimestamp() },
          { merge: true });
    return berikut;
  });
  const thn = new Date().getFullYear();
  return `${awalan}/${thn}/${String(angka).padStart(4, "0")}`;
}

// ── Indeks unik ───────────────────────────────────────────────
// Firestore tidak punya penjamin keunikan. Ini mencegah satu
// nomor rangka masuk dua kali dan merusak stok.
export async function pakaiNilaiUnik(koleksiIndeks, nilai, pemilikId) {
  const ref = doc(dbase, koleksiIndeks, String(nilai).toUpperCase());
  await runTransaction(dbase, async (t) => {
    const snap = await t.get(ref);
    if (snap.exists() && snap.data().pemilik !== pemilikId) {
      throw new Error(`${nilai} sudah terdaftar di sistem.`);
    }
    t.set(ref, { pemilik: pemilikId, pada: serverTimestamp() });
  });
  return ref;
}

// Penanda data uji, dipasang di setiap dokumen baru supaya bisa
// dibersihkan sekaligus sebelum showroom mulai jalan.
export function tandaBaru() {
  return {
    uji: MODE_UJI,
    dibuatOleh: auth.currentUser ? auth.currentUser.uid : null,
    dibuatPada: serverTimestamp(),
  };
}

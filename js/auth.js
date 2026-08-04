// auth.js — masuk, keluar, dan penjagaan hak akses.

import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { auth, dbase, doc, getDoc, catat } from "./db.js";
import { PERAN, boleh } from "./roles.js";

export let sesi = null; // { uid, email, nama, peran, aktif }

export async function masuk(email, sandi) {
  const kredensial = await signInWithEmailAndPassword(
    auth, email.trim(), sandi
  );
  const profil = await muatProfil(kredensial.user.uid);

  if (!profil) {
    await signOut(auth);
    throw new Error(
      "Akun ini belum terdaftar sebagai karyawan. Hubungi owner."
    );
  }
  if (profil.aktif !== true) {
    await catat("login_ditolak_nonaktif", { target: kredensial.user.uid });
    await signOut(auth);
    throw new Error(
      "Akun ini sudah dinonaktifkan. Hubungi owner untuk mengaktifkan."
    );
  }
  if (!PERAN[profil.peran]) {
    await signOut(auth);
    throw new Error("Peran akun ini belum diatur. Hubungi owner.");
  }

  await catat("login", { peran: profil.peran });
  return profil;
}

export async function keluar() {
  await catat("logout");
  sesi = null;
  await signOut(auth);
}

async function muatProfil(uid) {
  const snap = await getDoc(doc(dbase, "users", uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  sesi = {
    uid,
    email: d.email || "",
    nama: d.nama || "Tanpa nama",
    peran: d.peran,
    aktif: d.aktif === true,
  };
  return sesi;
}

// Dipanggil sekali saat aplikasi dibuka.
export function pantauSesi(saatMasuk, saatKeluar) {
  onAuthStateChanged(auth, async (pengguna) => {
    if (!pengguna) {
      sesi = null;
      saatKeluar();
      return;
    }
    const profil = await muatProfil(pengguna.uid);
    if (!profil || profil.aktif !== true || !PERAN[profil.peran]) {
      await signOut(auth);
      saatKeluar();
      return;
    }
    saatMasuk(profil);
  });
}

// Penjaga hak akses. Dipakai sebelum membuka halaman atau
// menampilkan angka sensitif seperti laba dan fee agen.
export function bolehAkses(izin) {
  if (!sesi) return false;
  return boleh(sesi.peran, izin);
}

export function pesanTolak(e) {
  const kode = e && e.code ? e.code : "";
  if (kode === "auth/invalid-credential" ||
      kode === "auth/wrong-password" ||
      kode === "auth/user-not-found") {
    return "Email atau kata sandi tidak cocok.";
  }
  if (kode === "auth/too-many-requests") {
    return "Terlalu banyak percobaan. Tunggu beberapa menit.";
  }
  if (kode === "auth/network-request-failed") {
    return "Tidak ada koneksi. Sambungkan internet untuk masuk pertama kali.";
  }
  return e && e.message ? e.message : "Gagal masuk. Coba lagi.";
}

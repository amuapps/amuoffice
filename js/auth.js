// auth.js — masuk, keluar, dan penjagaan hak akses.

import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { auth, dbase, doc, getDoc, catat,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword, updateEmail,
  updateDoc } from "./db.js?v=3.11.2";
import { PERAN, boleh } from "./roles.js?v=3.11.2";
import { kabar } from "./ui.js?v=3.11.2";

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
    biroJasaId: d.biroJasaId || null,
  };
  return sesi;
}

// Dipanggil sekali saat aplikasi dibuka.
//
// Firebase menyegarkan token login secara berkala di belakang layar
// (bukan cuma sekali di awal). Kalau internet putus SEBENTAR tepat
// saat itu terjadi, gampang sekali disalahartikan sebagai "keluar"
// padahal sebenarnya masih login — dan kalau langsung dianggap
// keluar, tampilan yang sedang diisi ikut hilang percuma. Karena
// itu ada jeda pemeriksaan ulang di bawah sebelum benar-benar
// dianggap logout.
export function pantauSesi(saatMasuk, saatKeluar) {
  onAuthStateChanged(auth, async (pengguna) => {
    if (!pengguna) {
      if (sesi) {
        // Sudah pernah login sebelumnya di sesi ini — beri jeda,
        // cek ulang, baru simpulkan. Kalau ternyata cuma gangguan
        // sesaat, auth.currentUser akan kembali terisi.
        await new Promise((r) => setTimeout(r, 1500));
        if (auth.currentUser) return; // memang cuma gangguan sesaat
      }
      sesi = null;
      saatKeluar();
      return;
    }
    try {
      const profil = await muatProfil(pengguna.uid);
      if (!profil || profil.aktif !== true || !PERAN[profil.peran]) {
        await signOut(auth);
        saatKeluar();
        return;
      }
      saatMasuk(profil);
    } catch (err) {
      // Gagal membaca profil dari server. Kalau sebelumnya memang
      // sudah login (sesi masih ada), ini besar kemungkinan cuma
      // koneksi putus sebentar — JANGAN hapus tampilan yang sedang
      // dipakai. Cukup beri tahu, biarkan penyegaran berikutnya
      // yang mencoba lagi secara otomatis.
      if (sesi) {
        kabar("Koneksi sempat terputus. Pekerjaan Anda aman, " +
              "tersambung lagi otomatis.", "rem");
        return;
      }
      saatKeluar();
    }
  });
}

// Penjaga hak akses. Dipakai sebelum membuka halaman atau
// menampilkan angka sensitif seperti laba dan fee agen.
export function bolehAkses(izin) {
  if (!sesi) return false;
  return boleh(sesi.peran, izin);
}

// Minta password diketik ulang sebelum aksi sensitif (mis. mengubah
// data pembeli/pemakai di SPK yang sudah tersimpan). Melempar error
// kalau salah — pemanggil cukup try/catch, tidak perlu urus detail
// kode error Firebase-nya.
export async function konfirmasiPassword(password) {
  const u = auth.currentUser;
  if (!u || !u.email) throw new Error("Sesi tidak valid, coba masuk ulang.");
  const kredensial = EmailAuthProvider.credential(u.email, password);
  await reauthenticateWithCredential(u, kredensial); // melempar kalau salah
}

// Dipakai siapa saja yang login (bukan cuma Owner) buat ganti sandi
// sendiri, mis. dari sandi awal yang diberikan Owner. Wajib
// konfirmasi sandi lama dulu — sama seperti aksi sensitif lainnya.
export async function ubahPasswordSendiri(passwordLama, passwordBaru) {
  await konfirmasiPassword(passwordLama); // melempar kalau sandi lama salah
  await updatePassword(auth.currentUser, passwordBaru);
}

// Sama pola-nya dengan ubahPasswordSendiri — dipakai siapa saja yang
// login (termasuk Biro Jasa) buat ganti email login sendiri kalau
// salah ketik/mau diganti. Wajib konfirmasi password dulu (Firebase
// juga mewajibkan ini kalau sesinya sudah agak lama). SEKALIGUS
// memperbarui salinan email di Firestore (koleksi "users") — supaya
// Authentication & tampilan aplikasi selalu konsisten, tidak seperti
// kalau diubah manual cuma dari Firebase Console.
export async function ubahEmailSendiri(password, emailBaru) {
  await konfirmasiPassword(password); // melempar kalau password salah
  await updateEmail(auth.currentUser, emailBaru.trim());
  await updateDoc(doc(dbase, "users", auth.currentUser.uid), { email: emailBaru.trim() });
}

// Dipakai dari layar login (belum login sama sekali) — karyawan
// yang sudah terdaftar Owner bisa minta link reset sendiri, masuk
// ke emailnya sendiri (lewat layanan email Firebase), tanpa perlu
// menunggu Owner memicu dari halaman Data Karyawan.
export async function mintaResetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export function pesanTolak(e) {
  const kode = e && e.code ? e.code : "";
  if (kode === "auth/invalid-credential" ||
      kode === "auth/wrong-password" ||
      kode === "auth/user-not-found") {
    return "Email atau kata sandi tidak cocok.";
  }
  if (kode === "auth/email-already-in-use") {
    return "Email itu sudah dipakai akun lain.";
  }
  if (kode === "auth/invalid-email") {
    return "Format email tidak valid.";
  }
  if (kode === "auth/too-many-requests") {
    return "Terlalu banyak percobaan. Tunggu beberapa menit.";
  }
  if (kode === "auth/network-request-failed") {
    return "Tidak ada koneksi. Sambungkan internet untuk masuk pertama kali.";
  }
  return e && e.message ? e.message : "Gagal masuk. Coba lagi.";
}

// pengaturan.js — modul Pengaturan.
//
// Dua hal yang selama ini hanya bisa dilakukan lewat Firebase
// Console: membuat akun karyawan, dan mengatur penomoran dokumen.
//
// Catatan teknis: membuat akun dari browser biasanya membuat
// browser ikut masuk sebagai akun baru itu — owner jadi terlempar
// keluar. Karena itu pembuatan akun dijalankan lewat sambungan
// Firebase kedua yang terpisah, lalu sambungan itu ditutup. Sesi
// owner tidak tersentuh.

import { initializeApp, deleteApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  dbase, auth, collection, doc, getDocs, setDoc, updateDoc, query, where,
  serverTimestamp, catat,
} from "./db.js?v=3.4.0";
import { sesi, bolehAkses } from "./auth.js?v=3.4.0";
import { PERAN, batasDiskon } from "./roles.js?v=3.4.0";
import { FIREBASE } from "./config.js?v=3.4.0";
import { konfirmasi, tanya, beritahu } from "./dialog.js?v=3.4.0";
import { rupiah, aman, kabar, tanggal, keTanggal } from "./ui.js?v=3.4.0";

const OPSI_PENDIDIKAN = ["SD", "SMP", "SMA/SMK", "D3", "S1", "S2", "S3", "Lainnya"];

// Dihitung dari tanggal bergabung — cukup buat gambaran umum, tidak
// perlu presisi sampai hari.
function masaKerja(tglBergabung) {
  const d = keTanggal(tglBergabung);
  if (!d) return null;
  const bulan = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
  const th = Math.floor(bulan / 12);
  const sisaBulan = bulan % 12;
  if (th === 0) return `${sisaBulan} bulan`;
  return `${th} thn${sisaBulan ? ` ${sisaBulan} bln` : ""}`;
}

// ── Pembuatan akun lewat sambungan terpisah ───────────────────
async function buatAkun(email, sandi) {
  const nama = "pembuat-akun-" + Date.now();
  const app2 = initializeApp(FIREBASE, nama);
  const auth2 = getAuth(app2);
  try {
    const kredensial = await createUserWithEmailAndPassword(
      auth2, email.trim(), sandi
    );
    await signOut(auth2);
    return kredensial.user.uid;
  } finally {
    await deleteApp(app2);
  }
}

function pesanBuat(e) {
  const kode = e && e.code ? e.code : "";
  if (kode === "auth/email-already-in-use") {
    return "Email itu sudah terdaftar. Pakai email lain, atau " +
           "cari akunnya di daftar bawah.";
  }
  if (kode === "auth/weak-password") {
    return "Kata sandi minimal 6 karakter.";
  }
  if (kode === "auth/invalid-email") return "Format email tidak benar.";
  return e && e.message ? e.message : "Gagal membuat akun.";
}

// ── Halaman pengguna ──────────────────────────────────────────
function kartuPengguna(u) {
  const p = PERAN[u.peran];
  const batas = batasDiskon(u.peran);
  const mk = masaKerja(u.tanggalBergabung);
  return `<article class="kartu ${u.aktif ? "" : "kartu--batal"}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul">${aman(u.nama || "Tanpa nama")}
          ${u.idKaryawan ? `<span class="mono" style="font-weight:400;
            color:var(--abu-2);font-size:12.5px"> · ${aman(u.idKaryawan)}</span>` : ""}</h3>
        <p class="kartu-sub">${aman(u.jabatan || (p ? p.label : u.peran))} ·
          ${aman(u.email || "")}</p>
      </div>
      <span class="tanda ${u.aktif ? "tanda--ready" : "tanda--batal"}">
        ${u.aktif ? "Aktif" : "Nonaktif"}
      </span>
    </div>
    <dl class="rinci">
      <div><dt>Peran (login)</dt>
        <dd>${aman(p ? p.label : u.peran)}${
          p ? ` <span class="mono">(${p.kode})</span>` : ""}</dd></div>
      <div><dt>NIK</dt><dd class="mono">${aman(u.nik || "-")}</dd></div>
      <div><dt>TTL</dt><dd>${aman(u.tempatLahir || "-")}${
        u.tanggalLahir ? `, ${tanggal(u.tanggalLahir)}` : ""}</dd></div>
      <div><dt>Pendidikan</dt><dd>${aman(u.pendidikan || "-")}</dd></div>
      <div><dt>Alamat</dt><dd>${aman(u.alamat || "-")}</dd></div>
      <div><dt>Bergabung</dt><dd>${u.tanggalBergabung
        ? `${tanggal(u.tanggalBergabung)}${mk ? ` (${mk})` : ""}` : "-"}</dd></div>
      <div><dt>Batas diskon</dt>
        <dd>${batas === null ? "Tanpa batas" : rupiah(batas)}</dd></div>
    </dl>
    <div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-ubah="${u.id}">Ubah Data</button>
      <button class="tombol tombol--kecil" data-status="${u.id}">
        ${u.aktif ? "Nonaktifkan" : "Aktifkan"}
      </button>
      <button class="tombol tombol--kecil" data-sandi="${u.id}">
        Kirim reset sandi
      </button>
    </div>
  </article>`;
}

function opsiPeran(terpilih) {
  return Object.entries(PERAN).map(([k, v]) =>
    `<option value="${k}" ${k === terpilih ? "selected" : ""}>
      ${v.label} — batas diskon ${
        v.batasDiskon === null ? "bebas" : rupiah(v.batasDiskon)
      }</option>`).join("");
}

// Daftar UID Owner disimpan di dokumen tersendiri yang boleh dibaca
// SIAPA SAJA yang login (lihat firestore.rules: koleksi "pengaturan"
// terbuka untuk dibaca siapa saja aktif) — supaya Admin/Sales bisa
// tahu SIAPA yang perlu diberi notifikasi saat mereka mengajukan
// sesuatu, tanpa perlu izin membaca koleksi "users" secara luas
// (yang isinya data karyawan lain, semestinya rahasia). Disinkron
// otomatis tiap kali halaman ini dibuka — lihat gambar() di bawah.

export async function halamanPengguna(wadah) {
  if (!bolehAkses("kelola.pengguna")) {
    wadah.innerHTML = `<div class="hampa">
      <p>Hanya owner yang boleh mengelola pengguna.</p></div>`;
    return;
  }

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">Data Karyawan</h2>
      <button class="tombol tombol--kecil tombol--isi" id="tambah-pengguna">
        Tambah Karyawan
      </button>
    </div>
    <div id="form-pengguna"></div>
    <div id="daftar-pengguna" class="daftar">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-pengguna");
  const formEl = wadah.querySelector("#form-pengguna");
  let isi = [];

  async function gambar() {
    const snap = await getDocs(collection(dbase, "users"));
    isi = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
    daftarEl.innerHTML = isi.map(kartuPengguna).join("");

    daftarEl.querySelectorAll("[data-ubah]").forEach((b) =>
      b.addEventListener("click", () => ubahPeran(b.dataset.ubah)));
    daftarEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => ubahStatus(b.dataset.status)));
    daftarEl.querySelectorAll("[data-sandi]").forEach((b) =>
      b.addEventListener("click", () => kirimReset(b.dataset.sandi)));

    // Auto-sync tiap kali halaman ini dibuka (bukan cuma pas
    // simpan/ubah) — supaya akun Owner yang sudah ada dari SEBELUM
    // fitur ini dibuat pun otomatis ikut tersinkron ke
    // pengaturan/pemilik, tanpa perlu disimpan ulang manual dulu.
    const uidOwnerSekarang = isi.filter((u) => u.peran === "owner").map((u) => u.id);
    setDoc(doc(dbase, "pengaturan", "pemilik"), {
      uids: uidOwnerSekarang, diperbarui: serverTimestamp(),
    }).catch(() => {});
  }

  function buka() {
    formEl.innerHTML = `<form class="form" id="f-pengguna">
      <p class="pemisah">Identitas Karyawan</p>
      <label class="label label--gelap" for="u-idkaryawan">ID Karyawan</label>
      <input class="isian isian--terang mono" id="u-idkaryawan"
             placeholder="mis. KRY-001">
      <label class="label label--gelap" for="u-nama">Nama lengkap</label>
      <input class="isian isian--terang" id="u-nama"
             placeholder="Sesuai KTP, muncul di dokumen">
      <label class="label label--gelap" for="u-nik">NIK</label>
      <input class="isian isian--terang mono" id="u-nik" inputmode="numeric"
             placeholder="16 digit, sesuai KTP">
      <div class="dua">
        <div>
          <label class="label label--gelap" for="u-tempatlahir">Tempat lahir</label>
          <input class="isian isian--terang" id="u-tempatlahir">
        </div>
        <div>
          <label class="label label--gelap" for="u-tgllahir">Tanggal lahir</label>
          <input class="isian isian--terang" id="u-tgllahir" type="date">
        </div>
      </div>
      <label class="label label--gelap" for="u-alamat">Alamat</label>
      <input class="isian isian--terang" id="u-alamat">
      <label class="label label--gelap" for="u-pendidikan">Pendidikan terakhir</label>
      <select class="isian isian--terang" id="u-pendidikan">
        <option value="">— pilih —</option>
        ${OPSI_PENDIDIKAN.map((p) => `<option value="${p}">${p}</option>`).join("")}
      </select>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="u-jabatan">Jabatan</label>
          <input class="isian isian--terang" id="u-jabatan"
                 placeholder="Menyesuaikan peran login">
        </div>
        <div>
          <label class="label label--gelap" for="u-bergabung">Tanggal bergabung</label>
          <input class="isian isian--terang" id="u-bergabung" type="date">
        </div>
      </div>

      <p class="pemisah">Akun Login</p>
      <label class="label label--gelap" for="u-email">Email</label>
      <input class="isian isian--terang" id="u-email" type="email"
             autocomplete="off">
      <label class="label label--gelap" for="u-sandi">Kata sandi awal</label>
      <input class="isian isian--terang" id="u-sandi" type="text"
             autocomplete="new-password" placeholder="Minimal 6 karakter">
      <p class="petunjuk">Sampaikan sandi ini ke karyawannya, lalu minta
        ia menggantinya lewat tombol reset sandi.</p>
      <label class="label label--gelap" for="u-peran">Peran</label>
      <select class="isian isian--terang" id="u-peran">
        ${opsiPeran("sales")}
      </select>
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">Buat akun</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-pengguna">Batal</button>
      </div>
    </form>`;

    // Jabatan otomatis terisi mengikuti peran yang dipilih — tapi
    // tetap bisa ditimpa manual (mis. "Sales Senior" bukan cuma "Sales").
    const jabatanEl = formEl.querySelector("#u-jabatan");
    const peranEl = formEl.querySelector("#u-peran");
    peranEl.addEventListener("change", () => {
      if (!jabatanEl.value.trim()) {
        jabatanEl.value = (PERAN[peranEl.value] || {}).label || "";
      }
    });

    formEl.querySelector("#batal-pengguna")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#f-pengguna").addEventListener("submit", async (e) => {
      e.preventDefault();
      const idKaryawan = formEl.querySelector("#u-idkaryawan").value.trim();
      const nama = formEl.querySelector("#u-nama").value.trim();
      const email = formEl.querySelector("#u-email").value.trim();
      const sandi = formEl.querySelector("#u-sandi").value;
      const peran = formEl.querySelector("#u-peran").value;
      if (!idKaryawan || !nama || !email || !sandi) {
        kabar("ID Karyawan, Nama, email, dan sandi wajib diisi.", "rem");
        return;
      }
      const tombol = e.target.querySelector('button[type="submit"]');
      tombol.disabled = true;
      tombol.textContent = "Membuat…";
      try {
        const bentrok = await getDocs(query(
          collection(dbase, "users"), where("idKaryawan", "==", idKaryawan)
        ));
        if (!bentrok.empty) {
          kabar("ID Karyawan ini sudah dipakai karyawan lain.", "rem");
          tombol.disabled = false;
          tombol.textContent = "Buat akun";
          return;
        }
        const uid = await buatAkun(email, sandi);
        await setDoc(doc(dbase, "users", uid), {
          idKaryawan, nama, email, peran, aktif: true,
          nik: formEl.querySelector("#u-nik").value.trim(),
          tempatLahir: formEl.querySelector("#u-tempatlahir").value.trim(),
          tanggalLahir: formEl.querySelector("#u-tgllahir").value || null,
          alamat: formEl.querySelector("#u-alamat").value.trim(),
          pendidikan: formEl.querySelector("#u-pendidikan").value,
          jabatan: jabatanEl.value.trim() || (PERAN[peran] || {}).label || "",
          tanggalBergabung: formEl.querySelector("#u-bergabung").value || null,
          dibuatOleh: sesi.uid,
          dibuatPada: serverTimestamp(),
        });
        await catat("pengguna_dibuat", {
          koleksi: "users", docId: uid, ringkas: `${nama} · ${peran}`,
        });
        formEl.innerHTML = "";
        await gambar();
        await beritahu({
          judul: "Akun dibuat",
          pesan: `${nama} sekarang bisa masuk memakai ${email}. ` +
                 `Sampaikan sandinya, dan minta ia segera menggantinya.`,
        });
      } catch (err) {
        kabar(pesanBuat(err), "rem");
        tombol.disabled = false;
        tombol.textContent = "Buat akun";
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ubahPeran(id) {
    const u = isi.find((x) => x.id === id);
    formEl.innerHTML = `<form class="form" id="f-peran">
      <p class="pemisah">${aman(u.nama)}</p>
      <label class="label label--gelap" for="p-idkaryawan">ID Karyawan</label>
      <input class="isian isian--terang mono" id="p-idkaryawan"
             value="${aman(u.idKaryawan || "")}">
      <label class="label label--gelap" for="p-nama">Nama lengkap</label>
      <input class="isian isian--terang" id="p-nama" value="${aman(u.nama)}">
      <label class="label label--gelap" for="p-nik">NIK</label>
      <input class="isian isian--terang mono" id="p-nik" inputmode="numeric"
             value="${aman(u.nik || "")}">
      <div class="dua">
        <div>
          <label class="label label--gelap" for="p-tempatlahir">Tempat lahir</label>
          <input class="isian isian--terang" id="p-tempatlahir"
                 value="${aman(u.tempatLahir || "")}">
        </div>
        <div>
          <label class="label label--gelap" for="p-tgllahir">Tanggal lahir</label>
          <input class="isian isian--terang" id="p-tgllahir" type="date"
                 value="${aman(u.tanggalLahir || "")}">
        </div>
      </div>
      <label class="label label--gelap" for="p-alamat">Alamat</label>
      <input class="isian isian--terang" id="p-alamat" value="${aman(u.alamat || "")}">
      <label class="label label--gelap" for="p-pendidikan">Pendidikan terakhir</label>
      <select class="isian isian--terang" id="p-pendidikan">
        <option value="">— pilih —</option>
        ${OPSI_PENDIDIKAN.map((p) => `<option value="${p}"
          ${p === u.pendidikan ? "selected" : ""}>${p}</option>`).join("")}
      </select>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="p-jabatan">Jabatan</label>
          <input class="isian isian--terang" id="p-jabatan" value="${aman(u.jabatan || "")}">
        </div>
        <div>
          <label class="label label--gelap" for="p-bergabung">Tanggal bergabung</label>
          <input class="isian isian--terang" id="p-bergabung" type="date"
                 value="${aman(u.tanggalBergabung || "")}">
        </div>
      </div>
      <label class="label label--gelap" for="p-peran">Peran (login)</label>
      <select class="isian isian--terang" id="p-peran">
        ${opsiPeran(u.peran)}
      </select>
      <div class="aksi">
        <button class="tombol tombol--utama" type="submit">Simpan</button>
        <button class="tombol tombol--sunyi tombol--gelap" type="button"
                id="batal-peran">Batal</button>
      </div>
    </form>`;
    formEl.querySelector("#batal-peran")
      .addEventListener("click", () => (formEl.innerHTML = ""));
    formEl.querySelector("#f-peran").addEventListener("submit", async (e) => {
      e.preventDefault();
      const idKaryawan = formEl.querySelector("#p-idkaryawan").value.trim();
      const nama = formEl.querySelector("#p-nama").value.trim();
      const peran = formEl.querySelector("#p-peran").value;
      if (!idKaryawan) {
        kabar("ID Karyawan wajib diisi.", "rem");
        return;
      }
      if (u.id === sesi.uid && peran !== "owner") {
        const jadi = await konfirmasi({
          judul: "Menurunkan peran sendiri",
          pesan: "Anda akan kehilangan akses owner dan tidak bisa " +
                 "mengembalikannya dari dalam aplikasi. Lanjutkan?",
          oke: "Tetap ubah", bahaya: true,
        });
        if (!jadi) return;
      }
      try {
        const bentrok = await getDocs(query(
          collection(dbase, "users"), where("idKaryawan", "==", idKaryawan)
        ));
        if (bentrok.docs.some((d) => d.id !== u.id)) {
          kabar("ID Karyawan ini sudah dipakai karyawan lain.", "rem");
          return;
        }
        await updateDoc(doc(dbase, "users", u.id), {
          idKaryawan, nama, peran,
          nik: formEl.querySelector("#p-nik").value.trim(),
          tempatLahir: formEl.querySelector("#p-tempatlahir").value.trim(),
          tanggalLahir: formEl.querySelector("#p-tgllahir").value || null,
          alamat: formEl.querySelector("#p-alamat").value.trim(),
          pendidikan: formEl.querySelector("#p-pendidikan").value,
          jabatan: formEl.querySelector("#p-jabatan").value.trim(),
          tanggalBergabung: formEl.querySelector("#p-bergabung").value || null,
        });
        await catat("pengguna_diubah", {
          koleksi: "users", docId: u.id, ringkas: `${nama} · ${peran}`,
        });
        formEl.innerHTML = "";
        await gambar();
        kabar("Perubahan disimpan.", "netral");
      } catch (err) {
        kabar("Gagal menyimpan: " + err.message, "rem");
      }
    });
    formEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Karyawan keluar dinonaktifkan, tidak dihapus — kalau dihapus,
  // transaksi lamanya kehilangan pemilik dan rekap komisi rusak.
  async function ubahStatus(id) {
    const u = isi.find((x) => x.id === id);
    if (u.id === sesi.uid) {
      kabar("Anda tidak bisa menonaktifkan akun sendiri.", "rem");
      return;
    }
    const jadi = await konfirmasi({
      judul: u.aktif ? "Nonaktifkan akun" : "Aktifkan akun",
      pesan: u.aktif
        ? `${u.nama} tidak akan bisa masuk lagi. Data dan transaksi ` +
          `lamanya tetap utuh — akun tidak dihapus.`
        : `${u.nama} akan bisa masuk kembali dengan peran ${u.peran}.`,
      oke: u.aktif ? "Nonaktifkan" : "Aktifkan",
      bahaya: u.aktif,
    });
    if (!jadi) return;
    try {
      await updateDoc(doc(dbase, "users", u.id), { aktif: !u.aktif });
      await catat(u.aktif ? "pengguna_dinonaktifkan" : "pengguna_diaktifkan", {
        koleksi: "users", docId: u.id, ringkas: u.nama,
      });
      await gambar();
      kabar("Status diperbarui.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  async function kirimReset(id) {
    const u = isi.find((x) => x.id === id);
    const jadi = await konfirmasi({
      judul: "Kirim tautan reset sandi",
      pesan: `Tautan penggantian sandi akan dikirim ke ${u.email}.`,
      oke: "Kirim",
    });
    if (!jadi) return;
    try {
      await sendPasswordResetEmail(auth, u.email);
      await catat("reset_sandi_dikirim", {
        koleksi: "users", docId: u.id, ringkas: u.email,
      });
      kabar("Tautan reset sudah dikirim.", "netral");
    } catch (err) {
      kabar("Gagal mengirim: " + err.message, "rem");
    }
  }

  wadah.querySelector("#tambah-pengguna").addEventListener("click", buka);
  await gambar();
}

// ── Halaman penomoran dokumen ─────────────────────────────────
const NAMA_COUNTER = {
  spk: "Surat Pesanan Kendaraan",
  kw: "Kuitansi",
  unit: "Unit",
};

function jelaskan(id) {
  const [awalan, tahun] = id.split("_");
  const nama = NAMA_COUNTER[awalan] || awalan.toUpperCase();
  return tahun ? `${nama} — tahun ${tahun}` : nama;
}

export async function halamanNomor(wadah) {
  const bisaUbah = bolehAkses("kelola.pengguna");

  wadah.innerHTML = `<section class="lembar">
    <h2 class="judul">Penomoran Dokumen</h2>
    <p class="petunjuk">Nomor berjalan otomatis dan tidak pernah
      diloncati. Angka di bawah adalah nomor terakhir yang sudah
      terpakai; dokumen berikutnya memakai angka setelahnya.</p>
    <div id="daftar-nomor" class="daftar" style="margin-top:14px">
      <p class="hampa">Memuat…</p>
    </div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-nomor");

  async function gambar() {
    const snap = await getDocs(collection(dbase, "counters"));
    const isi = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.id.localeCompare(b.id));

    daftarEl.innerHTML = isi.length
      ? isi.map((c) => `<article class="kartu">
          <div class="kartu-atas">
            <div>
              <h3 class="kartu-judul">${aman(jelaskan(c.id))}</h3>
              <p class="kartu-sub mono">${aman(c.id)}</p>
            </div>
            <b class="mono">${String(c.terakhir || 0).padStart(4, "0")}</b>
          </div>
          <p class="kartu-rinci">Berikutnya:
            <span class="mono">${
              String((c.terakhir || 0) + 1).padStart(4, "0")}</span></p>
          ${bisaUbah ? `<div class="aksi aksi--rapat">
            <button class="tombol tombol--kecil" data-set="${c.id}">
              Setel ulang</button></div>` : ""}
        </article>`).join("")
      : `<div class="hampa"><p>Belum ada dokumen yang diberi nomor.
         Penomoran muncul sendiri setelah SPK atau kuitansi pertama
         terbit.</p></div>`;

    if (!bisaUbah) return;
    daftarEl.querySelectorAll("[data-set]").forEach((b) =>
      b.addEventListener("click", () => setel(b.dataset.set,
        isi.find((x) => x.id === b.dataset.set))));
  }

  // Dipakai saat membersihkan data uji sebelum go-live, supaya nomor
  // dokumen asli bisa mulai dari 0001 lagi.
  async function setel(id, c) {
    const nilai = await tanya({
      judul: "Setel ulang penomoran",
      pesan: `Nomor terakhir untuk ${jelaskan(id)} sekarang ${
        c.terakhir || 0}. Isi angka baru — dokumen berikutnya akan ` +
        `memakai angka setelahnya. Kosongkan ke 0 untuk memulai dari 0001.`,
      nilai: String(c.terakhir || 0),
      petunjuk: "Angka",
    });
    if (nilai === null) return;
    const angka = Number(String(nilai).replace(/\D/g, ""));
    const jadi = await konfirmasi({
      judul: "Yakin menyetel ulang?",
      pesan: `Kalau di database masih ada dokumen dengan nomor di atas ${
        angka}, nomornya bisa kembar. Lakukan ini hanya setelah data ` +
        `uji dibersihkan.`,
      oke: "Setel ulang", bahaya: true,
    });
    if (!jadi) return;
    try {
      await setDoc(doc(dbase, "counters", id),
        { terakhir: angka, diubah: serverTimestamp() }, { merge: true });
      await catat("penomoran_disetel", {
        koleksi: "counters", docId: id, ringkas: `${id} → ${angka}`,
      });
      await gambar();
      kabar("Penomoran disetel ulang.", "netral");
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  await gambar();
}

# PT AUTO MITRA UTAMA — Sistem Internal
## Tahap 1 (pondasi)

Sub-dealer motor baru. Firestore + GitHub Pages, siap dipindah ke Netlify.

## Yang sudah ada

- Masuk dengan email, penjagaan peran dan status aktif
- Empat beranda berbeda: owner, admin, sales, kasir
- Log aktivitas yang tidak bisa diubah siapa pun
- Penomoran berurutan untuk SPK dan kuitansi
- Penjamin nomor rangka tidak kembar
- Bekerja tanpa sinyal, tersinkron saat koneksi kembali
- Tanggal mengikuti waktu setempat, bukan UTC

## Pemasangan

1. **Firebase Console** → buat proyek → aktifkan **Authentication**
   (metode Email/Password) dan **Firestore Database**.

2. Salin konfigurasi web ke `js/config.js`, lalu isi nama showroom.

3. Tempel isi `firestore.rules` ke Firestore → Rules → **Publish**.

4. Buat akun owner pertama:
   - Authentication → Add user → isi email dan sandi
   - Salin UID-nya
   - Firestore → buat koleksi `users` → dokumen dengan ID = UID tadi:

   ```
   nama:  "Nama Owner"
   email: "owner@showroom.id"
   peran: "owner"
   aktif: true
   ```

   Langkah ini manual sekali saja. Setelah owner masuk, akun
   karyawan lain dibuat dari dalam aplikasi.

5. Push ke GitHub → Settings → Pages → sumber: branch `main`.

6. **Penting:** Firebase → Authentication → Settings →
   **Authorized domains** → tambahkan `username.github.io`.
   Tanpa ini, login selalu gagal walau kodenya benar.

## Menguji

Buat satu akun tiap peran, lalu login bergantian. Tiap peran harus
mendarat di beranda berbeda dan hanya melihat menunya sendiri.

## Saat pindah ke Netlify

Hubungkan Netlify ke repo yang sama, ubah repo jadi privat, lalu
tambahkan domain Netlify ke Authorized domains. Kode tidak diubah.

## Sebelum go-live

Ubah `MODE_UJI` di `js/config.js` menjadi `false`, lalu bersihkan
dokumen bertanda `uji: true` dan reset koleksi `counters` supaya
nomor SPK asli mulai dari 0001.

---

©SRISP 2026

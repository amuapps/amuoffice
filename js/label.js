// label.js — nama tampilan tiap menu bisa diganti sendiri oleh
// owner ("Super Admin"), tanpa mengubah kode/rute di baliknya.
//
// Disimpan sebagai SATU dokumen: /pengaturan/label_kustom
//   { item: { "SYS-01": "Nama baru", ... },
//     grup: { "Master Data": "Nama baru", ... } }
//
// Kode (SYS-01, SLS-01, dst) dan nama grup ASLI dari roles.js tetap
// jadi kunci — jadi kalau override dihapus, otomatis balik ke nama
// bawaan. Ini yang bikin fitur ini aman dicoba-coba: tidak pernah
// menghapus rute atau kode aslinya, cuma menimpa apa yang tertulis.

import { dbase, doc, getDoc, setDoc, serverTimestamp, catat } from "./db.js?v=3.6.6";
import { bolehAkses } from "./auth.js?v=3.6.6";
import { aman, kabar } from "./ui.js?v=3.6.6";

let override = { item: {}, grup: {} };
let sudahDimuat = false;

export async function muatLabelKustom(paksa = false) {
  if (sudahDimuat && !paksa) return override;
  try {
    const snap = await getDoc(doc(dbase, "pengaturan", "label_kustom"));
    override = snap.exists()
      ? { item: snap.data().item || {}, grup: snap.data().grup || {} }
      : { item: {}, grup: {} };
  } catch {
    override = { item: {}, grup: {} }; // gagal baca → pakai nama bawaan, jangan macet
  }
  sudahDimuat = true;
  return override;
}

// Dipakai roles.js — sinkron, karena override sudah dimuat lebih
// dulu (lihat pemanggilan muatLabelKustom di app.js sebelum login
// selesai digambar).
export function labelItem(kode, asli) {
  return (kode && override.item[kode]) || asli;
}
export function labelGrup(namaAsli) {
  return override.grup[namaAsli] || namaAsli;
}

async function simpanLabelKustom(itemBaru, grupBaru) {
  await setDoc(doc(dbase, "pengaturan", "label_kustom"), {
    item: itemBaru, grup: grupBaru, diubahPada: serverTimestamp(),
  });
  await catat("label_diubah", { koleksi: "pengaturan", docId: "label_kustom" });
  override = { item: itemBaru, grup: grupBaru };
}

export async function halamanLabel(wadah, PERAN) {
  if (!bolehAkses("kelola.pengguna")) {
    wadah.innerHTML = `<section class="lembar">
      <div class="hampa"><p>Hanya Super Admin yang bisa mengubah nama menu.</p></div>
    </section>`;
    return;
  }

  await muatLabelKustom(true);

  // Kumpulkan SEMUA kode+label asli & nama grup asli dari peran
  // owner (paling lengkap), tanpa dobel.
  const daftarItem = new Map();
  const daftarGrup = new Map();
  PERAN.owner.menu.forEach((g) => {
    if (!daftarGrup.has(g.grup)) daftarGrup.set(g.grup, g.grup);
    g.butir.forEach((b) => {
      if (b.kode && !daftarItem.has(b.kode)) {
        daftarItem.set(b.kode, { kode: b.kode, asli: b.label, grup: g.grup });
      }
    });
  });

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas"><h2 class="judul">Ubah Nama Menu</h2></div>
    <p class="petunjuk">Ganti nama tampilan menu (mis. "SPK" jadi "Surat
      Pemesanan Kendaraan"). Rute dan datanya tidak berubah — ini cuma
      soal tulisan yang tampil di sidebar.</p>

    <label class="pilihan" style="margin:10px 0">
      <input type="checkbox" id="gembok">
      <span><b>Buka kunci untuk mengedit.</b> Terkunci secara default
        supaya tidak berubah tidak sengaja.</span>
    </label>

    <div class="pemisah">Nama kelompok</div>
    ${[...daftarGrup.values()].map((g) => `
      <div style="margin-bottom:10px">
        <label class="label label--gelap">${aman(g)}</label>
        <input class="isian isian--terang" data-grup-asli="${aman(g)}"
               value="${aman(labelGrup(g))}" disabled>
      </div>`).join("")}

    <div class="pemisah">Nama menu</div>
    ${[...daftarItem.values()].map((it) => `
      <div style="margin-bottom:10px">
        <label class="label label--gelap">${aman(it.asli)}
          <span class="kunci">${aman(it.grup)} · ${aman(it.kode)}</span></label>
        <input class="isian isian--terang" data-kode="${aman(it.kode)}"
               value="${aman(labelItem(it.kode, it.asli))}" disabled>
      </div>`).join("")}

    <div class="aksi" style="margin-top:14px">
      <button class="tombol tombol--utama" id="simpan-label" disabled>Simpan</button>
      <button class="tombol tombol--sunyi tombol--gelap" id="reset-label" disabled>
        Kembalikan semua ke nama bawaan</button>
    </div>
  </section>`;

  const gembokEl = wadah.querySelector("#gembok");
  const semuaInput = wadah.querySelectorAll("input[data-kode], input[data-grup-asli]");
  const tombolSimpan = wadah.querySelector("#simpan-label");
  const tombolReset = wadah.querySelector("#reset-label");

  gembokEl.addEventListener("change", () => {
    const buka = gembokEl.checked;
    semuaInput.forEach((i) => (i.disabled = !buka));
    tombolSimpan.disabled = !buka;
    tombolReset.disabled = !buka;
  });

  tombolSimpan.addEventListener("click", async () => {
    const itemBaru = {};
    wadah.querySelectorAll("input[data-kode]").forEach((i) => {
      const v = i.value.trim();
      if (v) itemBaru[i.dataset.kode] = v;
    });
    const grupBaru = {};
    wadah.querySelectorAll("input[data-grup-asli]").forEach((i) => {
      const v = i.value.trim();
      if (v) grupBaru[i.dataset.grupAsli] = v;
    });
    try {
      await simpanLabelKustom(itemBaru, grupBaru);
      kabar("Nama menu tersimpan. Muat ulang halaman untuk lihat perubahannya" +
            " di sidebar.", "netral");
    } catch (err) {
      kabar("Gagal menyimpan: " + err.message, "rem");
    }
  });

  tombolReset.addEventListener("click", async () => {
    try {
      await simpanLabelKustom({}, {});
      kabar("Semua nama menu dikembalikan ke bawaan. Muat ulang halaman.", "netral");
      await halamanLabel(wadah, PERAN);
    } catch (err) {
      kabar("Gagal reset: " + err.message, "rem");
    }
  });
}

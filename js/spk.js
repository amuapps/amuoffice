// spk.js — Surat Pesanan Kendaraan.
//
// Bentuknya mengikuti formulir SPK dealer Piaggio: data pembeli
// terpisah dari data Faktur STNK, aksesoris menambah total, BBN
// dan ongkir dihitung di luar harga unit, dan tanda jadi menyatu
// dalam satu alur — tidak dibuat lewat menu terpisah.
//
// SPK lahir SEBELUM unit ditebus, jadi menempel ke tipe motor
// dulu; nomor rangka diisi belakangan di menu Berkas.

import {
  dbase, collection, doc, getDocs, updateDoc, query, where,
  orderBy, limit, writeBatch, serverTimestamp, nomorBerikutnya,
  sertakanLog, tandaBaru, catat,
} from "./db.js";
import { sesi, bolehAkses } from "./auth.js";
import { perluPersetujuan, batasDiskon } from "./roles.js";
import { pecahHarga, SHOWROOM, MASA_BERLAKU_SPK } from "./config.js";
import { muatTipe, tipeDari } from "./tipe.js";
import {
  muatPelanggan, pelangganDari, simpanPelanggan,
  formPelanggan, bacaFormPelanggan,
} from "./pelanggan.js";
import { terbitkan } from "./kuitansi.js";
import { cetakSpk } from "./cetak.js";
import { tanya, konfirmasi } from "./dialog.js";
import {
  rupiah, terbilang, aman, kabar, tanggal, tanggalJam,
  pasangFormatUang, bacaAngka,
} from "./ui.js";

const LABEL = {
  menunggu_persetujuan: "Menunggu persetujuan",
  diajukan: "Diajukan",
  approve: "Disetujui",
  reject: "Ditolak",
  selesai: "Selesai",
  batal: "Batal",
};

// ── Perhitungan ───────────────────────────────────────────────
// PPN dihitung dari nilai unit dan aksesoris saja. BBN dan ongkir
// diteruskan ke pihak ketiga, bukan penyerahan barang oleh dealer,
// jadi tidak ikut dipecah PPN-nya.
export function hitung(d, mewah) {
  const jumlah = Math.max(1, Number(d.jumlah || 1));
  const aksesoris = (d.aksesoris || [])
    .reduce((a, b) => a + Number(b.harga || 0), 0);
  const p = d.potongan || [];
  const potonganHarga = p
    .filter((x) => x.jenis === "harga")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const bebanShowroom = p
    .filter((x) => x.sumber === "showroom")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);
  const piutangProgram = p
    .filter((x) => x.sumber === "atpm")
    .reduce((a, b) => a + Number(b.nominal || 0), 0);

  const nilaiUnit =
    Number(d.hargaOtr || 0) * jumlah + aksesoris - potonganHarga;
  const pecah = pecahHarga(nilaiUnit, mewah);
  const total =
    nilaiUnit + Number(d.tambahanBbn || 0) + Number(d.ongkir || 0);

  return {
    jumlah, aksesoris, potonganHarga, bebanShowroom, piutangProgram,
    nilaiUnit, dpp: pecah.dpp, ppn: pecah.ppn, total,
  };
}

// ── Daftar ────────────────────────────────────────────────────
function kartuSpk(s, bisaSetujui) {
  const perlu = s.statusSPK === "menunggu_persetujuan";
  return `<article class="kartu ${perlu ? "kartu--sorot" : ""}">
    <div class="kartu-atas">
      <div>
        <h3 class="kartu-judul mono">${aman(s.kode)}</h3>
        <p class="kartu-sub">${aman(s.pelangganSnapshot?.nama || "-")}</p>
      </div>
      <span class="tanda tanda--${s.statusSPK}">
        ${LABEL[s.statusSPK] || s.statusSPK}
      </span>
    </div>
    <p class="kartu-rinci">${aman(s.tipeSnapshot?.nama || "-")}
      · ${aman(s.warna || "-")}${s.jumlah > 1 ? " · " + s.jumlah + " unit" : ""}</p>
    <p class="angka-besar">${rupiah(s.total || s.hargaNet)}</p>
    <p class="kartu-rinci">
      ${s.metode === "kredit"
        ? "Kredit " + aman(s.kredit?.leasing || "-") +
          " · DP " + rupiah(s.kredit?.dp)
        : "Tunai"}
      · ${tanggal(s.dibuatPada)}
    </p>
    ${s.stnk && s.stnk.sama === false
      ? `<p class="kartu-rinci">STNK a.n. ${aman(s.stnk.nama)}</p>` : ""}
    ${s.bebanShowroom
      ? `<p class="kartu-rinci">Ditanggung showroom
         ${rupiah(s.bebanShowroom)}</p>` : ""}
    ${s.persetujuan?.olehNama
      ? `<p class="kartu-rinci">${
          s.statusSPK === "reject" ? "Ditolak" : "Disetujui"} ${
          aman(s.persetujuan.olehNama)} · ${tanggalJam(s.persetujuan.pada)}</p>`
      : ""}
    <div class="aksi aksi--rapat">
      <button class="tombol tombol--kecil" data-cetak="${s.id}">Cetak SPK</button>
      ${perlu && bisaSetujui
        ? `<button class="tombol tombol--kecil tombol--isi"
                   data-setuju="${s.id}">Setujui</button>
           <button class="tombol tombol--kecil" data-tolak="${s.id}">Tolak</button>`
        : ""}
    </div>
  </article>`;
}

export async function halamanSpk(wadah) {
  const bisaBuat = bolehAkses("spk.buat");
  const bisaSetujui = bolehAkses("spk.setujui");
  let saring = bisaSetujui ? "menunggu_persetujuan" : "semua";

  wadah.innerHTML = `<section class="lembar">
    <div class="lembar-atas">
      <h2 class="judul">SPK</h2>
      ${bisaBuat ? `<button class="tombol tombol--kecil tombol--isi"
        id="buat-spk">Buat SPK</button>` : ""}
    </div>
    <div class="chip-baris" id="saring-spk">
      ${bisaSetujui ? `<button class="chip aktif"
        data-s="menunggu_persetujuan">Perlu persetujuan</button>` : ""}
      <button class="chip ${bisaSetujui ? "" : "aktif"}"
              data-s="semua">Semua</button>
      <button class="chip" data-s="approve">Disetujui</button>
      <button class="chip" data-s="selesai">Selesai</button>
    </div>
    <div id="wadah-spk"></div>
    <div id="daftar-spk" class="daftar"><p class="hampa">Memuat…</p></div>
  </section>`;

  const daftarEl = wadah.querySelector("#daftar-spk");
  const formEl = wadah.querySelector("#wadah-spk");
  let terakhir = [];

  async function gambar() {
    daftarEl.innerHTML = `<p class="hampa">Memuat…</p>`;
    const dasar = collection(dbase, "transaksi");
    // Saat menyaring, orderBy sengaja tidak dipakai — kombinasi
    // where + orderBy menuntut indeks gabungan di Firestore.
    const q = saring === "semua"
      ? query(dasar, orderBy("dibuatPada", "desc"), limit(50))
      : query(dasar, where("statusSPK", "==", saring), limit(50));
    const snap = await getDocs(q);
    terakhir = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) =>
        (b.dibuatPada?.seconds || 0) - (a.dibuatPada?.seconds || 0));

    daftarEl.innerHTML = terakhir.length
      ? terakhir.map((s) => kartuSpk(s, bisaSetujui)).join("")
      : `<div class="hampa"><p>Belum ada SPK di kelompok ini.</p></div>`;

    daftarEl.querySelectorAll("[data-cetak]").forEach((b) =>
      b.addEventListener("click", () =>
        cetakSpk(terakhir.find((x) => x.id === b.dataset.cetak))));
    daftarEl.querySelectorAll("[data-setuju]").forEach((b) =>
      b.addEventListener("click", () => putuskan(b.dataset.setuju, true)));
    daftarEl.querySelectorAll("[data-tolak]").forEach((b) =>
      b.addEventListener("click", () => putuskan(b.dataset.tolak, false)));
  }

  wadah.querySelector("#saring-spk").addEventListener("click", (e) => {
    const t = e.target.closest("[data-s]");
    if (!t) return;
    saring = t.dataset.s;
    wadah.querySelectorAll("#saring-spk .chip")
      .forEach((c) => c.classList.toggle("aktif", c === t));
    gambar();
  });

  async function putuskan(id, setuju) {
    const catatan = await tanya({
      judul: setuju ? "Setujui SPK" : "Tolak SPK",
      pesan: setuju
        ? "Tulis catatan persetujuan — misalnya nominal diskon yang disetujui."
        : "Tulis alasan penolakan supaya sales tahu langkah berikutnya.",
      nilai: setuju ? "Disetujui" : "",
      petunjuk: setuju ? "Catatan" : "Alasan penolakan",
    });
    if (catatan === null) return;
    try {
      await updateDoc(doc(dbase, "transaksi", id), {
        statusSPK: setuju ? "approve" : "reject",
        persetujuan: {
          oleh: sesi.uid, olehNama: sesi.nama,
          pada: serverTimestamp(), catatan,
        },
      });
      await catat(setuju ? "spk_disetujui" : "spk_ditolak", {
        koleksi: "transaksi", docId: id, ringkas: catatan,
      });
      kabar(setuju ? "SPK disetujui." : "SPK ditolak.", "netral");
      await gambar();
    } catch (err) {
      kabar("Gagal: " + err.message, "rem");
    }
  }

  if (bisaBuat) {
    wadah.querySelector("#buat-spk")
      .addEventListener("click", () => wizard(formEl, gambar));
  }
  await gambar();
}

// ── Wizard tiga langkah ───────────────────────────────────────
async function wizard(wadah, selesai) {
  const draft = {
    langkah: 1,
    pelangganId: "", pelangganBaru: null,
    stnkSama: true, stnkNama: "", stnkAlamat: "",
    jumlah: 1, tipeId: "", warna: "", tahun: new Date().getFullYear(),
    hargaOtr: 0, aksesoris: [], potongan: [],
    tambahanBbn: 0, ongkir: 0,
    pengiriman: "on", kota: "", rencanaKirim: "", catatan: "",
    metode: "kredit", leasing: "", dp: 0, tenor: 0, angsuran: 0,
    agenNama: "", agenFee: 0, kodeSales: "",
    tandaJadi: 0, metodeTandaJadi: "tunai",
  };
  const daftarTipe = await muatTipe();
  const daftarPelanggan = await muatPelanggan();
  if (!daftarTipe.length) {
    kabar("Tambahkan tipe motor dulu sebelum membuat SPK.", "rem");
    return;
  }
  gambar();

  function kepala() {
    return `<div class="langkah-baris">
      ${[1, 2, 3].map((n) => `<span class="langkah ${
        n === draft.langkah ? "langkah--aktif" : ""
      } ${n < draft.langkah ? "langkah--lewat" : ""}">${n}</span>`).join("")}
      <span class="langkah-label">${
        ["Pembeli & STNK", "Unit & harga", "Pembayaran"][draft.langkah - 1]
      }</span>
    </div>`;
  }

  function gambar() {
    wadah.innerHTML = `<div class="form">${kepala()}${
      [isi1, isi2, isi3][draft.langkah - 1]()
    }</div>`;
    [pasang1, pasang2, pasang3][draft.langkah - 1]();
    wadah.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function tombolNav(akhir = false) {
    return `<div class="aksi">
      ${draft.langkah > 1
        ? `<button class="tombol tombol--sunyi tombol--gelap" type="button"
             id="mundur">Kembali</button>` : ""}
      <button class="tombol tombol--utama" type="button" id="maju">
        ${akhir ? "Simpan SPK" : "Lanjut"}
      </button>
    </div>
    <button class="tautan-batal" type="button" id="batal-spk">
      Batalkan pembuatan SPK
    </button>`;
  }

  function pasangNav(saatMaju) {
    const m = wadah.querySelector("#mundur");
    if (m) m.addEventListener("click", () => { draft.langkah--; gambar(); });
    wadah.querySelector("#maju").addEventListener("click", saatMaju);
    wadah.querySelector("#batal-spk")
      .addEventListener("click", () => (wadah.innerHTML = ""));
  }

  function uang(f) {
    const bersih = f.value.replace(/\D/g, "");
    f.value = bersih ? Number(bersih).toLocaleString("id-ID") : "";
    return Number(bersih || 0);
  }

  // ── Langkah 1: pembeli & faktur STNK ────────────────────────
  function isi1() {
    const opsi = daftarPelanggan.map((p) =>
      `<option value="${p.id}" ${draft.pelangganId === p.id ? "selected" : ""}>
        ${aman(p.nama)} — ${aman(p.telepon || "")}</option>`).join("");
    return `
      <label class="label label--gelap" for="s-pelanggan">Pembeli terdaftar</label>
      <select class="isian isian--terang" id="s-pelanggan">
        <option value="">— pembeli baru —</option>${opsi}
      </select>
      <div id="pembeli-baru">${formPelanggan(draft.pelangganBaru || {})}</div>

      <div class="pemisah">Faktur STNK atas nama</div>
      <label class="pilihan">
        <input type="checkbox" id="s-stnk-sama" ${draft.stnkSama ? "checked" : ""}>
        <span>Sama dengan data pembeli</span>
      </label>
      <div id="stnk-beda" ${draft.stnkSama ? "hidden" : ""}>
        <label class="label label--gelap" for="s-stnk-nama">Nama di STNK</label>
        <input class="isian isian--terang" id="s-stnk-nama"
               value="${aman(draft.stnkNama)}" placeholder="Sesuai KTP pemilik">
        <label class="label label--gelap" for="s-stnk-alamat">Alamat STNK</label>
        <input class="isian isian--terang" id="s-stnk-alamat"
               value="${aman(draft.stnkAlamat)}">
        <p class="petunjuk">Isi kalau motor didaftarkan atas nama orang lain.
          Salah di sini berarti berkas diulang dan biro jasa menagih dua kali.</p>
      </div>
      ${tombolNav()}`;
  }

  function pasang1() {
    const pilih = wadah.querySelector("#s-pelanggan");
    const baru = wadah.querySelector("#pembeli-baru");
    const sama = wadah.querySelector("#s-stnk-sama");
    const beda = wadah.querySelector("#stnk-beda");
    const segarkan = () => { baru.hidden = !!pilih.value; };
    pilih.addEventListener("change", segarkan);
    sama.addEventListener("change", () => { beda.hidden = sama.checked; });
    segarkan();

    pasangNav(() => {
      if (pilih.value) {
        draft.pelangganId = pilih.value;
        draft.pelangganBaru = null;
      } else {
        const d = bacaFormPelanggan(wadah);
        if (!d.nama || !d.telepon) {
          kabar("Nama dan telepon pembeli wajib diisi.", "rem");
          return;
        }
        draft.pelangganBaru = d;
        draft.pelangganId = "";
      }
      draft.stnkSama = sama.checked;
      draft.stnkNama = draft.stnkSama
        ? "" : wadah.querySelector("#s-stnk-nama").value.trim();
      draft.stnkAlamat = draft.stnkSama
        ? "" : wadah.querySelector("#s-stnk-alamat").value.trim();
      if (!draft.stnkSama && !draft.stnkNama) {
        kabar("Nama di STNK belum diisi.", "rem");
        return;
      }
      draft.langkah = 2;
      gambar();
    });
  }

  // ── Langkah 2: unit, harga, biaya ───────────────────────────
  function isi2() {
    const opsi = daftarTipe.map((t) =>
      `<option value="${t.id}" ${draft.tipeId === t.id ? "selected" : ""}>
        ${aman(t.merek)} ${aman(t.tipe)} ${aman(t.varian || "")}</option>`
    ).join("");
    return `
      <label class="label label--gelap" for="s-tipe">Merk / tipe</label>
      <select class="isian isian--terang" id="s-tipe">
        <option value="">— pilih —</option>${opsi}
      </select>
      <div class="tiga">
        <div>
          <label class="label label--gelap" for="s-warna">Warna</label>
          <select class="isian isian--terang kecil" id="s-warna"></select>
        </div>
        <div>
          <label class="label label--gelap" for="s-tahun">Tahun</label>
          <input class="isian isian--terang kecil" id="s-tahun"
                 inputmode="numeric" value="${draft.tahun}">
        </div>
        <div>
          <label class="label label--gelap" for="s-jumlah">Jumlah</label>
          <input class="isian isian--terang kecil" id="s-jumlah"
                 inputmode="numeric" value="${draft.jumlah}">
        </div>
      </div>
      <label class="label label--gelap" for="s-otr">Harga per unit</label>
      <input class="isian isian--terang" id="s-otr" inputmode="numeric">

      <div class="pemisah">Aksesoris tambahan</div>
      <div id="daftar-aksesoris"></div>
      <button class="tombol tombol--kecil" type="button" id="tambah-aksesoris">
        Tambah aksesoris
      </button>

      <div class="pemisah">Potongan</div>
      <div id="daftar-potongan"></div>
      <button class="tombol tombol--kecil" type="button" id="tambah-potongan">
        Tambah potongan
      </button>

      <div class="pemisah">Biaya lain</div>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="s-bbn">Penambahan BBN</label>
          <input class="isian isian--terang kecil" id="s-bbn"
                 inputmode="numeric">
        </div>
        <div>
          <label class="label label--gelap" for="s-ongkir">Ongkir</label>
          <input class="isian isian--terang kecil" id="s-ongkir"
                 inputmode="numeric">
        </div>
      </div>
      <p class="petunjuk">BBN dan ongkir diteruskan ke pihak ketiga,
        jadi tidak ikut dihitung PPN-nya.</p>

      <div class="pemisah">Pengiriman</div>
      <div class="chip-baris" id="s-pengiriman">
        <button class="chip ${draft.pengiriman === "on" ? "aktif" : ""}"
                type="button" data-k="on">On The Road</button>
        <button class="chip ${draft.pengiriman === "off" ? "aktif" : ""}"
                type="button" data-k="off">Off The Road</button>
      </div>
      <div class="dua">
        <div>
          <label class="label label--gelap" for="s-kota">Kota</label>
          <input class="isian isian--terang kecil" id="s-kota"
                 value="${aman(draft.kota)}">
        </div>
        <div>
          <label class="label label--gelap" for="s-kirim">Rencana delivery</label>
          <input class="isian isian--terang kecil" id="s-kirim" type="date"
                 value="${aman(draft.rencanaKirim)}">
        </div>
      </div>

      <div id="ringkas-harga" class="ringkas"></div>
      ${tombolNav()}`;
  }

  function barisAksesoris(a, i) {
    return `<div class="potongan" data-ai="${i}">
      <div class="dua">
        <input class="isian isian--terang kecil" data-af="nama"
               value="${aman(a.nama || "")}" placeholder="Nama aksesoris">
        <input class="isian isian--terang kecil" data-af="harga"
               inputmode="numeric" placeholder="Harga"
               value="${a.harga ? Number(a.harga).toLocaleString("id-ID") : ""}">
      </div>
      <button class="tautan-batal" type="button" data-ahapus="${i}">Hapus</button>
    </div>`;
  }

  function barisPotongan(p, i) {
    return `<div class="potongan" data-i="${i}">
      <div class="dua">
        <select class="isian isian--terang kecil" data-f="jenis">
          <option value="harga" ${p.jenis === "harga" ? "selected" : ""}>
            Potongan harga</option>
          <option value="barang" ${p.jenis === "barang" ? "selected" : ""}>
            Hadiah barang</option>
        </select>
        <select class="isian isian--terang kecil" data-f="sumber">
          <option value="showroom" ${p.sumber === "showroom" ? "selected" : ""}>
            Ditanggung showroom</option>
          <option value="atpm" ${p.sumber === "atpm" ? "selected" : ""}>
            Program Piaggio</option>
          <option value="leasing" ${p.sumber === "leasing" ? "selected" : ""}>
            Program leasing</option>
          <option value="komisi" ${p.sumber === "komisi" ? "selected" : ""}>
            Potong komisi</option>
        </select>
      </div>
      <div class="dua">
        <input class="isian isian--terang kecil" data-f="nominal"
               inputmode="numeric" placeholder="Nominal"
               value="${p.nominal ? Number(p.nominal).toLocaleString("id-ID") : ""}">
        <input class="isian isian--terang kecil" data-f="keterangan"
               value="${aman(p.keterangan || "")}" placeholder="Keterangan">
      </div>
      <button class="tautan-batal" type="button" data-hapus="${i}">Hapus</button>
    </div>`;
  }

  function pasang2() {
    const pTipe = wadah.querySelector("#s-tipe");
    const pWarna = wadah.querySelector("#s-warna");
    const pOtr = wadah.querySelector("#s-otr");
    const pJumlah = wadah.querySelector("#s-jumlah");
    const pBbn = wadah.querySelector("#s-bbn");
    const pOngkir = wadah.querySelector("#s-ongkir");
    [pOtr, pBbn, pOngkir].forEach(pasangFormatUang);

    if (draft.hargaOtr) {
      pOtr.value = Number(draft.hargaOtr).toLocaleString("id-ID");
    }
    if (draft.tambahanBbn) {
      pBbn.value = Number(draft.tambahanBbn).toLocaleString("id-ID");
    }
    if (draft.ongkir) {
      pOngkir.value = Number(draft.ongkir).toLocaleString("id-ID");
    }

    function isiWarna() {
      const t = tipeDari(pTipe.value);
      pWarna.innerHTML = `<option value="">— pilih —</option>` +
        ((t && t.warna) || []).map((w) =>
          `<option value="${aman(w)}" ${draft.warna === w ? "selected" : ""}>
            ${aman(w)}</option>`).join("");
      if (t && !pOtr.value) {
        pOtr.value = Number(t.hargaOtr || 0).toLocaleString("id-ID");
      }
      ringkas();
    }
    pTipe.addEventListener("change", isiWarna);
    [pOtr, pJumlah, pBbn, pOngkir].forEach((el) =>
      el.addEventListener("input", ringkas));
    isiWarna();

    wadah.querySelector("#s-pengiriman").addEventListener("click", (e) => {
      const t = e.target.closest("[data-k]");
      if (!t) return;
      draft.pengiriman = t.dataset.k;
      wadah.querySelectorAll("#s-pengiriman .chip")
        .forEach((c) => c.classList.toggle("aktif", c === t));
    });

    function gambarAksesoris() {
      wadah.querySelector("#daftar-aksesoris").innerHTML =
        draft.aksesoris.map(barisAksesoris).join("");
      wadah.querySelectorAll("[data-ai]").forEach((b) => {
        b.querySelectorAll("[data-af]").forEach((f) => {
          f.addEventListener("input", () => {
            const i = Number(b.dataset.ai);
            draft.aksesoris[i][f.dataset.af] =
              f.dataset.af === "harga" ? uang(f) : f.value;
            ringkas();
          });
        });
      });
      wadah.querySelectorAll("[data-ahapus]").forEach((b) =>
        b.addEventListener("click", () => {
          draft.aksesoris.splice(Number(b.dataset.ahapus), 1);
          gambarAksesoris(); ringkas();
        }));
    }

    function gambarPotongan() {
      wadah.querySelector("#daftar-potongan").innerHTML =
        draft.potongan.map(barisPotongan).join("");
      wadah.querySelectorAll("[data-i]").forEach((b) => {
        b.querySelectorAll("[data-f]").forEach((f) => {
          f.addEventListener("input", () => {
            const i = Number(b.dataset.i);
            draft.potongan[i][f.dataset.f] =
              f.dataset.f === "nominal" ? uang(f) : f.value;
            ringkas();
          });
        });
      });
      wadah.querySelectorAll("[data-hapus]").forEach((b) =>
        b.addEventListener("click", () => {
          draft.potongan.splice(Number(b.dataset.hapus), 1);
          gambarPotongan(); ringkas();
        }));
    }

    wadah.querySelector("#tambah-aksesoris").addEventListener("click", () => {
      draft.aksesoris.push({ nama: "", harga: 0 });
      gambarAksesoris();
    });
    wadah.querySelector("#tambah-potongan").addEventListener("click", () => {
      draft.potongan.push({
        jenis: "harga", sumber: "showroom", nominal: 0, keterangan: "",
      });
      gambarPotongan();
    });
    gambarAksesoris();
    gambarPotongan();

    function ringkas() {
      const t = tipeDari(pTipe.value);
      const sementara = {
        ...draft,
        jumlah: Number(pJumlah.value || 1),
        hargaOtr: bacaAngka(pOtr),
        tambahanBbn: bacaAngka(pBbn),
        ongkir: bacaAngka(pOngkir),
      };
      const h = hitung(sementara, t && t.mewah);
      const batas = batasDiskon(sesi.peran);
      const lewat = perluPersetujuan(sesi.peran, h.bebanShowroom);
      wadah.querySelector("#ringkas-harga").innerHTML = `
        <div class="ringkas-baris"><span>${h.jumlah} unit</span>
          <span class="mono">${
            rupiah(sementara.hargaOtr * h.jumlah)}</span></div>
        ${h.aksesoris ? `<div class="ringkas-baris"><span>Aksesoris</span>
          <span class="mono">${rupiah(h.aksesoris)}</span></div>` : ""}
        ${h.potonganHarga ? `<div class="ringkas-baris"><span>Potongan</span>
          <span class="mono">− ${rupiah(h.potonganHarga)}</span></div>` : ""}
        ${sementara.tambahanBbn ? `<div class="ringkas-baris">
          <span>Penambahan BBN</span>
          <span class="mono">${rupiah(sementara.tambahanBbn)}</span></div>` : ""}
        ${sementara.ongkir ? `<div class="ringkas-baris"><span>Ongkir</span>
          <span class="mono">${rupiah(sementara.ongkir)}</span></div>` : ""}
        <div class="ringkas-baris ringkas-total"><span>Total</span>
          <b class="mono">${rupiah(h.total)}</b></div>
        <div class="ringkas-baris"><span>DPP / PPN</span>
          <span class="mono">${rupiah(h.dpp)} / ${rupiah(h.ppn)}</span></div>
        ${h.bebanShowroom ? `<div class="ringkas-baris">
          <span>Ditanggung showroom</span>
          <b class="mono">${rupiah(h.bebanShowroom)}</b></div>` : ""}
        ${h.piutangProgram ? `<div class="ringkas-baris">
          <span>Klaim ke Piaggio</span>
          <span class="mono">${rupiah(h.piutangProgram)}</span></div>` : ""}
        ${lewat ? `<p class="peringatan">Melebihi batas Anda
          (${rupiah(batas)}). SPK akan menunggu persetujuan owner.</p>` : ""}`;
    }

    pasangNav(() => {
      if (!pTipe.value) { kabar("Pilih tipe motornya.", "rem"); return; }
      if (!bacaAngka(pOtr)) { kabar("Harga unit belum diisi.", "rem"); return; }
      draft.tipeId = pTipe.value;
      draft.warna = pWarna.value;
      draft.tahun = Number(wadah.querySelector("#s-tahun").value || 0);
      draft.jumlah = Math.max(1, Number(pJumlah.value || 1));
      draft.hargaOtr = bacaAngka(pOtr);
      draft.tambahanBbn = bacaAngka(pBbn);
      draft.ongkir = bacaAngka(pOngkir);
      draft.kota = wadah.querySelector("#s-kota").value.trim();
      draft.rencanaKirim = wadah.querySelector("#s-kirim").value;
      draft.langkah = 3;
      gambar();
    });
  }

  // ── Langkah 3: pembayaran & tanda jadi ──────────────────────
  function isi3() {
    return `
      <label class="label label--gelap">Cara pembayaran</label>
      <div class="chip-baris" id="metode">
        <button class="chip ${draft.metode === "kredit" ? "aktif" : ""}"
                type="button" data-m="kredit">Kredit</button>
        <button class="chip ${draft.metode === "cash" ? "aktif" : ""}"
                type="button" data-m="cash">Tunai</button>
      </div>
      <div id="isian-kredit">
        <label class="label label--gelap" for="s-leasing">Kredit via</label>
        <input class="isian isian--terang" id="s-leasing"
               value="${aman(draft.leasing)}" placeholder="Nama leasing">
        <div class="tiga">
          <div>
            <label class="label label--gelap" for="s-dp">DP</label>
            <input class="isian isian--terang kecil" id="s-dp"
                   inputmode="numeric">
          </div>
          <div>
            <label class="label label--gelap" for="s-tenor">Tenor (bln)</label>
            <input class="isian isian--terang kecil" id="s-tenor"
                   inputmode="numeric" value="${draft.tenor || ""}">
          </div>
          <div>
            <label class="label label--gelap" for="s-angsuran">Angsuran</label>
            <input class="isian isian--terang kecil" id="s-angsuran"
                   inputmode="numeric">
          </div>
        </div>
      </div>

      <div class="pemisah">Salesman & agen</div>
      <div class="dua">
        <input class="isian isian--terang kecil" id="s-kode"
               value="${aman(draft.kodeSales)}" placeholder="Kode salesman">
        <input class="isian isian--terang kecil" id="s-agen"
               value="${aman(draft.agenNama)}" placeholder="Nama agen">
      </div>
      <input class="isian isian--terang kecil" id="s-fee" inputmode="numeric"
             placeholder="Fee agen" style="margin-top:8px">

      <div class="pemisah">Tanda jadi</div>
      <div class="dua">
        <input class="isian isian--terang kecil" id="s-tandajadi"
               inputmode="numeric" placeholder="Nominal diterima">
        <select class="isian isian--terang kecil" id="s-tj-metode">
          <option value="tunai">Tunai</option>
          <option value="transfer">Transfer</option>
        </select>
      </div>
      <p class="petunjuk">Isi kalau pembeli membayar tanda jadi sekarang —
        kuitansinya terbit otomatis bersama SPK ini. Kosongkan kalau
        belum ada pembayaran.</p>

      <label class="label label--gelap" for="s-catatan">Catatan</label>
      <input class="isian isian--terang" id="s-catatan"
             value="${aman(draft.catatan)}" placeholder="Opsional">
      ${tombolNav(true)}`;
  }

  function pasang3() {
    ["s-dp", "s-angsuran", "s-fee", "s-tandajadi"].forEach((id) =>
      pasangFormatUang(wadah.querySelector("#" + id)));
    const kredit = wadah.querySelector("#isian-kredit");
    kredit.hidden = draft.metode !== "kredit";

    wadah.querySelector("#metode").addEventListener("click", (e) => {
      const t = e.target.closest("[data-m]");
      if (!t) return;
      draft.metode = t.dataset.m;
      wadah.querySelectorAll("#metode .chip")
        .forEach((c) => c.classList.toggle("aktif", c === t));
      kredit.hidden = draft.metode !== "kredit";
    });

    pasangNav(async () => {
      draft.leasing = wadah.querySelector("#s-leasing").value.trim();
      draft.dp = bacaAngka(wadah.querySelector("#s-dp"));
      draft.tenor = Number(wadah.querySelector("#s-tenor").value || 0);
      draft.angsuran = bacaAngka(wadah.querySelector("#s-angsuran"));
      draft.kodeSales = wadah.querySelector("#s-kode").value.trim();
      draft.agenNama = wadah.querySelector("#s-agen").value.trim();
      draft.agenFee = bacaAngka(wadah.querySelector("#s-fee"));
      draft.tandaJadi = bacaAngka(wadah.querySelector("#s-tandajadi"));
      draft.metodeTandaJadi = wadah.querySelector("#s-tj-metode").value;
      draft.catatan = wadah.querySelector("#s-catatan").value.trim();

      if (draft.metode === "kredit" && !draft.leasing) {
        kabar("Nama leasing wajib diisi untuk penjualan kredit.", "rem");
        return;
      }
      const tombol = wadah.querySelector("#maju");
      tombol.disabled = true;
      tombol.textContent = "Menyimpan…";
      try {
        const hasil = await simpan(draft);
        wadah.innerHTML = "";
        await selesai();
        const cetak = await konfirmasi({
          judul: `${hasil.kode} tersimpan`,
          pesan: "Cetak lembar SPK sekarang untuk ditandatangani pemesan?",
          oke: "Cetak SPK",
          batal: "Nanti saja",
        });
        if (cetak) cetakSpk(hasil.data);
      } catch (err) {
        kabar("Gagal menyimpan SPK: " + err.message, "rem");
        tombol.disabled = false;
        tombol.textContent = "Simpan SPK";
      }
    });
  }
}

// ── Penyimpanan ───────────────────────────────────────────────
async function simpan(d) {
  let pelangganId = d.pelangganId;
  if (!pelangganId && d.pelangganBaru) {
    pelangganId = await simpanPelanggan(d.pelangganBaru);
  }
  const pel = pelangganDari(pelangganId);
  const t = tipeDari(d.tipeId);
  const h = hitung(d, t.mewah);
  const perlu = perluPersetujuan(sesi.peran, h.bebanShowroom);

  const kode = await nomorBerikutnya(`spk_${new Date().getFullYear()}`, "SPK");
  const ref = doc(collection(dbase, "transaksi"));
  const batch = writeBatch(dbase);

  const isi = {
    kode,
    statusSPK: perlu ? "menunggu_persetujuan" : "diajukan",
    tipeId: d.tipeId,
    tipeSnapshot: {
      nama: `${t.merek} ${t.tipe} ${t.varian || ""}`.trim(),
      cc: t.cc || null, mewah: !!t.mewah,
    },
    unitId: null,
    warna: d.warna,
    tahun: d.tahun,
    jumlah: h.jumlah,
    pelangganId,
    pelangganSnapshot: {
      nama: pel?.nama || "", telepon: pel?.telepon || "",
      nik: pel?.nik || "", alamat: pel?.alamat || "",
      email: pel?.email || "",
    },
    stnk: d.stnkSama
      ? { sama: true, nama: pel?.nama || "", alamat: pel?.alamat || "" }
      : { sama: false, nama: d.stnkNama, alamat: d.stnkAlamat },
    salesId: sesi.uid,
    salesNama: sesi.nama,
    kodeSales: d.kodeSales,
    agen: d.agenNama
      ? { nama: d.agenNama, fee: d.agenFee, statusBayar: "belum" }
      : null,
    hargaOtr: d.hargaOtr,
    aksesoris: d.aksesoris.filter((a) => a.nama || a.harga),
    potongan: d.potongan,
    tambahanBbn: d.tambahanBbn,
    ongkir: d.ongkir,
    nilaiUnit: h.nilaiUnit,
    total: h.total,
    hargaNet: h.total,        // dipakai modul pembayaran & kuitansi
    dpp: h.dpp,
    ppn: h.ppn,
    bebanShowroom: h.bebanShowroom,
    piutangProgram: h.piutangProgram,
    pengiriman: d.pengiriman,
    kota: d.kota,
    rencanaKirim: d.rencanaKirim || null,
    catatan: d.catatan,
    metode: d.metode,
    kredit: d.metode === "kredit"
      ? {
          leasing: d.leasing, dp: d.dp, tenor: d.tenor,
          angsuran: d.angsuran, statusApproval: "menunggu",
        }
      : null,
    persetujuan: perlu ? { perlu: true } : null,
    totalDibayar: 0,
    sisa: h.total,
    statusBayar: "belum",
    terbilang: terbilang(h.total),
    masaBerlakuHari: MASA_BERLAKU_SPK,
    penerbit: SHOWROOM.nama,
    ...tandaBaru(),
  };
  batch.set(ref, isi);

  sertakanLog(batch, "spk_dibuat", {
    koleksi: "transaksi", docId: ref.id,
    ringkas: `${kode} · ${rupiah(h.total)}`,
    bebanShowroom: h.bebanShowroom,
    perluPersetujuan: perlu,
  });

  await batch.commit();

  // Tanda jadi menyatu dengan SPK, seperti potongan di formulir asli.
  let tandaJadiTerbit = 0;
  if (d.tandaJadi > 0) {
    try {
      await terbitkan(
        { id: ref.id, ...isi, dibuatPada: new Date() },
        { jenis: "tanda_jadi", nominal: d.tandaJadi,
          metode: d.metodeTandaJadi }
      );
      tandaJadiTerbit = d.tandaJadi;
    } catch (e) {
      kabar("SPK tersimpan, kuitansi tanda jadi gagal: " + e.message, "rem");
    }
  }

  kabar(
    perlu ? `${kode} menunggu persetujuan owner.` : `${kode} tersimpan.`,
    perlu ? "info" : "netral"
  );
  return {
    kode,
    data: { id: ref.id, ...isi, dibuatPada: new Date(),
            tandaJadi: tandaJadiTerbit },
  };
}

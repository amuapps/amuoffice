// dialog.js — kotak dialog milik aplikasi sendiri.
//
// Menggantikan confirm() dan prompt() bawaan browser, yang selalu
// memunculkan tulisan "amu.web.id menyatakan" dan tidak bisa diatur
// tampilannya. Bentuknya mengikuti dialog desktop: bilah judul di
// atas, pesan di tengah, tombol di kanan bawah.

let terbuka = null;

function bangun({
  judul, pesan, jenis, nilai, petunjuk, oke, batal, bahaya, tipeIsian,
}) {
  const isian = jenis === "tanya"
    ? `<input class="isian isian--terang dialog-isian" id="dialog-nilai"
              type="${tipeIsian || "text"}"
              value="${String(nilai || "").replace(/"/g, "&quot;")}"
              placeholder="${String(petunjuk || "").replace(/"/g, "&quot;")}">`
    : "";

  return `<div class="dialog-tirai" id="dialog-tirai"></div>
    <div class="dialog" role="dialog" aria-modal="true"
         aria-labelledby="dialog-judul">
      <div class="dialog-kop">
        <img class="dialog-logo" src="./logo.png" alt=""
             onerror="this.hidden=true">
        <span class="dialog-titik"></span>
        <h2 class="dialog-judul" id="dialog-judul">${judul}</h2>
      </div>
      <div class="dialog-isi">
        <p class="dialog-pesan">${pesan}</p>
        ${isian}
      </div>
      <div class="dialog-aksi">
        ${jenis === "info" ? "" :
          `<button class="tombol tombol--sunyi" id="dialog-batal"
                   type="button">${batal}</button>`}
        <button class="tombol tombol--utama ${bahaya ? "tombol--bahaya" : ""}"
                id="dialog-oke" type="button">${oke}</button>
      </div>
    </div>`;
}

function buka(opsi) {
  const o = {
    judul: "Konfirmasi",
    pesan: "",
    jenis: "konfirmasi",   // konfirmasi | tanya | info
    nilai: "",
    petunjuk: "",
    oke: "Oke",
    batal: "Batal",
    bahaya: false,
    ...opsi,
  };

  return new Promise((selesai) => {
    const wadah = document.getElementById("dialog-wadah");
    if (!wadah) { selesai(o.jenis === "tanya" ? null : false); return; }

    wadah.innerHTML = bangun(o);
    wadah.hidden = false;

    const nilaiEl = wadah.querySelector("#dialog-nilai");
    const okeEl = wadah.querySelector("#dialog-oke");
    const batalEl = wadah.querySelector("#dialog-batal");

    function tutup(hasil) {
      document.removeEventListener("keydown", tombolPapan);
      wadah.innerHTML = "";
      wadah.hidden = true;
      terbuka = null;
      selesai(hasil);
    }

    function setuju() {
      if (o.jenis === "tanya") {
        const isi = nilaiEl.value.trim();
        if (!isi) { nilaiEl.focus(); return; }
        tutup(isi);
      } else {
        tutup(true);
      }
    }

    function tolak() {
      tutup(o.jenis === "tanya" ? null : false);
    }

    function tombolPapan(e) {
      if (e.key === "Escape") { e.preventDefault(); tolak(); }
      if (e.key === "Enter" && o.jenis !== "info") { e.preventDefault(); setuju(); }
    }

    okeEl.addEventListener("click", setuju);
    if (batalEl) batalEl.addEventListener("click", tolak);
    wadah.querySelector("#dialog-tirai").addEventListener("click", tolak);
    document.addEventListener("keydown", tombolPapan);

    terbuka = tutup;
    setTimeout(() => (nilaiEl || okeEl).focus(), 30);
  });
}

// Ya/tidak. Mengembalikan true atau false.
export function konfirmasi(opsi) {
  return buka({ ...opsi, jenis: "konfirmasi" });
}

// Meminta isian teks. Mengembalikan teksnya, atau null kalau dibatalkan.
export function tanya(opsi) {
  return buka({ ...opsi, jenis: "tanya" });
}

// Sekadar memberitahu. Hanya ada satu tombol.
export function beritahu(opsi) {
  return buka({ ...opsi, jenis: "info", oke: "Mengerti" });
}

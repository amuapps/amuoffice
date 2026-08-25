// segera.js — layar untuk modul yang sudah punya tempat di menu
// tapi isinya belum dibangun.
//
// Sengaja tetap memakai kerangka layar yang sama (kode, bilah
// judul, seksi) supaya susunan menunya bisa dinilai lebih dulu
// sebelum satu per satu diisi.

import { bilahLayar, seksi, pasangSeksi } from "./layar.js?v=3.7.2";
import { aman } from "./ui.js?v=3.7.2";

export function halamanSegera(wadah, { kode, judul, catatan }) {
  wadah.innerHTML = `<div class="layar">
    ${bilahLayar({ kode, judul })}
    ${seksi("Keterangan", `
      <div class="hampa">
        <p><b>${aman(judul)}</b></p>
        <p style="margin-top:6px">${aman(catatan ||
          "Layar ini belum dibangun. Susunan menu dan kodenya sudah " +
          "ditetapkan, jadi bisa diisi kapan saja tanpa mengubah yang lain.")}</p>
      </div>`)}
  </div>`;
  pasangSeksi(wadah);
}

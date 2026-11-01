# PRD 3: Melengkapi HideMent (2 Orang)

**Untuk:** Orang pertama & orang kedua
**Durasi:** 4 minggu
**Reviewer:** MyKineID

Ini pekerjaan **tambahan** di luar PRD 1 (Reddit) dan PRD 2 (Data AI). Isinya bagian HideMent yang **belum ada sama sekali** saat ini. Setup & aturan Git ada di [Aturan bersama](kontributor-onboarding.md).

| Orang | Bagian | Tugas singkatnya |
|---|---|---|
| **Orang pertama** | A. Kualitas & Keandalan | Supaya HideMent tidak diam-diam rusak saat X/TikTok/IG/YouTube mengubah tampilan, dan lapor otomatis benar-benar jalan di semua platform |
| **Orang kedua** | B. Fitur & Rilis | Tema terang, ekspor/impor pengaturan, AI lokal tanpa biaya, dan paket siap upload ke Chrome Web Store |

Kalian tidak menyentuh file yang sama, jadi bisa jalan berbarengan.

---

## A. Orang pertama: Kualitas & Keandalan

### Tugasmu, singkatnya

> **Bikin HideMent tahan banting.** Setiap perubahan dicek otomatis di GitHub, perubahan tampilan platform langsung ketahuan, dan lapor otomatis terbukti jalan di X, TikTok, YouTube, dan Instagram.

### A1. CI di GitHub (minggu 1)

1. Buat `.github/workflows/check.yml` yang menjalankan `npm ci` lalu `npm run check` di setiap push dan pull request, memakai Node 22.
2. Tambahkan badge status CI di bagian atas README.

**Selesai kalau:** PR baru menampilkan centang hijau/merah dari GitHub Actions.

### A2. Test tampilan platform (minggu 1–2)

Masalah yang mau dicegah: tampilan X pernah berubah (hilangnya `data-testid`) dan HideMent jadi "0 dipindai" tanpa ada yang sadar.

1. Tambah dev dependency `happy-dom`.
2. Simpan potongan HTML asli per platform di `tests/fixtures/` (dianonimkan: ganti nama akun & teks). Minimal: X tampilan lama, X tampilan baru, TikTok, YouTube, Instagram.
3. Buat `tests/adapters.test.ts` (`// @vitest-environment happy-dom`) yang mengecek per fixture:
   - `findComments` menemukan jumlah komentar yang benar;
   - `getText`, `getAuthor`, `getPermalink`, dan `getMenuButton` tidak kosong;
   - `getCommentCount` membaca angka yang benar (mis. 347);
   - `getBadgeSlot` mengembalikan baris nama akun (`where: "inline"` atau `"after"`), bukan `"row"`.

**Selesai kalau:** menghapus satu selektor di adapter membuat test merah.

### A3. Peringatan "tampilan platform berubah" (minggu 2)

Kalau Analyze dijalankan di postingan yang jumlah komentarnya lebih dari 0 tetapi adapter tidak menemukan satu komentar pun, tampilkan pesan yang jelas di popup & side panel:

> "HideMent tidak bisa membaca komentar di halaman ini. Kemungkinan tampilan <platform> berubah. Laporkan ke pengembang."

Pesannya disertai tombol yang membuka halaman issue GitHub baru dengan judul sudah terisi.

File yang disentuh: `src/content/fast-scan.ts`, `src/sidepanel/sidepanel.ts`, `src/popup/popup.ts`.

**Selesai kalau:** di fixture yang selektornya sengaja dirusak, pesan itu muncul, bukan "0 komentar".

### A4. Uji & perbaiki lapor otomatis per platform (minggu 3–4)

Pakai **akun uji** (bukan akun pribadi) dan postingan milik tim sendiri yang komentarnya diisi teks judol palsu.

| Platform | Yang dicek |
|---|---|
| X | Form "Apa yang Anda laporkan?" → alasan terpilih → **Berikutnya** → sub-alasan → **Kirim** → konfirmasi terbaca |
| TikTok | Menu ⋯ → Laporkan → Perjudian → Kirim → konfirmasi |
| YouTube | ⋯ → Laporkan → Spam atau menyesatkan → Berikutnya → Laporkan → konfirmasi |
| Instagram | ⋯ → Laporkan → Spam → konfirmasi; cek juga posisi badge di samping nama |

Untuk tiap platform:

1. Catat teks tombol & teks konfirmasi yang muncul (bahasa Indonesia **dan** Inggris).
2. Tambahkan teks yang belum dikenali ke `REASON_RE`, `NEXT_RE`, `SUBMIT_RE`, atau `SENT_RE` di `src/content/report-helper.ts`, beserta test-nya di `tests/report-reasons.test.ts` / `tests/links.test.ts`.
3. Tulis hasilnya di tabel README bagian Troubleshooting.

**Selesai kalau:** "Laporkan semua otomatis" untuk 5 komentar uji di tiap platform menghasilkan "Sukses! 5 komentar berhasil dilaporkan".

---

## B. Orang kedua: Fitur & Rilis

### Tugasmu, singkatnya

> **Bikin HideMent siap dipakai orang umum.** Ada tema terang, pengaturan bisa dipindah ke komputer lain, bisa pakai AI lokal tanpa biaya, dan ada paket siap upload ke Chrome Web Store.

### B1. Tema terang (minggu 1)

1. Di `src/styles/theme.css`, tambah token warna terang di `@media (prefers-color-scheme: light)`. Sekarang semua warna hanya versi gelap.
2. Tambah pilihan **Tema: Ikuti sistem / Gelap / Terang** di Pengaturan → Tampilan. Simpan di `settings.display.theme`; dark/light dipasang lewat atribut `data-theme` di `<html>`.
3. Cek popup, side panel, dan halaman Pengaturan di dua tema. Badge di halaman (overlay.css) tetap terbaca di X/TikTok mode terang.

**Selesai kalau:** screenshot popup, side panel, dan Pengaturan di tema terang & gelap ada di PR, tanpa teks yang sulit dibaca.

### B2. Ekspor & impor pengaturan (minggu 1–2)

1. Di Pengaturan → Data: tombol **Ekspor pengaturan** (file `.json`) dan **Impor pengaturan**.
2. **API key TIDAK ikut diekspor.** Ekspor: mode, tampilan, ambang skor, whitelist, kata kunci, dan contoh belajar (opsional, dengan centang).
3. Impor dicek dengan `sanitizeSettings` dari `src/core/settings.ts`. File rusak tidak boleh merusak pengaturan yang ada.
4. Logika murninya taruh di `src/core/` + test.

**Selesai kalau:** ekspor di satu browser lalu impor di browser lain menghasilkan pengaturan yang sama (kecuali API key), dan test lulus.

### B3. AI lokal tanpa biaya: Ollama (minggu 2–3)

1. Uji HideMent dengan [Ollama](https://ollama.com) (endpoint `http://localhost:11434/v1`) memakai 2–3 model kecil yang bisa bahasa Indonesia.
2. Tambah tombol preset **"Pakai Ollama di komputer ini"** di Pengaturan → Koneksi AI yang mengisi Base URL otomatis.
3. Tulis panduan `docs/ollama.md`: cara install, model yang disarankan, kecepatan per batch, dan batasannya.
4. Jalankan `npm run eval` dengan model lokal, lalu tulis hasilnya di panduan.

**Selesai kalau:** orang awam bisa mengikuti `docs/ollama.md` dari nol sampai badge muncul tanpa API key berbayar.

### B4. Paket rilis Chrome Web Store (minggu 3–4)

1. Script `npm run release` (`scripts/release.mjs`) yang menjalankan `npm run check` lalu membuat `hidement-<versi>.zip` dari `dist/`.
2. Halaman kebijakan privasi `docs/privacy.md` (bahasa Indonesia & Inggris). Isinya: data apa yang diproses, bahwa teks komentar hanya dikirim ke endpoint AI pilihan pengguna, tidak ada server HideMent, dan lapor otomatis memakai akun pengguna.
3. Bahan listing di `docs/store/`: deskripsi singkat & panjang, 5 screenshot 1280×800, dan ikon 128.
4. Checklist izin: jelaskan kenapa tiap permission di `static/manifest.json` dibutuhkan (ditanya saat review Chrome Web Store).

**Selesai kalau:** zip bisa di-load unpacked tanpa error, dan semua bahan listing lengkap di `docs/store/`.

### Bonus (kalau waktu sisa): Firefox

Coba build untuk Firefox MV3 (`npm run build -- --firefox`): `browser_specific_settings` di manifest, dan ganti `sidePanel` dengan `sidebar_action`. Tulis apa yang belum jalan.

---

## Jadwal

| Minggu | Orang pertama | Orang kedua |
|---|---|---|
| 1 | A1 CI, mulai A2 | B1 tema terang, mulai B2 |
| 2 | A2 selesai, A3 | B2 selesai, mulai B3 |
| 3 | A4 (X, TikTok) | B3 selesai, mulai B4 |
| 4 | A4 (YouTube, IG), demo | B4 selesai, demo |

## Aturan kirim kerja

- Satu tugas = satu branch = satu PR. Contoh nama branch: `ci/check`, `test/adapter-fixtures`, `feat/tema-terang`, `feat/ekspor-pengaturan`, `docs/ollama`, `build/release-zip`.
- `npm run check` hijau sebelum push. Setelah A1 selesai, CI juga harus hijau.
- Jangan push langsung ke `main`; MyKineID yang review & merge.

## Dilarang

- Memakai akun pribadi atau melapor komentar orang sungguhan saat menguji lapor otomatis.
- Commit API key, `.env`, atau HTML fixture yang masih berisi nama akun asli.
- Menambah dependency selain `happy-dom` tanpa diskusi dulu.

## Kalau mentok

Tulis di issue GitHub dan tandai MyKineID. Mentok lebih dari 1 hari → langsung kabari di grup.

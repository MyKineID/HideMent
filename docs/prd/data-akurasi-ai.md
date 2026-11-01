# PRD 2: Data & Akurasi AI

**Untuk:** Orang kedua
**Durasi:** 4 minggu
**Reviewer:** MyKineID

---

## Tugasmu, singkatnya

> **Bikin deteksi AI HideMent tidak ngawur, pakai komentar asli dari TikTok.**
>
> Kumpulkan komentar dari 9 link TikTok → cek labelnya satu per satu → jadikan dataset → ukur akurasi AI → perbaiki sampai angkanya naik.

Kamu **tidak** mengerjakan Reddit. Itu tugas orang pertama (PRD 1).

---

## Hasil akhir yang harus ada

1. File dataset `research/dataset/tiktok-2026-11.jsonl`: komentar asli yang **sudah kamu cek** dan **sudah dianonimkan**.
2. Fitur `--examples` di `research/eval.ts` supaya akurasi bisa diukur **dengan** contoh belajar.
3. Laporan angka **sebelum vs sesudah** (ditulis di deskripsi PR).
4. Panduan label diperbarui (minimal 10 contoh pola baru).
5. Aturan judol baru untuk pola yang selalu lolos (plus test).

---

## Langkah kerja

### Tugas 0: Setup (hari 1)

```bash
git clone https://github.com/MyKineID/HideMent.git
cd HideMent
npm ci
npm run check
npm run dev
```

1. Buka `chrome://extensions`, nyalakan **Developer mode**, klik **Load unpacked**, lalu pilih folder `dist/`.
2. Minta Base URL + API key AI ke MyKineID, lalu isi di Pengaturan → Koneksi AI. **Jangan pernah di-commit.**
3. **Login TikTok** di Chrome itu. Tanpa login, TikTok hanya memberi 20 komentar per video.

**Selesai kalau:** buka satu video TikTok, klik ikon HideMent → **Analyze komentar postingan ini**, dan label Aman/Sedang/Tinggi muncul di komentar.

---

### Tugas 1: Kumpulkan komentar (minggu 1)

1. Buka HideMent → ikon ⚙ Pengaturan → **Contoh belajar**.
2. Di kartu **Belajar dari link postingan**, tempel 9 link di bawah, lalu klik **Pelajari komentar dari 9 link**.
3. Side panel terbuka dan mengerjakan link satu per satu. **Jangan tutup tab yang dibuka HideMent** sampai semua link berstatus selesai.
4. **Lapor otomatis harus MATI.** Kita cuma mengumpulkan data, bukan melapor.

```
https://vt.tiktok.com/ZSgG8TFAQ/
https://vt.tiktok.com/ZSgGLVqBM/
https://vt.tiktok.com/ZSgt3X328/
https://vt.tiktok.com/ZSgWe36m3/
https://vt.tiktok.com/ZSgvtJE2J/
https://vt.tiktok.com/ZSgvteMH1/
https://vt.tiktok.com/ZSgvt1awm/
https://vt.tiktok.com/ZSgvtUVRM/
https://vt.tiktok.com/ZSgvtcHUp/
```

**Selesai kalau:** ke-9 link berstatus selesai di side panel, dan Antrian berisi komentar yang terdeteksi.

---

### Tugas 2: Cek label satu per satu (minggu 1–2)

Di side panel **Antrian**, untuk **setiap** komentar:

- Deteksinya benar → klik **Benar**
- Deteksinya salah (sebenarnya komentar biasa) → klik **Salah, aman**

Kalau ragu, baca `research/labeling-guide.md`. Prinsipnya: **kritik keras ≠ hinaan**, dan **nada positif ≠ aman** (promosi judol sering bernada positif).

**Selesai kalau:** tidak ada lagi komentar di Antrian yang belum diberi Benar/Salah.

---

### Tugas 3: Ekspor & bersihkan dataset (minggu 2)

1. Di side panel, klik ikon **buku** (Ekspor dataset AI) untuk mengunduh file `.jsonl`.
2. Buat script `research/anonymize.ts` (jalankan dengan `npx tsx research/anonymize.ts <input> <output>`) yang:
   - **menghapus** kolom `url`, `report`, dan `reason`;
   - mengganti `@namaakun` di teks dengan `@user`, nomor HP dengan `08xx`, dan link dengan `[link]`;
   - **membuang** baris duplikat dan baris `perlu_review: true` (yang belum kamu cek).
3. Simpan hasilnya ke `research/dataset/tiktok-2026-11.jsonl`.
4. **Jangan commit file mentah hasil ekspor.** Yang di-commit hanya file yang sudah bersih.

**Selesai kalau:** semua baris di file punya `"perlu_review": false`, tidak ada nama akun asli/nomor HP/link, dan PR berisi script + dataset sudah dibuka.

---

### Tugas 4: Ukur akurasi SEBELUM (minggu 2)

```bash
NINE_ROUTER_BASE_URL=... NINE_ROUTER_API_KEY=... NINE_ROUTER_MODEL=... \
  npm run eval -- research/dataset/tiktok-2026-11.jsonl
```

Catat angka ini: **precision, recall, F1 per kategori**, dan **false positive pada komentar aman**. Inilah angka **SEBELUM**.

---

### Tugas 5: Tambah fitur `--examples` di eval (minggu 3)

Saat ini `research/eval.ts` belum memakai contoh belajar, jadi efek "AI belajar" belum bisa diukur. Kerjakan:

1. Bagi dataset jadi dua file secara acak dengan seed tetap: **70% `train`** (dipakai sebagai contoh) dan **30% `test`** (dipakai untuk menguji). **Satu komentar tidak boleh ada di dua file**, kalau tidak skornya palsu.
2. Tambah opsi `--examples <file.jsonl>` di `eval.ts`. Isinya dibaca dengan `parseExamples` lalu `new ExampleIndex(...)`, dan untuk tiap batch AI ambil contoh dengan `index.pick(...)`. Contohnya ada di `src/background/batcher.ts`; pakai `buildUserPrompt(items, examples)`.
3. Jalankan dua kali pada file `test`:
   ```bash
   npm run eval -- research/dataset/tiktok-test.jsonl
   npm run eval -- research/dataset/tiktok-test.jsonl --examples research/dataset/tiktok-train.jsonl
   ```

**Selesai kalau:** tabel **sebelum vs sesudah** ada di deskripsi PR, dan F1 judol **naik** atau false positive **turun**.

---

### Tugas 6: Perbarui panduan label (minggu 3)

Tambah **minimal 10 contoh baru** di `research/labeling-guide.md` dari pola yang kamu temukan di TikTok, misalnya: slang/emoji judol baru, nama situs baru, dan komentar yang membingungkan (sarkasme vs hinaan). Tiap contoh diberi alasan singkat kenapa labelnya begitu.

---

### Tugas 7: Aturan judol baru (minggu 4)

1. Dari hasil eval, cari komentar judol yang **selalu lolos** (tidak terdeteksi).
2. Tambah polanya di `src/core/judol-rules.ts`.
3. Tambah test-nya di `tests/judol-rules.test.ts`.
4. Pastikan `npm run eval` di `research/dataset/sample.jsonl` **tidak** menambah false positive.

**Selesai kalau:** `npm run check` hijau dan pola baru terdeteksi tanpa AI.

---

## Jadwal

| Minggu | Kerjakan |
|---|---|
| 1 | Tugas 0, 1, mulai 2 |
| 2 | Selesaikan 2, lalu 3, 4 |
| 3 | 5, 6 |
| 4 | 7, demo ke tim |

## Aturan kirim kerja

- Satu tugas = satu branch = satu PR. Contoh nama branch: `data/tiktok-dataset`, `feat/eval-examples`, `fix/judol-rules-pola-baru`.
- Sebelum push: `npm run check` harus hijau.
- Jangan push langsung ke `main`. MyKineID yang me-review dan merge.
- Format commit: `data: ...`, `feat: ...`, `fix: ...`, `docs: ...` (bahasa Indonesia).

## Dilarang

- Commit API key, `.env`, atau dataset mentah yang belum dianonimkan.
- Menyalakan lapor otomatis saat mengumpulkan data.
- Memakai label tebakan AI yang belum kamu cek sebagai kunci jawaban eval.

## Kalau mentok

Tulis di issue GitHub dan tandai MyKineID. Mentok lebih dari 1 hari → langsung kabari di grup.

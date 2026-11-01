# PRD: Onboarding 2 Kontributor HideMent

| | |
|---|---|
| **Status** | Siap dibagikan |
| **Pemilik proyek / reviewer** | MyKineID |
| **Kontributor** | Kontributor A (Platform & Adapter), Kontributor B (Data & Akurasi AI) |
| **Durasi siklus pertama** | 4 minggu |
| **Repo** | https://github.com/MyKineID/HideMent |

---

## 1. Tujuan

HideMent sudah bisa mendeteksi, menyembunyikan, dan melapor komentar berbahaya di YouTube, Instagram, TikTok, dan X. Supaya makin berguna, dua orang kontributor baru ikut membangun dengan pembagian yang jelas dan tidak saling bertabrakan:

| Peran | Fokus | Hasil akhir siklus ini |
|---|---|---|
| **Kontributor A: Platform & Adapter** | Menambah platform baru dan menjaga selektor DOM tetap jalan | Dukungan **Reddit** sesuai [PRD Reddit](reddit-platform.md), dirilis di v0.3.0 |
| **Kontributor B: Data & Akurasi AI** | Membuat AI tidak "ngawur": dataset nyata, contoh belajar, evaluasi | Dataset komentar TikTok nyata yang sudah dicek manusia + laporan evaluasi akurasi sebelum/sesudah |

Ukuran keberhasilan siklus pertama:

- Kedua kontributor bisa build & menjalankan ekstensi sendiri di hari pertama.
- Minimal **6 PR** ter-merge (3 per orang), semuanya lulus `npm run check`.
- F1 deteksi judol di dataset TikTok nyata **naik** dibanding baseline (diukur dengan `npm run eval`).
- False positive pada komentar aman **turun** atau minimal tidak naik.

## 2. Hari pertama: setup

### 2.1 Yang dibutuhkan

- Git, Node.js ≥ 18, Chrome / Edge ≥ 116.
- Akun GitHub (diundang sebagai *collaborator* oleh pemilik repo, lihat bagian 8).
- Opsional: endpoint AI kompatibel OpenAI (mis. 9router) untuk mode selain Judol. Minta ke pemilik proyek; **jangan pernah commit API key**.

### 2.2 Langkah

```bash
git clone https://github.com/MyKineID/HideMent.git
cd HideMent
npm ci
npm run check      # typecheck + test + build, harus hijau sebelum mulai
npm run dev        # build + watch selama ngoding
```

1. Buka `chrome://extensions`, nyalakan **Developer mode**, klik **Load unpacked**, pilih folder `dist/`.
2. Setelah mengubah kode, `npm run dev` membangun ulang otomatis; klik ikon reload HideMent di `chrome://extensions`, lalu refresh tab.
3. Buka satu video TikTok, klik ikon HideMent → **Analyze komentar postingan ini**. Kalau badge muncul, setup selesai.

### 2.3 Peta kode (baca dulu, ±1 jam)

| Folder | Isi | Paling relevan untuk |
|---|---|---|
| `src/content/adapters/` | Selektor DOM per platform | A |
| `src/content/fast-scan.ts` | Memuat semua komentar (Analyze komentar postingan ini) | A |
| `src/content/report-helper.ts` | Alur lapor (bantu & otomatis) | A |
| `src/core/judol-rules.ts`, `phishing.ts`, `normalize.ts` | Aturan lokal tanpa AI | B |
| `src/core/prompt.ts`, `examples.ts`, `dataset.ts` | Prompt AI, contoh belajar, data dari Antrian | B |
| `src/sidepanel/` | Antrian, Analyze dari link, lapor otomatis, Benar/Salah | A & B |
| `research/` | Dataset, `label.ts`, `eval.ts`, `bench.ts`, panduan label | B |
| `tests/` | Unit test (Vitest) | A & B |

## 3. Alur kerja Git

1. Ambil satu issue dari board (bagian 5). Tulis komentar "saya ambil" supaya tidak dobel.
2. Buat branch dari `main` terbaru:
   ```bash
   git switch main && git pull
   git switch -c feat/reddit-adapter      # atau fix/..., data/..., docs/...
   ```
3. Commit kecil-kecil dengan format yang sudah dipakai di repo ini (bahasa Indonesia):
   - `feat: dukungan Reddit di Analyze dari link`
   - `fix(tiktok): selektor tombol lapor berubah`
   - `data: 300 komentar TikTok berlabel dari 9 postingan`
   - `docs: panduan label kategori sarkasme`
4. Sebelum push: `npm run check` harus hijau.
5. Buka Pull Request ke `main`. Isi deskripsi: **apa yang berubah, kenapa, cara mengujinya**, dan screenshot kalau ada perubahan UI.
6. MyKineID me-review. Perbaiki komentar review dengan commit baru (jangan force-push setelah review dimulai).
7. Setelah approve, pemilik yang melakukan merge. Hapus branch setelah merge.

Aturan penting:

- **Jangan push langsung ke `main`.**
- Satu PR = satu topik. PR besar (> ~400 baris kode) dipecah.
- Kalau dua orang perlu mengubah file yang sama (mis. `src/core/types.ts`), koordinasikan dulu di issue.

## 4. Konvensi kode

- TypeScript strict; tidak ada `any` baru kecuali benar-benar perlu dan diberi alasan.
- Teks UI dan komentar kode dalam **bahasa Indonesia**. Komentar menjelaskan *kenapa*, bukan mengulang *apa*.
- Selektor DOM platform **hanya** boleh ada di `src/content/adapters/`.
- Warna & komponen pakai token di `src/styles/theme.css`. Gaya visual: modern/bersih, sentuhan Rimuru Tempest halus, Raphael sebagai suara sistem. Jangan menambah gaya pixel/8-bit.
- Dependency baru (npm) didiskusikan dulu di issue. Ekstensi harus tetap kecil.
- Logika murni (tanpa DOM/`chrome.*`) ditaruh di `src/core/` dan **wajib** punya test di `tests/`.
- Privasi: tidak ada request ke server selain endpoint AI pengguna. Tidak ada analytics.

## 5. Backlog siklus pertama

Pemilik proyek membuat issue GitHub dari tabel ini (label `peran:A` / `peran:B`).

### Kontributor A: Platform & Adapter

| ID | Tugas | Selesai jika |
|---|---|---|
| A1 | Registrasi platform Reddit (FR-1 s.d. FR-6 di PRD Reddit) | Link Reddit dikenali di *Analyze dari link*; test link lulus |
| A2 | Adapter Reddit baru: deteksi, author, permalink, jumlah komentar (FR-7 s.d. FR-16) | Badge muncul di thread uji; fixture test lulus |
| A3 | Fast scan Reddit: "more replies", "View more comments" (FR-17 s.d. FR-20) | Thread 300+ komentar termuat sampai batas `scan.max` |
| A4 | old.reddit: deteksi + mode bantu lapor (FR-21 s.d. FR-23) | Checklist manual di PR terpenuhi |
| A5 | Lapor otomatis Reddit + `SENT_RE` (FR-24 s.d. FR-26) | "Sukses! N komentar berhasil dilaporkan" di subreddit uji |
| A6 | Fixture test adapter TikTok (pakai `happy-dom`), supaya perubahan DOM TikTok cepat ketahuan | Test gagal kalau selektor `comment-level-1` / `comment-count` hilang |

### Kontributor B: Data & Akurasi AI

| ID | Tugas | Selesai jika |
|---|---|---|
| B1 | **Kumpulkan dataset TikTok nyata** dari 9 link yang sudah dikumpulkan tim (lihat lampiran A): *Analyze dari link* tanpa lapor otomatis → cek tiap komentar dengan **Benar / Salah, aman** → **Ekspor dataset (JSONL)** | File mentah tersimpan lokal (tidak di-commit sebelum dianonimkan) |
| B2 | Anonimkan & bersihkan dataset: hapus kolom `url`, ganti nama akun/nomor HP/link pribadi di teks dengan placeholder, buang duplikat | `research/dataset/tiktok-<tanggal>.jsonl` ter-commit, semua baris `perlu_review: false` |
| B3 | Baseline evaluasi: jalankan `npm run eval -- research/dataset/tiktok-<tanggal>.jsonl` dengan model yang dipakai tim, simpan ringkasan | `research/results/` (lokal) + ringkasan angka di deskripsi PR |
| B4 | Perkuat contoh belajar: impor komentar hasil cek (Pengaturan → Contoh belajar → Impor), ulangi eval, bandingkan | Tabel sebelum/sesudah (precision, recall, F1, false positive) di PR |
| B5 | Perbarui `research/labeling-guide.md` dengan pola baru yang ditemukan di TikTok (mis. slang/emoji judol baru, batas sarkasme vs hinaan) | Minimal 10 contoh baru beserta alasannya |
| B6 | Usulkan aturan lokal baru untuk pola judol yang selalu lolos (mis. merek situs baru) di `src/core/judol-rules.ts` + test | Test baru lulus; false positive di `sample.jsonl` tidak naik |

### Kerja bersama

| ID | Tugas | Pemilik |
|---|---|---|
| C1 | Uji lapor otomatis di TikTok & YouTube memakai **akun uji**, catat tingkat keberhasilan dan pesan konfirmasi baru untuk `SENT_RE` | A menulis kode, B menyiapkan daftar komentar uji |
| C2 | Demo internal di akhir minggu ke-4: alur link → analyze → cek → lapor | Berdua |

## 6. Definisi selesai (berlaku untuk setiap PR)

- [ ] `npm run check` hijau di lokal.
- [ ] Logika baru di `src/core/` punya test.
- [ ] Diuji manual di Chrome dengan ekstensi hasil build (sebutkan platform & URL uji di PR, tanpa data pribadi).
- [ ] Tidak ada API key, `.env`, atau data pribadi (nama akun asli, nomor HP) di commit.
- [ ] README / dokumen terkait diperbarui kalau perilaku berubah.
- [ ] Screenshot untuk perubahan UI.

## 7. Etika & keamanan

- **Lapor otomatis mengirim laporan sungguhan** atas nama akun yang login. Saat menguji, pakai akun uji dan subreddit/akun milik tim. Jangan menguji dengan melapor komentar orang yang tidak berbahaya.
- Dataset berisi komentar orang sungguhan: **anonimkan sebelum di-commit** (bagian B2). Jangan unggah dataset mentah ke tempat publik.
- Hasil AI bukan kebenaran. Hanya komentar yang sudah dicek manusia yang boleh masuk contoh belajar atau dataset evaluasi (`perlu_review: false`).
- Temukan celah keamanan? Laporkan langsung ke pemilik proyek, jangan dibuka di issue publik.

## 8. Checklist pemilik proyek (MyKineID)

- [ ] Undang kedua kontributor: GitHub → repo → *Settings* → *Collaborators* → *Add people* (peran **Write**).
- [ ] Aktifkan *branch protection* untuk `main`: wajib PR, minimal 1 approval, wajib status check bila CI sudah ada.
- [ ] Buat label `peran:A`, `peran:B`, `bersama`, `bug`, `data`, `docs`.
- [ ] Buat issue dari backlog bagian 5 dan susun di GitHub Projects (kolom: Todo, Dikerjakan, Review, Selesai).
- [ ] Bagikan endpoint AI uji (tanpa key produksi) lewat jalur privat.
- [ ] Jadwalkan sinkronisasi mingguan 30 menit.

## 9. Jadwal

| Minggu | Kontributor A | Kontributor B |
|---|---|---|
| 1 | Setup, baca kode, A1 | Setup, baca `research/`, B1 |
| 2 | A2, A6 | B2, B3 (baseline) |
| 3 | A3, A4 | B4, B5 |
| 4 | A5, C1, demo | B6, C1, demo |

## 10. Komunikasi

- Diskusi teknis: di issue/PR GitHub supaya tercatat.
- Pertanyaan cepat: grup chat tim.
- Blokir lebih dari 1 hari: tandai pemilik proyek di issue.

---

## Lampiran A: Link TikTok untuk dataset awal (B1)

Tempel seluruh daftar ini sekaligus di side panel → **Analyze dari link** (format chat WhatsApp tidak perlu dibersihkan):

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

Matikan *Langsung laporkan otomatis* untuk pengumpulan data; lapor dilakukan setelah hasilnya dicek.

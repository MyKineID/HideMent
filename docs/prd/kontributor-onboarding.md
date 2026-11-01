# Aturan Bersama Kontributor HideMent

Dibaca **dua-duanya** sebelum mulai. Isinya cara setup, cara kirim kerja, dan aturan. Tugas masing-masing ada di PRD sendiri.

## 1. Siapa mengerjakan apa

| Orang | Baca PRD ini | Tugas singkatnya |
|---|---|---|
| **Orang pertama** | [PRD 1: Dukungan Platform Reddit](reddit-platform.md) | Bikin HideMent jalan di Reddit: deteksi, Analyze, Analyze dari link, lapor otomatis |
| **Orang kedua** | [PRD 2: Data & Akurasi AI](data-akurasi-ai.md) | Kumpulkan komentar asli dari 9 link TikTok, cek labelnya, ukur & naikkan akurasi AI |
| **Berdua** | [PRD 3: Melengkapi HideMent](melengkapi-hidement.md) | Orang pertama: CI, test tampilan platform, lapor otomatis per platform. Orang kedua: tema terang, ekspor/impor pengaturan, Ollama, rilis Chrome Web Store |
| **Berdua** | [PRD 4: Pengecekan 3 platform](pengecekan-3-platform.md) | Orang pertama cek YouTube & Instagram, orang kedua cek TikTok, pakai checklist C1–C18 |

Reviewer & yang merge: **MyKineID**. Durasi: 4 minggu. Repo: https://github.com/MyKineID/HideMent

Kalian tidak saling menunggu: orang pertama bekerja di `src/content/adapters/` dan file platform, orang kedua di `research/` dan `src/core/judol-rules.ts`. Kalau perlu mengubah file yang sama (mis. `src/core/types.ts`), kabari dulu di issue.

## 2. Hari pertama: setup

### 2.1 Yang dibutuhkan

- Git, Node.js ≥ 18, Chrome / Edge ≥ 116.
- Akun GitHub (diundang sebagai *collaborator* oleh pemilik repo, lihat bagian 7).
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

1. Ambil satu tugas dari PRD-mu (sebaiknya sudah dibuat jadi issue). Tulis komentar "saya ambil" supaya tidak dobel.
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

## 5. Definisi selesai (berlaku untuk setiap PR)

- [ ] `npm run check` hijau di lokal.
- [ ] Logika baru di `src/core/` punya test.
- [ ] Diuji manual di Chrome dengan ekstensi hasil build (sebutkan platform & URL uji di PR, tanpa data pribadi).
- [ ] Tidak ada API key, `.env`, atau data pribadi (nama akun asli, nomor HP) di commit.
- [ ] README / dokumen terkait diperbarui kalau perilaku berubah.
- [ ] Screenshot untuk perubahan UI.

## 6. Etika & keamanan

- **Lapor otomatis mengirim laporan sungguhan** atas nama akun yang login. Saat menguji, pakai akun uji dan subreddit/akun milik tim. Jangan menguji dengan melapor komentar orang yang tidak berbahaya.
- Dataset berisi komentar orang sungguhan: **anonimkan sebelum di-commit** (PRD 2, Tugas 3). Jangan unggah dataset mentah ke tempat publik.
- Hasil AI bukan kebenaran. Hanya komentar yang sudah dicek manusia yang boleh masuk contoh belajar atau dataset evaluasi (`perlu_review: false`).
- Temukan celah keamanan? Laporkan langsung ke pemilik proyek, jangan dibuka di issue publik.

## 7. Checklist pemilik proyek (MyKineID)

- [ ] Undang kedua kontributor: GitHub → repo → *Settings* → *Collaborators* → *Add people* (peran **Write**).
- [ ] Aktifkan *branch protection* untuk `main`: wajib PR, minimal 1 approval, wajib status check bila CI sudah ada.
- [ ] Buat label `reddit`, `data`, `bug`, `docs`.
- [ ] Buat satu issue per tugas di PRD 1 dan PRD 2, susun di GitHub Projects (kolom: Todo, Dikerjakan, Review, Selesai).
- [ ] Bagikan endpoint AI uji (tanpa key produksi) lewat jalur privat.
- [ ] Jadwalkan sinkronisasi mingguan 30 menit.

## 8. Komunikasi

- Diskusi teknis: di issue/PR GitHub supaya tercatat.
- Pertanyaan cepat: grup chat tim.
- Blokir lebih dari 1 hari: tandai pemilik proyek di issue.


# PRD 5: Sistem Limit Komentar

**Untuk:** Kontributor yang ditunjuk MyKineID
**Durasi:** 2 minggu
**Reviewer:** MyKineID

---

## Tugasmu, singkatnya

> **Bikin HideMent membaca komentar sebanyak yang pengguna mau, tidak lebih, di semua cara pindai, dan tetap ringan di postingan yang komentarnya ribuan (terutama X).**
>
> Ada satu batas yang jelas per postingan → batas itu dipatuhi di mode *Tekan Analyze*, *Saat scroll*, *Pindai cepat*, dan *Analyze dari link* → saat batas tercapai, pengguna melihat "300 dari 2.709 komentar dibaca · batas tercapai" dan bisa menekan **Baca 300 lagi**.

Kamu **tidak** mengubah mesin deteksi (`src/core/engine/`). Mesinnya sudah cepat (±0,2–0,4 ms per komentar); yang mahal adalah memuat & menggulir komentar di halaman platform.
Setup & aturan Git ada di [Aturan bersama](kontributor-onboarding.md).

| Minggu | Kerjakan | Selesai kalau |
|---|---|---|
| 1 | Model pengaturan + logika batas yang bisa dites (FR-1 s.d. FR-8) | `npm run check` hijau, test baru untuk sanitasi & logika batas lulus |
| 2 | Pasang batas di semua cara pindai + UI minimal + uji di X (FR-9 s.d. FR-20) | Thread X 1.000+ balasan: berhenti tepat di batas, tombol *Baca N lagi* jalan, tab tidak patah-patah |

Detail lengkap tiap poin ada di bawah.

---

| | |
|---|---|
| **Status** | Siap dikerjakan (struktur; belum diimplementasikan) |
| **Target rilis** | HideMent v0.4.0 |
| **Dokumen terkait** | `src/core/settings.ts`, `src/content/index.ts`, `src/content/fast-scan.ts`, `src/content/adapters/x.ts`, `src/sidepanel/sidepanel.ts`, `src/options/` |

---

## 1. Latar belakang

Keadaan sekarang (cek sendiri di kode sebelum mulai):

| Cara pindai | Batas yang berlaku sekarang | Masalah |
|---|---|---|
| **Tekan Analyze** / **Pindai cepat** (`FastScanner` di `src/content/fast-scan.ts`) | `settings.scan.max` (50–2000, bawaan 300), dicek di loop `run()` | Sudah ada, tapi hanya di sini. Setelah berhenti, tidak ada cara melanjutkan selain menaikkan angka di Pengaturan. |
| **Saat scroll** (`IntersectionObserver` di `src/content/index.ts`) | **Tidak ada.** Setiap komentar yang terlihat dianalisis | Di X, menggulir thread ramai bisa memuat ribuan balasan; semuanya dianalisis dan dicatat. |
| **Analyze dari link** (side panel) | Memakai `scan.max` per link lewat `FastScanner` | Tidak ada batas total untuk satu putaran banyak link. |
| Memori label | `VERDICT_MEMORY = 6000` per halaman, antrian `QUEUE_MAX = 500` | Tidak terlihat oleh pengguna; batas komentar seharusnya membuat angka ini jarang tersentuh. |

X paling berat karena: (1) satu postingan bisa punya ribuan balasan, (2) X membuang komentar dari DOM saat digulir lalu menggambarnya ulang (virtualisasi), jadi menghitung elemen DOM selalu salah, (3) X punya dua versi DOM (dengan dan tanpa `data-testid`, lihat `src/content/adapters/x.ts`).

Mesin lokal tidak butuh batas demi biaya (gratis), tapi batas tetap perlu supaya: tab tidak berat karena terus digulir, pengguna tahu kapan analisis selesai, dan *Analyze dari link* dengan banyak link tidak berjalan berjam-jam.

## 2. Tujuan

| # | Tujuan | Ukuran keberhasilan |
|---|---|---|
| G1 | Satu batas komentar per postingan berlaku di **semua** cara pindai | Di 4 cara pindai, jumlah komentar yang dianalisis per postingan ≤ batas (diuji manual + unit test) |
| G2 | Hitungan yang benar walau DOM digambar ulang | Di X, komentar yang sama yang muncul lagi saat scroll **tidak** dihitung dua kali (pakai fingerprint teks, bukan elemen) |
| G3 | Pengguna bisa melanjutkan tanpa membuka Pengaturan | Tombol **Baca N lagi** di bar pindai menambah kuota postingan itu saja |
| G4 | Tetap ringan | Thread X 1.000+ balasan dengan batas 300: CPU tab tidak macet (tidak ada long task > 200 ms dari HideMent di Performance panel) |
| G5 | UI tetap bersih | Tambahan UI maksimal: 1 kolom angka + 1 opsi lanjutan di Pengaturan, 1 tombol di bar pindai, 1 baris teks di popup |
| G6 | Tidak ada regresi | Semua test lama lulus, `npm run check` hijau |

## 3. Bukan tujuan (v0.4.0)

- Mengubah mesin deteksi, kamus, atau database contoh.
- Memakai API platform (X API, dsb.). HideMent tetap membaca DOM.
- Memilih komentar "terpenting" dengan algoritma sendiri. Urutan baca tetap urutan yang ditampilkan platform.
- Batas per hari/per akun. Batas hanya per postingan dan per putaran *Analyze dari link*.

## 4. Pengguna & skenario

| Persona | Skenario |
|---|---|
| **Pembaca biasa di X** | Mode *Saat scroll*. Menggulir thread viral; HideMent berhenti menganalisis setelah 300 komentar dan bar menampilkan "batas tercapai · Baca 300 lagi". |
| **Moderator** | Menempel 20 link di *Analyze dari link*, batas 200 per link dan 3.000 total; side panel menampilkan sisa kuota. |
| **Pengguna laptop kentang** | Menurunkan batas ke 100 supaya tab tetap ringan. |

## 5. Kebutuhan fungsional

### 5.1 Model pengaturan

| ID | Kebutuhan | File |
|---|---|---|
| FR-1 | Tambah `scan.limit` berisi `perPost` (bawaan 300, rentang 50–5.000), `perRun` untuk *Analyze dari link* (bawaan 3.000, rentang 100–20.000), dan `perPlatform` (opsional, override per platform; bawaan kosong) | `src/core/settings.ts` |
| FR-2 | Migrasi: nilai `scan.max` lama dipindah ke `scan.limit.perPost`, lalu `scan.max` dibuang. Naikkan `SCHEMA` | `src/core/settings.ts` (`loadSettings`) |
| FR-3 | Sanitasi: nilai di luar rentang dikoreksi, override platform yang tidak dikenal dibuang (pola sama dengan `sanitizeSettings` sekarang) | `src/core/settings.ts` |
| FR-4 | Fungsi murni `limitFor(settings, platform): number` (override platform kalau ada, kalau tidak `perPost`) | `src/core/settings.ts` atau file baru `src/core/limits.ts` |

### 5.2 Logika batas (bisa dites tanpa browser)

| ID | Kebutuhan | File |
|---|---|---|
| FR-5 | Kelas/fungsi `CommentBudget` per postingan: `allow(fingerprint): boolean` (true kalau komentar baru dan kuota masih ada), `used`, `limit`, `extend(n)`, `reset()` | file baru `src/core/limits.ts` |
| FR-6 | Hitungan memakai **fingerprint teks** (sama dengan `data-rg-fp` yang sudah dipakai `verdictByFp`), bukan elemen DOM. Komentar yang digambar ulang tidak memakan kuota lagi | `src/core/limits.ts`, `src/content/index.ts` |
| FR-7 | Kuota direset saat pindah postingan (pakai `postKey()` yang sudah ada), bukan saat DOM berubah | `src/content/index.ts` |
| FR-8 | Unit test: kuota habis tepat di batas, fingerprint ganda tidak dihitung, `extend` menambah kuota, reset saat postingan berganti | `tests/limits.test.ts` |

### 5.3 Menerapkan batas di semua cara pindai

| ID | Kebutuhan | File |
|---|---|---|
| FR-9 | `queueForAnalysis` hanya memasukkan komentar ke `outbox` kalau `budget.allow(fp)`. Komentar yang sudah punya label tetap dipasang lagi labelnya (dari `verdictByFp`) tanpa memakan kuota | `src/content/index.ts` |
| FR-10 | `FastScanner.run()` memakai `budget.limit` menggantikan `deps.max()`, dan berhenti menggulir begitu kuota habis (tidak memuat komentar yang tidak akan dianalisis) | `src/content/fast-scan.ts` |
| FR-11 | Mode *Saat scroll*: saat kuota habis, berhenti mengamati komentar baru (`visibility.observe`) sampai pengguna menekan *Baca N lagi* | `src/content/index.ts` |
| FR-12 | *Analyze dari link*: tiap link memakai batas per postingan; putaran berhenti kalau total komentar dibaca mencapai `perRun`, link sisanya ditandai "Dilewati: batas putaran tercapai" | `src/sidepanel/sidepanel.ts` |
| FR-13 | Pesan `ScanProgress` membawa `limit` dan `reason: "limit" | "end" | "stopped" | "error"` supaya popup & side panel bisa menampilkan alasan berhenti yang tepat | `src/shared/messages.ts`, `src/content/fast-scan.ts` |

### 5.4 UI (minimal, jangan tambah yang tidak perlu)

| ID | Kebutuhan | File |
|---|---|---|
| FR-14 | Pengaturan → Pemindaian: kolom **Batas komentar per postingan** menggantikan "Batas per pindai" (satu kolom, bukan kolom baru). Override per platform & batas per putaran masuk ke `<details>` "Pengaturan lanjutan" yang sudah ada polanya | `src/options/options.html`, `src/options/options.ts` |
| FR-15 | Bar pindai di halaman (`.rg-scanbar`): saat berhenti karena batas, teks "300 dari 2.709 komentar dibaca · batas tercapai" + tombol **Baca 300 lagi** (N = batas). Tombol memanggil `budget.extend(N)` untuk postingan itu saja, tidak mengubah pengaturan | `src/content/fast-scan.ts`, `src/content/overlay.css` |
| FR-16 | Popup: baris progres yang sudah ada menambahkan "· batas 300" kalau batas yang menghentikan pindai | `src/popup/popup.ts` |
| FR-17 | Side panel *Analyze dari link*: ringkasan menampilkan "x / perRun komentar" | `src/sidepanel/sidepanel.ts` |

### 5.5 Kinerja & ketahanan

| ID | Kebutuhan | File |
|---|---|---|
| FR-18 | `scan()` di content script tidak boleh memproses elemen yang sudah punya `data-rg-id` lagi; pastikan throttle `SCAN_THROTTLE_MS` tetap dipakai saat X menggambar ulang ratusan node | `src/content/index.ts` |
| FR-19 | Setelah kuota habis, `MutationObserver` tetap jalan hanya untuk memasang ulang label komentar yang sudah dinilai (X), bukan untuk mengirim komentar baru | `src/content/index.ts` |
| FR-20 | Uji manual di X: thread 1.000+ balasan, batas 300 di mode *Saat scroll* dan *Pindai cepat*. Catat di PR: jumlah dianalisis (harus 300), apakah ada long task > 200 ms dari `content.js` (DevTools → Performance), dan apakah label tetap menempel saat scroll balik ke atas | catatan di PR |

## 6. Kriteria selesai

- [ ] FR-1 s.d. FR-20 terpenuhi; tiap FR punya commit atau test yang bisa ditunjuk.
- [ ] `tests/limits.test.ts` dan test sanitasi pengaturan baru lulus; `npm run check` hijau.
- [ ] Pengaturan lama dengan `scan.max` termigrasi tanpa kehilangan nilai (test).
- [ ] Tidak ada elemen UI baru selain yang disebut di 5.4. Tampilan hero/banner Raphael di Pengaturan **tidak diubah**.
- [ ] README: bagian Konfigurasi menyebut batas komentar per postingan dan tombol *Baca N lagi*.
- [ ] Screenshot/GIF di PR: bar pindai di X saat batas tercapai, dan setelah *Baca N lagi*.

## 7. Pertanyaan terbuka (putuskan bersama reviewer)

1. Bawaan batas untuk X: tetap 300 seperti platform lain, atau lebih kecil (mis. 200) karena thread X jauh lebih panjang?
2. Apakah balasan (replies) dihitung ke batas yang sama, atau punya kuota sendiri?
3. Apakah komentar dari akun whitelist ikut memakan kuota? (Usul: tidak, karena tidak dianalisis.)
4. Perlukah batas waktu (mis. berhenti setelah 3 menit menggulir) selain batas jumlah?

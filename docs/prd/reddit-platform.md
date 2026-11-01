# PRD: Dukungan Platform Reddit

| | |
|---|---|
| **Status** | Draft, siap dikerjakan |
| **Pemilik produk** | MyKineID |
| **Pelaksana** | Kontributor A (lihat [PRD kontributor](kontributor-onboarding.md)) |
| **Target rilis** | HideMent v0.3.0 |
| **Dokumen terkait** | `src/content/adapters/`, `src/core/links.ts`, `research/labeling-guide.md` |

---

## 1. Latar belakang

HideMent saat ini mendukung YouTube, Instagram, TikTok, dan X. Komunitas Indonesia di Reddit (mis. r/indonesia, r/indotech, r/finansial, subreddit kampus & game) juga mulai dibanjiri promosi judol, link phising "giveaway", dan ujaran kebencian, terutama di thread yang ramai. Moderator subreddit kecil biasanya hanya 1–3 orang dan menyisir komentar secara manual.

Reddit berbeda dari platform lain dalam tiga hal penting:

1. **Thread bercabang dalam** (balasan bisa 10+ tingkat) dan banyak cabang disembunyikan di balik tombol "more replies" / "View more comments".
2. **Dua tampilan yang masih dipakai**: Reddit baru (`www.reddit.com`, web component `shreddit-*`) dan Reddit lama (`old.reddit.com`, HTML klasik).
3. **Campuran bahasa**: komentar Indonesia bercampur Inggris dan slang; aturan lokal judol tetap berlaku, tapi mode lain bergantung pada AI.

## 2. Tujuan

| # | Tujuan | Ukuran keberhasilan |
|---|---|---|
| G1 | Komentar Reddit dideteksi sama baiknya dengan platform lain | ≥ 95% komentar yang terlihat di halaman ikut dianalisis (diuji di 10 thread nyata) |
| G2 | **Analyze komentar postingan ini** bekerja di thread Reddit | Membaca jumlah komentar thread, memuat semua cabang sampai batas `scan.max`, menampilkan "x dari y komentar" |
| G3 | **Analyze dari link** menerima link Reddit | `reddit.com/r/.../comments/...`, `redd.it/...`, dan link share `reddit.com/r/.../s/...` dikenali |
| G4 | **Lapor otomatis** bekerja di Reddit baru | ≥ 80% komentar judol/spam berhasil dilapor otomatis dengan konfirmasi platform (uji 20 komentar di subreddit uji milik tim) |
| G5 | Tidak ada regresi di platform lain | Semua test lama lulus, `npm run check` hijau |

## 3. Bukan tujuan (v0.3.0)

- Memakai **Reddit API / OAuth**. HideMent tetap membaca DOM halaman, tanpa server dan tanpa token.
- Tindakan moderator (remove, ban, lock). HideMent hanya menandai, menyembunyikan, dan melapor sebagai pengguna biasa.
- Aplikasi Reddit mobile dan `i.reddit.com`.
- Postingan (submission) itu sendiri. Yang dianalisis hanya komentar.
- Lapor otomatis di Reddit lama (cukup mode bantu: isi form, pengguna yang menekan kirim).

## 4. Pengguna & skenario

| Persona | Skenario |
|---|---|
| **Pembaca biasa** | Membuka thread r/indonesia, komentar judol & phising otomatis diblur. |
| **Moderator subreddit** | Menempel 10 link thread ramai di *Analyze dari link*, mengecek Antrian, lalu *Laporkan semua otomatis* untuk spam judol. |
| **Peneliti/kontributor dataset** | Menganalisis thread, menandai Benar/Salah, lalu mengekspor dataset JSONL untuk `npm run eval`. |

## 5. Kebutuhan fungsional

### 5.1 Registrasi platform

| ID | Kebutuhan | File |
|---|---|---|
| FR-1 | Tambah `"reddit"` ke tipe `Platform`, `settings.platforms` (bawaan **aktif**), dan label "Reddit" di semua UI yang memetakan platform | `src/core/types.ts`, `src/core/settings.ts`, `src/sidepanel/sidepanel.ts`, `src/popup/popup.ts`, `src/options/options.html` |
| FR-2 | Ikon Reddit (garis, 24×24, gaya sama dengan ikon lain, bukan logo resmi) | `src/shared/icons.ts` |
| FR-3 | `host_permissions` dan `content_scripts.matches`: `https://www.reddit.com/*`, `https://old.reddit.com/*`, `https://sh.reddit.com/*` | `static/manifest.json` |
| FR-4 | `detectAdapter` mengenali host `reddit.com` dan subdomainnya | `src/content/adapters/index.ts` |
| FR-5 | `extractPostLinks` dan `postIdOf` mengenali `reddit.com/r/<sub>/comments/<id>/...`, `redd.it/<id>`, dan link share `/r/<sub>/s/<kode>` (dibuka lalu diikuti redirect-nya) | `src/core/links.ts` + `tests/links.test.ts` |
| FR-6 | Regex tab aktif yang dipakai side panel & popup (`SUPPORTED_RE`, `PLATFORM_HOSTS`) ikut menerima Reddit | `src/sidepanel/sidepanel.ts`, `src/popup/popup.ts` |

### 5.2 Adapter Reddit baru (`www.reddit.com`)

Implementasi interface `Adapter` di `src/content/adapters/reddit.ts`.

| ID | Method | Perilaku yang diharapkan (verifikasi ulang di DOM terbaru sebelum menulis selektor) |
|---|---|---|
| FR-7 | `findComments` | Setiap elemen `shreddit-comment`. Komentar bersarang adalah elemen terpisah; jangan sampai teks balasan ikut terbaca sebagai bagian komentar induk. |
| FR-8 | `getText` / `getTextEl` | Isi komentar di `[slot="comment"]` milik komentar itu sendiri (bukan turunan `shreddit-comment` lain). Komentar `[deleted]` / `[removed]` dilewati. |
| FR-9 | `getAuthor` | Atribut `author` pada `shreddit-comment`, tanpa awalan `u/`. |
| FR-10 | `getPermalink` | Atribut `permalink` (dijadikan URL absolut) supaya tombol *Lihat* langsung membuka komentar. |
| FR-11 | `getBadgeSlot` | Baris di atas teks komentar (`where: "row"`). |
| FR-12 | `getMenuButton` | Tombol overflow (⋯) komentar (`shreddit-overflow-menu` atau tombol ber-`aria-label` "more options"). Catat jika tombol ada di dalam shadow root dan perlu `el.shadowRoot`. |
| FR-13 | `isPostPage` | `/r/<sub>/comments/<id>/...` |
| FR-14 | `getCommentCount` | Atribut `comment-count` pada `shreddit-post` milik thread ini; fallback teks "N comments"/"N komentar" diparse dengan `parseCount`. |
| FR-15 | `openComments` | Tidak perlu di thread normal. Jika thread dibuka dari feed dalam bentuk modal/overlay, klik tombol komentar. |
| FR-16 | `reportReason` | Petakan kategori ke alasan Reddit: judol/spam → "Spam"; phishing/scam → "Spam" lalu sub-alasan link berbahaya bila ada; hinaan/perundungan → "Harassment"; ancaman → "Threatening violence"; sara/penistaan → "Hate"; pelecehan → "Sexualization" hanya bila relevan, selain itu "Harassment". Tambahkan daftar teks opsi Reddit ke `tests/report-reasons.test.ts`. |

### 5.3 Memuat semua komentar

| ID | Kebutuhan |
|---|---|
| FR-17 | Fast scan menekan tombol "more replies", "View more comments", dan "Continue this thread" (tanpa pindah halaman). Tambahkan pola teksnya (Inggris & Indonesia) ke `EXPAND_RE` atau ke selektor khusus Reddit. |
| FR-18 | "Continue this thread" yang membuka halaman baru **tidak** diklik saat fast scan (akan memutus pemindaian); cukup dicatat sebagai cabang yang tidak termuat. |
| FR-19 | Reddit memuat komentar di jendela utama (bukan panel), jadi `scrollerFor` akan jatuh ke `window`. Pastikan fast scan berhenti saat jumlah komentar tidak bertambah 4 putaran, seperti platform lain. |
| FR-20 | Komentar yang dirender ulang Reddit (virtualisasi/hydration) tidak boleh dianalisis dua kali: andalkan fingerprint teks yang sudah ada (`hashText`). |

### 5.4 Reddit lama (`old.reddit.com`)

| ID | Kebutuhan |
|---|---|
| FR-21 | Adapter terpisah atau cabang di adapter yang sama: komentar = `.thing.comment`, teks = `.usertext-body .md` milik komentar itu, author = `.author`, permalink = `a.bylink`. |
| FR-22 | Tombol "load more comments" (`.morecomments a`) diklik saat fast scan. |
| FR-23 | Lapor: mode bantu saja (isi form, berhenti di tombol kirim). Lapor otomatis dinonaktifkan dengan pesan "Lapor otomatis belum didukung di old.reddit". |

### 5.5 Lapor otomatis

| ID | Kebutuhan |
|---|---|
| FR-24 | Alur `runReportFlow` yang sudah ada dipakai ulang. Kalau dialog lapor Reddit memakai shadow DOM, tambahkan pencarian ke shadow root di `report-helper.ts` (fungsi `dialogButtons`, `findReasonOption`) tanpa merusak platform lain. |
| FR-25 | Tambahkan teks konfirmasi Reddit ("Thanks for your report", dll.) ke `SENT_RE` beserta test-nya. |
| FR-26 | Aturan keamanan tetap: hanya kirim kalau alasan cocok otomatis, jeda antar laporan, maks. 50 per putaran, dan komentar bertanda "Salah, aman" tidak pernah dilapor. |

## 6. Kebutuhan non-fungsional

- **Performa**: memindai thread 500 komentar tidak membuat halaman tersendat (> 100 ms main thread per putaran scan dianggap gagal). Gunakan throttle `SCAN_THROTTLE_MS` yang sudah ada.
- **Privasi**: tidak ada request baru selain ke endpoint AI pengguna. Tidak ada scraping ke luar halaman yang sedang dibuka.
- **Ketahanan selektor**: semua selektor Reddit ada di satu file adapter dan diberi komentar asal-usulnya (atribut/tag apa yang dicari), supaya mudah diperbarui saat Reddit mengubah DOM.
- **Aksesibilitas**: badge & popover tetap bisa dioperasikan keyboard seperti di platform lain.

## 7. Pengujian

| Jenis | Isi |
|---|---|
| Unit | `tests/links.test.ts` (link Reddit), `tests/report-reasons.test.ts` (opsi lapor Reddit), `SENT_RE` Reddit. |
| Fixture adapter | Simpan potongan HTML thread nyata (dianonimkan) di `tests/fixtures/reddit-*.html`, uji `findComments`/`getText`/`getAuthor`/`getCommentCount` memakai DOM tiruan (tambah dev dependency `happy-dom` dan `// @vitest-environment happy-dom` di file test). |
| Manual | Checklist di PR: thread kecil (< 20 komentar), thread besar (> 300), thread dengan "Continue this thread", old.reddit, komentar dihapus, mode gelap/terang Reddit. |
| Regresi | `npm run check` hijau; uji cepat YouTube & TikTok satu postingan masing-masing. |

## 8. Kriteria selesai (acceptance)

- [ ] Membuka thread Reddit dengan komentar judol contoh → badge Judol muncul tanpa AI.
- [ ] *Analyze komentar postingan ini* menampilkan "x dari y komentar" dengan y = jumlah komentar thread.
- [ ] *Analyze dari link* menerima link `reddit.com/.../comments/...`, `redd.it`, dan link share `/s/`.
- [ ] *Laporkan semua otomatis* di Reddit baru menghasilkan "Sukses! N komentar berhasil dilaporkan" pada subreddit uji.
- [ ] old.reddit: deteksi & mode bantu lapor jalan; lapor otomatis menolak dengan pesan jelas.
- [ ] README (tabel platform, troubleshooting, roadmap) diperbarui.
- [ ] Tidak ada perubahan perilaku di YouTube/Instagram/TikTok/X.

## 9. Rencana kerja

| Minggu | Hasil |
|---|---|
| 1 | FR-1 s.d. FR-6 (registrasi platform & link) + test link. Riset DOM Reddit baru: catat selektor di komentar PR. |
| 2 | Adapter Reddit baru (FR-7 s.d. FR-16) + fixture test. Deteksi & badge jalan. |
| 3 | Fast scan Reddit (FR-17 s.d. FR-20) + jumlah komentar. old.reddit (FR-21 s.d. FR-23). |
| 4 | Lapor otomatis (FR-24 s.d. FR-26), uji di subreddit uji, README, rilis v0.3.0. |

## 10. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Reddit sering mengubah web component / shadow DOM | Deteksi berhenti | Selektor terpusat di adapter, fixture test, prioritaskan atribut (`author`, `thingid`, `comment-count`) daripada nama kelas |
| Akun pelapor dibatasi Reddit karena terlalu banyak laporan | Akun pengguna terkena rate limit | Jeda antar laporan, batas 50 per putaran, konfirmasi sebelum mulai, uji hanya di subreddit uji milik tim |
| Komentar berbahasa Inggris memicu salah deteksi | False positive | Aturan judol tidak diubah; dokumentasikan di `labeling-guide.md`; kumpulkan contoh "aman" berbahasa Inggris lewat tombol *Salah, aman* |
| Thread sangat besar (ribuan komentar) | Pemindaian lama | Tetap dibatasi `scan.max`, tampilkan "x dari y" supaya pengguna tahu masih ada sisa |

## 11. Pertanyaan terbuka

1. Apakah perlu daftar subreddit yang otomatis di-whitelist (mis. subreddit yang memang membahas judi sebagai topik riset)?
2. Apakah moderator butuh ekspor khusus (mis. daftar permalink untuk mod queue) di luar CSV/JSONL yang sudah ada?
3. Perlu dukungan `new.reddit.com` lama (tampilan 2018) atau cukup `www` + `old`?

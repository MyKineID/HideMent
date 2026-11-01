# PRD 4: Pengecekan HideMent di YouTube, Instagram, TikTok

**Untuk:** Orang pertama & orang kedua
**Durasi:** 2 minggu
**Reviewer:** MyKineID

---

## Tugasmu, singkatnya

> **Coba semua fitur HideMent di platformmu, langkah demi langkah, lalu catat mana yang jalan dan mana yang rusak.**
>
> Tidak perlu ngoding (kecuali mau ikut memperbaiki). Yang dibutuhkan: teliti, screenshot, dan laporan yang jelas.

| Orang | Platform yang dicek |
|---|---|
| **Orang pertama** | **YouTube** dan **Instagram** |
| **Orang kedua** | **TikTok** |

Hasil akhir: satu file hasil per platform (`docs/qa/hasil-youtube.md`, `docs/qa/hasil-instagram.md`, `docs/qa/hasil-tiktok.md`) dan satu issue GitHub untuk setiap cek yang gagal.

---

## 1. Persiapan (hari 1)

1. Setup sesuai [Aturan bersama](kontributor-onboarding.md): `git clone`, `npm ci`, `npm run build`, lalu Load unpacked folder `dist/`.
2. Hubungkan AI di Pengaturan → Koneksi AI (minta Base URL + key ke MyKineID).
3. Pengaturan → Pemindaian → **Kapan mendeteksi: Tekan Analyze** (bawaan).
4. Pakai **akun uji**, bukan akun pribadi, dan **login** di platformnya. TikTok tanpa login hanya memberi 20 komentar.
5. Siapkan **postingan uji milik sendiri** (video YouTube unlisted, postingan IG, video TikTok), lalu isi komentarnya dari akun uji lain. Campur:
   - 5 komentar judol palsu, diambil dari `research/dataset/sample.jsonl` (label `judol`);
   - 2 komentar phishing palsu (label `phishing`);
   - 10 komentar biasa (pujian, pertanyaan, kritik);
   - minimal 2 balasan (reply) di bawah komentar lain.

> Lapor otomatis **hanya** boleh diuji di postingan uji ini. Jangan melapor komentar orang sungguhan.

---

## 2. Checklist (sama untuk setiap platform)

Kerjakan berurutan. Tulis **Lulus / Gagal / Sebagian** untuk setiap cek. Kalau gagal, sertakan screenshot.

| ID | Langkah | Hasil yang seharusnya |
|---|---|---|
| C1 | Buka postingan uji, **jangan** tekan apa pun | Tidak ada badge di komentar. Popup menampilkan **jumlah komentar** sama dengan angka di platform |
| C2 | Buka side panel | Baris bawah: "N komentar di postingan ini · tekan Analyze untuk mendeteksi" |
| C3 | Tekan **Analyze komentar postingan ini** | Komentar dimuat sendiri **tanpa scroll manual**; progres "x dari N komentar" berjalan |
| C4 | Tunggu sampai selesai | **Setiap** komentar punya badge **Aman / Sedang / Tinggi** di **samping nama akun** (tidak menambah baris) |
| C5 | Cek komentar judol & phishing palsu | Semuanya badge **Tinggi** dengan kategori Judi Online / Link Phising |
| C6 | Cek komentar biasa | Badge **Aman**; kritik keras tidak boleh jadi Tinggi |
| C7 | Cek balasan (reply) | Balasan ikut dimuat dan diberi badge |
| C8 | Scroll manual naik-turun | Badge tetap ada, tidak hilang dan tidak dobel |
| C9 | Buka popup lagi | Angka aman / sedang / tinggi masuk akal dan sama dengan isi Antrian |
| C10 | Di Antrian, klik **Lihat** pada satu komentar | Langsung ke komentar itu (disorot) |
| C11 | Klik badge → popover | Alasan, jenis, dan sumber (Aturan lokal / AI) tampil |
| C12 | Klik **Lapor** pada satu komentar (mode bantu) | Menu ⋯ → Laporkan terbuka, alasan terpilih, berhenti di tombol Kirim. **Halaman tidak menggulir sendiri** |
| C13 | **Laporkan semua otomatis** (komentar uji saja) | Muncul "Sukses! N komentar berhasil dilaporkan"; status di Antrian jadi "Sudah dilapor" |
| C14 | Tandai satu komentar **Salah, aman**, lalu ulangi C13 | Komentar itu **tidak** ikut dilapor |
| C15 | Pindah ke postingan lain | Tidak ada badge sampai Analyze ditekan lagi di postingan itu |
| C16 | Side panel → **Analyze dari link**, tempel link postingan uji | Link dikenali, dibuka, dan dianalisis; ringkasan "x dari N komentar · y berbahaya" |
| C17 | Pengaturan → Contoh belajar → **Belajar dari link**, tempel link postingan uji | Contoh "dari link postingan" bertambah di daftar |
| C18 | Ganti tema platform (gelap ↔ terang) | Badge & toast tetap terbaca |

---

## 3. Catatan khusus per platform

### YouTube (orang pertama)

- Cek **dua jenis halaman**: video biasa (`/watch?v=`) dan **Shorts** (`/shorts/`).
- C1: jumlah komentar diambil dari judul "1.234 Komentar" di atas kolom komentar. Di Shorts, dari tombol komentar.
- C10: link komentar YouTube berbentuk `&lc=...`; komentar seharusnya tampil sebagai "Komentar yang disorot".
- C12–C13: alasan yang diharapkan "Spam atau menyesatkan" (judol/phishing), lalu **Berikutnya** → **Laporkan**.
- Catat juga: apakah komentar di dalam "Balasan" (C7) ikut terbuka.

### Instagram (orang pertama)

- Cek tiga bentuk: postingan foto (`/p/`), **Reels** (`/reel/`), dan postingan yang dibuka sebagai **pop-up** dari profil.
- C1: Instagram sering **tidak menampilkan** jumlah komentar. Kalau tidak ada, popup menulis "terlihat" (jumlah yang sudah dimuat). Catat di mana angka komentar muncul di layarmu, kalau ada.
- C4: badge seharusnya **tepat setelah nama akun**. Kalau menempel di tempat aneh atau merusak tata letak, screenshot.
- C12: menu ⋯ komentar IG kadang hanya muncul saat kursor di atas komentar. Catat apakah HideMent tetap bisa membukanya.

### TikTok (orang kedua)

- Cek dua tampilan: halaman video (`/@akun/video/...`) dan **link pendek** `vt.tiktok.com/...` (redirect).
- C3: panel kanan punya tab **"Comments | You may like"**. HideMent harus membuka tab Comments sendiri. Catat kalau panel tetap di "You may like".
- C3: kalau berhenti di ±20 komentar padahal jumlahnya ratusan, cek dulu sudah login. Kalau sudah login dan masih berhenti, itu **bug**.
- C10 & C12: komentar TikTok tidak punya link sendiri, jadi HideMent menggulir **panel komentar** (bukan halaman) untuk mencarinya. Catat kalau halamannya ikut bergeser.
- C12–C13: alasan yang diharapkan "Perjudian" untuk judol.
- C16–C17: pakai juga 9 link TikTok tim (ada di [PRD 2](data-akurasi-ai.md#tugas-1-kumpulkan-komentar-minggu-1)), **lapor otomatis mati**.

---

## 4. Cara mencatat hasil

Buat file `docs/qa/hasil-<platform>.md` dengan format ini:

```markdown
# Hasil pengecekan: TikTok
Tanggal: 2026-11-10 · Browser: Chrome 152 · HideMent: 0.2.0 (commit abc1234) · Login: ya

| ID | Hasil | Catatan |
|---|---|---|
| C1 | Lulus | popup 347, platform 347 |
| C3 | Gagal | berhenti di 20 dari 2.169 walau sudah login → issue #12 |
| ... | | |
```

Commit `docs/qa/` lewat PR (branch `qa/tiktok`, `qa/youtube`, `qa/instagram`).

## 5. Cara melaporkan yang gagal

Satu cek gagal = satu issue GitHub. Judul: `[cek][tiktok] C3: berhenti di 20 komentar`.

Isi issue:

1. **Halaman:** jenis URL (mis. video TikTok, Reels IG), **tanpa** link akun pribadi.
2. **Langkah:** apa yang kamu klik, berurutan.
3. **Seharusnya:** salin dari kolom "Hasil yang seharusnya".
4. **Kenyataan:** apa yang terjadi.
5. **Screenshot** (sensor nama akun orang lain).
6. **Log error:**
   - halaman: klik kanan → Inspect → tab Console, salin baris merah;
   - service worker: `chrome://extensions` → HideMent → *Inspect views: service worker* → Console.

## 6. Kalau mau ikut memperbaiki (opsional)

Selektor tiap platform ada di `src/content/adapters/` (`youtube.ts`, `instagram.ts`, `tiktok.ts`). Teks tombol & konfirmasi lapor ada di `src/content/report-helper.ts`. Perbaikan dikirim sebagai PR terpisah dari PR hasil cek, dengan menyebut nomor issue-nya.

---

## Jadwal

| Hari | Orang pertama | Orang kedua |
|---|---|---|
| 1–2 | Persiapan, akun uji, postingan uji YouTube & IG | Persiapan, akun uji, video uji TikTok |
| 3–5 | Checklist YouTube (watch + Shorts) | Checklist TikTok (halaman video + link pendek) |
| 6–8 | Checklist Instagram (post, Reels, pop-up) | C16–C17 dengan 9 link tim, ulang cek yang gagal |
| 9–10 | Kirim `hasil-youtube.md`, `hasil-instagram.md`, dan issue | Kirim `hasil-tiktok.md` dan issue |

## Selesai kalau

- [ ] Tiga file `docs/qa/hasil-*.md` ter-merge, semua C1–C18 terisi.
- [ ] Setiap cek yang **Gagal** punya issue dengan screenshot.
- [ ] Tidak ada akun asli / data pribadi di file hasil maupun issue.

## Dilarang

- Melapor komentar orang sungguhan, atau menyalakan lapor otomatis di postingan yang bukan milik tim.
- Memakai akun pribadi untuk uji lapor.
- Commit API key atau screenshot yang memperlihatkan nama akun orang lain tanpa disensor.

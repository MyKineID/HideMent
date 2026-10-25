<p align="center">
  <img src="docs/raphael.webp" alt="Raphael Guard" width="220" />
</p>

<h1 align="center">Raphael Guard</h1>

<p align="center">
  Ekstensi browser berbasis AI untuk mendeteksi <b>komentar berbahaya berbahasa Indonesia</b>,<br/>
  mulai dari promosi judi online (judol), link phising, sampai hinaan dan perundungan.
</p>

<p align="center">
  Chrome / Edge (Manifest V3) · YouTube · Instagram · TikTok · X
</p>

---

## Latar belakang

Kolom komentar media sosial Indonesia, terutama YouTube, dipenuhi:

- **Promosi judi online** yang disamarkan dengan huruf hias (`𝐒𝐋𝐎𝐓 𝐆𝐀𝐂𝐎𝐑`), nama situs merek+angka (`PULAU138`), atau ajakan "cek bio".
- **Link phising dan penipuan** yang meniru bank, e-wallet, atau platform.
- **Perundungan dan hinaan**, termasuk **sarkasme** yang tidak tertangkap filter kata kasar biasa.

Jumlah komentarnya terlalu banyak untuk diperiksa manual. Akibatnya komentar berbahaya terlewat, sementara filter sederhana malah ikut menandai kritik yang wajar.

## Tujuan

Raphael Guard **tidak** bertujuan menghapus semua komentar negatif. Tujuannya:

1. **Mengurangi komentar yang benar-benar merugikan** pengguna dan kreator.
2. **Tetap membiarkan kritik normal.** "Editingnya jelek" atau "argumennya lemah" adalah kritik, bukan serangan.
3. **Membantu moderator memprioritaskan**: komentar diberi skor risiko 0–100 dan diurutkan dari yang paling berbahaya.
4. **Mempermudah pelaporan** dengan saran alasan laporan yang sesuai. Keputusan akhir tetap di tangan manusia.

## Dua mode

| Mode | Yang dideteksi |
|---|---|
| 🎰 **Anti Judol / Link Phising** | judi online, link phising, penipuan (hadiah palsu, investasi bodong, pinjol), spam |
| 🛡 **Anti Hate / Toxic** | hinaan, perundungan, ujaran SARA, ancaman, pelecehan, sarkasme yang merendahkan |

Kedua mode bisa dinyalakan bersamaan atau terpisah.

## Fitur

- **Badge + skor risiko** di samping komentar (Tinggi / Sedang), lengkap dengan alasannya.
- **Highlight, blur, atau sembunyikan.** Semuanya bisa dinyalakan/dimatikan dan diatur per kategori. Komentar yang diblur bisa dibuka dengan klik.
- **Dashboard Antrian** di side panel: daftar komentar berbahaya dari semua tab, diurutkan dari risiko tertinggi, bisa difilter dan diekspor ke CSV.
- **Bantu Laporkan**: membuka menu laporan platform dan menyarankan alasannya. Laporan tetap dikirim oleh pengguna sendiri.
- **Whitelist** akun tepercaya dan **kata kunci kustom**.
- **Tombol "Bukan berbahaya"** untuk mencatat salah deteksi sebagai data riset.

## Cara kerja

```
Komentar terlihat di layar
        │
        ▼
Normalisasi teks ─── huruf hias, leetspeak (g4c0r), spasi (s l o t), huruf Kiril tiruan
        │
        ▼
Aturan lokal (tanpa API) ── judol yang jelas langsung ditandai
        │ sisanya
        ▼
Cache ── komentar yang sama tidak dinilai dua kali
        │ yang baru
        ▼
AI via 9router (API OpenAI-compatible) ── dikirim berkelompok, ±20 komentar per request
        │
        ▼
Badge · highlight · blur · Dashboard Antrian
```

Ekstensi ini hemat dan cepat karena hanya komentar yang terlihat yang diperiksa, judol yang jelas tidak perlu ke AI, dan hasil penilaian disimpan di cache.

## Instalasi

**Kebutuhan:** Node.js 18+ dan endpoint AI yang kompatibel dengan OpenAI. Proyek ini memakai 9router, tapi endpoint `/v1/chat/completions` lain juga bisa.

```bash
git clone https://github.com/MyKineID/raphael-guard.git
cd raphael-guard
npm install
npm run build
```

1. Buka `chrome://extensions` (atau `edge://extensions`).
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**, lalu pilih folder `dist/`.
4. Di halaman Pengaturan yang terbuka otomatis, isi **Base URL** dan **API Key**, klik **Ambil Model**, pilih model, lalu klik **Tes Koneksi**.
5. Buka kolom komentar YouTube, Instagram, TikTok, atau X.

> Tanpa API pun, deteksi judol berbasis aturan lokal tetap berjalan.

## Privasi

- Teks komentar **hanya dikirim ke endpoint AI yang kamu isi sendiri**. Tidak ada server pihak ketiga.
- API key disimpan di penyimpanan lokal browser.
- Ekstensi tidak pernah mengirim laporan atau melakukan aksi apa pun atas nama pengguna.

## Riset & evaluasi

Folder [`research/`](research) berisi:

- [`labeling-guide.md`](research/labeling-guide.md): definisi tiap label dan batas antara **komentar berbahaya** dan **kritik wajar**.
- [`dataset/sample.jsonl`](research/dataset/sample.jsonl): contoh dataset berlabel.
- `eval.ts`: menghitung precision, recall, dan F1 per kategori, serta **false positive pada komentar aman**.

```bash
NINE_ROUTER_BASE_URL=http://host:20128/v1 NINE_ROUTER_API_KEY=sk-... NINE_ROUTER_MODEL=nama-model npm run eval
```

Kontribusi dataset (komentar nyata yang sudah dianonimkan) sangat membantu meningkatkan akurasi.

## Pengembangan

```bash
npm run dev        # build + watch
npm test           # unit test (normalisasi, aturan judol, phising, parser AI)
npm run typecheck
```

Struktur singkat:

| Folder | Isi |
|---|---|
| `src/core/` | normalisasi teks, aturan judol & phising, prompt AI |
| `src/background/` | klien 9router, antrian batch, cache |
| `src/content/` | pemindai komentar per platform, overlay, bantu laporkan |
| `src/popup/`, `src/options/`, `src/sidepanel/` | antarmuka |

Instagram dan TikTok sering mengubah struktur halamannya. Kalau komentar tidak terdeteksi, perbarui selektornya di `src/content/adapters/`.

## Kredit

Ilustrasi Raphael digambar sendiri oleh pembuat proyek. Tema warnanya terinspirasi Rimuru & Diablo (*Tensei Shitara Slime Datta Ken*).

## Lisensi

[MIT](LICENSE): bebas dipakai, dimodifikasi, dan dikembangkan.

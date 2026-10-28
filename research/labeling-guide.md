# Panduan Pelabelan: HideMent

Panduan ini menentukan **komentar mana yang benar-benar merugikan** dan mana yang **kritik/ekspresi wajar**. Prinsip utama riset: kurangi komentar berbahaya *tanpa* membungkam kritik normal terhadap kreator.

## Format dataset
Satu komentar per baris (`.jsonl`):
```json
{"text": "isi komentar", "label": "hinaan", "sentimen": "negatif", "platform": "youtube", "note": "opsional"}
```

Dataset contoh (`dataset/sample.jsonl`, 105 komentar) adalah **komentar sintetis** yang meniru gaya komentar sosmed Indonesia. Isinya tidak diambil dari akun orang sungguhan. Nama situs judol di dalamnya fiktif, dan suku/agama ditulis sebagai placeholder `[suku X]`.

## Sentimen (arah komentar)
Sentimen dilabeli **terpisah** dari bahaya:

| Sentimen | Artinya | Contoh |
|---|---|---|
| `positif` | nada memuji, senang, bersyukur, atau mengajak | "videonya bagus banget", **juga** testimoni judol "alhamdulillah wd terus" |
| `netral` | bertanya, informasi, tanpa emosi | "lagunya judulnya apa kak?" |
| `negatif` | kecewa, marah, mengkritik, atau menyerang | "editingnya jelek" (aman), "muka lu kayak kecoak" (hinaan) |

Kenapa dipisah? Karena **nada ≠ bahaya**. Di dataset contoh, mayoritas komentar judol/phising justru bernada positif, sedangkan banyak komentar aman bernada negatif (kritik). Model yang hanya melihat sentimen akan salah dua arah.

## Mode 1: Anti Judol / Link Phising
| Label | Definisi | Contoh |
|---|---|---|
| `judol` | Promosi judi online, termasuk yang disamarkan: testimoni menang/WD, nama situs merek+angka, huruf hias, "cek bio", "ketik di google" | `PULAU138 pasti wd` |
| `phishing` | Link/ajakan ke situs palsu, pencurian akun/OTP, meniru bank/e-wallet/platform | `verifikasi akun di youtube-verify(.)site` |
| `scam` | Penipuan: hadiah palsu, investasi bodong, pinjol ilegal, minta transfer/hubungi admin WA | `profit harian 10% pasti` |
| `spam` | Promosi berulang/tidak relevan selain judi (follow-for-follow, jualan, bot) | `follback kak` |

## Mode 2: Anti Hate / Toxic
| Label | Definisi |
|---|---|
| `hinaan` | Menghina fisik/kecerdasan/martabat orang secara langsung |
| `perundungan` | Merundung, mengajak mengeroyok, menyuruh bunuh diri, mempermalukan |
| `sara` | Kebencian berbasis suku, agama, ras, antargolongan, gender, orientasi, disabilitas |
| `ancaman` | Ancaman kekerasan, doxing, intimidasi |
| `pelecehan` | Pelecehan seksual/komentar cabul ke seseorang |
| `sarkasme` | Sindiran yang **tujuannya merendahkan orang** (pujian palsu, ejekan terselubung) |

## `aman`: jangan ditandai
- **Kritik isi/karya/kebijakan**, sekeras apa pun: "editingnya jelek", "argumennya lemah", "clickbait".
- Kata kasar sebagai ekspresi, bukan untuk menyerang orang: "anjir lucu banget".
- Istilah judol di konteks lain: "gacha-nya rungkad" (game), "Depok" (kota).
- Pujian tulus yang kebetulan berbentuk seperti sarkasme.

## Aturan keputusan
1. Pertanyaan pertama: **apakah ada target orang/kelompok yang dirugikan?** Kalau yang dikritik hanya konten → `aman`.
2. Kalau ada beberapa kategori, pilih yang **paling berbahaya** (ancaman > sara > perundungan > pelecehan > hinaan > sarkasme).
3. Ragu antara sarkasme dan candaan? Lihat apakah ada unsur merendahkan martabat. Kalau tidak ada → `aman`.
4. Judol tanpa kata "judi" tetap `judol` jika polanya jelas (testimoni saldo + arahan ke bio/google + merek+angka).

## Auto-label pakai AI
Untuk menambah data dengan cepat:
1. Kumpulkan komentar mentah di `research/raw/*.txt` (satu per baris). **Hapus nama, username, nomor HP, dan alamat** sebelum dipakai.
2. Jalankan `npm run label -- research/raw/namafile.txt`. AI akan mengisi label, sentimen, skor, alasan, dan keyakinan.
3. Hasilnya ada di `research/dataset/auto-namafile.jsonl`. **Periksa manual** semua baris `"perlu_review": true` (AI ragu, atau bertentangan dengan aturan lokal).
4. Setelah dicek, gabungkan ke dataset utama.

Label dari AI hanyalah **draf**. Keputusan akhir tetap di tangan manusia, supaya evaluasinya tidak bias terhadap AI yang sedang diuji.

## Metrik yang dilaporkan (`npm run eval`)
- Precision/Recall/F1 per kategori dan per mode.
- **False Positive Rate pada komentar `aman`**: metrik kunci agar kritik wajar tidak ikut ditandai.
- Persentase komentar yang diputuskan aturan lokal (hemat API) vs AI.
- Sebaran sentimen per kelompok (judol/phising, toxic, aman).

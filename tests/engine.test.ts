import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { customTerms } from "../src/core/engine/features";
import { SEED_BASE } from "../src/core/engine/seed-data";
import { DecisionEngine, FLAG_MIN, safeMode, type DecideContext } from "../src/core/engine";
import { toDoc } from "../src/core/engine/text";
import type { Category } from "../src/core/types";

const allModes = { judol: true, kebencian: true, pelecehan: true, agama: true, sara: true, kustom: false };
const ctx: DecideContext = { modes: allModes };
const engine = new DecisionEngine();
const decide = (text: string, c: DecideContext = ctx, e = engine) => e.decide({ id: "1", text }, c).verdict;

/** Komentar berbahaya dinilai dengan kategori yang benar DAN skornya sampai ambang sedang (50), seperti di ekstensi. */
function expectFlag(text: string, category: Category) {
  const v = decide(text);
  expect(v.category, `${text} → ${v.category} ${v.score} (${v.reason})`).toBe(category);
  expect(v.score, text).toBeGreaterThanOrEqual(50);
}

function expectSafe(text: string) {
  const v = decide(text);
  const flagged = v.category !== "aman" && v.score >= 50;
  expect(flagged, `${text} → ${v.category} ${v.score} (${v.reason})`).toBe(false);
}

describe("mesin lokal: mendeteksi tiap kategori tanpa AI", () => {
  const cases: [Category, string[]][] = [
    ["judol", ["Kemarin iseng main di KOIN77 eh langsung wd 3jt 🔥", "yang mau saldo nambah tiap hari intip aja bio aku 😁", "W D  5 J T  D I  S I T U S  B I O"]],
    ["phishing", ["Akun kamu diblokir, verifikasi ulang di akun-verify.xyz sekarang", "Kak tadi ada kode OTP nyasar ke nomor kakak, tolong kirim ke aku ya"]],
    ["scam", ["Pinjaman cair 10 menit tanpa BI checking, chat admin wa", "Gabung investasi kami, modal 1jt jadi 10jt dalam sebulan"]],
    ["spam", ["Follow back ya kak, udah aku follow 🙏", "PROMO PROMO PROMO skincare murah, order sekarang!!!"]],
    ["hinaan", ["Dasar goblok, ngomong aja gak becus", "Muka lu kayak monyet, gak usah sok cakep", "t0l0l bgt sih jd orang"]],
    ["perundungan", ["Mending lo mati aja, gak ada yg peduli", "Ayo rame2 spam komen di akunnya biar dia kena mental"]],
    ["ancaman", ["Gw tau rumah lu, tunggu aja nanti malam", "Awas lu, gw cari sampe dapet"]],
    ["sarkasme", ["Wah pinter banget ya, saking pinternya soal SD aja salah 👏👏", "Cantik kok kak, kalau lampunya dimatiin 😂"]],
    ["pelecehan", ["Open BO gak kak? berapa semalam", "Bodynya semok banget kak, kirim pap dong 🤤"]],
    ["penistaan", ["Nabi kalian cuma tokoh dongeng karangan orang", "Kitab suci agama itu isinya sampah semua"]],
    ["sara", ["Orang [suku X] emang dari sananya licik semua", "Perempuan gak usah sekolah tinggi, ujung2nya di dapur juga"]],
  ];
  for (const [cat, texts] of cases) for (const t of texts) it(`${cat}: ${t.slice(0, 45)}`, () => expectFlag(t, cat));
});

describe("mesin lokal: tidak menandai kritik wajar & konteks normal", () => {
  const safe = [
    "Editingnya jelek banget, audionya juga pecah. Tolong diperbaiki",
    "Anjir keren banget transisinya, gimana caranya kak?",
    "Lucu banget kucingnya sampe ngakak 😂😂",
    "Aku goblok banget kemarin salah naik bus",
    "Kamu gak bodoh kok, cuma belum terbiasa",
    "Slot parkir di mall susah banget kalau weekend",
    "Jackpot banget dapet diskon 90% kemarin",
    "Hati-hati guys, yang komen cek bio di atas itu judol, jangan diklik",
    "Jangan pernah kasih kode OTP ke siapa pun ya, itu penipuan",
    "Aku salah transfer ke rekening temen, untung dibalikin",
    "Ketik aja di google cara bikin rendang empuk, banyak resepnya",
    "Babi itu haram dalam Islam, makanya gak dimakan",
    "Selamat hari raya Natal bagi yang merayakan",
    "Orang Jawa kalau ngomong halus banget ya",
    "Cewek juga bisa jadi pemimpin yang hebat",
    "Kak kirim foto katalog produknya dong, mau lihat warna lain",
    "Resep dada ayam bakar madu ini enak banget",
    "Hati-hati di jalan ya kak, semoga selamat sampai tujuan",
    "Tunggu aja, minggu depan aku upload part 3",
    "Wah hebat ya, review jujur tanpa endorse",
    "Kebijakan pemerintah soal ini bener-bener ngawur",
  ];
  for (const t of safe) it(t.slice(0, 50), () => expectSafe(t));
});

describe("keluaran model keputusan", () => {
  it("memberi keyakinan 0–1 untuk setiap kategori mode yang aktif", () => {
    const d = engine.decide({ id: "x", text: "Dasar goblok lu" }, ctx);
    expect(Object.keys(d.probs)).toEqual(expect.arrayContaining(["hinaan", "perundungan", "judol", "sara", "pelecehan"]));
    for (const p of Object.values(d.probs)) expect(p).toBeGreaterThanOrEqual(0), expect(p).toBeLessThanOrEqual(1);
    expect(d.verdict.score).toBe(Math.round(d.probs.hinaan! * 100));
    expect(d.verdict).toMatchObject({ id: "x", mode: "kebencian", source: "model" });
  });

  it("aman = skor di bawah 30 dan mode konteks yang aktif", () => {
    const v = decide("Videonya bagus banget bang");
    expect(v.category).toBe("aman");
    expect(v.score).toBeLessThan(FLAG_MIN * 100);
    expect(v.mode).toBe(safeMode(allModes));
  });

  it("judol yang jelas diputuskan aturan lokal (paling cepat)", () => {
    expect(decide("PULAU138 gacor maxwin pasti wd")).toMatchObject({ category: "judol", source: "rule" });
  });

  it("komentar emoji/pendek dilewati", () => {
    expect(decide("🔥🔥👍")).toMatchObject({ category: "aman", reason: "terlalu pendek" });
  });

  it("mode yang mati tidak pernah dipilih", () => {
    const onlyJudol = { modes: { ...allModes, kebencian: false, pelecehan: false, agama: false, sara: false } };
    expect(decide("Dasar goblok lu, muka kayak monyet", onlyJudol).category).toBe("aman");
    expect(decide("Gw tau rumah lu, tunggu aja", { modes: { ...allModes, kebencian: false } }).category).not.toBe("ancaman");
  });

  it("cepat: rata-rata di bawah 2 ms per komentar setelah pemanasan", () => {
    const texts = ["Dasar goblok lu", "Videonya bagus banget", "cek bio aku ya kak", "Orang [suku X] licik semua", "Open BO kak?"];
    for (const t of texts) decide(t);
    const started = performance.now();
    for (let i = 0; i < 200; i++) for (const t of texts) decide(t);
    expect((performance.now() - started) / 1000).toBeLessThan(2);
  });
});

describe("database contoh (RAG lokal)", () => {
  it("contoh pelecehan & hinaan dari pemilik proyek terdeteksi, dengan bukti contoh database", () => {
    const owner: [string, Category][] = [
      ["ah ange", "pelecehan"],
      ["wlw ❤️", "pelecehan"],
      ["masa harus balik ke wc lagi", "pelecehan"],
      ["makasih udah keluar ahh", "pelecehan"],
      ["ini yang lagi viral ya?", "pelecehan"],
      ["sejam berapa ?", "pelecehan"],
      ["sekandang berapa ini orang nya ?", "hinaan"],
      ["kayak selai coklat", "hinaan"],
    ];
    for (const [text, cat] of owner) expectFlag(text, cat);
    const d = engine.decide({ id: "1", text: "kak sejam berapa? 😏" }, ctx);
    expect(d.verdict.category).toBe("pelecehan");
    expect(d.similar[0]).toMatchObject({ label: "pelecehan", from: "database" });
    expect(d.verdict.reason).toMatch(/mirip contoh database/);
  });

  it("variasi kalimat ikut tertangkap, konteks wajar tidak", () => {
    expectFlag("kulitnya item banget kayak aspal", "hinaan");
    expectFlag("auto ange liat kakak joget 🥵", "pelecehan");
    for (const t of [
      "Sewa lapangan badminton sejam berapa?",
      "abis makan sambel bolak balik wc",
      "Kopinya item banget kayak aspal wkwk",
      "Kamu kayak selai coklat, manis banget 🥰",
      "Makhluk apa ini, imut banget",
      "Adek gw bangun tidur langsung nangis",
      "selai coklatnya beli di mana kak?",
    ]) expectSafe(t);
  });

  it("file seed-data.ts sinkron dengan data/seed/*.jsonl (jalankan `npm run seed` kalau gagal)", () => {
    const dir = join(process.cwd(), "data", "seed");
    const texts = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .flatMap((f) => readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).text as string));
    const inSeed = new Set(SEED_BASE.map((s) => s.text));
    expect(texts.filter((t) => !inSeed.has(t.trim()))).toEqual([]);
  });
});

describe("normalisasi teks", () => {
  it("huruf hias, leetspeak, singkatan, dan kata ulang angka 2", () => {
    expect(toDoc("𝐆𝐎𝐁𝐋𝐎𝐊 bgt yg kyk gitu").tokens).toEqual(["goblok", "banget", "yang", "kyk", "gitu"]);
    expect(toDoc("rame2 ujung2nya malu2in").spaced).toBe(" rame rame ujung ujungnya malu maluin ");
    expect(toDoc("g o b l o k").spacedLetters).toBe(true);
  });
});

describe("belajar dari contoh pengguna", () => {
  it("komentar yang hampir sama mengikuti label contoh, termasuk 'Bukan berbahaya'", () => {
    const text = "info pola gacor jam 2 pagi di PANDA88, wd terus";
    expect(decide(text).category).toBe("judol");
    const learned = new DecisionEngine({ examples: [{ text, label: "aman" }] });
    expect(decide("info pola gacor jam 2 pagi di 𝐏𝐀𝐍𝐃𝐀𝟖𝟖, wd terus", ctx, learned).category).toBe("aman");
  });

  it("contoh berbahaya baru ikut dikenali walau kata-katanya tidak ada di kamus", () => {
    const text = "kakak itu emang kebanyakan micin ya otaknya";
    const before = decide(text);
    const learned = new DecisionEngine({ examples: [{ text: "kebanyakan micin otaknya kakak itu", label: "hinaan" }] });
    const after = decide(text, ctx, learned);
    expect(after.category).toBe("hinaan");
    expect(after.score).toBeGreaterThan(before.score);
  });
});

describe("mode kustom (kata kunci)", () => {
  const custom = { name: "Spoiler", definition: "ending, mati di akhir, pelakunya ternyata" };
  const on = { modes: { ...allModes, kustom: true }, custom };

  it("definisi dipecah jadi kata kunci", () => {
    expect(customTerms("ending, mati di akhir\npelakunya ternyata").map((t) => t.t)).toEqual(["ending", "mati di akhir", "pelakunya ternyata"]);
    expect(customTerms("membocorkan akhir cerita film atau series yang sedang dibahas").every((t) => t.w < 2)).toBe(true);
  });

  it("menandai dengan nama mode kustom, hanya kalau modenya aktif", () => {
    expect(decide("Endingnya si Rina mati di akhir wkwk", on)).toMatchObject({ category: "kustom", mode: "kustom", label: "Spoiler" });
    expect(decide("Endingnya si Rina mati di akhir wkwk", { modes: allModes, custom }).category).not.toBe("kustom");
  });
});

import { describe, expect, it } from "vitest";
import { analyzeRules, prefilter, RULE_DIRECT_THRESHOLD } from "../src/core/judol-rules";

const modes = { judol: true, kebencian: true, pelecehan: true, agama: true, sara: true, kustom: false };

describe("aturan judol", () => {
  const spam = [
    "Gara gara main di PULAU138 aku jadi bisa beli motor, pasti wd terus 🔥",
    "𝐃𝐄𝐖𝐀𝐃𝐎𝐑𝐀𝟕𝟕 emang gacor parah, modal receh langsung maxwin",
    "cari di google SLOTJP88 bonus new member 100%",
    "g4c0r bgt situs ini, anti rungkad, ketik di google ALEXIS17",
    "Toto macau hari ini bocor, cek bio ya",
  ];
  for (const text of spam) {
    it(`menandai: ${text.slice(0, 40)}`, () => {
      const r = analyzeRules(text);
      expect(r.judolScore).toBeGreaterThanOrEqual(RULE_DIRECT_THRESHOLD);
    });
  }

  const safe = [
    "Videonya bagus banget bang, penjelasannya mudah dipahami",
    "Menurut saya argumennya kurang kuat di menit 5, datanya perlu sumber",
    "Kapan bahas Depok lagi bang? kangen konten kuliner",
    "Aku main Genshin dari 2020, gacha-nya rungkad terus wkwk",
    "Covid19 dulu bikin semua susah ya",
    "Judika suaranya bagus banget",
  ];
  for (const text of safe) {
    it(`tidak langsung menandai: ${text.slice(0, 40)}`, () => {
      expect(analyzeRules(text).judolScore).toBeLessThan(RULE_DIRECT_THRESHOLD);
    });
  }

  it("kata kunci kustom ikut dihitung", () => {
    expect(analyzeRules("main di situsbaru sekarang", ["situsbaru"]).judolScore).toBeGreaterThan(40);
  });
});

describe("prefilter", () => {
  it("komentar emoji/pendek dilewati tanpa AI", () => {
    const r = prefilter({ id: "1", text: "🔥🔥👍" }, modes, []);
    expect(r.needsAi).toBe(false);
    expect(r.verdict?.category).toBe("aman");
  });

  it("judol kuat diputuskan lokal", () => {
    const r = prefilter({ id: "2", text: "PULAU138 gacor maxwin pasti wd" }, modes, []);
    expect(r.needsAi).toBe(false);
    expect(r.verdict).toMatchObject({ mode: "judol", category: "judol", source: "rule" });
  });

  it("komentar biasa diteruskan ke AI", () => {
    const r = prefilter({ id: "3", text: "Bodoh banget sih kamu, gak usah bikin video lagi" }, modes, []);
    expect(r.needsAi).toBe(true);
    expect(r.verdict).toBeUndefined();
  });

  it("mode judol mati → tidak ada putusan judol lokal", () => {
    const r = prefilter({ id: "4", text: "PULAU138 gacor maxwin pasti wd" }, { ...modes, judol: false }, []);
    expect(r.verdict).toBeUndefined();
    expect(r.hint).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { pickReason } from "../src/content/report-helper";
import type { Category } from "../src/core/types";

const X = ["Kebencian", "Penyalahgunaan & Pelecehan", "Ucapan Kekerasan", "Keselamatan Anak", "Privasi", "Spam", "Penipuan atau peniruan identitas", "Berikutnya"];
const YOUTUBE = ["Konten seksual", "Konten kekerasan atau menjijikkan", "Konten kebencian atau kasar", "Pelecehan atau penindasan", "Tindakan berbahaya", "Spam atau menyesatkan", "Batal", "Berikutnya"];

describe("pemetaan alasan lapor", () => {
  const cases: [Category, string, string][] = [
    ["judol", "Spam", "Spam atau menyesatkan"],
    ["spam", "Spam", "Spam atau menyesatkan"],
    ["scam", "Penipuan atau peniruan identitas", "Spam atau menyesatkan"],
    ["phishing", "Penipuan atau peniruan identitas", "Spam atau menyesatkan"],
    ["hinaan", "Penyalahgunaan & Pelecehan", "Pelecehan atau penindasan"],
    ["perundungan", "Penyalahgunaan & Pelecehan", "Pelecehan atau penindasan"],
    ["sara", "Kebencian", "Konten kebencian atau kasar"],
    ["ancaman", "Ucapan Kekerasan", "Konten kekerasan atau menjijikkan"],
    ["pelecehan", "Penyalahgunaan & Pelecehan", "Konten seksual"],
  ];
  for (const [cat, x, yt] of cases) {
    it(`${cat} → X "${x}" / YouTube "${yt}"`, () => {
      expect(pickReason(cat, X)).toBe(x);
      expect(pickReason(cat, YOUTUBE)).toBe(yt);
    });
  }

  it("tidak pernah memilih tombol kirim / lanjut", () => {
    for (const btn of ["Kirim", "Laporkan", "Report", "Berikutnya", "Next", "Submit", "Batal"]) {
      for (const cat of ["judol", "hinaan", "sara", "ancaman", "pelecehan", "spam", "scam", "phishing", "perundungan", "sarkasme"] as Category[]) {
        expect(pickReason(cat, [btn])).toBeNull();
      }
    }
  });

  it("komentar aman tidak punya alasan lapor", () => {
    expect(pickReason("aman", X)).toBeNull();
  });
});

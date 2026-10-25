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

describe("label lapor X versi 2026", () => {
  const X2026 = [
    "Kebencian, Pelecehan secara online, atau Penganiayaan",
    "Spam",
    "Keselamatan Anak",
    "Tutur Kekerasan",
    "Perilaku Ilegal dan Teratur",
    "Peniruan",
    "Konten Pribadi atau Tanpa Persetujuan",
    "Berikutnya",
  ];
  const cases: [Category, string][] = [
    ["hinaan", "Kebencian, Pelecehan secara online, atau Penganiayaan"],
    ["sara", "Kebencian, Pelecehan secara online, atau Penganiayaan"],
    ["perundungan", "Kebencian, Pelecehan secara online, atau Penganiayaan"],
    ["ancaman", "Tutur Kekerasan"],
    ["judol", "Spam"],
    ["phishing", "Peniruan"],
    ["scam", "Spam"],
  ];
  for (const [cat, want] of cases) it(`${cat} → ${want}`, () => expect(pickReason(cat, X2026)).toBe(want));
});

describe("sub-alasan (layar kedua)", () => {
  const SUB = ["Hinaan atau penghinaan terarah", "Konten seksual yang tidak diinginkan", "Ancaman kekerasan", "Lainnya", "Berikutnya"];
  it("hinaan → Hinaan atau penghinaan terarah", () => expect(pickReason("hinaan", SUB)).toBe("Hinaan atau penghinaan terarah"));
  it("pelecehan → Konten seksual", () => expect(pickReason("pelecehan", SUB)).toBe("Konten seksual yang tidak diinginkan"));
  it("ancaman → Ancaman kekerasan", () => expect(pickReason("ancaman", SUB)).toBe("Ancaman kekerasan"));
  it("tidak menebak kalau tidak ada yang cocok", () => expect(pickReason("judol", SUB)).toBeNull());
});

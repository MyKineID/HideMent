import { describe, expect, it } from "vitest";
import { normalize } from "../src/core/normalize";
import { analyzePhishing, extractLinks } from "../src/core/phishing";

const links = (t: string) => extractLinks(normalize(t)).map((l) => l.domain);

describe("ekstraksi link", () => {
  it("menemukan URL biasa & tanpa protokol", () => {
    expect(links("cek https://bit.ly/abc123 dan www.contoh.xyz/promo")).toEqual(["bit.ly", "contoh.xyz"]);
  });

  it("menemukan link yang disamarkan", () => {
    expect(links("buka hadiahku dot com sekarang")).toContain("hadiahku.com");
    expect(links("situsnya menang88(.)vip")).toContain("menang88.vip");
    expect(links("klaim di promo [.] site")).toContain("promo.site");
  });

  it("mengabaikan angka desimal", () => {
    expect(links("ratingnya 4.5 dari 5")).toEqual([]);
  });
});

describe("analisis phising", () => {
  it("skor tinggi untuk tiruan bank + pancingan", () => {
    const r = analyzePhishing(normalize("Selamat anda pemenang! klaim hadiah di bca-hadiah.xyz, hubungi admin 0812 3456 7890"));
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.join(" ")).toMatch(/bca/);
  });

  it("link tepercaya tidak menambah skor", () => {
    expect(analyzePhishing(normalize("sumbernya https://www.youtube.com/watch?v=abc")).score).toBe(0);
  });

  it("punycode ditandai", () => {
    const r = analyzePhishing(normalize("login di xn--bc-7ba.com"));
    expect(r.reasons.join(" ")).toMatch(/punycode/);
  });
});

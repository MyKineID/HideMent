import { describe, expect, it } from "vitest";
import { autoReportCandidates, learnFromComments, reviewExample, reviewMap, toDatasetRow, toJsonl } from "../src/core/dataset";
import type { Example } from "../src/core/examples";
import type { QueueItem, Verdict } from "../src/core/types";

function item(text: string, score: number, extra: Partial<QueueItem> = {}): QueueItem {
  return {
    key: text, tabId: 1, platform: "tiktok", url: "https://www.tiktok.com/@a/video/1", commentId: text, author: "a", text,
    verdict: { id: text, mode: "judol", category: "judol", score, reason: "promo situs", source: "ai" },
    priority: score >= 80 ? "tinggi" : "sedang", at: score, ...extra,
  };
}

describe("data belajar dari Antrian", () => {
  it("Benar memakai label AI, Salah menjadi aman", () => {
    const it1 = item("PULAU138 gacor", 95);
    expect(reviewExample(it1, true, 5)).toEqual({ text: "PULAU138 gacor", label: "judol", at: 5, source: "review" });
    expect(reviewExample(it1, false, 5).label).toBe("aman");
  });

  it("hanya contoh hasil cek pengguna yang dihitung, dicocokkan lewat teks ternormalisasi", () => {
    const ex: Example[] = [
      { text: "𝐏𝐔𝐋𝐀𝐔𝟏𝟑𝟖 gacor", label: "aman", at: 1, source: "review" },
      { text: "slot88", label: "judol", at: 1, source: "manual" },
    ];
    const m = reviewMap(ex);
    expect(m.size).toBe(1);
    expect(toDatasetRow(item("PULAU138 gacor", 95), m)).toMatchObject({ label: "aman", predicted: "judol", reviewed: true, perlu_review: false });
    expect(toDatasetRow(item("slot88", 90), m)).toMatchObject({ label: "judol", reviewed: false, perlu_review: true });
  });
});

describe("kandidat lapor otomatis", () => {
  it("prioritas tinggi, belum dilapor, tidak ditandai aman, urut skor", () => {
    const q = [
      item("a", 85),
      item("b", 99),
      item("c", 60),
      item("d", 95, { report: "done" }),
      item("e", 92, { report: "failed" }),
      item("f", 90, { report: "pending" }),
      item("g", 97),
    ];
    const reviews = reviewMap([{ text: "g", label: "aman", at: 1, source: "review" }]);
    expect(autoReportCandidates(q, reviews).map((x) => x.text)).toEqual(["b", "f", "a"]);
  });
});

it("JSONL satu objek per baris", () => {
  expect(toJsonl([{ a: 1 }, { b: "x" }])).toBe('{"a":1}\n{"b":"x"}\n');
  expect(toJsonl([])).toBe("");
});

describe("belajar dari komentar link", () => {
  const t = { high: 80, medium: 50 };
  const v = (category: Verdict["category"], score: number, source: Verdict["source"] = "ai"): Verdict => ({ id: "1", mode: "judol", category, score, reason: "", source });
  it("ambil yang yakin saja", () => {
    const out = learnFromComments(
      [
        { text: "PULAU138 gacor wd terus", verdict: v("judol", 95, "rule") },
        { text: "bagus banget videonya kak", verdict: v("aman", 5) },
        { text: "agak mencurigakan nih", verdict: v("spam", 60) },
        { text: "terlalu pendek", verdict: v("aman", 0, "rule") },
        { text: "belum dinilai AI" },
        { text: "ok", verdict: v("aman", 0) },
      ],
      t,
      9,
    );
    expect(out).toEqual([
      { text: "PULAU138 gacor wd terus", label: "judol", at: 9, source: "link" },
      { text: "bagus banget videonya kak", label: "aman", at: 9, source: "link" },
    ]);
  });
  it("contoh aman dibatasi", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ text: `komentar biasa ${i}`, verdict: v("aman", 3) }));
    expect(learnFromComments(many, t, 1, 4)).toHaveLength(4);
  });
});

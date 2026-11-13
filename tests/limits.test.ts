import { describe, expect, it } from "vitest";
import { CommentBudget, limitFor } from "../src/core/limits";
import { resolveSettings } from "../src/core/settings";

describe("CommentBudget", () => {
  it("kuota habis tepat di batas", () => {
    const budget = new CommentBudget(3);
    expect(budget.allow("a")).toBe(true);
    expect(budget.allow("b")).toBe(true);
    expect(budget.allow("c")).toBe(true);
    expect(budget.allow("d")).toBe(false);
    expect(budget.used).toBe(3);
    expect(budget.limit).toBe(3);
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
  });

  it("fingerprint ganda tidak dihitung dua kali (DOM digambar ulang)", () => {
    const budget = new CommentBudget(10);
    expect(budget.allow("fp-sama")).toBe(true);
    expect(budget.allow("fp-sama")).toBe(false);
    expect(budget.allow("fp-sama")).toBe(false);
    expect(budget.used).toBe(1);
    expect(budget.allow("fp-lain")).toBe(true);
    expect(budget.used).toBe(2);
  });

  it("fingerprint kosong ditolak", () => {
    const budget = new CommentBudget(10);
    expect(budget.allow("")).toBe(false);
    expect(budget.used).toBe(0);
  });

  it("extend menambah kuota postingan itu saja, tidak mengubah pengaturan", () => {
    const budget = new CommentBudget(2);
    budget.allow("a");
    budget.allow("b");
    expect(budget.allow("c")).toBe(false);
    budget.extend(3);
    expect(budget.limit).toBe(5);
    expect(budget.remaining).toBe(3);
    expect(budget.allow("c")).toBe(true);
    expect(budget.allow("d")).toBe(true);
    expect(budget.allow("e")).toBe(true);
    expect(budget.used).toBe(5);
    expect(budget.allow("f")).toBe(false);
    // extend tidak menyentuh pengaturan; nilai di storage tetap 2 (dites lewat limitFor di bawah).
  });

  it("extend menolak angka tidak wajar", () => {
    const budget = new CommentBudget(2);
    budget.extend(0);
    budget.extend(-5);
    budget.extend(Number.NaN);
    expect(budget.limit).toBe(2);
    budget.extend(1.9);
    expect(budget.limit).toBe(3);
  });

  it("reset saat postingan berganti: hitungan dan fingerprint dikosongkan, batas tetap", () => {
    const budget = new CommentBudget(2);
    budget.allow("a");
    budget.allow("b");
    budget.reset();
    expect(budget.used).toBe(0);
    expect(budget.remaining).toBe(2);
    expect(budget.exhausted).toBe(false);
    expect(budget.limit).toBe(2);
    // fingerprint lama boleh dihitung lagi di postingan baru.
    expect(budget.allow("a")).toBe(true);
  });

  it("batas 0 langsung habis", () => {
    const budget = new CommentBudget(0);
    expect(budget.allow("a")).toBe(false);
    expect(budget.exhausted).toBe(true);
  });
});

describe("limitFor", () => {
  it("memakai perPost kalau tidak ada override", () => {
    const s = resolveSettings({});
    expect(limitFor(s, "youtube")).toBe(300);
    expect(limitFor(s, "x")).toBe(300);
  });

  it("override per platform mengalahkan perPost", () => {
    const s = resolveSettings({ scan: { limit: { perPost: 300, perPlatform: { x: 200 } } } });
    expect(limitFor(s, "x")).toBe(200);
    expect(limitFor(s, "instagram")).toBe(300);
  });

  it("override dibatasi rentang dan dibuang kalau platformnya tidak dikenal", () => {
    const s = resolveSettings({ scan: { limit: { perPlatform: { x: 1e9, youtube: 1 } as never } } });
    expect(limitFor(s, "x")).toBe(5000);
    expect(limitFor(s, "youtube")).toBe(50);
  });
});

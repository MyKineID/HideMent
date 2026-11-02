// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { reddit } from "../src/content/adapters/reddit";

/*
 * Uji adapter old.reddit.com memakai DOM tiruan dari fixture (PRD FR-21 s.d. FR-23).
 * location diarahkan ke old.reddit.com supaya adapter masuk cabang lama.
 */

const html = readFileSync(resolve("tests/fixtures/reddit-old.html"), "utf8");

beforeAll(async () => {
  const api = (window as unknown as { happyDOM?: { setURL(url: string): Promise<void> } }).happyDOM;
  await api?.setURL("https://old.reddit.com/r/uji_hidement/comments/1abc123/judul_thread/");
  if (location.hostname !== "old.reddit.com") throw new Error("env happy-dom tidak mendukung setURL");
});

const doc = () => new DOMParser().parseFromString(html, "text/html");
const comments = () => reddit.findComments(doc());

describe("adapter old.reddit", () => {
  it("setiap .thing.comment adalah satu komentar (FR-21)", () => {
    expect(comments().length).toBe(3);
  });

  it("teks dari .usertext-body .md milik komentar itu sendiri (FR-21)", () => {
    const [induk, nested, deleted] = comments();
    expect(reddit.getText(induk)).toBe("komentar lama yang pertama");
    expect(reddit.getText(induk)).not.toContain("balasan bersarang");
    expect(reddit.getText(nested)).toBe("balasan bersarang di old reddit");
    expect(reddit.getText(deleted)).toBe("");
  });

  it("author dari .author, deleted → kosong (FR-21)", () => {
    const [a, , deleted] = comments();
    expect(reddit.getAuthor(a)).toBe("pengguna_a123");
    expect(reddit.getAuthor(deleted)).toBe("");
  });

  it("permalink dari a.bylink (FR-21)", () => {
    expect(reddit.getPermalink(comments()[0])).toBe("https://old.reddit.com/r/uji_hidement/comments/1abc123/judul_thread/komen1/");
  });

  it("link report ditemukan sebagai tombol menu (FR-23, mode bantu)", () => {
    expect(reddit.getMenuButton(comments()[0])?.textContent).toMatch(/^report$/i);
  });

  it("jumlah komentar dari teks 'all N comments' (FR-14)", () => {
    expect(reddit.getCommentCount(doc(), new URL(location.href))).toBe(3);
  });

  it("lapor otomatis ditolak di old.reddit dengan pesan jelas (FR-23)", () => {
    expect(reddit.autoReportRefusal?.(new URL(location.href))).toBe("Lapor otomatis belum didukung di old.reddit.");
    expect(reddit.autoReportRefusal?.(new URL("https://www.reddit.com/r/uji_hidement/comments/1abc123/x/"))).toBeNull();
  });
});

// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { reddit } from "../src/content/adapters/reddit";

/*
 * Uji adapter Reddit baru memakai DOM tiruan dari fixture (PRD bagian Pengujian).
 * Fixture dianonimkan; env happy-dom dipakai karena shreddit-* adalah custom element biasa
 * bagi parser — querySelector & atribut tetap terbaca.
 */

const html = readFileSync(resolve("tests/fixtures/reddit-new.html"), "utf8");
const doc = () => new DOMParser().parseFromString(html, "text/html");
const comments = () => reddit.findComments(doc());
const url = new URL("https://www.reddit.com/r/uji_hidement/comments/1abc123/judul_thread/");

describe("adapter Reddit baru (shreddit)", () => {
  it("setiap shreddit-comment adalah satu komentar, termasuk yang bersarang", () => {
    expect(comments().length).toBe(4);
  });

  it("teks komentar induk tidak bocor ke balasannya (FR-7)", () => {
    const [induk, nested] = comments();
    expect(reddit.getText(induk)).toContain("komentar pertama");
    expect(reddit.getText(induk)).not.toContain("balasan tingkat dua");
    expect(reddit.getText(nested)).toBe("balasan tingkat dua yang terpisah dari komentar induknya");
  });

  it("komentar [deleted]/[removed] dikosongkan supaya dilewati (FR-8)", () => {
    const deleted = comments()[2];
    expect(reddit.getText(deleted)).toBe("");
  });

  it("author dari atribut, tanpa awalan u/, deleted → kosong (FR-9)", () => {
    const [a, b, deleted, c] = comments();
    expect(reddit.getAuthor(a)).toBe("pengguna_a123");
    expect(reddit.getAuthor(b)).toBe("pengguna_b456");
    expect(reddit.getAuthor(c)).toBe("pengguna_c789");
    expect(reddit.getAuthor(deleted)).toBe("");
  });

  it("permalink atribut dijadikan URL absolut (FR-10)", () => {
    const link = reddit.getPermalink(comments()[0]) ?? "";
    expect(link.startsWith("http")).toBe(true);
    expect(link.endsWith("/r/uji_hidement/comments/1abc123/judul_thread/komen1/")).toBe(true);
    expect(reddit.getPermalink(comments()[3])).toContain("/komen4/");
  });

  it("badge di baris tersendiri tepat di atas teks komentar (FR-11)", () => {
    const slot = reddit.getBadgeSlot(comments()[0]);
    expect(slot?.where).toBe("row");
    expect(slot?.node.getAttribute("slot")).toBe("comment");
  });

  it("tombol menu overflow ditemukan (FR-12)", () => {
    const btn = reddit.getMenuButton(comments()[3]);
    expect(btn?.getAttribute("aria-label")).toBe("more options");
  });

  it("jumlah komentar dari atribut comment-count shreddit-post, fallback teks (FR-14)", () => {
    expect(reddit.getCommentCount(doc(), url)).toBe(5);
  });

  it("halaman thread dikenali, halaman lain tidak (FR-13)", () => {
    expect(reddit.isPostPage(new URL("https://www.reddit.com/r/indonesia/comments/1abc123/judul/"))).toBe(true);
    expect(reddit.isPostPage(new URL("https://www.reddit.com/r/indonesia/"))).toBe(false);
  });
});

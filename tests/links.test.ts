import { describe, expect, it } from "vitest";
import { extractPostLinks, parseCount, postIdOf } from "../src/core/links";
import { SENT_RE } from "../src/content/report-helper";

describe("link postingan dari teks bebas", () => {
  it("chat WhatsApp: ambil link TikTok, buang duplikat & tanda baca", () => {
    const chat = [
      "[31/10, 13.05] ‎novi sistem informasi: https://vt.tiktok.com/ZSgG8TFAQ/",
      "[31/10, 13.05] ‎novi sistem informasi: https://vt.tiktok.com/ZSgGLVqBM/",
      "[31/10, 13.21] sherly: cek ini https://vt.tiktok.com/ZSgG8TFAQ/.",
      "bukan link: https://example.com/abc",
    ].join("\n");
    expect(extractPostLinks(chat)).toEqual([
      { url: "https://vt.tiktok.com/ZSgG8TFAQ/", platform: "tiktok" },
      { url: "https://vt.tiktok.com/ZSgGLVqBM/", platform: "tiktok" },
    ]);
  });

  it("platform lain", () => {
    const links = extractPostLinks("https://youtu.be/abc https://www.instagram.com/p/XYZ/ https://x.com/a/status/1 https://www.youtube.com/watch?v=q");
    expect(links.map((l) => l.platform)).toEqual(["youtube", "instagram", "x", "youtube"]);
  });

  it("id postingan untuk mencocokkan halaman setelah redirect", () => {
    expect(postIdOf("https://www.tiktok.com/@banjul21/video/7697160117355056405?_r=1")).toBe("7697160117355056405");
    expect(postIdOf("https://x.com/a/status/123")).toBe("123");
    expect(postIdOf("https://www.instagram.com/reel/AbC-1/")).toBe("AbC-1");
    expect(postIdOf("https://www.youtube.com/watch?v=dQw4")).toBe("dQw4");
    expect(postIdOf("https://www.youtube.com/shorts/xyz")).toBe("xyz");
    expect(postIdOf("bukan url")).toBeNull();
  });
});

describe("jumlah komentar", () => {
  it.each([
    ["2709", 2709],
    ["1.234 Komentar", 1234],
    ["1,234 comments", 1234],
    ["1,2K", 1200],
    ["1.2K", 1200],
    ["12,3 rb", 12300],
    ["3 jt", 3000000],
    ["1.5M", 1500000],
    ["Komentar (87)", 87],
    ["12 Replies. Reply", 12],
  ])("%s → %d", (text, n) => expect(parseCount(text)).toBe(n));

  it("tanpa angka", () => {
    expect(parseCount("Komentar")).toBeNull();
    expect(parseCount(null)).toBeNull();
  });
});

describe("konfirmasi laporan terkirim", () => {
  it.each(["Terima kasih atas laporanmu", "Thanks for reporting", "Laporan kamu telah dikirim", "Report submitted", "We'll review your report"])(
    "terkirim: %s",
    (t) => expect(SENT_RE.test(t)).toBe(true),
  );
  it.each(["Laporkan", "Report", "Apa yang ingin kamu laporkan?", "Why are you reporting this comment?", "Kirim"])("belum: %s", (t) =>
    expect(SENT_RE.test(t)).toBe(false),
  );
});

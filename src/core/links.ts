import type { Platform } from "./types";

/*
 * Link postingan yang ditempel pengguna (sering langsung dari chat WhatsApp, lengkap dengan
 * "[31/10, 13.05] nama: https://vt.tiktok.com/…") dan angka jumlah komentar yang ditampilkan platform.
 */

const URL_RE = /https?:\/\/[^\s<>"'()[\]]+/gi;

const HOSTS: [RegExp, Platform][] = [
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(reddit\.com|redd\.it)$/, "reddit"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(x|twitter)\.com$/, "x"],
];

export interface PostLink {
  url: string;
  platform: Platform;
}

export function platformOfUrl(raw: string): Platform | null {
  try {
    const host = new URL(raw).hostname;
    return HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Ambil semua link postingan yang didukung dari teks bebas, tanpa duplikat, urut sesuai kemunculan. */
export function extractPostLinks(text: string): PostLink[] {
  const seen = new Set<string>();
  const out: PostLink[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    const platform = platformOfUrl(url);
    if (!platform || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, platform });
  }
  return out;
}

/** ID video/postingan dari URL lengkap; dipakai untuk mencocokkan halaman setelah redirect link pendek. */
export function postIdOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    /* Reddit: /r/<sub>/comments/<id>/... — permalink komentar tetap mengarah ke id THREAD-nya; redd.it/<id>.
       Link share /r/<sub>/s/<kode> tidak memuat id (null): tab runner membukanya lalu redirect-nya diikuti sendiri. */
    return (
      u.pathname.match(/\/comments\/([\w-]+)/)?.[1] ??
      (/(^|\.)redd\.it$/.test(u.hostname) ? (u.pathname.match(/^\/([\w-]+)/)?.[1] ?? null) : null) ??
      u.pathname.match(/\/(?:video|photo|status)\/(\d+)/)?.[1] ??
      u.pathname.match(/^\/(?:p|reel|reels|shorts)\/([\w-]+)/)?.[1] ??
      u.searchParams.get("v") ??
      null
    );
  } catch {
    return null;
  }
}

const SUFFIX: Record<string, number> = { k: 1e3, rb: 1e3, ribu: 1e3, m: 1e6, jt: 1e6, juta: 1e6, b: 1e9 };

/**
 * "2709" → 2709, "1.234 Komentar" → 1234, "1,2K" / "1.2K" / "12,3 rb" → 1200 / 1200 / 12300, "3 jt" → 3000000.
 * Mengembalikan null kalau tidak ada angka.
 */
export function parseCount(text: string | null | undefined): number | null {
  const m = (text ?? "").replace(/ /g, " ").match(/(\d[\d.,]*)\s*(rb|ribu|jt|juta|[kKmMbB])?\b/);
  if (!m) return null;
  const [, num, unit] = m;
  if (unit) {
    const mult = SUFFIX[unit.toLowerCase()] ?? 1;
    return Math.round(Number(num.replace(",", ".")) * mult);
  }
  /* Tanpa satuan, titik/koma adalah pemisah ribuan ("1.234" / "1,234"). */
  return Number(num.replace(/[.,]/g, ""));
}

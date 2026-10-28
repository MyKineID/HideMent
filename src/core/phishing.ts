import type { NormalizedText } from "./normalize";

export interface LinkFinding {
  raw: string;
  domain: string;
  obfuscated: boolean;
  reasons: string[];
}

export interface PhishingResult {
  score: number;
  links: LinkFinding[];
  reasons: string[];
}

const SHORTENERS = new Set([
  "bit.ly", "s.id", "tinyurl.com", "cutt.ly", "rebrand.ly", "t.ly", "shorturl.at", "rb.gy",
  "is.gd", "ow.ly", "linktr.ee", "heylink.me", "lynk.id", "bio.link", "tr.ee", "goo.su",
  "t.co", "shope.ee", "urlz.fr", "v.gd", "clck.ru", "linkr.bio", "msha.ke",
]);

const RISKY_TLDS = new Set([
  "xyz", "top", "icu", "site", "online", "click", "vip", "live", "cc", "store", "buzz", "fun",
  "monster", "rest", "sbs", "cfd", "lol", "quest", "cyou", "bond", "win", "bet", "casino",
  "pw", "tk", "ml", "ga", "cf", "gq", "work", "life", "club", "shop", "pro", "today", "space",
]);

const TRUSTED_DOMAINS = [
  "youtube.com", "youtu.be", "google.com", "instagram.com", "tiktok.com", "x.com",
  "twitter.com", "facebook.com", "wikipedia.org", "github.com", "detik.com", "kompas.com",
  "go.id", "ac.id", "sch.id", "spotify.com", "open.spotify.com", "shopee.co.id",
  "tokopedia.com", "netflix.com", "whatsapp.com",
];

const BRANDS: Record<string, string[]> = {
  bca: ["bca.co.id", "klikbca.com"],
  bri: ["bri.co.id"],
  mandiri: ["bankmandiri.co.id"],
  bni: ["bni.co.id"],
  dana: ["dana.id"],
  ovo: ["ovo.id"],
  gopay: ["gopay.co.id", "gojek.com"],
  shopee: ["shopee.co.id", "shopee.com", "shope.ee"],
  tokopedia: ["tokopedia.com"],
  bpjs: ["bpjs-kesehatan.go.id", "bpjsketenagakerjaan.go.id"],
  pln: ["pln.co.id"],
  telkomsel: ["telkomsel.com"],
  youtube: ["youtube.com", "youtu.be"],
  google: ["google.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  whatsapp: ["whatsapp.com", "wa.me"],
};

const BAIT_TERMS = [
  "hadiah", "klaim", "giveaway", "verifikasi akun", "menang undian", "pemenang", "transfer dulu",
  "biaya admin", "kode otp", "otp", "login di", "akun anda", "akun kamu diblokir", "saldo gratis",
  "dana kaget", "pinjol", "pinjaman cepat", "cair cepat", "investasi pasti", "profit harian",
  "chat admin", "hubungi admin", "wa admin", "dm admin", "ambil hadiah", "selamat anda",
];

const URL_RE =
  /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+|(?:[a-z0-9-]{2,63}\.)+(?:[a-z]{2,24})(?:\/[^\s<>"')\]]*)?)/gi;
const OBFUSCATED_RE =
  /\b([a-z0-9-]{2,63})\s*(?:\(\s*\.\s*\)|\[\s*\.\s*\]|\{\s*\.\s*\}|\s+dot\s+|\s+titik\s+|\s*\(dot\)\s*|\s*\[dot\]\s*|\s+\.\s+|\s*,\s*(?=(?:com|net|org|xyz|id|co|me|vip|site|online|top)\b))\s*((?:co\.)?[a-z]{2,10})\b/gi;
const PHONE_RE = /(?:\+?62|\b0)8[1-9][\d\s.-]{6,13}\d/g;
const IP_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const KNOWN_TLDS = new Set([
  ...RISKY_TLDS, "com", "net", "org", "id", "co", "me", "io", "ly", "gl", "be", "ee", "app",
  "dev", "info", "biz", "us", "uk", "my", "sg", "asia", "link", "to", "gg", "tv", "ru",
]);

function hostOf(raw: string): string {
  const s = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return s.split(/[/?#:]/)[0].toLowerCase().replace(/\.+$/, "");
}

/** Imbuhan khas domain tiruan, mis. klikbca-login, danakaget, bri123. */
const BRAND_AFFIX_RE =
  /^(?:\d+|klik|login|masuk|hadiah|promo|resmi|official|cs|id|bonus|kaget|giveaway|verifikasi|verify|secure|akun|bank|mobile|care|help|support|undian|gratis|online|web|app)+$/;

/**
 * Merek pendek (bca, bri, ovo) tidak boleh dicocokkan sebagai substring biasa,
 * kalau tidak "library.xyz" dianggap meniru BRI dan "danamon" meniru DANA.
 */
function mentionsBrand(host: string, brand: string): boolean {
  if (brand.length >= 5) return host.includes(brand);
  return host.split(/[.-]/).some((token) => {
    if (token === brand) return true;
    if (token.startsWith(brand)) return BRAND_AFFIX_RE.test(token.slice(brand.length));
    if (token.endsWith(brand)) return BRAND_AFFIX_RE.test(token.slice(0, -brand.length));
    return false;
  });
}

function endsWithDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

export function isTrusted(host: string): boolean {
  return TRUSTED_DOMAINS.some((d) => endsWithDomain(host, d));
}

function assessHost(host: string): string[] {
  const reasons: string[] = [];
  const tld = host.split(".").pop() ?? "";
  if (SHORTENERS.has(host)) reasons.push(`pemendek link (${host})`);
  if (RISKY_TLDS.has(tld)) reasons.push(`TLD berisiko (.${tld})`);
  if (host.split(".").some((p) => p.startsWith("xn--"))) reasons.push("domain punycode (huruf tiruan)");
  if (IP_RE.test(host)) reasons.push("alamat IP langsung");
  for (const [brand, official] of Object.entries(BRANDS)) {
    if (mentionsBrand(host, brand) && !official.some((d) => endsWithDomain(host, d))) {
      reasons.push(`meniru merek "${brand}"`);
    }
  }
  if (/\d{2,}/.test(host.split(".")[0]) && /[a-z]{3,}/.test(host)) {
    reasons.push("nama domain berpola merek+angka");
  }
  return reasons;
}

export function extractLinks(n: NormalizedText): LinkFinding[] {
  const found = new Map<string, LinkFinding>();
  const text = n.folded;

  for (const m of text.matchAll(URL_RE)) {
    const host = hostOf(m[1]);
    const tld = host.split(".").pop() ?? "";
    if (!host.includes(".") || !KNOWN_TLDS.has(tld)) continue;
    if (/^\d+(\.\d+)*$/.test(host) && !IP_RE.test(host)) continue;
    if (!found.has(host)) found.set(host, { raw: m[1], domain: host, obfuscated: false, reasons: [] });
  }

  for (const m of text.matchAll(OBFUSCATED_RE)) {
    const host = `${m[1]}.${m[2]}`.toLowerCase();
    const tld = m[2].split(".").pop() ?? "";
    if (!KNOWN_TLDS.has(tld)) continue;
    const existing = found.get(host);
    if (existing) existing.obfuscated = true;
    else found.set(host, { raw: m[0], domain: host, obfuscated: true, reasons: [] });
  }

  for (const link of found.values()) {
    link.reasons = assessHost(link.domain);
    if (link.obfuscated) link.reasons.push("link disamarkan agar lolos filter");
  }
  return [...found.values()];
}

export function analyzePhishing(n: NormalizedText): PhishingResult {
  const links = extractLinks(n);
  const reasons: string[] = [];
  let score = 0;

  for (const link of links) {
    if (isTrusted(link.domain) && !link.obfuscated) continue;
    score += 15 + link.reasons.length * 20;
    reasons.push(...link.reasons.map((r) => `${link.domain}: ${r}`));
  }

  const bait = BAIT_TERMS.filter((t) => n.deleet.includes(t));
  if (bait.length) {
    score += Math.min(40, bait.length * 15);
    reasons.push(`kata pancingan: ${bait.slice(0, 3).join(", ")}`);
  }

  const phones = n.folded.match(PHONE_RE);
  if (phones && (bait.length || links.length)) {
    score += 20;
    reasons.push("mengarahkan ke nomor WhatsApp/telepon");
  }

  if (links.length === 0 && bait.length < 2) score = Math.min(score, 30);
  return { score: Math.min(100, score), links, reasons };
}

import { normalize, letterCount, type NormalizedText } from "./normalize";
import { analyzePhishing } from "./phishing";
import type { Category, CommentInput, Mode, Verdict } from "./types";

interface Term {
  t: string;
  w: number;
}

const JUDOL_TERMS: Term[] = [
  { t: "gacor", w: 40 }, { t: "maxwin", w: 45 }, { t: "slot", w: 25 }, { t: "scatter", w: 35 },
  { t: "jackpot", w: 25 }, { t: "rtp", w: 25 }, { t: "togel", w: 45 }, { t: "toto", w: 20 },
  { t: "judi", w: 30 }, { t: "kasino", w: 30 }, { t: "casino", w: 30 }, { t: "bandar", w: 20 },
  { t: "pragmatic", w: 35 }, { t: "olympus", w: 25 }, { t: "mahjong", w: 30 },
  { t: "bonanza", w: 30 }, { t: "starlight princes", w: 35 }, { t: "zeus", w: 15 },
  { t: "bonus new member", w: 45 }, { t: "new member", w: 15 }, { t: "freebet", w: 40 },
  { t: "fre bet", w: 30 }, { t: "free spin", w: 30 }, { t: "deposit", w: 15 }, { t: "depo", w: 20 },
  { t: "withdraw", w: 15 }, { t: "auto wd", w: 40 }, { t: "pasti wd", w: 40 }, { t: "lgsg wd", w: 35 },
  { t: "langsung wd", w: 35 }, { t: "wd terus", w: 35 }, { t: "anti rungkad", w: 45 },
  { t: "rungkad", w: 25 }, { t: "pola", w: 10 }, { t: "petir merah", w: 35 },
  { t: "situs", w: 15 }, { t: "link alternatif", w: 40 }, { t: "modal receh", w: 35 },
  { t: "modal kecil", w: 15 }, { t: "cuan", w: 10 }, { t: "jp paus", w: 45 }, { t: "jepe", w: 30 },
  { t: "jp terus", w: 40 }, { t: "lgsg jp", w: 40 }, { t: "langsung jp", w: 40 }, { t: "sensasional", w: 20 },
  { t: "wd", w: 20 }, { t: "jp", w: 15 }, { t: "gugel", w: 10 },
  { t: "parlay", w: 35 }, { t: "sbobet", w: 45 }, { t: "slot online", w: 45 },
  { t: "game online terpercaya", w: 35 }, { t: "sweet bonanza", w: 40 }, { t: "gates of", w: 25 },
  { t: "toto macau", w: 50 }, { t: "bocoran", w: 15 },
];

const CTA_TERMS: Term[] = [
  { t: "cari di google", w: 25 }, { t: "ketik di google", w: 30 }, { t: "cek di google", w: 25 },
  { t: "search di google", w: 25 }, { t: "cek bio", w: 20 }, { t: "link di bio", w: 20 },
  { t: "lihat profil", w: 15 }, { t: "cek profil", w: 15 }, { t: "klik profil", w: 20 },
  { t: "dijamin", w: 10 }, { t: "gampang menang", w: 25 }, { t: "pasti menang", w: 25 },
  { t: "dari modal", w: 15 }, { t: "berkat", w: 10 }, { t: "terpercaya", w: 10 },
];

const BRAND_NUMBER_RE = /\b[a-z]{3,14}(?:88|77|99|138|168|189|303|365|777|888|4d|123|69|55|33|128|388|500|889)\b/g;
const BRAND_NUMBER_STRONG_RE = /\b[a-z]{3,14}\d{2,4}\b/g;

export interface RuleResult {
  judolScore: number;
  judolCategory: Category;
  reasons: string[];
  trivial: boolean;
}

const SPACED_LETTERS_RE = /(?:^|\s)(?:\p{L}\s){3,}\p{L}(?:\s|$)/u;

interface CompiledTerm extends Term {
  needle: string;
  re: RegExp;
  single: boolean;
}

/** Regex tiap istilah dikompilasi sekali saja, bukan untuk setiap komentar yang dipindai. */
function compileTerms(terms: Term[]): CompiledTerm[] {
  return terms.map((term) => {
    const needle = term.t.replace(/(\p{L})\1+/gu, "$1");
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { ...term, needle, re: new RegExp(` ${escaped}(?:nya|an|kan|in|mu|ku|lah)? `, "u"), single: !needle.includes(" ") };
  });
}

const JUDOL_COMPILED = compileTerms(JUDOL_TERMS);
const CTA_COMPILED = compileTerms(CTA_TERMS);

let customSource = "";
let customCompiled: CompiledTerm[] = [];

function customTerms(keywords: string[]): CompiledTerm[] {
  const source = keywords.join("\n");
  if (source !== customSource) {
    customSource = source;
    customCompiled = compileTerms(
      keywords
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
        .map((t) => ({ t, w: 45 })),
    );
  }
  return customCompiled;
}

function findTerms(n: NormalizedText, spaced: string, minCompact: number, terms: CompiledTerm[]): Term[] {
  return terms.filter(({ re, needle, single }) => re.test(spaced) || (single && needle.length >= minCompact && n.compact.includes(needle)));
}

export function analyzeRules(text: string, customKeywords: string[] = []): RuleResult {
  const n = normalize(text);
  const reasons: string[] = [];
  const trivial = letterCount(n.folded) < 3;

  const spaced = ` ${n.deleet.replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const spacedLetters = SPACED_LETTERS_RE.test(n.folded);
  const minCompact = spacedLetters ? 4 : 6;
  const judolHits = [
    ...findTerms(n, spaced, minCompact, JUDOL_COMPILED),
    ...findTerms(n, spaced, minCompact, customTerms(customKeywords)),
  ];
  const ctaHits = findTerms(n, spaced, minCompact, CTA_COMPILED);
  let score = judolHits.reduce((a, h) => a + h.w, 0);
  if (judolHits.length) reasons.push(`istilah judol: ${judolHits.slice(0, 4).map((h) => h.t).join(", ")}`);

  const brands = new Set([...(n.folded.match(BRAND_NUMBER_RE) ?? [])]);
  const looseBrands = new Set([...(n.folded.match(BRAND_NUMBER_STRONG_RE) ?? [])]);
  if (brands.size) {
    score += judolHits.length || ctaHits.length ? 35 : 15;
    reasons.push(`nama situs berpola merek+angka: ${[...brands].slice(0, 2).join(", ")}`);
  } else if (looseBrands.size && (judolHits.length || ctaHits.length)) {
    score += 20;
    reasons.push(`kemungkinan nama situs: ${[...looseBrands].slice(0, 2).join(", ")}`);
  }

  if (ctaHits.length && (judolHits.length || brands.size || looseBrands.size)) {
    score += ctaHits.reduce((a, h) => a + h.w, 0);
    reasons.push(`ajakan: ${ctaHits.slice(0, 2).map((h) => h.t).join(", ")}`);
  }

  if (spacedLetters && judolHits.length) {
    score += 20;
    reasons.push("huruf dipisah spasi untuk mengelabui filter");
  }

  if (n.hasFancyUnicode) {
    score += judolHits.length || brands.size ? 25 : 10;
    reasons.push("memakai huruf Unicode hias untuk mengelabui filter");
  }

  const phishing = analyzePhishing(n);
  let category: Category = "judol";
  if (phishing.score > 0) {
    reasons.push(...phishing.reasons.slice(0, 3));
    if (phishing.score > score) category = judolHits.length ? "judol" : "phishing";
    score = Math.max(score, phishing.score) + Math.min(score, phishing.score) * 0.5;
  }

  return { judolScore: Math.round(Math.min(100, score)), judolCategory: category, reasons, trivial };
}

export const RULE_DIRECT_THRESHOLD = 70;
export const RULE_HINT_THRESHOLD = 25;

export interface PrefilterResult {
  verdict?: Verdict;
  hint?: string;
  needsAi: boolean;
}

export function prefilter(c: CommentInput, modes: Record<Mode, boolean>, customKeywords: string[]): PrefilterResult {
  const r = analyzeRules(c.text, customKeywords);
  if (r.trivial) {
    return { verdict: { id: c.id, mode: "toxic", category: "aman", score: 0, reason: "terlalu pendek", source: "rule" }, needsAi: false };
  }
  if (modes.judol && r.judolScore >= RULE_DIRECT_THRESHOLD) {
    return {
      verdict: { id: c.id, mode: "judol", category: r.judolCategory, score: r.judolScore, reason: r.reasons.join("; "), source: "rule" },
      needsAi: false,
    };
  }
  const anyAiMode = modes.toxic || modes.judol;
  return {
    needsAi: anyAiMode,
    hint: modes.judol && r.judolScore >= RULE_HINT_THRESHOLD ? `indikasi aturan lokal (${r.judolScore}): ${r.reasons.join("; ")}` : undefined,
  };
}

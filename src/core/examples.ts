import { normalize } from "./normalize";
import type { PromptExample } from "./prompt";
import { CATEGORY_LABEL, type Category } from "./types";

/*
 * Contoh belajar: komentar berlabel dari pengguna. Tidak ada training; setiap kali menganalisis,
 * contoh yang paling mirip dengan komentar yang sedang dinilai ikut dikirim ke AI sebagai acuan
 * (few-shot berbasis kemiripan). Kemiripan dihitung dari trigram teks yang sudah dinormalisasi,
 * jadi tetap cocok walau ditulis dengan huruf hias atau angka pengganti huruf.
 */

export type ExampleSource = "manual" | "import" | "feedback";

export interface Example extends PromptExample {
  at: number;
  source: ExampleSource;
}

export const EXAMPLES_KEY = "examples";
export const EXAMPLES_MAX = 2000;

const LABELS = new Set(Object.keys(CATEGORY_LABEL));
/** Label lama dataset Tempest yang sekarang sudah dipecah atau diganti nama. */
const LABEL_ALIAS: Record<string, Category> = { toxic: "hinaan", phising: "phishing", judi: "judol", safe: "aman", ok: "aman" };

export function toLabel(v: unknown): Category | null {
  const k = String(v ?? "").trim().toLowerCase();
  if (LABELS.has(k)) return k as Category;
  return LABEL_ALIAS[k] ?? null;
}

function rowToExample(row: Record<string, unknown>, source: ExampleSource, at: number): Example | null {
  const text = String(row.text ?? row.t ?? row.komentar ?? row.comment ?? "").trim();
  const label = toLabel(row.label ?? row.k ?? row.kategori ?? row.category);
  return text && label ? { text: text.slice(0, 600), label, at, source } : null;
}

/** Pisah satu baris CSV, termasuk kolom berkutip yang berisi koma atau kutip ganda. */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Baca file contoh: JSON Lines, array JSON, atau CSV dengan kolom text & label. Baris yang tidak valid dilewati. */
export function parseExamples(raw: string, source: ExampleSource = "import", now = Date.now()): Example[] {
  const text = raw.replace(/^﻿/, "").trim();
  if (!text) return [];
  const rows: Record<string, unknown>[] = [];
  if (text.startsWith("[")) {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) rows.push(...data.filter((r) => r && typeof r === "object"));
    } catch {
      /* bukan array JSON utuh; coba per baris */
    }
  }
  if (!rows.length && text.startsWith("{")) {
    for (const line of text.split("\n")) {
      try {
        const o = JSON.parse(line.trim().replace(/,$/, ""));
        if (o && typeof o === "object") rows.push(o);
      } catch {
        /* baris rusak */
      }
    }
  }
  if (!rows.length) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const head = csvCells(lines[0]).map((h) => h.toLowerCase());
    const ti = head.findIndex((h) => ["text", "t", "komentar", "comment"].includes(h));
    const li = head.findIndex((h) => ["label", "k", "kategori", "category"].includes(h));
    const [tCol, lCol, body] = ti >= 0 && li >= 0 ? [ti, li, lines.slice(1)] : [0, 1, lines];
    for (const line of body) {
      const cells = csvCells(line);
      rows.push({ text: cells[tCol], label: cells[lCol] });
    }
  }
  return rows.map((r) => rowToExample(r, source, now)).filter((e): e is Example => e !== null);
}

/** Gabungkan contoh baru ke daftar lama: teks yang sama diganti label terbarunya, daftar dibatasi EXAMPLES_MAX. */
export function mergeExamples(current: Example[], incoming: Example[]): Example[] {
  const byKey = new Map<string, Example>();
  for (const e of [...current, ...incoming]) byKey.set(keyOf(e.text), e);
  return [...byKey.values()].slice(-EXAMPLES_MAX);
}

function keyOf(text: string): string {
  return normalize(text).compact;
}

function trigrams(text: string): Set<string> {
  const s = ` ${normalize(text).deleet.replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const g of small) if (big.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface PickOptions {
  /** Kategori yang boleh dipakai sebagai contoh (mode aktif + "aman"). */
  allowed: Set<Category>;
  perItem?: number;
  max?: number;
  minScore?: number;
}

export class ExampleIndex {
  private grams: Set<string>[];

  constructor(readonly examples: PromptExample[]) {
    this.grams = examples.map((e) => trigrams(e.text));
  }

  get size(): number {
    return this.examples.length;
  }

  /** Untuk tiap komentar, ambil contoh paling mirip (tanpa duplikat antar komentar dalam satu batch). */
  pick(texts: string[], { allowed, perItem = 2, max = 8, minScore = 0.2 }: PickOptions): PromptExample[] {
    const chosen = new Set<number>();
    for (const t of texts) {
      const g = trigrams(t);
      const scored: [number, number][] = [];
      this.grams.forEach((eg, i) => {
        if (chosen.has(i) || !allowed.has(this.examples[i].label)) return;
        const score = jaccard(g, eg);
        if (score >= minScore) scored.push([score, i]);
      });
      scored.sort((a, b) => b[0] - a[0]);
      for (const [, i] of scored.slice(0, perItem)) chosen.add(i);
      if (chosen.size >= max) break;
    }
    return [...chosen].slice(0, max).map((i) => this.examples[i]);
  }
}

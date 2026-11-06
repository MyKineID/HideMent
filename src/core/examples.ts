import { normalize } from "./normalize";
import { CATEGORY_LABEL, type Category } from "./types";

/*
 * Contoh belajar: komentar berlabel dari pengguna. Mesin lokal (src/core/engine) memakainya dengan dua cara:
 * - Naive Bayes dilatih ulang dari contoh ini (hanya menghitung kata, selesai dalam milidetik);
 * - komentar yang hampir sama dengan sebuah contoh mengikuti label contoh tersebut.
 * Kemiripan dihitung dari teks yang sudah dinormalisasi, jadi tetap cocok walau ditulis dengan huruf hias
 * atau angka pengganti huruf.
 */

export interface LabeledText {
  text: string;
  label: Category;
}

/**
 * "review" = dicek pengguna di Antrian (tombol Benar/Salah) dari komentar yang sudah dianalisis.
 * "link"   = dipelajari otomatis dari komentar postingan yang dianalisis lewat "Analyze dari link".
 */
export type ExampleSource = "manual" | "import" | "feedback" | "review" | "link";

export interface Example extends LabeledText {
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

/**
 * Gabungkan contoh baru ke daftar lama: teks yang sama diganti label terbarunya, daftar dibatasi EXAMPLES_MAX.
 * Contoh "link" (label hasil analisis) tidak pernah menimpa label dari manusia, dan yang pertama dibuang saat penuh.
 */
export function mergeExamples(current: Example[], incoming: Example[]): Example[] {
  const byKey = new Map<string, Example>();
  for (const e of [...current, ...incoming]) {
    const key = exampleKey(e.text);
    const prev = byKey.get(key);
    if (e.source === "link" && prev && prev.source !== "link") continue;
    byKey.delete(key);
    byKey.set(key, e);
  }
  const out = [...byKey.values()];
  for (let i = 0; out.length > EXAMPLES_MAX && i < out.length; ) {
    if (out[i].source === "link") out.splice(i, 1);
    else i++;
  }
  return out.slice(-EXAMPLES_MAX);
}

/** Kunci dedup contoh: teks yang sudah dinormalisasi (huruf hias & angka pengganti disamakan). */
export function exampleKey(text: string): string {
  return normalize(text).compact;
}

/**
 * Contoh yang dipelajari mesin lokal: contoh belajar (kalau "Pakai contoh saat analisis" aktif) ditambah
 * catatan tombol "Bukan berbahaya" sebagai contoh aman (kalau diikutkan).
 */
export function learningExamples(
  examples: Example[],
  feedback: { text?: string; label?: string }[],
  learn: { enabled: boolean; includeFeedback: boolean },
): LabeledText[] {
  if (!learn.enabled) return [];
  const fromFeedback = learn.includeFeedback
    ? feedback.flatMap((f) => {
        const label = toLabel(f.label);
        return f.text && label ? [{ text: f.text, label }] : [];
      })
    : [];
  return [...examples.map(({ text, label }) => ({ text, label })), ...fromFeedback];
}

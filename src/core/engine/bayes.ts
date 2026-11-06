import type { Category } from "../types";
import { toDoc, type Doc } from "./text";

/**
 * Naive Bayes multinomial kecil: belajar dari contoh berlabel (seed bawaan + contoh belajar pengguna).
 * "Training" hanya menghitung frekuensi kata, jadi dibangun ulang dalam milidetik setiap contoh berubah.
 * Hasilnya bukti log-odds tiap kategori dibanding "aman", dinormalisasi panjang komentar supaya
 * komentar panjang tidak otomatis terlihat sangat yakin.
 */

export interface Labeled {
  text: string;
  label: Category;
}

const ALPHA = 0.4;
const CLIP = 3;

/** Fitur: kata + pasangan kata berurutan. Angka murni dibuang. */
export function features(doc: Doc): string[] {
  const words = doc.tokens.filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const out = [...words];
  for (let i = 0; i + 1 < words.length; i++) out.push(`${words[i]}_${words[i + 1]}`);
  return out;
}

export class NaiveBayes {
  private counts = new Map<Category, Map<string, number>>();
  private totals = new Map<Category, number>();
  private docs = new Map<Category, number>();
  private vocab = new Set<string>();
  /** log P(fitur | kategori) yang sudah dihitung, plus nilai untuk fitur yang tak pernah muncul di kategori itu. */
  private logp = new Map<Category, { seen: Map<string, number>; unseen: number }>();

  constructor(rows: Labeled[]) {
    for (const r of rows) this.add(features(toDoc(r.text)), r.label);
    for (const [label, m] of this.counts) {
      const denom = Math.log((this.totals.get(label) ?? 0) + ALPHA * this.vocab.size);
      const seen = new Map<string, number>();
      for (const [f, n] of m) seen.set(f, Math.log(n + ALPHA) - denom);
      this.logp.set(label, { seen, unseen: Math.log(ALPHA) - denom });
    }
  }

  private add(feats: string[], label: Category): void {
    let m = this.counts.get(label);
    if (!m) this.counts.set(label, (m = new Map()));
    for (const f of new Set(feats)) {
      m.set(f, (m.get(f) ?? 0) + 1);
      this.vocab.add(f);
      this.totals.set(label, (this.totals.get(label) ?? 0) + 1);
    }
    this.docs.set(label, (this.docs.get(label) ?? 0) + 1);
  }

  get size(): number {
    let n = 0;
    for (const v of this.docs.values()) n += v;
    return n;
  }

  get vocabSize(): number {
    return this.vocab.size;
  }

  examplesOf(label: Category): number {
    return this.docs.get(label) ?? 0;
  }

  private logLik(label: Category, feats: string[]): number {
    const { seen, unseen } = this.logp.get(label)!;
    let s = 0;
    for (const f of feats) s += seen.get(f) ?? unseen;
    return s;
  }

  /**
   * Bukti tiap kategori (yang punya contoh) dibanding "aman", dalam log-odds per akar jumlah fitur, dibatasi ±3.
   * Kategori tanpa contoh, atau kalau belum ada contoh "aman", tidak diberi bukti sama sekali.
   */
  evidence(doc: Doc, categories: Iterable<Category>): Map<Category, number> {
    const out = new Map<Category, number>();
    if (!this.counts.has("aman")) return out;
    const feats = [...new Set(features(doc))].filter((f) => this.vocab.has(f));
    if (!feats.length) return out;
    const safe = this.logLik("aman", feats);
    const norm = Math.sqrt(feats.length);
    for (const c of categories) {
      if (c === "aman" || !this.counts.has(c)) continue;
      const e = (this.logLik(c, feats) - safe) / norm;
      out.set(c, Math.max(-CLIP, Math.min(CLIP, e)));
    }
    return out;
  }
}

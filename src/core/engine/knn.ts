import type { Category } from "../types";
import type { Doc } from "./text";
import type { Labeled } from "./bayes";

/**
 * Pencarian contoh belajar yang paling mirip. Kemiripan = nilai terbesar dari
 * - Jaccard trigram huruf (tahan salah ketik & imbuhan), dan
 * - Jaccard kata (tahan urutan kata yang diacak: "otaknya kebanyakan micin" ≈ "kebanyakan micin otaknya").
 * Supaya tetap cepat dengan ribuan contoh: kandidat dicari lewat indeks terbalik dari trigram yang JARANG
 * saja (trigram umum seperti " ya" ada di hampir semua contoh), lalu kemiripan sebenarnya hanya dihitung
 * untuk segelintir kandidat teratas.
 */

export interface Neighbor {
  example: Labeled;
  sim: number;
}

const MAX_CANDIDATES = 24;

function trigrams(spaced: string): Set<string> {
  const s = spaced.replace(/\s+/g, " ");
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

const words = (spaced: string) => new Set(spaced.trim().split(" ").filter((w) => w.length > 1));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export class NeighborIndex {
  private grams: Set<string>[] = [];
  private wordSets: Set<string>[] = [];
  private postings = new Map<string, number[]>();

  constructor(
    private rows: Labeled[],
    toSpaced: (text: string) => string,
  ) {
    rows.forEach((r, i) => {
      const spaced = toSpaced(r.text);
      const g = trigrams(spaced);
      this.grams.push(g);
      this.wordSets.push(words(spaced));
      for (const t of g) {
        const list = this.postings.get(t);
        if (list) list.push(i);
        else this.postings.set(t, [i]);
      }
    });
    /* Trigram yang muncul di lebih dari 8% contoh (min. 40) tidak dipakai mencari kandidat. */
    const cap = Math.max(40, rows.length * 0.08);
    for (const [t, list] of this.postings) if (list.length > cap) this.postings.delete(t);
  }

  get size(): number {
    return this.rows.length;
  }

  nearest(doc: Doc, allowed: Set<Category>, k = 1): Neighbor[] {
    if (!this.rows.length) return [];
    const q = trigrams(doc.spaced);
    if (!q.size) return [];
    const qw = words(doc.spaced);
    const hits = new Map<number, number>();
    for (const t of q) for (const i of this.postings.get(t) ?? []) hits.set(i, (hits.get(i) ?? 0) + 1);
    const candidates = [...hits].sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATES);
    const out: Neighbor[] = [];
    for (const [i] of candidates) {
      const ex = this.rows[i];
      if (ex.label !== "aman" && !allowed.has(ex.label)) continue;
      out.push({ example: ex, sim: Math.max(jaccard(q, this.grams[i]), jaccard(qw, this.wordSets[i])) });
    }
    return out.sort((a, b) => b.sim - a.sim).slice(0, k);
  }
}

import type { Doc } from "./text";

/**
 * Kamus istilah berbobot yang dicocokkan ke Doc dalam SATU kali jalan untuk semua kelompok kamus:
 * - "goblok"        → satu kata, boleh berakhiran (goblokNYA, goblokIN)
 * - "goblo*"        → awalan kata (goblokk, gobloknya, goblog)
 * - "tau rumah"     → frasa; kata terakhir boleh berakhiran atau diakhiri "*"
 * Huruf berulang di istilah dirapikan sama seperti teks komentar ("allah" → "alah").
 */
export interface Term {
  t: string;
  w: number;
}

export interface Hit {
  t: string;
  w: number;
}

interface Entry<G> {
  group: G;
  term: Term;
}

interface Phrase<G> extends Entry<G> {
  re: RegExp;
  joined: string;
}

const squeeze = (s: string) => s.toLowerCase().replace(/(\p{L})\1+/gu, "$1").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SUFFIX_RE = "(?:nya|ny|kan|an|in|mu|ku|lah|kah|lu|lo|i)?";
const wordRe = (w: string) => (w.endsWith("*") ? `${escape(w.slice(0, -1))}[\\p{L}\\p{N}]*` : escape(w));

export class MultiMatcher<G extends string> {
  private exact = new Map<string, Entry<G>[]>();
  private prefixes: (Entry<G> & { p: string })[] = [];
  private phrasesByFirst = new Map<string, Phrase<G>[]>();
  private loosePhrases: Phrase<G>[] = [];
  private groups: G[];

  constructor(lexicon: Record<G, Term[]>) {
    this.groups = Object.keys(lexicon) as G[];
    for (const group of this.groups) {
      for (const term of lexicon[group]) {
        const needle = squeeze(term.t);
        if (!needle) continue;
        if (!needle.includes(" ")) {
          if (needle.endsWith("*")) this.prefixes.push({ group, term, p: needle.slice(0, -1) });
          else this.exact.set(needle, [...(this.exact.get(needle) ?? []), { group, term }]);
          continue;
        }
        const words = needle.split(/\s+/);
        const last = words[words.length - 1];
        const tail = last.endsWith("*") ? wordRe(last) : `${escape(last)}${SUFFIX_RE}`;
        const body = [...words.slice(0, -1).map(wordRe), tail].join(" ");
        const phrase: Phrase<G> = { group, term, re: new RegExp(` ${body} `, "u"), joined: words.join("").replace(/\*/g, "") };
        if (words[0].endsWith("*")) this.loosePhrases.push(phrase);
        else this.phrasesByFirst.set(words[0], [...(this.phrasesByFirst.get(words[0]) ?? []), phrase]);
      }
    }
  }

  /** Istilah yang cocok per kelompok (masing-masing paling banyak sekali), urut dari bobot terbesar. */
  find(doc: Doc): Record<G, Hit[]> {
    const found = new Map<G, Map<string, number>>();
    const add = ({ group, term }: Entry<G>) => {
      let m = found.get(group);
      if (!m) found.set(group, (m = new Map()));
      if ((m.get(term.t) ?? -Infinity) < term.w) m.set(term.t, term.w);
    };
    const firstWords = new Set<string>();
    doc.tokens.forEach((token, i) => {
      for (const s of doc.stems[i]) {
        const hits = this.exact.get(s);
        if (hits) for (const h of hits) add(h);
        if (this.phrasesByFirst.has(s)) firstWords.add(s);
      }
      for (const p of this.prefixes) if (token.startsWith(p.p)) add(p);
    });
    for (const first of firstWords) for (const ph of this.phrasesByFirst.get(first)!) if (ph.re.test(doc.spaced)) add(ph);
    for (const ph of this.loosePhrases) if (ph.re.test(doc.spaced)) add(ph);

    /* "g o b l o k" / "c e k  p r o f i l": cocokkan juga ke teks tanpa spasi. */
    if (doc.spacedLetters) {
      for (const [needle, entries] of this.exact) if (needle.length >= 4 && doc.compact.includes(needle)) entries.forEach(add);
      for (const list of this.phrasesByFirst.values()) for (const ph of list) if (ph.joined.length >= 6 && doc.compact.includes(ph.joined)) add(ph);
    }

    const out = {} as Record<G, Hit[]>;
    for (const g of this.groups) {
      const m = found.get(g);
      out[g] = m ? [...m].map(([t, w]) => ({ t, w })).sort((a, b) => b.w - a.w) : [];
    }
    return out;
  }
}

/** Satu kamus saja (dipakai mode kustom). */
export class Matcher {
  private inner: MultiMatcher<"x">;
  constructor(terms: Term[]) {
    this.inner = new MultiMatcher({ x: terms });
  }
  find(doc: Doc): Hit[] {
    return this.inner.find(doc).x;
  }
}

/** Jumlah bobot dengan imbal hasil menurun: bukti ke-2, ke-3, dst. makin kecil pengaruhnya. */
export function decayedSum(hits: Hit[], decay = [1, 0.75, 0.5, 0.35, 0.25]): number {
  let total = 0;
  hits.forEach((h, i) => (total += h.w * (decay[i] ?? 0.2)));
  return total;
}

import { analyzeRules, RULE_DIRECT_THRESHOLD } from "../judol-rules";
import { normalize } from "../normalize";
import { CATEGORY_LABEL, MODE_CATEGORIES, MODES, modeOf, type Category, type CommentInput, type Mode, type Verdict } from "../types";
import { NaiveBayes, type Labeled } from "./bayes";
import { BIAS, customTerms, isWarning, ruleEvidence } from "./features";
import { NeighborIndex } from "./knn";
import { Matcher } from "./matcher";
import { SEED_BASE, SEED_SAMPLE } from "./seed-data";
import { toDoc } from "./text";

/*
 * Raphael — mesin keputusan lokal HideMent.
 *
 * Cara kerjanya meniru "decision model" (bukan model bahasa): untuk setiap komentar, setiap kategori
 * dari mode yang aktif diperlakukan sebagai satu pilihan jawaban dan diberi keyakinan 0–1. Keyakinan itu
 * gabungan tiga sumber bukti dalam satuan log-odds:
 *   1. aturan & kamus berbobot (features.ts) — target orang, negasi, konteks kritik, kedekatan kata;
 *   2. Naive Bayes dari contoh berlabel (seed bawaan + contoh belajar pengguna);
 *   3. pencarian contoh paling mirip (knn.ts), seperti RAG tanpa model bahasa: database contoh berlabel
 *      (data/seed) dan contoh belajar pengguna. Contoh yang mirip ikut menjadi bukti, dan ditampilkan sebagai
 *      alasan supaya setiap keputusan bisa ditelusuri. Label buatan pengguna selalu paling kuat.
 * Semuanya berjalan di browser: tanpa API key, tanpa internet, dalam hitungan mikrodetik per komentar.
 */

export type { Labeled } from "./bayes";

export const DEFAULT_SEED: Labeled[] = [...SEED_BASE, ...SEED_SAMPLE];

/** Di bawah keyakinan ini komentar dianggap aman (skor < 30, sama dengan batas "aman" lama). */
export const FLAG_MIN = 0.3;
const NB_WEIGHT = 0.9;
const NB_WEIGHT_ALONE = 0.6;
const NB_WEIGHT_SAFE = 0.6;
/** Contoh pengguna mulai berpengaruh dari kemiripan ini, dan dianggap "komentar yang sama" dari NEAR_SAME. */
const NEAR_MIN = 0.5;
const NEAR_SAME = 0.85;
/** Database bawaan: mulai berpengaruh dari kemiripan ini, maksimal sekuat DB_BOOST log-odds (lebih lunak dari contohmu). */
const DB_MIN = 0.55;
const DB_SAME = 0.85;
const DB_BOOST = 3.5;
const DB_RANK = [1, 0.6, 0.4];

export interface EngineOptions {
  /** Contoh belajar dari pengguna (manual, impor, Antrian, link, "Bukan berbahaya"). */
  examples?: Labeled[];
  /** Contoh bawaan; default seed sintetis + dataset riset. */
  seed?: Labeled[];
}

export interface DecideContext {
  modes: Record<Mode, boolean>;
  custom?: { name: string; definition: string };
  customKeywords?: string[];
}

export interface Similar {
  text: string;
  label: Category;
  /** Kemiripan 0–1. */
  sim: number;
  from: "database" | "contohmu";
}

export interface Decision {
  verdict: Verdict;
  /** Keyakinan 0–1 tiap kategori aktif, seperti skor tiap pilihan pada model keputusan. */
  probs: Partial<Record<Category, number>>;
  /** Contoh berlabel paling mirip yang dipakai sebagai bukti (paling mirip dulu). */
  similar: Similar[];
  /** Lama menilai komentar ini (mikrodetik). */
  us: number;
}

export interface EngineStats {
  seed: number;
  examples: number;
  vocab: number;
}

const now = () => globalThis.performance?.now() ?? Date.now();
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Mode untuk verdict "aman": mode aktif pertama selain judol, supaya badge aman tetap punya konteks. */
export function safeMode(modes: Record<Mode, boolean>): Mode {
  return MODES.find((m) => m !== "judol" && modes[m]) ?? "judol";
}

export class DecisionEngine {
  private nb: NaiveBayes;
  private near: NeighborIndex;
  private db: NeighborIndex;
  private customKey = "";
  private customMatcher: Matcher | null = null;
  private userCounts = new Map<Category, number>();
  readonly stats: EngineStats;

  constructor({ examples = [], seed = DEFAULT_SEED }: EngineOptions = {}) {
    for (const e of examples) this.userCounts.set(e.label, (this.userCounts.get(e.label) ?? 0) + 1);
    this.nb = new NaiveBayes([...seed, ...examples]);
    this.near = new NeighborIndex(examples, (t) => toDoc(t).spaced);
    this.db = new NeighborIndex(seed, (t) => toDoc(t).spaced);
    this.stats = { seed: seed.length, examples: examples.length, vocab: this.nb.vocabSize };
  }

  private custom(definition: string): Matcher | null {
    if (definition !== this.customKey) {
      this.customKey = definition;
      const terms = customTerms(definition);
      this.customMatcher = terms.length ? new Matcher(terms) : null;
    }
    return this.customMatcher;
  }

  decide(c: CommentInput, ctx: DecideContext): Decision {
    const started = now();
    const { modes } = ctx;
    let similar: Similar[] = [];
    const done = (verdict: Verdict, probs: Decision["probs"] = {}): Decision => ({ verdict, probs, similar, us: Math.round((now() - started) * 1000) });
    const safe = (reason: string, score = 0): Verdict => ({ id: c.id, mode: safeMode(modes), category: "aman", score: Math.min(29, score), reason, source: "model" });

    const kustomOn = modes.kustom && Boolean(ctx.custom?.definition);
    const active = new Set<Category>(MODES.filter((m) => modes[m] && (m !== "kustom" || kustomOn)).flatMap((m) => MODE_CATEGORIES[m]));
    const n = normalize(c.text);
    const rules = analyzeRules(c.text, ctx.customKeywords ?? [], n);
    if (rules.trivial) return done({ ...safe("terlalu pendek"), mode: "judol", source: "rule" });

    const doc = toDoc(c.text, n);
    const [nearest] = this.near.nearest(doc, active, 1);
    const fromDb = this.db.nearest(doc, active, 3);
    similar = [
      ...(nearest ? [{ text: nearest.example.text, label: nearest.example.label, sim: nearest.sim, from: "contohmu" as const }] : []),
      ...fromDb.map((x) => ({ text: x.example.text, label: x.example.label, sim: x.sim, from: "database" as const })),
    ]
      .filter((x) => x.sim >= 0.3)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 3);
    const userSaysSafe = nearest && nearest.sim >= NEAR_SAME && nearest.example.label === "aman";
    if (userSaysSafe) return done(safe(`sama dengan contoh aman buatanmu (${Math.round(nearest.sim * 100)}%)`));

    /*
     * Judol yang jelas langsung diputuskan aturan (paling cepat). Phising tetap lewat mesin supaya promosi judol
     * berlink ("mampir ke naga999 titik xyz") dan peringatan ("hati2, itu judol") bisa dibedakan.
     */
    if (modes.judol && rules.judolCategory === "judol" && rules.judolScore >= RULE_DIRECT_THRESHOLD && !isWarning(doc)) {
      const verdict: Verdict = { id: c.id, mode: "judol", category: rules.judolCategory, score: rules.judolScore, reason: rules.reasons.join("; "), source: "rule" };
      return done(verdict, { [rules.judolCategory]: rules.judolScore / 100 });
    }
    if (!active.size) return done(safe("tidak ada mode aktif"));

    const ev = ruleEvidence(doc, { active, rules, custom: kustomOn ? this.custom(ctx.custom!.definition) : null });
    const nb = this.nb.evidence(doc, active);
    for (const [cat, e] of nb) {
      const slot = ev.get(cat) ?? { z: BIAS, why: [] };
      /*
       * Naive Bayes dari contoh sedikit mudah "hafal kata" (mis. "dong kak"). Bobot penuh hanya kalau aturan
       * juga melihat tanda kategori itu, atau pengguna sudah memberi cukup contoh kategori tersebut.
       * Bukti "mirip komentar aman" selalu dipakai, tapi lebih lunak.
       */
      const ruled = slot.z > BIAS + 0.5;
      const weight = e < 0 ? (slot.z > 0 ? NB_WEIGHT_SAFE / 2 : NB_WEIGHT_SAFE) : ruled || (this.userCounts.get(cat) ?? 0) >= 5 ? NB_WEIGHT : NB_WEIGHT_ALONE;
      slot.z += weight * e;
      if (e > 1.2 && !slot.why.length) slot.why.push(`pola kata mirip contoh ${CATEGORY_LABEL[cat].toLowerCase()}`);
      ev.set(cat, slot);
    }
    /* Database: hingga 3 contoh paling mirip memberi suara sesuai labelnya (yang paling mirip paling kuat). */
    fromDb.forEach((x, rank) => {
      if (x.sim < DB_MIN) return;
      const boost = (x.sim >= DB_SAME ? DB_BOOST : ((x.sim - DB_MIN) / (DB_SAME - DB_MIN)) * DB_BOOST) * DB_RANK[rank];
      if (x.example.label === "aman") {
        for (const slot of ev.values()) slot.z -= boost;
        return;
      }
      const slot = ev.get(x.example.label);
      if (!slot) return;
      slot.z += boost;
      if (rank === 0 || boost > 1) slot.why.push(`mirip contoh database "${x.example.text.slice(0, 48)}${x.example.text.length > 48 ? "…" : ""}" (${Math.round(x.sim * 100)}%)`);
    });
    if (nearest && nearest.sim >= NEAR_MIN) {
      const boost = nearest.sim >= NEAR_SAME ? 5 : ((nearest.sim - NEAR_MIN) / (NEAR_SAME - NEAR_MIN)) * 4;
      const label = nearest.example.label;
      const note = `mirip contoh belajarmu (${Math.round(nearest.sim * 100)}%)`;
      if (label === "aman") for (const slot of ev.values()) slot.z -= boost;
      else {
        const slot = ev.get(label) ?? { z: BIAS, why: [] };
        slot.z += boost;
        slot.why.unshift(note);
        ev.set(label, slot);
      }
    }

    const probs: Decision["probs"] = {};
    let top: Category | null = null;
    for (const [cat, e] of ev) {
      probs[cat] = sigmoid(e.z);
      if (top === null || probs[cat]! > probs[top]!) top = cat;
    }
    if (top === null) return done(safe("tidak ada tanda berbahaya"), probs);

    const p = probs[top]!;
    const score = Math.round(p * 100);
    if (p < FLAG_MIN) {
      const reason = p < 0.1 ? "tidak ada tanda berbahaya" : `sedikit tanda ${CATEGORY_LABEL[top].toLowerCase()} (${score}), belum cukup`;
      return done(safe(reason, score), probs);
    }
    const why = ev.get(top)!.why;
    const verdict: Verdict = {
      id: c.id,
      mode: modeOf(top)!,
      category: top,
      score,
      reason: (why.length ? why.join("; ") : `keyakinan ${CATEGORY_LABEL[top].toLowerCase()} ${score}%`).slice(0, 240),
      source: "model",
      ...(top === "kustom" && ctx.custom?.name ? { label: ctx.custom.name } : {}),
    };
    return done(verdict, probs);
  }
}

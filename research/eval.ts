/**
 * Evaluasi HideMent terhadap dataset berlabel, untuk penyedia Lokal dan Gemini.
 *
 *   npm run eval [-- path/dataset.jsonl] [--folds 5]
 *   npm run eval -- research/dataset/blind4.jsonl --provider gemini [--model gemini-2.5-flash] [--full]
 *
 * Lokal: k-fold (komentar yang dinilai TIDAK pernah ikut jadi contoh latih) plus
 * hasil "seed bawaan saja" sebagai pembanding. Gemini: satu putaran penuh lewat
 * API (batch 20), tanpa latih; baris yang gagal dinilai dihitung sebagai gagal,
 * bukan diam-diam diganti hasil lokal.
 *
 * Supaya jujur, seed bawaan yang teksnya sama persis ATAU kemiripannya >= 0,85
 * dengan baris uji ikut dibuang (dulu hanya teks yang sama persis).
 *
 * 8 benchmark yang dilaporkan: (1) kategori tepat, (2) precision/recall/F1
 * berbahaya vs aman + per kategori, (3) false positive komentar aman,
 * (4) latensi median/p95 + komentar per detik, (5) biaya per 1.000 komentar
 * (token in/out x tarif dari env GEMINI_PRICE_USD_PER_1M_IN/OUT; Lokal Rp 0),
 * (6) ketahanan kamuflase (jalankan eval pada blind4-camouflage.jsonl dan
 * bandingkan penurunan akurasinya), (7) kalibrasi skor (dari prediksi skor
 * >= 80 berapa persen yang benar, + persen prediksi ragu skor 30-50),
 * (8) tingkat kegagalan (timeout, rate limit, JSON gagal, end-to-end 300 komentar).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { DecisionEngine, DEFAULT_SEED, type Labeled } from "../src/core/engine";
import { NeighborIndex } from "../src/core/engine/knn";
import { toDoc } from "../src/core/engine/text";
import { exampleKey } from "../src/core/examples";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import {
  GEMINI_BATCH_SIZE,
  GEMINI_DEFAULT_MODEL,
  GeminiDecisionProvider,
  fastPathVerdict,
  type TokenUsage,
} from "../src/core/providers";
import { MODE_CATEGORIES, MODES, modeOf, type Category, type Verdict } from "../src/core/types";

interface Row {
  text: string;
  label: Category;
  sentimen?: "positif" | "netral" | "negatif";
  /** Baris dari ekspor Antrian yang labelnya belum dicek manusia. */
  perlu_review?: boolean;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const folds = Math.max(2, Number(flag("--folds") ?? 5));
const provider = flag("--provider") ?? "local";
const geminiModel = flag("--model") ?? GEMINI_DEFAULT_MODEL;
const geminiFull = args.includes("--full");
const batchSize = Math.max(1, Number(flag("--batch") ?? GEMINI_BATCH_SIZE));
const file = args[0] ?? "research/dataset/sample.jsonl";
const modes = { ...DEFAULT_SETTINGS.modes, kebencian: true, pelecehan: true, agama: true, sara: true };
const { medium } = DEFAULT_SETTINGS.thresholds;

const allRows: Row[] = (await readFile(file, "utf8"))
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
/* Label yang belum dicek manusia hanyalah tebakan; memakainya sebagai kunci jawaban membuat skor palsu. */
const rows = allRows.filter((r) => r.perlu_review !== true);
if (rows.length < allRows.length) console.log(`Melewati ${allRows.length - rows.length} baris perlu_review (belum dicek manusia).`);

/* Seed bawaan yang kebetulan sama dengan baris dataset dibuang, supaya tidak ada contekan. */
const keys = new Set(rows.map((r) => exampleKey(r.text)));
const seedExact = DEFAULT_SEED.filter((s) => !keys.has(exampleKey(s.text)));
/* Kebocoran yang lebih halus: seed yang hampir sama dengan baris uji (kemiripan >= 0,85) ikut dibuang. */
const allCategories = new Set<Category>([...MODES.flatMap((m) => MODE_CATEGORIES[m]), "aman"]);
const simIndex = new NeighborIndex(seedExact, (t) => toDoc(t).spaced);
const dropSim = new Set<number>();
for (const r of rows) {
  for (const n of simIndex.nearest(toDoc(r.text), allCategories, 3)) {
    if (n.sim >= 0.85) dropSim.add(seedExact.indexOf(n.example));
  }
}
const seed = seedExact.filter((_, i) => !dropSim.has(i));
if (dropSim.size) console.log(`Membuang ${dropSim.size} contoh seed yang kemiripannya >= 0,85 dengan baris uji.`);

/** Komentar dianggap "ditandai" kalau kategorinya bukan aman DAN skornya mencapai ambang sedang (sama dengan di ekstensi). */
const flagged = (v: Verdict | undefined): Category => (v && v.category !== "aman" && v.score >= medium ? v.category : "aman");

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function runLocal(trainOf: (fold: number) => Labeled[]): { pred: Verdict[]; totalUs: number } {
  const pred: Verdict[] = new Array(rows.length);
  let totalUs = 0;
  /* Pemanasan JIT supaya waktu per komentar mencerminkan pemakaian nyata (ekstensi menilai ratusan komentar). */
  const warm = new DecisionEngine({ seed: [] });
  for (const r of rows) warm.decide({ id: "w", text: r.text }, { modes });
  for (let f = 0; f < folds; f++) {
    const engine = new DecisionEngine({ seed: [...seed, ...trainOf(f)] });
    rows.forEach((r, i) => {
      if (i % folds !== f) return;
      const d = engine.decide({ id: String(i), text: r.text }, { modes });
      pred[i] = d.verdict;
      totalUs += d.us;
    });
  }
  return { pred, totalUs };
}

interface EvalOutcome {
  exact: number;
  perMode: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }>;
  perCategory: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }>;
  falsePositiveSafe: number;
  safeTotal: number;
  errors: { text: string; gold: Category; pred: Category; score?: number; reason?: string }[];
  calibration: { highConfidenceTotal: number; highConfidenceCorrect: number; highConfidenceAccuracy: number; uncertainCount: number; uncertainShare: number };
}

function report(name: string, pred: (Verdict | undefined)[], totalUs: number): EvalOutcome {
  const p = (i: number) => flagged(pred[i]);
  const prf = (isPos: (c: Category) => boolean) => {
    let tp = 0, fp = 0, fn = 0;
    rows.forEach((r, i) => {
      if (pred[i] === undefined) return;
      const a = isPos(p(i)), g = isPos(r.label);
      if (a && g) tp++;
      else if (a && !g) fp++;
      else if (!a && g) fn++;
    });
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { tp, fp, fn, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3) };
  };
  const labels = [...MODES.flatMap((m) => MODE_CATEGORIES[m])].filter((l) => l !== "kustom");
  const perMode = {
    ...Object.fromEntries(MODES.filter((m) => m !== "kustom").map((m) => [m, prf((c) => MODE_CATEGORIES[m].includes(c))])),
    berbahaya: prf((c) => c !== "aman"),
  };
  const perCategory = Object.fromEntries(labels.filter((l) => rows.some((r) => r.label === l)).map((l) => [l, prf((c) => c === l)]));
  const safeRows = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.label === "aman");
  const fpSafe = safeRows.filter(({ i }) => pred[i] !== undefined && p(i) !== "aman");
  const decided = rows.filter((_, i) => pred[i] !== undefined);
  const exact = rows.filter((r, i) => pred[i] !== undefined && p(i) === r.label).length;
  const errors = rows
    .map((r, i) => ({ text: r.text, gold: r.label, pred: p(i), score: pred[i]?.score, reason: pred[i]?.reason }))
    .filter((e, i) => pred[i] !== undefined && e.gold !== e.pred);
  /* Kalibrasi: dari prediksi skor >= 80, berapa persen yang benar; prediksi ragu = skor 30-50. */
  const highIdx = rows.map((_, i) => i).filter((i) => pred[i] !== undefined && pred[i]!.score >= 80);
  const highCorrect = highIdx.filter((i) => p(i) === rows[i].label).length;
  const uncertain = rows.filter((_, i) => pred[i] !== undefined && pred[i]!.score >= 30 && pred[i]!.score <= 50).length;
  const calibration = {
    highConfidenceTotal: highIdx.length,
    highConfidenceCorrect: highCorrect,
    highConfidenceAccuracy: highIdx.length ? +(highCorrect / highIdx.length).toFixed(3) : 0,
    uncertainCount: uncertain,
    uncertainShare: decided.length ? +(uncertain / decided.length).toFixed(3) : 0,
  };

  console.log(`\n━━ ${name} ━━`);
  const avgUs = totalUs / Math.max(1, decided.length);
  const avgText = avgUs >= 10000 ? `${(avgUs / 1000).toFixed(0)} ms/komentar` : `${avgUs.toFixed(0)} µs/komentar`;
  console.log(`Kategori tepat: ${exact}/${decided.length} dinilai (${decided.length ? ((exact / decided.length) * 100).toFixed(1) : "0"}%)  ·  rata-rata ${avgText}`);
  console.log("Per mode:");
  console.table(perMode);
  console.log("Per kategori:");
  console.table(perCategory);
  console.log(`False positive pada komentar aman: ${fpSafe.length}/${safeRows.length} (${((fpSafe.length / Math.max(1, safeRows.length)) * 100).toFixed(1)}%)`);
  console.log(
    `Kalibrasi: ${calibration.highConfidenceCorrect}/${calibration.highConfidenceTotal} prediksi skor >= 80 benar (${(calibration.highConfidenceAccuracy * 100).toFixed(1)}%); prediksi ragu (skor 30-50): ${calibration.uncertainCount} (${(calibration.uncertainShare * 100).toFixed(1)}%)`,
  );
  return { exact, perMode, perCategory, falsePositiveSafe: fpSafe.length, safeTotal: safeRows.length, errors, calibration };
}

function costPer1000(usage: TokenUsage, n: number): { usd: number | null; note: string } {
  const inRate = Number(process.env.GEMINI_PRICE_USD_PER_1M_IN);
  const outRate = Number(process.env.GEMINI_PRICE_USD_PER_1M_OUT);
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate) || n === 0) {
    return { usd: null, note: "tarif tidak diisi (isi GEMINI_PRICE_USD_PER_1M_IN dan GEMINI_PRICE_USD_PER_1M_OUT dari halaman harga resmi Google)" };
  }
  const per1000In = (usage.inputTokens / n) * 1000;
  const per1000Out = (usage.outputTokens / n) * 1000;
  return { usd: +(((per1000In * inRate) / 1e6 + (per1000Out * outRate) / 1e6).toFixed(4)), note: `tarif env: in $${inRate}/1jt, out $${outRate}/1jt` };
}

const machine = `${process.platform} · ${cpus()[0]?.model ?? "CPU tidak dikenal"} · ${(totalmem() / 1024 ** 3).toFixed(1)} GB RAM · Node ${process.version}`;
console.log(`Dataset: ${file} (${rows.length} komentar) · seed bawaan ${seed.length} contoh · ${folds}-fold`);
console.log(`Mesin pengukur: ${machine} · ${new Date().toISOString()}`);

let result: Record<string, unknown>;

if (provider === "gemini") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY belum diisi. Isi dulu, misal: GEMINI_API_KEY=... npm run eval -- research/dataset/blind4.jsonl --provider gemini");
    process.exit(1);
  }
  const gemini = new GeminiDecisionProvider({ apiKey, model: geminiModel, batchSize });
  const ctx = { modes, custom: DEFAULT_SETTINGS.custom, customKeywords: DEFAULT_SETTINGS.customKeywords };
  const pred: (Verdict | undefined)[] = new Array(rows.length);
  const latenciesMs: number[] = [];
  let failures = 0;
  let totalUs = 0;
  const startedAll = Date.now();
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const batchStart = Date.now();
    try {
      const comments = batch.map((r, k) => ({ id: String(i + k), text: r.text }));
      const decidedVerdicts: (Verdict | undefined)[] = comments.map(() => undefined);
      let toDecide = comments;
      if (!geminiFull) {
        toDecide = [];
        comments.forEach((c, k) => {
          const rule = fastPathVerdict(c, ctx);
          if (rule) decidedVerdicts[k] = rule;
          else toDecide.push(c);
        });
      }
      if (toDecide.length) {
        const decisions = await gemini.decide(toDecide, ctx);
        for (const d of decisions) {
          const idx = comments.findIndex((c) => c.id === d.verdict.id);
          decidedVerdicts[idx] = d.verdict;
        }
      }
      const msPerComment = (Date.now() - batchStart) / batch.length;
      batch.forEach((_, k) => {
        pred[i + k] = decidedVerdicts[k];
        latenciesMs.push(msPerComment);
        totalUs += msPerComment * 1000;
      });
    } catch (e) {
      failures += batch.length;
      console.log(`Batch ${i / batchSize + 1} gagal dan dihitung gagal (${batch.length} komentar): ${e instanceof Error ? e.message : e}`);
    }
  }
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const main = report(`Gemini ${geminiModel}${geminiFull ? " (penuh, tanpa fast path)" : " (fast path aturan judol aktif)"}`, pred, totalUs);
  const usage = gemini.totalUsage;
  const cost = costPer1000(usage, rows.length - failures);
  const endToEndMs = Date.now() - startedAll;
  console.log(`\nLatensi Gemini: median ${percentile(sorted, 0.5).toFixed(0)} ms, p95 ${percentile(sorted, 0.95).toFixed(0)} ms per komentar · ${(rows.length / Math.max(1, endToEndMs / 1000)).toFixed(1)} komentar/menit (end-to-end ${rows.length} komentar: ${(endToEndMs / 1000).toFixed(1)} s)`);
  console.log(`Token: ${usage.inputTokens} in + ${usage.outputTokens} out = ${usage.totalTokens} total (${rows.length - failures ? Math.round((usage.totalTokens / (rows.length - failures)) * 1000) : 0} token/1.000 komentar)`);
  console.log(`Biaya per 1.000 komentar: ${cost.usd === null ? "belum dihitung" : `$${cost.usd}`} (${cost.note})`);
  console.log(`Tingkat kegagalan: ${failures}/${rows.length} komentar (${((failures / rows.length) * 100).toFixed(1)}%)`);
  if (main.errors.length) {
    console.log("\nKesalahan (Gemini):");
    for (const e of main.errors) console.log(`  [${e.gold} → ${e.pred}${e.score !== undefined ? ` ${e.score}` : ""}] ${e.text.slice(0, 80)}`);
  }
  result = {
    provider: "gemini",
    model: geminiModel,
    full: geminiFull,
    file,
    n: rows.length,
    machine,
    date: new Date().toISOString(),
    latencyMs: { median: +percentile(sorted, 0.5).toFixed(1), p95: +percentile(sorted, 0.95).toFixed(1), endToEndSeconds: +(endToEndMs / 1000).toFixed(1) },
    usage,
    costPer1000: cost,
    failures,
    gemini: main,
  };
} else {
  const seedOnly = runLocal(() => []);
  const cv = runLocal((f) => rows.filter((_, i) => i % folds !== f));
  const base = report("Seed bawaan saja (tanpa contoh dari dataset ini)", seedOnly.pred, seedOnly.totalUs);
  const main = report(`Seed + contoh dataset (${folds}-fold, komentar uji tidak pernah dilatih)`, cv.pred, cv.totalUs);

  const sentimentTable: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!r.sentimen) continue;
    const group = modeOf(r.label) ?? "aman";
    sentimentTable[group] ??= { positif: 0, netral: 0, negatif: 0 };
    sentimentTable[group][r.sentimen]++;
  }
  if (Object.keys(sentimentTable).length) {
    console.log("\nSebaran sentimen (label asli) — bukti bahwa nada ≠ bahaya:");
    console.table(sentimentTable);
  }
  if (main.errors.length) {
    console.log("\nKesalahan (k-fold):");
    for (const e of main.errors) console.log(`  [${e.gold} → ${e.pred}${e.score !== undefined ? ` ${e.score}` : ""}] ${e.text.slice(0, 80)}`);
  }
  result = {
    provider: "local",
    file,
    n: rows.length,
    folds,
    machine,
    date: new Date().toISOString(),
    seed: seed.length,
    seedOnly: base,
    kfold: main,
    sentimentTable,
  };
}

await mkdir("research/results", { recursive: true });
const out = `research/results/eval-${provider}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(out, JSON.stringify(result, null, 2));
console.log(`\n✓ Hasil disimpan ke ${out}`);

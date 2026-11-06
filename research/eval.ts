/**
 * Evaluasi mesin keputusan lokal HideMent terhadap dataset berlabel. Tidak butuh API/internet.
 *
 *   npm run eval [-- path/dataset.jsonl] [--folds 5]
 *
 * Supaya jujur, komentar yang dinilai TIDAK pernah ikut jadi contoh latih: dataset dibagi k bagian
 * (k-fold); tiap bagian dinilai oleh mesin yang hanya dilatih dari seed bawaan + bagian lainnya.
 * Ditampilkan juga hasil "tanpa contoh dataset" (seed bawaan saja) sebagai pembanding.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DecisionEngine, DEFAULT_SEED, type Labeled } from "../src/core/engine";
import { exampleKey } from "../src/core/examples";
import { DEFAULT_SETTINGS } from "../src/core/settings";
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
const seed = DEFAULT_SEED.filter((s) => !keys.has(exampleKey(s.text)));

/** Komentar dianggap "ditandai" kalau kategorinya bukan aman DAN skornya mencapai ambang sedang (sama dengan di ekstensi). */
const flagged = (v: Verdict | undefined): Category => (v && v.category !== "aman" && v.score >= medium ? v.category : "aman");

function run(trainOf: (fold: number) => Labeled[]): { pred: Verdict[]; totalUs: number } {
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

const cv = run((f) => rows.filter((_, i) => i % folds !== f));
const seedOnly = run(() => []);

function report(name: string, pred: Verdict[], totalUs: number) {
  const p = (i: number) => flagged(pred[i]);
  const prf = (isPos: (c: Category) => boolean) => {
    let tp = 0, fp = 0, fn = 0;
    rows.forEach((r, i) => {
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
  const fpSafe = safeRows.filter(({ i }) => p(i) !== "aman");
  const exact = rows.filter((r, i) => p(i) === r.label).length;
  const errors = rows
    .map((r, i) => ({ text: r.text, gold: r.label, pred: p(i), score: pred[i]?.score, reason: pred[i]?.reason }))
    .filter((e) => e.gold !== e.pred);

  console.log(`\n━━ ${name} ━━`);
  console.log(`Kategori tepat: ${exact}/${rows.length} (${((exact / rows.length) * 100).toFixed(1)}%)  ·  rata-rata ${(totalUs / rows.length).toFixed(0)} µs/komentar`);
  console.log("Per mode:");
  console.table(perMode);
  console.log("Per kategori:");
  console.table(perCategory);
  console.log(`False positive pada komentar aman: ${fpSafe.length}/${safeRows.length} (${((fpSafe.length / Math.max(1, safeRows.length)) * 100).toFixed(1)}%)`);
  return { exact, perMode, perCategory, falsePositiveSafe: fpSafe.length, errors };
}

console.log(`Dataset: ${file} (${rows.length} komentar) · seed bawaan ${seed.length} contoh · ${folds}-fold`);
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

await mkdir("research/results", { recursive: true });
const out = `research/results/eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(out, JSON.stringify({ file, n: rows.length, folds, seedOnly: base, kfold: main, sentimentTable }, null, 2));
console.log(`\n✓ Hasil disimpan ke ${out}`);

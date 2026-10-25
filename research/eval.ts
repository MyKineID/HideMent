/**
 * Evaluasi pipeline Raphael Guard (aturan lokal + 9router) terhadap dataset berlabel.
 *
 *   NINE_ROUTER_BASE_URL=https://host/v1 NINE_ROUTER_API_KEY=sk-... NINE_ROUTER_MODEL=xxx npm run eval [-- path/dataset.jsonl]
 *
 * Tanpa env 9router, hanya aturan lokal yang dievaluasi.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { prefilter } from "../src/core/judol-rules";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse, type AiItem } from "../src/core/prompt";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { MODE_CATEGORIES, type Category, type Verdict } from "../src/core/types";
import { chat } from "../src/background/api";

interface Row {
  text: string;
  label: Category;
  note?: string;
}

const file = process.argv[2] ?? "research/dataset/sample.jsonl";
const api = {
  ...DEFAULT_SETTINGS.api,
  baseUrl: process.env.NINE_ROUTER_BASE_URL ?? "",
  apiKey: process.env.NINE_ROUTER_API_KEY ?? "",
  model: process.env.NINE_ROUTER_MODEL ?? "",
  timeoutMs: 120000,
};
const modes = { judol: true, toxic: true };
const useAi = Boolean(api.baseUrl && api.model);

const rows: Row[] = (await readFile(file, "utf8"))
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const predictions = new Map<number, Verdict>();
const aiItems: { idx: number; item: AiItem }[] = [];
rows.forEach((r, idx) => {
  const pf = prefilter({ id: String(idx), text: r.text }, modes, []);
  if (pf.verdict) predictions.set(idx, pf.verdict);
  else if (pf.needsAi) aiItems.push({ idx, item: { input: { id: String(idx), text: r.text }, hint: pf.hint } });
});
const ruleDecided = predictions.size;

let totalLatency = 0;
if (useAi) {
  const system = buildSystemPrompt(modes);
  for (let i = 0; i < aiItems.length; i += api.batchSize) {
    const chunk = aiItems.slice(i, i + api.batchSize);
    const res = await chat(api, system, buildUserPrompt(chunk.map((c) => c.item)));
    totalLatency += res.latencyMs;
    for (const v of parseAiResponse(res.content, chunk.map((c) => c.item.input.id), modes)) predictions.set(Number(v.id), v);
    process.stdout.write(`\r  AI batch ${Math.ceil((i + 1) / api.batchSize)}/${Math.ceil(aiItems.length / api.batchSize)}`);
  }
  process.stdout.write("\n");
} else {
  console.log("ℹ Env 9router tidak diisi → hanya mengevaluasi aturan lokal (sisanya dianggap 'aman').");
}

const pred = (i: number): Category => predictions.get(i)?.category ?? "aman";
const labels: Category[] = [...MODE_CATEGORIES.judol, ...MODE_CATEGORIES.toxic, "aman"];

function prf(isPos: (c: Category) => boolean) {
  let tp = 0, fp = 0, fn = 0;
  rows.forEach((r, i) => {
    const p = isPos(pred(i)), g = isPos(r.label);
    if (p && g) tp++;
    else if (p && !g) fp++;
    else if (!p && g) fn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3) };
}

const perCategory = Object.fromEntries(labels.filter((l) => l !== "aman").map((l) => [l, prf((c) => c === l)]));
const perMode = {
  judol: prf((c) => (MODE_CATEGORIES.judol as Category[]).includes(c)),
  toxic: prf((c) => (MODE_CATEGORIES.toxic as Category[]).includes(c)),
  berbahaya: prf((c) => c !== "aman"),
};
const safeRows = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.label === "aman");
const falsePositives = safeRows.filter(({ i }) => pred(i) !== "aman");

const confusion: Record<string, Record<string, number>> = {};
rows.forEach((r, i) => {
  confusion[r.label] ??= {};
  confusion[r.label][pred(i)] = (confusion[r.label][pred(i)] ?? 0) + 1;
});

const errors = rows
  .map((r, i) => ({ text: r.text, gold: r.label, pred: pred(i), score: predictions.get(i)?.score, source: predictions.get(i)?.source, reason: predictions.get(i)?.reason }))
  .filter((e) => e.gold !== e.pred);

console.log(`\nDataset: ${file} (${rows.length} komentar)  Model: ${useAi ? api.model : "— (aturan lokal saja)"}`);
console.log(`Diputuskan aturan lokal: ${ruleDecided} (${((ruleDecided / rows.length) * 100).toFixed(0)}%)  ·  ke AI: ${aiItems.length}`);
if (useAi) console.log(`Total latensi AI: ${totalLatency} ms`);
console.log("\nPer mode:");
console.table(perMode);
console.log("Per kategori:");
console.table(perCategory);
console.log(`False positive pada komentar aman: ${falsePositives.length}/${safeRows.length} (${((falsePositives.length / Math.max(1, safeRows.length)) * 100).toFixed(1)}%)`);
if (errors.length) {
  console.log("\nKesalahan:");
  for (const e of errors) console.log(`  [${e.gold} → ${e.pred}${e.score !== undefined ? ` ${e.score}` : ""}] ${e.text.slice(0, 80)}`);
}

await mkdir("research/results", { recursive: true });
const out = `research/results/eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(out, JSON.stringify({ file, model: useAi ? api.model : null, n: rows.length, ruleDecided, perMode, perCategory, confusion, errors }, null, 2));
console.log(`\n✓ Hasil disimpan ke ${out}`);

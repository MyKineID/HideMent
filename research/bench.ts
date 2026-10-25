/**
 * Benchmark kecepatan & akurasi model di 9router untuk tugas klasifikasi komentar Tempest.
 *
 *   NINE_ROUTER_BASE_URL=... NINE_ROUTER_API_KEY=... npm run bench -- model-a model-b ...
 *
 * Tiap model menerima 20 komentar yang sama (prompt asli ekstensi, streaming).
 * Diukur: waktu ke hasil pertama, total waktu, akurasi berbahaya/aman, dan ketepatan kategori.
 */
import { readFile } from "node:fs/promises";
import { chatStream } from "../src/background/api";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse, parseJsonLines, parseVerdictRow } from "../src/core/prompt";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import type { Category } from "../src/core/types";

const models = process.argv.slice(2);
if (!models.length) {
  console.error("Pakai: npm run bench -- <model> [model ...]");
  process.exit(1);
}
const modes = { judol: true, toxic: true };
const LIMIT = Number(process.env.BENCH_N ?? 20);
const rows = (await readFile("research/dataset/sample.jsonl", "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { text: string; label: Category });

const picked: typeof rows = [];
const seen = new Map<string, number>();
for (const r of rows) {
  const n = seen.get(r.label) ?? 0;
  if (n < (r.label === "aman" ? 5 : 2) && picked.length < LIMIT) {
    picked.push(r);
    seen.set(r.label, n + 1);
  }
}
const ids = picked.map((_, i) => String(i + 1));
const system = buildSystemPrompt(modes);
const user = buildUserPrompt(picked.map((r, i) => ({ input: { id: ids[i], text: r.text } })));

interface Result {
  model: string;
  ok: boolean;
  firstMs?: number;
  totalMs?: number;
  got?: number;
  harmAcc?: number;
  catAcc?: number;
  error?: string;
}

async function bench(model: string): Promise<Result> {
  const api = { ...DEFAULT_SETTINGS.api, baseUrl: process.env.NINE_ROUTER_BASE_URL ?? "", apiKey: process.env.NINE_ROUTER_API_KEY ?? "", model, timeoutMs: 30000 };
  const started = Date.now();
  let firstMs = 0;
  let buf = "";
  try {
    const res = await chatStream(api, system, user, (t) => {
      buf += t;
      if (!firstMs && parseJsonLines(buf.slice(0, buf.lastIndexOf("\n") + 1)).some((r) => parseVerdictRow(r, modes))) firstMs = Date.now() - started;
    });
    const v = new Map(parseAiResponse(res.content, ids, modes).map((x) => [x.id, x]));
    let harm = 0;
    let cat = 0;
    picked.forEach((r, i) => {
      const p = v.get(ids[i])?.category ?? "aman";
      if ((p === "aman") === (r.label === "aman")) harm++;
      if (p === r.label) cat++;
    });
    return { model, ok: true, firstMs: firstMs || res.latencyMs, totalMs: res.latencyMs, got: v.size, harmAcc: harm / picked.length, catAcc: cat / picked.length };
  } catch (e) {
    return { model, ok: false, error: (e as Error).message.slice(0, 60) };
  }
}

const results: Result[] = [];
const queue = [...models];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const r = await bench(m);
      results.push(r);
      console.log(r.ok ? `✓ ${m}  ${r.firstMs} ms / ${r.totalMs} ms` : `✗ ${m}  ${r.error}`);
    }
  }),
);

const ok = results.filter((r) => r.ok).sort((a, b) => a.totalMs! - b.totalMs!);
console.log(`\n${picked.length} komentar per model · diurutkan dari total waktu tercepat\n`);
console.table(
  ok.map((r) => ({
    model: r.model,
    "hasil pertama": `${(r.firstMs! / 1000).toFixed(1)} dtk`,
    total: `${(r.totalMs! / 1000).toFixed(1)} dtk`,
    terjawab: `${r.got}/${picked.length}`,
    "berbahaya vs aman": `${Math.round(r.harmAcc! * 100)}%`,
    kategori: `${Math.round(r.catAcc! * 100)}%`,
  })),
);
const failed = results.filter((r) => !r.ok);
if (failed.length) console.log(`Gagal: ${failed.map((r) => `${r.model} (${r.error})`).join("; ")}`);

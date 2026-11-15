/**
 * Benchmark kecepatan HideMent, untuk penyedia Lokal dan Gemini.
 *
 *   npm run bench [-- path/dataset.jsonl ...]
 *   npm run bench -- research/dataset/blind4.jsonl --provider gemini [--model gemini-2.5-flash]
 *
 * Lokal (tanpa API, tanpa internet). Diukur: waktu membangun mesin (melatih Naive
 * Bayes dari seed + contoh), waktu menilai satu komentar (median, p95, rata-rata
 * setelah pemanasan), jumlah komentar per detik, dan end-to-end 300 komentar.
 *
 * Gemini (butuh GEMINI_API_KEY). Diukur per batch 20: median/p95 ms per komentar,
 * komentar per menit, token in/out per 1.000 komentar, biaya per 1.000 komentar
 * (kalau tarif diisi lewat env GEMINI_PRICE_USD_PER_1M_IN/OUT), dan tingkat
 * kegagalan batch. Biaya tidak pernah dihitung dari tarif yang diingat: tanpa
 * tarif env, yang dilaporkan hanya token.
 */
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { DecisionEngine } from "../src/core/engine";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import {
  GEMINI_BATCH_SIZE,
  GEMINI_DEFAULT_MODEL,
  GeminiDecisionProvider,
  type TokenUsage,
} from "../src/core/providers";

const rawArgs = process.argv.slice(2);
const flag = (name: string) => {
  const i = rawArgs.indexOf(name);
  return i >= 0 ? rawArgs.splice(i, 2)[1] : undefined;
};
const provider = flag("--provider") ?? "local";
const geminiModel = flag("--model") ?? GEMINI_DEFAULT_MODEL;
const batchSize = Math.max(1, Number(flag("--batch") ?? GEMINI_BATCH_SIZE));
const files = rawArgs.length ? rawArgs : ["research/dataset/sample.jsonl", "research/dataset/holdout.jsonl", "research/dataset/blind.jsonl"];

const texts: string[] = [];
for (const f of files) {
  const raw = await readFile(f, "utf8").catch(() => "");
  for (const l of raw.split("\n")) if (l.trim()) texts.push(JSON.parse(l).text);
}
if (!texts.length) {
  console.error("Tidak ada komentar untuk diuji.");
  process.exit(1);
}

const modes = { judol: true, kebencian: true, pelecehan: true, agama: true, sara: true, kustom: true };
const custom = { name: "Spoiler", definition: "ending, mati di akhir, pelakunya ternyata" };
const ctx = { modes, custom, customKeywords: DEFAULT_SETTINGS.customKeywords };
const now = () => performance.now();
const machine = `${process.platform} · ${cpus()[0]?.model ?? "CPU tidak dikenal"} · ${(totalmem() / 1024 ** 3).toFixed(1)} GB RAM · Node ${process.version}`;
console.log(`Mesin pengukur: ${machine} · ${new Date().toISOString()}`);
console.log(`${texts.length} komentar dari: ${files.join(", ")}`);

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
}

function costPer1000(usage: TokenUsage, n: number): string {
  const inRate = Number(process.env.GEMINI_PRICE_USD_PER_1M_IN);
  const outRate = Number(process.env.GEMINI_PRICE_USD_PER_1M_OUT);
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate) || n === 0) {
    return "belum dihitung (isi GEMINI_PRICE_USD_PER_1M_IN dan GEMINI_PRICE_USD_PER_1M_OUT dari halaman harga resmi Google)";
  }
  const usd = ((usage.inputTokens / n) * 1000 * inRate) / 1e6 + ((usage.outputTokens / n) * 1000 * outRate) / 1e6;
  return `$${usd.toFixed(4)} per 1.000 komentar (tarif env: in $${inRate}/1jt, out $${outRate}/1jt)`;
}

if (provider === "gemini") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY belum diisi. Isi dulu, misal: GEMINI_API_KEY=... npm run bench -- research/dataset/blind4.jsonl --provider gemini");
    process.exit(1);
  }
  const gemini = new GeminiDecisionProvider({ apiKey, model: geminiModel, batchSize });
  const comments = texts.map((text, i) => ({ id: String(i), text }));
  const latenciesMs: number[] = [];
  let failures = 0;
  const startedAll = now();
  for (let i = 0; i < comments.length; i += batchSize) {
    const batch = comments.slice(i, i + batchSize);
    const t = now();
    try {
      await gemini.decide(batch, ctx);
      latenciesMs.push((now() - t) / batch.length);
    } catch (e) {
      failures += batch.length;
      console.log(`Batch ${i / batchSize + 1} gagal (${batch.length} komentar): ${e instanceof Error ? e.message : e}`);
    }
  }
  const endToEndS = (now() - startedAll) / 1000;
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const usage = gemini.totalUsage;
  const done = texts.length - failures;
  console.log(`\nGemini ${geminiModel} (batch ${batchSize}):`);
  console.log(`Median: ${percentile(sorted, 0.5).toFixed(0)} ms/komentar · p95: ${percentile(sorted, 0.95).toFixed(0)} ms/komentar`);
  console.log(`End-to-end ${texts.length} komentar: ${endToEndS.toFixed(1)} s · ${(texts.length / Math.max(1, endToEndS / 60)).toFixed(1)} komentar/menit`);
  console.log(`Token: ${usage.inputTokens} in + ${usage.outputTokens} out = ${usage.totalTokens} total (${done ? Math.round((usage.totalTokens / done) * 1000) : 0} token/1.000 komentar)`);
  console.log(`Biaya: ${costPer1000(usage, done)}`);
  console.log(`Tingkat kegagalan: ${failures}/${texts.length} komentar (${((failures / texts.length) * 100).toFixed(1)}%)`);
  process.exit(0);
}

let t = now();
const engine = new DecisionEngine();
const buildMs = now() - t;

/* Contoh pengguna sintetis untuk mengukur dampak 2000 contoh belajar (batas maksimal di ekstensi). */
const userExamples = Array.from({ length: 2000 }, (_, i) => ({ text: `${texts[i % texts.length]} ${i}`, label: i % 3 ? ("aman" as const) : ("judol" as const) }));
t = now();
const big = new DecisionEngine({ examples: userExamples });
const buildBigMs = now() - t;

function measure(e: DecisionEngine, rounds: number): number[] {
  for (const text of texts) e.decide({ id: "w", text }, { modes, custom }); // pemanasan
  const out: number[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const text of texts) {
      const s = now();
      e.decide({ id: "x", text }, { modes, custom });
      out.push((now() - s) * 1000);
    }
  }
  return out.sort((a, b) => a - b);
}

function row(name: string, us: number[]) {
  const avg = us.reduce((a, b) => a + b, 0) / us.length;
  return {
    mesin: name,
    median: `${us[Math.floor(us.length / 2)].toFixed(0)} µs`,
    p95: `${us[Math.floor(us.length * 0.95)].toFixed(0)} µs`,
    "rata-rata": `${avg.toFixed(0)} µs`,
    "komentar/detik": Math.round(1e6 / avg).toLocaleString("id-ID"),
  };
}

const rounds = Math.max(3, Math.ceil(3000 / texts.length));
console.log(`${texts.length} komentar × ${rounds} putaran, semua mode aktif (termasuk kustom)\n`);
console.log(`Bangun mesin (seed bawaan):        ${buildMs.toFixed(0)} ms`);
console.log(`Bangun mesin (+2000 contoh belajar): ${buildBigMs.toFixed(0)} ms\n`);
console.table([row("seed bawaan", measure(engine, rounds)), row("+2000 contoh belajar", measure(big, rounds))]);
const total = texts.length;
t = now();
for (const text of texts) engine.decide({ id: "x", text }, { modes, custom });
console.log(`\n${total} komentar sekali jalan: ${(now() - t).toFixed(1)} ms total`);
/* End-to-end 300 komentar (ukuran satu postingan yang ramai), sekali jalan tanpa pemanasan ulang. */
const first300 = texts.slice(0, 300);
t = now();
for (const text of first300) engine.decide({ id: "e", text }, { modes, custom });
console.log(`End-to-end ${first300.length} komentar: ${(now() - t).toFixed(1)} ms`);

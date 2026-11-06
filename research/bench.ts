/**
 * Benchmark kecepatan mesin keputusan lokal HideMent (tanpa API, tanpa internet).
 *
 *   npm run bench [-- path/dataset.jsonl ...]
 *
 * Diukur: waktu membangun mesin (melatih Naive Bayes dari seed + contoh), waktu menilai satu komentar
 * (median, p95, rata-rata setelah pemanasan), dan jumlah komentar per detik.
 */
import { readFile } from "node:fs/promises";
import { DecisionEngine } from "../src/core/engine";

const files = process.argv.slice(2);
if (!files.length) files.push("research/dataset/sample.jsonl", "research/dataset/holdout.jsonl", "research/dataset/blind.jsonl");

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
const now = () => performance.now();

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

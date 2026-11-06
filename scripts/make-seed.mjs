/**
 * Database contoh berlabel → contoh bawaan mesin lokal (src/core/engine/seed-data.ts).
 *
 * Sumber:
 *   data/seed/<label>.jsonl         database contoh yang ditulis tangan (satu file per kategori)
 *   research/dataset/sample.jsonl   dataset riset (baris "perlu_review" dilewati)
 *
 * Dijalankan otomatis oleh `npm run build`; jalankan manual dengan `npm run seed` setelah menambah contoh,
 * supaya `npm test`/`npm run eval` memakai data terbaru. Baris rusak, label tak dikenal, dan teks ganda ditolak
 * dengan pesan yang jelas.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const LABELS = new Set(["judol", "phishing", "scam", "spam", "hinaan", "perundungan", "ancaman", "sarkasme", "pelecehan", "penistaan", "sara", "kustom", "aman"]);
const SEED_DIR = "data/seed";
const SAMPLE = "research/dataset/sample.jsonl";
const OUT = "src/core/engine/seed-data.ts";

/** Kunci dedup sederhana: huruf & angka saja, huruf kecil. */
const key = (t) => t.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

async function readJsonl(file, { skipReview = false } = {}) {
  const rows = [];
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${i + 1} bukan JSON valid`);
    }
    if (skipReview && r.perlu_review === true) return;
    if (typeof r.text !== "string" || !r.text.trim()) throw new Error(`${file}:${i + 1} tidak punya "text"`);
    if (!LABELS.has(r.label)) throw new Error(`${file}:${i + 1} label "${r.label}" tidak dikenal`);
    rows.push([r.text.trim(), r.label, `${file}:${i + 1}`]);
  });
  return rows;
}

export async function makeSeed({ quiet = false } = {}) {
  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith(".jsonl")).sort();
  const base = [];
  for (const f of files) base.push(...(await readJsonl(`${SEED_DIR}/${f}`)));
  const sample = await readJsonl(SAMPLE, { skipReview: true });

  const seen = new Map();
  for (const [text, label, where] of [...base, ...sample]) {
    const k = key(text);
    const prev = seen.get(k);
    if (prev && prev.label !== label) throw new Error(`Label bertentangan untuk teks yang sama: ${prev.where} (${prev.label}) vs ${where} (${label})`);
    if (!prev) seen.set(k, { label, where });
  }
  const dedup = (rows) => {
    const keep = new Set();
    return rows.filter(([text]) => !keep.has(key(text)) && keep.add(key(text)));
  };
  const line = ([text, label]) => `  ${JSON.stringify([text, label])},`;
  const body = `/* Dibuat otomatis oleh scripts/make-seed.mjs dari ${SEED_DIR}/*.jsonl dan ${SAMPLE}. Jangan diedit manual: ubah datanya lalu jalankan \`npm run seed\`. */
import type { Category } from "../types";
import type { Labeled } from "./bayes";

const toRows = (rows: [string, Category][]): Labeled[] => rows.map(([text, label]) => ({ text, label }));

/** Database contoh tulisan tangan (${SEED_DIR}). */
export const SEED_BASE: Labeled[] = toRows([
${dedup(base).map(line).join("\n")}
]);

/** Dataset riset berlabel (${SAMPLE}). */
export const SEED_SAMPLE: Labeled[] = toRows([
${dedup(sample).map(line).join("\n")}
]);
`;
  const before = await readFile(OUT, "utf8").catch(() => "");
  if (before !== body) await writeFile(OUT, body);
  if (!quiet) {
    const counts = {};
    for (const [, label] of base) counts[label] = (counts[label] ?? 0) + 1;
    console.log(`✓ ${base.length} contoh database (${Object.entries(counts).map(([l, c]) => `${l} ${c}`).join(", ")}) + ${sample.length} dataset riset → ${OUT}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await makeSeed().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
}

/**
 * Auto-label komentar mentah dengan mesin lokal HideMent → dataset siap direview manusia. Tanpa API/internet.
 *
 *   npm run label -- research/raw/contoh-komentar.txt
 *
 * Input: .txt (satu komentar per baris) atau .jsonl (field "text", opsional "platform").
 * Output: research/dataset/auto-<nama>.jsonl dengan label, skor, alasan, keyakinan, dan "perlu_review".
 * SEMUA baris ditandai perlu_review: true karena label mesin hanyalah tebakan; `npm run eval` melewatinya
 * sampai manusia memeriksa dan menghapus tanda itu. Yang paling ragu (keyakinan 30–70%) diurutkan paling atas.
 */
import { basename, extname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { DecisionEngine } from "../src/core/engine";
import { DEFAULT_SETTINGS } from "../src/core/settings";

const input = process.argv[2];
if (!input) {
  console.error("Pakai: npm run label -- <file.txt|file.jsonl>");
  process.exit(1);
}

interface Raw {
  text: string;
  platform?: string;
}

const content = await readFile(input, "utf8");
const rows: Raw[] =
  extname(input) === ".jsonl"
    ? content.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : content.split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text }));

const engine = new DecisionEngine();
const modes = { ...DEFAULT_SETTINGS.modes, kebencian: true, pelecehan: true, agama: true, sara: true };

const out = rows.map((r) => {
  const { verdict: v, probs } = engine.decide({ id: "x", text: r.text }, { modes });
  const top = Math.max(0, ...Object.values(probs).map((p) => p ?? 0));
  /* Keyakinan: seberapa jauh dari "ragu" (50%). Hasil 30–70% paling perlu dicek. */
  const keyakinan = +Math.abs(top - 0.5).toFixed(2) * 2;
  return {
    text: r.text,
    label: v.category,
    ...(r.platform ? { platform: r.platform } : {}),
    skor: v.score,
    alasan: v.reason,
    keyakinan: +keyakinan.toFixed(2),
    sumber: `lokal:${v.source}`,
    perlu_review: true,
  };
});
out.sort((a, b) => a.keyakinan - b.keyakinan);

const target = `research/dataset/auto-${basename(input, extname(input))}.jsonl`;
await writeFile(target, out.map((o) => JSON.stringify(o)).join("\n") + "\n");

const counts = Object.entries(out.reduce<Record<string, number>>((a, o) => ((a[o.label] = (a[o.label] ?? 0) + 1), a), {}))
  .map(([n, c]) => `${n}: ${c}`)
  .join(", ");
console.log(`Label → ${counts}`);
console.log(`Ragu (keyakinan < 0,4): ${out.filter((o) => o.keyakinan < 0.4).length}/${out.length}`);
console.log(`✓ Disimpan ke ${target}. Periksa labelnya, lalu hapus "perlu_review": true pada baris yang sudah benar sebelum dipakai untuk evaluasi.`);

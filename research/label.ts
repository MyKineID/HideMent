/**
 * Auto-label komentar mentah pakai AI 9router → dataset siap direview.
 *
 *   NINE_ROUTER_BASE_URL=... NINE_ROUTER_API_KEY=... NINE_ROUTER_MODEL=... npm run label -- research/raw/contoh-komentar.txt
 *
 * Input: .txt (satu komentar per baris) atau .jsonl (field "text", opsional "platform").
 * Output: research/dataset/auto-<nama>.jsonl, tiap baris berisi label, sentimen, skor, alasan, keyakinan,
 * dan "perlu_review": true kalau AI ragu atau bertentangan dengan aturan lokal.
 */
import { basename, extname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { chat } from "../src/background/api";
import { analyzeRules } from "../src/core/judol-rules";
import { extractJson } from "../src/core/prompt";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { MODE_CATEGORIES, MODES } from "../src/core/types";

const input = process.argv[2];
if (!input) {
  console.error("Pakai: npm run label -- <file.txt|file.jsonl>");
  process.exit(1);
}
const api = {
  ...DEFAULT_SETTINGS.api,
  baseUrl: process.env.NINE_ROUTER_BASE_URL ?? "",
  apiKey: process.env.NINE_ROUTER_API_KEY ?? "",
  model: process.env.NINE_ROUTER_MODEL ?? "",
  timeoutMs: 120000,
};
if (!api.baseUrl || !api.model) {
  console.error("Isi dulu NINE_ROUTER_BASE_URL, NINE_ROUTER_API_KEY, dan NINE_ROUTER_MODEL.");
  process.exit(1);
}

const LABELS = [...MODES.flatMap((m) => MODE_CATEGORIES[m]), "aman"];
const SENTIMEN = ["positif", "netral", "negatif"];
const BATCH = 15;

const SYSTEM = `Kamu anotator dataset riset moderasi komentar media sosial berbahasa Indonesia.
Untuk setiap komentar tentukan:
- "label": salah satu dari ${LABELS.join(", ")}. "aman" termasuk kritik wajar terhadap konten, keluhan, beda pendapat, dan kata kasar sebagai ekspresi.
- "sentimen": arah nada komentar, yaitu "positif", "netral", atau "negatif". Sentimen TERPISAH dari bahaya: promosi judol sering bernada positif, kritik wajar bernada negatif tapi aman.
- "skor": tingkat bahaya 0-100 (aman = di bawah 30).
- "alasan": maksimal 12 kata.
- "keyakinan": 0.0-1.0, seberapa yakin kamu dengan label ini.
Balas HANYA JSON: {"r":[{"i":"<id>","label":"...","sentimen":"...","skor":0,"alasan":"...","keyakinan":0.0}]}`;

interface Raw {
  text: string;
  platform?: string;
}

const content = await readFile(input, "utf8");
const rows: Raw[] =
  extname(input) === ".jsonl"
    ? content.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : content.split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text }));

const out: Record<string, unknown>[] = [];
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const payload = chunk.map((r, j) => ({ i: String(j + 1), t: r.text.slice(0, 600) }));
  const res = await chat(api, SYSTEM, `Labeli komentar berikut:\n${JSON.stringify(payload)}`);
  const data = extractJson(res.content) as { r?: Record<string, unknown>[] } | Record<string, unknown>[];
  const results = new Map((Array.isArray(data) ? data : (data.r ?? [])).map((x) => [String(x.i ?? x.id), x]));

  chunk.forEach((r, j) => {
    const ai = results.get(String(j + 1)) ?? {};
    const label = LABELS.includes(String(ai.label)) ? String(ai.label) : "aman";
    const sentimen = SENTIMEN.includes(String(ai.sentimen)) ? String(ai.sentimen) : "netral";
    const keyakinan = Math.max(0, Math.min(1, Number(ai.keyakinan ?? 0)));
    const rule = analyzeRules(r.text);
    const konflik = (rule.judolScore >= 70) !== (MODE_CATEGORIES.judol as string[]).includes(label);
    out.push({
      text: r.text,
      label,
      sentimen,
      ...(r.platform ? { platform: r.platform } : {}),
      skor: Math.max(0, Math.min(100, Math.round(Number(ai.skor ?? 0)))),
      alasan: String(ai.alasan ?? "").slice(0, 160),
      keyakinan,
      sumber: `ai:${api.model}`,
      perlu_review: !results.has(String(j + 1)) || keyakinan < 0.7 || konflik,
    });
  });
  process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length} komentar dilabeli`);
}
process.stdout.write("\n");

const target = `research/dataset/auto-${basename(input, extname(input))}.jsonl`;
await writeFile(target, out.map((o) => JSON.stringify(o)).join("\n") + "\n");

const count = (k: string) =>
  Object.entries(out.reduce<Record<string, number>>((a, o) => ((a[String(o[k])] = (a[String(o[k])] ?? 0) + 1), a), {}))
    .map(([n, c]) => `${n}: ${c}`)
    .join(", ");
console.log(`\nLabel    → ${count("label")}`);
console.log(`Sentimen → ${count("sentimen")}`);
console.log(`Perlu review manusia: ${out.filter((o) => o.perlu_review).length}/${out.length}`);
console.log(`✓ Disimpan ke ${target}. Cek baris "perlu_review": true sebelum dipakai untuk evaluasi.`);

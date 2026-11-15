/**
 * Varian kamuflase untuk benchmark ketahanan model (benchmark 6).
 *
 *   npm run camouflage -- research/dataset/blind4.jsonl research/dataset/blind4-camouflage.jsonl
 *
 * Empat penyamaran yang dipakai promosi judol dan ujaran kebencian di lapangan,
 * masing-masing dipakai bergiliran supaya tiap varian dapat jatah yang sama:
 *   0. leetspeak (a→4, e→3, i→1, o→0, s→5)
 *   1. huruf hias (mathematical bold, dilipat normalisasi)
 *   2. huruf dipisah spasi (s p a s i)
 *   3. salah ketik (dua huruf di tengah kata ditukar)
 * Label tetap sama: teksnya yang berubah, maknanya tidak.
 */
import { readFile, writeFile } from "node:fs/promises";

export function leet(text: string): string {
  return text.replace(/[aeios]/g, (c) => ({ a: "4", e: "3", i: "1", o: "0", s: "5" })[c]!);
}

export function fancy(text: string): string {
  return [...text]
    .map((c) => {
      if (c >= "a" && c <= "z") return String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97);
      if (c >= "A" && c <= "Z") return String.fromCodePoint(0x1d400 + c.charCodeAt(0) - 65);
      if (c >= "0" && c <= "9") return String.fromCodePoint(0x1d7ce + c.charCodeAt(0) - 48);
      return c;
    })
    .join("");
}

export function spaced(text: string): string {
  return text
    .split(" ")
    .map((w) => (w.length >= 4 ? [...w].join(" ") : w))
    .join(" ");
}

export function typo(text: string): string {
  return text
    .split(" ")
    .map((w) => {
      if (w.length < 5) return w;
      const chars = [...w];
      [chars[1], chars[2]] = [chars[2], chars[1]];
      return chars.join("");
    })
    .join(" ");
}

export const CAMOUFLAGE_KINDS = ["leetspeak", "huruf hias", "spasi", "salah ketik"] as const;
export type CamouflageKind = (typeof CAMOUFLAGE_KINDS)[number];

export function camouflage(text: string, kind: CamouflageKind): string {
  switch (kind) {
    case "leetspeak":
      return leet(text);
    case "huruf hias":
      return fancy(text);
    case "spasi":
      return spaced(text);
    case "salah ketik":
      return typo(text);
  }
}

const [input, output] = process.argv.slice(2);
if (input && output) {
  const lines = (await readFile(input, "utf8")).split("\n").filter((l) => l.trim());
  const out = lines.map((l, i) => {
    const row = JSON.parse(l) as { text: string };
    const kind = CAMOUFLAGE_KINDS[i % CAMOUFLAGE_KINDS.length];
    return JSON.stringify({ ...row, text: camouflage(row.text, kind), kamuflase: kind });
  });
  await writeFile(output, out.join("\n") + "\n");
  console.log(`${lines.length} baris → ${output} (4 varian kamuflase bergiliran)`);
}

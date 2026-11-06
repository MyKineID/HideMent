import { exampleKey, type Example } from "./examples";
import { priorityOf, type Settings } from "./settings";
import type { Category, QueueItem, Verdict } from "./types";

/*
 * Dari hasil analisis ke contoh belajar mesin lokal, lewat dua jalur:
 * - Cek pengguna di Antrian: "Benar" = label hasil analisis dipakai, "Salah" = komentar itu sebenarnya aman.
 *   Label ini selalu menang.
 * - "Analyze dari link" dengan "Pelajari komentarnya": hanya hasil yang yakin (learnFromComments),
 *   bersumber "link" supaya bisa dibedakan, dihapus massal, dan tidak pernah menimpa label manusia.
 * Mesin lokal lalu mempelajari contoh ini (Naive Bayes + pencocokan komentar yang mirip).
 */

/** Label hasil cek pengguna per teks komentar (kunci = exampleKey). */
export type ReviewMap = Map<string, Category>;

export function reviewMap(examples: Example[]): ReviewMap {
  return new Map(examples.filter((e) => e.source === "review").map((e) => [exampleKey(e.text), e.label]));
}

export function reviewedLabel(reviews: ReviewMap, item: Pick<QueueItem, "text">): Category | undefined {
  return reviews.get(exampleKey(item.text));
}

export function reviewExample(item: QueueItem, correct: boolean, now = Date.now()): Example {
  return { text: item.text.slice(0, 600), label: correct ? item.verdict.category : "aman", at: now, source: "review" };
}

/**
 * Komentar yang boleh dilapor otomatis: prioritas tinggi, belum dilapor/dilewati/gagal,
 * dan TIDAK pernah ditandai "Salah" (aman) oleh pengguna. Urut dari risiko tertinggi.
 */
export function autoReportCandidates(queue: QueueItem[], reviews: ReviewMap): QueueItem[] {
  return queue
    .filter((q) => q.priority === "tinggi" && (!q.report || q.report === "pending") && reviewedLabel(reviews, q) !== "aman")
    .sort((a, b) => b.verdict.score - a.verdict.score || b.at - a.at);
}

export interface DatasetRow {
  text: string;
  /** Label akhir: hasil cek pengguna kalau ada, kalau belum = tebakan mesin/aturan. */
  label: Category;
  predicted: Category;
  score: number;
  source: string;
  reason: string;
  platform: string;
  url: string;
  reviewed: boolean;
  /** Sama dengan format research/label.ts: baris yang belum dicek manusia perlu direview sebelum dipakai evaluasi. */
  perlu_review: boolean;
  report: string;
}

export function toDatasetRow(item: QueueItem, reviews: ReviewMap): DatasetRow {
  const human = reviewedLabel(reviews, item);
  return {
    text: item.text,
    label: human ?? item.verdict.category,
    predicted: item.verdict.category,
    score: item.verdict.score,
    source: item.verdict.source,
    reason: item.verdict.reason,
    platform: item.platform,
    url: item.url,
    reviewed: human !== undefined,
    perlu_review: human === undefined,
    report: item.report ?? "",
  };
}

export function toJsonl(rows: object[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
}

export interface LearnInput {
  text: string;
  verdict?: Verdict;
}

/**
 * Komentar postingan yang dianalisis lewat "Analyze dari link" → contoh belajar mesin lokal.
 * Hanya hasil yang yakin yang diambil: prioritas tinggi (label kategorinya) dan "aman" yang dinilai mesin.
 * Yang sedang/ragu dan "aman" karena terlalu pendek/whitelist (sumber aturan) dilewati, lalu "aman" dibatasi supaya contoh tidak
 * dibanjiri komentar biasa. Label buatan manusia tetap menang (lihat mergeExamples).
 */
export function learnFromComments(comments: LearnInput[], thresholds: Settings["thresholds"], now = Date.now(), maxSafe = 40): Example[] {
  const harmful: Example[] = [];
  const safe: Example[] = [];
  for (const { text, verdict: v } of comments) {
    const t = text.trim();
    if (!v || t.length < 4) continue;
    const priority = priorityOf(v.score, thresholds);
    if (v.category !== "aman" && priority === "tinggi") harmful.push({ text: t.slice(0, 600), label: v.category, at: now, source: "link" });
    else if ((v.category === "aman" || priority === "rendah") && v.source !== "rule" && safe.length < maxSafe) {
      safe.push({ text: t.slice(0, 600), label: "aman", at: now, source: "link" });
    }
  }
  return [...harmful, ...safe];
}

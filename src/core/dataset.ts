import { exampleKey, type Example } from "./examples";
import type { Category, QueueItem } from "./types";

/*
 * Dari hasil analisis ke data belajar AI. Hasil AI tidak pernah langsung dijadikan contoh (itu membuat AI
 * belajar dari tebakannya sendiri). Yang masuk hanya komentar yang sudah dicek pengguna:
 * "Benar" = label AI dipakai, "Salah" = komentar itu sebenarnya aman. Contoh ini lalu ikut dikirim
 * ke AI sebagai acuan untuk komentar yang mirip, jadi kesalahan yang sama tidak terulang.
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
  /** Label akhir: hasil cek pengguna kalau ada, kalau belum = tebakan AI/aturan. */
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

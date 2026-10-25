import type { CommentInput, Platform, QueueItem, ReportStatus, Verdict } from "../core/types";

export type Msg =
  | { type: "analyze"; platform: Platform; url: string; comments: CommentInput[] }
  | { type: "listModels"; baseUrl: string; apiKey: string }
  | { type: "testConnection" }
  | { type: "getQueue" }
  | { type: "clearQueue" }
  | { type: "clearCache" }
  | { type: "getStatus"; tabId?: number }
  | { type: "focusComment"; tabId: number; commentId: string }
  | { type: "removeQueueItem"; key: string }
  | { type: "startReport"; key: string }
  | { type: "setReportStatus"; key: string; status: ReportStatus }
  | ScanProgress;

export type TabMsg =
  | { type: "verdicts"; verdicts: Verdict[] }
  | { type: "focusComment"; commentId: string }
  | { type: "reportComment"; commentId: string; verdict: Verdict }
  | { type: "fastScan" }
  | { type: "stopScan" }
  | { type: "rescan" };

export type BroadcastMsg = { type: "queueUpdated"; queue: QueueItem[] };

export interface ScanProgress {
  type: "scanProgress";
  state: "running" | "done" | "stopped" | "error";
  loaded: number;
  max: number;
  note?: string;
}

/** Sampai tahap mana alur lapor otomatis berjalan sebelum diserahkan ke pengguna. */
export type ReportStage = "reason" | "dialog" | "menu" | "none";

export interface ReportResult {
  stage: ReportStage;
  reason: string;
  note: string;
}

export interface StatusInfo {
  configured: boolean;
  model: string;
  tabCounts: { scanned: number; high: number; medium: number };
  requests: number;
  failures: number;
  lastLatencyMs: number;
  lastTtftMs: number;
  lastError: string;
}

export async function send<T = unknown>(msg: Msg): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; data?: T; error?: string } | undefined;
  if (!res) throw new Error("Service worker tidak merespons");
  if (!res.ok) throw new Error(res.error ?? "Terjadi kesalahan");
  return res.data as T;
}

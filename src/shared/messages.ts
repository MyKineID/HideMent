import type { CommentInput, Platform, QueueItem, ReportStatus, Verdict } from "../core/types";

export type Msg =
  | { type: "analyze"; platform: Platform; url: string; comments: CommentInput[] }
  /** Nilai satu kalimat dengan mesin lokal (fitur "Coba mesin" di Pengaturan). Balasan: Decision. */
  | { type: "tryEngine"; text: string }
  | { type: "getQueue" }
  | { type: "clearQueue" }
  | { type: "getStatus"; tabId?: number }
  | { type: "focusComment"; tabId: number; commentId: string; text: string }
  | { type: "removeQueueItem"; key: string }
  | { type: "startReport"; key: string; auto?: boolean }
  | { type: "setReportStatus"; key: string; status: ReportStatus }
  | ScanProgress
  | { type: "reportSubmitted"; commentId: string }
  | { type: "ensureContent"; tabId: number };

export type TabMsg =
  | { type: "verdicts"; verdicts: Verdict[] }
  | { type: "focusComment"; commentId: string; text: string }
  | {
      type: "reportComment";
      commentId: string;
      text: string;
      verdict: Verdict;
      auto?: boolean;
      /** "dom" = hanya cari di halaman yang sedang tampil (tanpa scroll); "scroll" = boleh menggulir wadah komentar. */
      find?: "dom" | "scroll";
    }
  /**
   * Analyze komentar postingan ini. Bawaan: instan, semua komentar yang sudah dimuat langsung dinilai dan komentar
   * yang muncul saat pengguna scroll ikut dinilai, tanpa menggulir halaman. `load` = gulir otomatis untuk memuat komentar
   * lain (dipakai "Analyze dari link" di tab latar, atau kalau pengguna menyalakan "Muat semua komentar otomatis").
   */
  | { type: "fastScan"; load?: boolean }
  | { type: "ping" }
  | { type: "stopScan" }
  | { type: "rescan" }
  | { type: "postInfo" }
  | { type: "collect" };

/** Ringkasan postingan yang sedang dibuka (dibaca popup & side panel). */
export interface PostInfo {
  isPost: boolean;
  /** Jumlah komentar menurut platform (angka di bawah postingan). */
  total: number | null;
  /** Komentar unik yang sudah dimuat/terlihat di halaman. */
  seen: number;
  /** Analyze sudah dijalankan di postingan ini (atau mode deteksinya otomatis). */
  analyzed: boolean;
  aman: number;
  sedang: number;
  tinggi: number;
}

export interface CollectedComment {
  text: string;
  author: string;
  verdict?: Verdict;
}

export type BroadcastMsg = { type: "queueUpdated"; queue: QueueItem[] };

export interface FastScanReply {
  ok: boolean;
  note?: string;
  total?: number | null;
  /** Mode instan: berapa komentar yang langsung dinilai. */
  analyzed?: number;
  /** true = dinilai instan tanpa scroll; false/undefined = sedang memuat dengan scroll otomatis. */
  instant?: boolean;
}

export interface ScanProgress {
  type: "scanProgress";
  state: "running" | "done" | "stopped" | "error";
  loaded: number;
  max: number;
  /** Jumlah komentar yang ditampilkan platform untuk postingan ini (null kalau tidak terbaca). */
  total?: number | null;
  note?: string;
  /** Alasan berhenti: "limit" = kuota komentar per postingan tercapai; "end" = komentarnya habis; sisanya sama dengan state. */
  reason?: "limit" | "end" | "stopped" | "error";
  /** Batas komentar per postingan yang berlaku saat ini (untuk "· batas 300" di popup dan tombol Baca N lagi). */
  limit?: number;
}

/**
 * Sampai tahap mana alur lapor berjalan. "sent" = laporan sudah terkirim otomatis dan platform
 * menampilkan konfirmasi; tahap lain = diserahkan ke pengguna (atau gagal pada mode otomatis).
 */
export type ReportStage = "sent" | "submit" | "reason" | "dialog" | "menu" | "none";

export interface ReportResult {
  stage: ReportStage;
  reason: string;
  note: string;
  /** Komentar tidak ada di halaman yang sedang tampil (mode find "dom"); service worker lalu membuka link komentarnya. */
  missing?: boolean;
}

export interface StatusInfo {
  tabCounts: { scanned: number; high: number; medium: number };
  /** Mesin keputusan lokal: jumlah contoh yang dipelajari dan kecepatan rata-rata. */
  engine: { examples: number; seed: number; analyzed: number; avgUs: number };
}

export async function send<T = unknown>(msg: Msg): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; data?: T; error?: string } | undefined;
  if (!res) throw new Error("Service worker tidak merespons");
  if (!res.ok) throw new Error(res.error ?? "Terjadi kesalahan");
  return res.data as T;
}

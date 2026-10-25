export type Mode = "judol" | "toxic";

export type Platform = "youtube" | "instagram" | "tiktok" | "x";

export type JudolCategory = "judol" | "phishing" | "scam" | "spam";
export type ToxicCategory =
  | "hinaan"
  | "perundungan"
  | "sara"
  | "ancaman"
  | "pelecehan"
  | "sarkasme";
export type Category = JudolCategory | ToxicCategory | "aman";

export type Priority = "tinggi" | "sedang" | "rendah";

export type VerdictSource = "rule" | "ai" | "cache";

export interface CommentInput {
  id: string;
  text: string;
  author?: string;
}

export interface Verdict {
  id: string;
  mode: Mode;
  category: Category;
  score: number;
  reason: string;
  source: VerdictSource;
}

export type ReportStatus = "pending" | "done" | "skipped";

export interface QueueItem {
  key: string;
  tabId: number;
  platform: Platform;
  url: string;
  commentId: string;
  author: string;
  text: string;
  verdict: Verdict;
  priority: Priority;
  at: number;
  report?: ReportStatus;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  judol: "Judi Online",
  phishing: "Link Phising",
  scam: "Penipuan",
  spam: "Spam",
  hinaan: "Hinaan",
  perundungan: "Perundungan",
  sara: "Ujaran SARA",
  ancaman: "Ancaman",
  pelecehan: "Pelecehan",
  sarkasme: "Sarkasme Merendahkan",
  aman: "Aman",
};

export const MODE_CATEGORIES: Record<Mode, Category[]> = {
  judol: ["judol", "phishing", "scam", "spam"],
  toxic: ["hinaan", "perundungan", "sara", "ancaman", "pelecehan", "sarkasme"],
};

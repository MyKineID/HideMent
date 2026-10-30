export type Mode = "judol" | "kebencian" | "pelecehan" | "agama" | "sara" | "kustom";

export type Platform = "youtube" | "instagram" | "tiktok" | "x";

export type JudolCategory = "judol" | "phishing" | "scam" | "spam";
export type KebencianCategory = "hinaan" | "perundungan" | "ancaman" | "sarkasme";
export type Category = JudolCategory | KebencianCategory | "pelecehan" | "penistaan" | "sara" | "kustom" | "aman";

export type Priority = "tinggi" | "sedang" | "rendah";

export type VerdictSource = "rule" | "ai" | "cache";

export interface CommentInput {
  id: string;
  text: string;
  author?: string;
  /** Link langsung ke komentar ini (permalink), kalau platform menyediakannya. */
  url?: string;
}

export interface Verdict {
  id: string;
  mode: Mode;
  category: Category;
  score: number;
  reason: string;
  source: VerdictSource;
  /** Nama tampilan untuk kategori "kustom" (nama mode buatan pengguna). */
  label?: string;
}

export type ReportStatus = "pending" | "done" | "skipped";

export interface QueueItem {
  key: string;
  tabId: number;
  platform: Platform;
  /** Permalink komentar; sama dengan pageUrl kalau platform tidak punya permalink per komentar. */
  url: string;
  /** Halaman tempat komentar ditemukan. */
  pageUrl?: string;
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
  ancaman: "Ancaman",
  sarkasme: "Sarkasme Merendahkan",
  pelecehan: "Pelecehan Seksual",
  penistaan: "Penistaan Agama",
  sara: "SARA",
  kustom: "Kustom",
  aman: "Aman",
};

export const MODE_CATEGORIES: Record<Mode, Category[]> = {
  judol: ["judol", "phishing", "scam", "spam"],
  kebencian: ["hinaan", "perundungan", "ancaman", "sarkasme"],
  pelecehan: ["pelecehan"],
  agama: ["penistaan"],
  sara: ["sara"],
  kustom: ["kustom"],
};

export const MODES = Object.keys(MODE_CATEGORIES) as Mode[];

export const MODE_LABEL: Record<Mode, string> = {
  judol: "Judol",
  kebencian: "Ujaran Kebencian",
  pelecehan: "Pelecehan Seksual",
  agama: "Penistaan Agama",
  sara: "SARA",
  kustom: "Kustom",
};

export function verdictLabel(v: Pick<Verdict, "category" | "label">): string {
  return v.label || CATEGORY_LABEL[v.category];
}

/** Mode yang memuat kategori ini; "aman" tidak punya mode sendiri. */
export function modeOf(category: Category): Mode | null {
  return MODES.find((m) => MODE_CATEGORIES[m].includes(category)) ?? null;
}

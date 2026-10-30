import type { Category, Mode, Platform, Priority } from "./types";

export type ActionKind = "highlight" | "blur" | "hide";

export interface Settings {
  enabled: boolean;
  api: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    batchSize: number;
    concurrency: number;
  };
  modes: Record<Mode, boolean>;
  /** Mode buatan pengguna: nama tampilan + definisi yang dikirim ke AI. */
  custom: { name: string; definition: string };
  /** Contoh komentar berlabel yang dipakai AI sebagai acuan. */
  learn: { enabled: boolean; includeFeedback: boolean };
  platforms: Record<Platform, boolean>;
  display: {
    showBadge: boolean;
    highlight: boolean;
    blur: boolean;
    hide: boolean;
    clickToReveal: boolean;
    showSafeBadge: boolean;
  };
  categoryAction: Partial<Record<Category, ActionKind>>;
  scan: {
    /** "scroll" = analisis komentar yang terlihat saat di-scroll; "fast" = otomatis memuat & menganalisis semua komentar postingan. */
    method: "scroll" | "fast";
    /** Batas jumlah komentar yang dimuat Pindai Cepat. */
    max: number;
    /** Ikut buka balasan ("Tampilkan balasan"). */
    replies: boolean;
  };
  report: {
    /** Tombol "Bantu laporkan" di popover komentar. */
    assist: boolean;
    /** Komentar prioritas tinggi otomatis masuk antrian lapor di Dashboard. */
    autoQueue: boolean;
  };
  thresholds: { high: number; medium: number };
  whitelist: string[];
  customKeywords: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  api: {
    baseUrl: "",
    apiKey: "",
    model: "",
    timeoutMs: 30000,
    batchSize: 8,
    concurrency: 4,
  },
  modes: { judol: true, kebencian: false, pelecehan: false, agama: false, sara: false, kustom: false },
  custom: { name: "", definition: "" },
  learn: { enabled: true, includeFeedback: true },
  platforms: { youtube: true, instagram: true, tiktok: true, x: true },
  display: {
    showBadge: true,
    highlight: true,
    blur: true,
    hide: false,
    clickToReveal: true,
    showSafeBadge: false,
  },
  categoryAction: { spam: "highlight" },
  scan: { method: "scroll", max: 300, replies: true },
  report: { assist: true, autoQueue: false },
  thresholds: { high: 80, medium: 50 },
  whitelist: [],
  customKeywords: [],
};

const KEY = "settings";
const SCHEMA = 4;

function merge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return (patch ?? base) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] =
      b && typeof b === "object" && !Array.isArray(b) && v && typeof v === "object" && !Array.isArray(v)
        ? merge(b, v)
        : v;
  }
  return out as T;
}

/** Batas nilai numerik; sama dengan batas input di halaman Pengaturan. */
export const LIMITS = {
  timeoutMs: [5000, 180000],
  batchSize: [1, 50],
  concurrency: [1, 8],
  scanMax: [50, 2000],
  customName: 40,
  customDefinition: 400,
  threshold: [10, 100],
} as const;

const ACTIONS: readonly ActionKind[] = ["highlight", "blur", "hide"];

function clampInt(v: unknown, [min, max]: readonly [number, number], fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function stringList(v: unknown, max = 2000): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, max);
}

function boolRecord<K extends string>(v: unknown, base: Record<K, boolean>): Record<K, boolean> {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const k of Object.keys(base) as K[]) out[k] = bool(src[k], base[k]);
  return out;
}

/**
 * Pastikan setiap field punya tipe & rentang yang benar. Storage bisa berisi data lama,
 * hasil edit manual, atau nilai yang rusak; tanpa ini batcher bisa macet (mis. concurrency 0).
 */
export function sanitizeSettings(s: Settings): Settings {
  const d = DEFAULT_SETTINGS;
  const high = clampInt(s.thresholds?.high, LIMITS.threshold, d.thresholds.high);
  const medium = Math.min(clampInt(s.thresholds?.medium, LIMITS.threshold, d.thresholds.medium), Math.max(LIMITS.threshold[0], high - 5));
  const categoryAction: Settings["categoryAction"] = {};
  for (const [cat, action] of Object.entries(s.categoryAction ?? {})) {
    if (ACTIONS.includes(action as ActionKind)) categoryAction[cat as Category] = action as ActionKind;
  }
  return {
    enabled: bool(s.enabled, d.enabled),
    api: {
      baseUrl: str(s.api?.baseUrl, d.api.baseUrl),
      apiKey: str(s.api?.apiKey, d.api.apiKey),
      model: str(s.api?.model, d.api.model),
      timeoutMs: clampInt(s.api?.timeoutMs, LIMITS.timeoutMs, d.api.timeoutMs),
      batchSize: clampInt(s.api?.batchSize, LIMITS.batchSize, d.api.batchSize),
      concurrency: clampInt(s.api?.concurrency, LIMITS.concurrency, d.api.concurrency),
    },
    modes: boolRecord(s.modes, d.modes),
    custom: {
      name: str(s.custom?.name, "").slice(0, LIMITS.customName),
      definition: str(s.custom?.definition, "").slice(0, LIMITS.customDefinition),
    },
    learn: boolRecord(s.learn, d.learn),
    platforms: boolRecord(s.platforms, d.platforms),
    display: boolRecord(s.display, d.display),
    categoryAction,
    scan: {
      method: s.scan?.method === "fast" ? "fast" : "scroll",
      max: clampInt(s.scan?.max, LIMITS.scanMax, d.scan.max),
      replies: bool(s.scan?.replies, d.scan.replies),
    },
    report: boolRecord(s.report, d.report),
    thresholds: { high, medium },
    whitelist: stringList(s.whitelist),
    customKeywords: stringList(s.customKeywords, 500),
  };
}

/** Schema < 4 punya satu saklar "toxic"; padanan terdekatnya mode Ujaran Kebencian. Mode baru lain mulai mati. */
export function migrateModes(modes: object): Settings["modes"] {
  const { toxic, ...rest } = modes as Partial<Settings["modes"]> & { toxic?: unknown };
  if (typeof toxic !== "boolean") return rest as Settings["modes"];
  return { kebencian: toxic, ...rest } as Settings["modes"];
}

/** Mode yang benar-benar dipakai: mode kustom hanya aktif kalau definisinya sudah diisi. */
export function activeModes(s: Settings): Record<Mode, boolean> {
  return { ...s.modes, kustom: s.modes.kustom && Boolean(s.custom.definition) };
}

export function resolveSettings(stored: unknown): Settings {
  return sanitizeSettings(merge(DEFAULT_SETTINGS, stored ?? {}));
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get([KEY, "schema"]);
  const stored = (raw[KEY] ?? {}) as Partial<Settings>;
  if (raw[KEY] && raw.schema !== SCHEMA) {
    if (!raw.schema || Number(raw.schema) < 2) stored.categoryAction = { ...DEFAULT_SETTINGS.categoryAction };
    if (stored.api && stored.api.batchSize === 20 && stored.api.concurrency === 2) {
      stored.api = { ...stored.api, batchSize: DEFAULT_SETTINGS.api.batchSize, concurrency: DEFAULT_SETTINGS.api.concurrency };
    }
    if (stored.modes) stored.modes = migrateModes(stored.modes);
    await chrome.storage.local.set({ [KEY]: stored, schema: SCHEMA });
  }
  return resolveSettings(stored);
}

export async function saveSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const next = sanitizeSettings(merge(await loadSettings(), patch));
  await chrome.storage.local.set({ [KEY]: next, schema: SCHEMA });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) cb(resolveSettings(changes[KEY].newValue));
  });
}

export function priorityOf(score: number, t: Settings["thresholds"]): Priority {
  if (score >= t.high) return "tinggi";
  if (score >= t.medium) return "sedang";
  return "rendah";
}

export function isApiConfigured(s: Settings): boolean {
  return Boolean(s.api.baseUrl && s.api.model);
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

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
  modes: { judol: true, toxic: true },
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
const SCHEMA = 3;

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

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get([KEY, "schema"]);
  const stored = (raw[KEY] ?? {}) as Partial<Settings>;
  if (raw[KEY] && raw.schema !== SCHEMA) {
    if (!raw.schema || Number(raw.schema) < 2) stored.categoryAction = { ...DEFAULT_SETTINGS.categoryAction };
    if (stored.api && stored.api.batchSize === 20 && stored.api.concurrency === 2) {
      stored.api = { ...stored.api, batchSize: DEFAULT_SETTINGS.api.batchSize, concurrency: DEFAULT_SETTINGS.api.concurrency };
    }
    await chrome.storage.local.set({ [KEY]: stored, schema: SCHEMA });
  }
  return merge(DEFAULT_SETTINGS, stored);
}

export async function saveSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const next = merge(await loadSettings(), patch);
  await chrome.storage.local.set({ [KEY]: next, schema: SCHEMA });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) cb(merge(DEFAULT_SETTINGS, changes[KEY].newValue ?? {}));
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

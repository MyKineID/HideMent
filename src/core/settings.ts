import type { Category, Mode, Platform, Priority } from "./types";

export type ActionKind = "highlight" | "blur" | "hide";

export interface Settings {
  enabled: boolean;
  modes: Record<Mode, boolean>;
  /** Mode buatan pengguna: nama tampilan + kata kunci/frasa (dipisah koma) yang dinilai mesin lokal. */
  custom: { name: string; definition: string };
  /** Contoh komentar berlabel yang dipelajari mesin lokal. */
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
    /**
     * "manual" = tidak ada yang dianalisis sampai tombol "Analyze komentar postingan ini" ditekan di postingan itu;
     * "scroll" = analisis komentar yang terlihat saat di-scroll; "fast" = otomatis memuat & menganalisis semua komentar postingan.
     */
    method: "manual" | "scroll" | "fast";
    /** Batas komentar per postingan, berlaku di semua cara pindai. */
    limit: {
      /** Batas komentar yang dianalisis per postingan (semua cara pindai). */
      perPost: number;
      /** Batas total komentar untuk satu putaran Analyze dari link (banyak link sekaligus). */
      perRun: number;
      /** Override batas per platform; kosong berarti memakai perPost. */
      perPlatform: Partial<Record<Platform, number>>;
    };
    /** Ikut buka balasan ("Tampilkan balasan"). */
    replies: boolean;
    /**
     * Gulir otomatis untuk memuat komentar lain saat Analyze. Bawaan mati: Analyze langsung menilai komentar yang
     * sudah dimuat, dan komentar baru dinilai seketika saat pengguna scroll sendiri.
     */
    autoLoad: boolean;
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
  modes: { judol: true, kebencian: false, pelecehan: false, agama: false, sara: false, kustom: false },
  custom: { name: "", definition: "" },
  learn: { enabled: true, includeFeedback: true },
  platforms: { youtube: true, instagram: true, tiktok: true, x: true, reddit: true },
  display: {
    showBadge: true,
    highlight: true,
    blur: true,
    hide: false,
    clickToReveal: true,
    showSafeBadge: true,
  },
  categoryAction: { spam: "highlight" },
  scan: {
    method: "manual",
    limit: { perPost: 300, perRun: 3000, perPlatform: {} },
    replies: true,
    autoLoad: false,
  },
  report: { assist: true, autoQueue: false },
  thresholds: { high: 80, medium: 50 },
  whitelist: [],
  customKeywords: [],
};

const KEY = "settings";
const SCHEMA = 8;

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
  /** Batas komentar yang dianalisis per postingan. */
  limitPerPost: [50, 5000],
  /** Batas total komentar satu putaran Analyze dari link. */
  limitPerRun: [100, 20000],
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

/** Pastikan batas komentar punya tipe & rentang yang benar; override platform yang tidak dikenal dibuang. */
function sanitizeScan(v: Settings["scan"] | undefined): Settings["scan"] {
  const d = DEFAULT_SETTINGS.scan;
  const perPlatform: Settings["scan"]["limit"]["perPlatform"] = {};
  const overrides = (v?.limit?.perPlatform ?? {}) as Record<string, unknown>;
  for (const platform of ["youtube", "instagram", "tiktok", "x", "reddit"] as const) {
    const n = Number(overrides[platform]);
    if (!Number.isFinite(n)) continue;
    perPlatform[platform] = clampInt(n, LIMITS.limitPerPost, d.limit.perPost);
  }
  return {
    method: v?.method === "fast" || v?.method === "scroll" ? v.method : "manual",
    limit: {
      perPost: clampInt(v?.limit?.perPost, LIMITS.limitPerPost, d.limit.perPost),
      perRun: clampInt(v?.limit?.perRun, LIMITS.limitPerRun, d.limit.perRun),
      perPlatform,
    },
    replies: bool(v?.replies, d.replies),
    autoLoad: bool(v?.autoLoad, d.autoLoad),
  };
}

/**
 * Pastikan setiap field punya tipe & rentang yang benar. Storage bisa berisi data lama
 * (termasuk field koneksi AI dari versi sebelumnya, yang dibuang di sini), hasil edit manual, atau nilai rusak.
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
    modes: boolRecord(s.modes, d.modes),
    custom: {
      name: str(s.custom?.name, "").slice(0, LIMITS.customName),
      definition: str(s.custom?.definition, "").slice(0, LIMITS.customDefinition),
    },
    learn: boolRecord(s.learn, d.learn),
    platforms: boolRecord(s.platforms, d.platforms),
    display: boolRecord(s.display, d.display),
    categoryAction,
    scan: sanitizeScan(s.scan),
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
    if (stored.modes) stored.modes = migrateModes(stored.modes);
    /* Schema 5: setiap komentar yang dianalisis diberi label, termasuk "Aman". */
    if (Number(raw.schema) < 5 && stored.display) stored.display = { ...stored.display, showSafeBadge: true };
    /* Schema 6: bawaan lama "scroll" menganalisis sebelum pengguna meminta; sekarang menunggu tombol Analyze. */
    if (Number(raw.schema) < 6 && stored.scan?.method === "scroll") stored.scan = { ...stored.scan, method: "manual" };
    /* Schema 7: koneksi AI (Base URL, API key, model) dihapus; semua mode dinilai mesin lokal. Jangan simpan API key lama. */
    delete (stored as { api?: unknown }).api;
    /* Schema 8: scan.max dipindah ke scan.limit.perPost; batas kini berlaku di semua cara pindai, dan scan.max dibuang. */
    if (Number(raw.schema) < 8 && stored.scan) {
      const scanOld = stored.scan as Settings["scan"] & { max?: unknown };
      const max = typeof scanOld.max === "number" && Number.isFinite(scanOld.max) ? scanOld.max : undefined;
      stored.scan = { ...scanOld, limit: { perPost: max ?? DEFAULT_SETTINGS.scan.limit.perPost } as Settings["scan"]["limit"] };
      delete (stored.scan as { max?: unknown }).max;
    }
    await chrome.storage.local.set({ [KEY]: stored, schema: SCHEMA });
    if (Number(raw.schema) < 7) await chrome.storage.local.remove(["modelCache", "verdictCache"]);
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

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

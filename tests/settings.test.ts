import { afterEach, describe, expect, it, vi } from "vitest";
import { limitFor } from "../src/core/limits";
import { activeModes, DEFAULT_SETTINGS, loadSettings, migrateModes, resolveSettings } from "../src/core/settings";

describe("sanitasi pengaturan", () => {
  it("storage kosong → default", () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("angka di luar rentang dibatasi, nilai rusak kembali ke default", () => {
    const s = resolveSettings({ scan: { limit: { perPost: 1e9, perRun: 1e9 } }, thresholds: { high: "abc", medium: -5 } });
    expect(s.scan.limit.perPost).toBe(5000);
    expect(s.scan.limit.perRun).toBe(20000);
    expect(s.thresholds).toEqual({ high: DEFAULT_SETTINGS.thresholds.high, medium: 10 });
  });

  it("batas komentar: bawaan 300 per postingan & 3.000 per putaran, nilai rusak kembali ke default", () => {
    expect(resolveSettings({}).scan.limit).toEqual({ perPost: 300, perRun: 3000, perPlatform: {} });
    expect(resolveSettings({ scan: { limit: { perPost: "banyak", perRun: 1e9 } } }).scan.limit).toEqual({
      perPost: 300,
      perRun: 20000,
      perPlatform: {},
    });
  });

  it("override platform: hanya platform yang dikenal, di luar rentang dibatasi", () => {
    const s = resolveSettings({ scan: { limit: { perPlatform: { x: 200, youtube: 1e9, tiktok: "lima", spurdo: 99 } } } });
    expect(s.scan.limit.perPlatform).toEqual({ x: 200, youtube: 5000 });
    expect(limitFor(s, "x")).toBe(200);
    expect(limitFor(s, "youtube")).toBe(5000);
    expect(limitFor(resolveSettings({}), "reddit")).toBe(300);
  });

  it("ambang sedang selalu di bawah ambang tinggi", () => {
    expect(resolveSettings({ thresholds: { high: 60, medium: 90 } }).thresholds).toEqual({ high: 60, medium: 55 });
  });

  it("tipe salah diganti default, daftar dibersihkan", () => {
    const s = resolveSettings({
      enabled: "ya",
      modes: { judol: 1, kebencian: false },
      scan: { method: "turbo" },
      whitelist: [" @akun ", "", "@akun", 42],
      categoryAction: { spam: "blur", hinaan: "ledakkan" },
    });
    expect(s.enabled).toBe(true);
    expect(s.modes).toEqual({ judol: true, kebencian: false, pelecehan: false, agama: false, sara: false, kustom: false });
    expect(s.scan.method).toBe("manual");
    expect(s.whitelist).toEqual(["@akun"]);
    expect(s.categoryAction).toEqual({ spam: "blur" });
  });

  it("bawaan hanya satu mode aktif: Judol", () => {
    expect(Object.entries(DEFAULT_SETTINGS.modes).filter(([, on]) => on)).toEqual([["judol", true]]);
  });

  it("saklar toxic lama pindah ke Ujaran Kebencian", () => {
    expect(migrateModes({ judol: true, toxic: false })).toEqual({ judol: true, kebencian: false });
    expect(resolveSettings({ modes: migrateModes({ judol: false, toxic: true }) }).modes).toEqual({
      judol: false,
      kebencian: true,
      pelecehan: false,
      agama: false,
      sara: false,
      kustom: false,
    });
    expect(migrateModes({ judol: true, sara: false })).toEqual({ judol: true, sara: false });
  });

  it("mode kustom hanya aktif kalau definisinya diisi", () => {
    const empty = resolveSettings({ modes: { kustom: true } });
    expect(activeModes(empty).kustom).toBe(false);
    const filled = resolveSettings({ modes: { kustom: true }, custom: { name: " Spoiler ", definition: "x".repeat(900) } });
    expect(activeModes(filled).kustom).toBe(true);
    expect(filled.custom.name).toBe("Spoiler");
    expect(filled.custom.definition).toHaveLength(400);
  });

  it("koneksi AI dari versi lama (Base URL, API key, model) dibuang", () => {
    const s = resolveSettings({ api: { baseUrl: "http://localhost:20128/v1", apiKey: "sk-rahasia", model: "x" } }) as unknown as Record<string, unknown>;
    expect(s.api).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("sk-rahasia");
  });
});

describe("cara memindai", () => {
  it("Analyze bawaan instan: tidak menggulir halaman sendiri", () => {
    expect(resolveSettings({}).scan.autoLoad).toBe(false);
    expect(resolveSettings({ scan: { autoLoad: true } }).scan.autoLoad).toBe(true);
    expect(resolveSettings({ scan: { autoLoad: "ya" } }).scan.autoLoad).toBe(false);
  });

  it("bawaan menunggu tombol Analyze, pilihan lama tetap dihormati", () => {
    expect(resolveSettings({}).scan.method).toBe("manual");
    expect(resolveSettings({ scan: { method: "scroll" } }).scan.method).toBe("scroll");
    expect(resolveSettings({ scan: { method: "fast" } }).scan.method).toBe("fast");
  });
});

describe("migrasi batas komentar (schema < 8)", () => {
  /** Stub chrome.storage.local yang menyimpan data dan mencatat hasil set(). */
  function stubStorage(data: Record<string, unknown>): { saved: () => Record<string, unknown> } {
    let written: Record<string, unknown> | undefined;
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => data,
          set: async (v: Record<string, unknown>) => {
            written = v;
          },
          remove: async () => undefined,
        },
      },
    });
    return { saved: () => written ?? {} };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scan.max lama dipindah ke scan.limit.perPost tanpa kehilangan nilai, lalu scan.max dibuang", async () => {
    stubStorage({
      settings: { scan: { method: "fast", max: 250, replies: false, autoLoad: true } },
      schema: 7,
    });
    const s = await loadSettings();
    expect(s.scan.limit.perPost).toBe(250);
    expect(s.scan.method).toBe("fast");
    expect(s.scan.replies).toBe(false);
    expect((s.scan as unknown as { max?: unknown }).max).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('"max"');
  });

  it("storage schema lama tanpa scan.max tetap terisi bawaan", async () => {
    stubStorage({ settings: { scan: { method: "manual" } }, schema: 5 });
    const s = await loadSettings();
    expect(s.scan.limit).toEqual({ perPost: 300, perRun: 3000, perPlatform: {} });
  });
});

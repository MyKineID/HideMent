import { describe, expect, it } from "vitest";
import { activeModes, DEFAULT_SETTINGS, migrateModes, resolveSettings } from "../src/core/settings";

describe("sanitasi pengaturan", () => {
  it("storage kosong → default", () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("angka di luar rentang dibatasi, nilai rusak kembali ke default", () => {
    const s = resolveSettings({ scan: { max: 1e9 }, thresholds: { high: "abc", medium: -5 } });
    expect(s.scan.max).toBe(2000);
    expect(s.thresholds).toEqual({ high: DEFAULT_SETTINGS.thresholds.high, medium: 10 });
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
  it("bawaan menunggu tombol Analyze, pilihan lama tetap dihormati", () => {
    expect(resolveSettings({}).scan.method).toBe("manual");
    expect(resolveSettings({ scan: { method: "scroll" } }).scan.method).toBe("scroll");
    expect(resolveSettings({ scan: { method: "fast" } }).scan.method).toBe("fast");
  });
});

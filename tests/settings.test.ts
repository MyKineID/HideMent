import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, resolveSettings } from "../src/core/settings";

describe("sanitasi pengaturan", () => {
  it("storage kosong → default", () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("angka di luar rentang dibatasi, nilai rusak kembali ke default", () => {
    const s = resolveSettings({ api: { batchSize: 0, concurrency: 99, timeoutMs: "abc" }, scan: { max: 1e9 } });
    expect(s.api).toMatchObject({ batchSize: 1, concurrency: 8, timeoutMs: DEFAULT_SETTINGS.api.timeoutMs });
    expect(s.scan.max).toBe(2000);
  });

  it("ambang sedang selalu di bawah ambang tinggi", () => {
    expect(resolveSettings({ thresholds: { high: 60, medium: 90 } }).thresholds).toEqual({ high: 60, medium: 55 });
  });

  it("tipe salah diganti default, daftar dibersihkan", () => {
    const s = resolveSettings({
      enabled: "ya",
      modes: { judol: 1, toxic: false },
      scan: { method: "turbo" },
      whitelist: [" @akun ", "", "@akun", 42],
      categoryAction: { spam: "blur", hinaan: "ledakkan" },
    });
    expect(s.enabled).toBe(true);
    expect(s.modes).toEqual({ judol: true, toxic: false });
    expect(s.scan.method).toBe("scroll");
    expect(s.whitelist).toEqual(["@akun"]);
    expect(s.categoryAction).toEqual({ spam: "blur" });
  });

  it("base URL & API key di-trim", () => {
    expect(resolveSettings({ api: { baseUrl: "  http://localhost:20128/v1 ", apiKey: " sk-x " } }).api).toMatchObject({
      baseUrl: "http://localhost:20128/v1",
      apiKey: "sk-x",
    });
  });
});

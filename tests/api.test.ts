import { describe, expect, it } from "vitest";
import { ApiError, trimBase, validBase } from "../src/background/api";

describe("base URL", () => {
  it("membuang garis miring & path endpoint", () => {
    expect(trimBase(" http://host:20128/v1/ ")).toBe("http://host:20128/v1");
    expect(trimBase("http://host/v1/chat/completions")).toBe("http://host/v1");
    expect(trimBase("http://host/v1/models")).toBe("http://host/v1");
  });

  it("menolak alamat tanpa skema http(s) dengan pesan yang jelas", () => {
    expect(() => validBase("")).toThrow(ApiError);
    expect(() => validBase("localhost:20128/v1")).toThrow(/http/);
    expect(() => validBase("ftp://host/v1")).toThrow(/http/);
    expect(() => validBase("bukan url")).toThrow(/tidak valid/);
  });

  it("menerima alamat http & https", () => {
    expect(validBase("https://api.contoh.id/v1/")).toBe("https://api.contoh.id/v1");
    expect(validBase("http://127.0.0.1:20128")).toBe("http://127.0.0.1:20128");
  });
});

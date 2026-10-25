import { describe, expect, it } from "vitest";
import { buildSystemPrompt, extractJson, parseAiResponse } from "../src/core/prompt";

const both = { judol: true, toxic: true };

describe("prompt", () => {
  it("hanya memuat kategori mode yang aktif", () => {
    const p = buildSystemPrompt({ judol: false, toxic: true });
    expect(p).toContain('"hinaan"');
    expect(p).not.toContain('"judol"');
  });
});

describe("parse respons AI", () => {
  it("membaca format ringkas", () => {
    const v = parseAiResponse('{"r":[{"i":"1","k":"hinaan","s":88,"a":"menghina fisik"},{"i":"2","k":"aman","s":70,"a":"kritik"}]}', ["1", "2"], both);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ id: "1", mode: "toxic", category: "hinaan", score: 88, source: "ai" });
    expect(v[1].score).toBeLessThan(30);
  });

  it("toleran terhadap code fence & teks tambahan", () => {
    expect(extractJson('```json\n{"r":[]}\n```')).toEqual({ r: [] });
    expect(extractJson('Berikut hasilnya: {"r":[]} semoga membantu')).toEqual({ r: [] });
  });

  it("kategori tak dikenal / mode mati → aman", () => {
    const v = parseAiResponse('{"r":[{"i":"1","k":"bingung","s":90},{"i":"2","k":"judol","s":95}]}', ["1", "2"], { judol: false, toxic: true });
    expect(v.map((x) => x.category)).toEqual(["aman", "aman"]);
  });

  it("mengabaikan id yang tidak diminta & membatasi skor", () => {
    const v = parseAiResponse('[{"id":"9","category":"sara","score":50},{"id":"1","category":"ancaman","score":150}]', ["1"], both);
    expect(v).toEqual([expect.objectContaining({ id: "1", category: "ancaman", score: 100 })]);
  });
});

describe("format JSON Lines (streaming)", () => {
  it("membaca satu verdict per baris", () => {
    const text = '{"i":"1","k":"judol","s":95,"a":"promosi slot"}\n{"i":"2","k":"aman","s":5,"a":"kritik"}\n';
    const v = parseAiResponse(text, ["1", "2"], both);
    expect(v.map((x) => x.category)).toEqual(["judol", "aman"]);
  });

  it("mengabaikan code fence & baris yang belum lengkap", () => {
    const text = '```jsonl\n{"i":"1","k":"hinaan","s":80,"a":"x"}\n{"i":"2","k":"sa';
    expect(parseAiResponse(text, ["1", "2"], both)).toHaveLength(1);
  });
});

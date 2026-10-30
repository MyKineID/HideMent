import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt, extractJson, parseAiResponse } from "../src/core/prompt";

const all = { judol: true, kebencian: true, pelecehan: true, agama: true, sara: true, kustom: false };

describe("prompt", () => {
  it("hanya memuat kategori mode yang aktif", () => {
    const p = buildSystemPrompt({ ...all, judol: false, agama: false });
    expect(p).toContain('"hinaan"');
    expect(p).toContain('"sara"');
    expect(p).not.toContain('"judol"');
    expect(p).not.toContain('- "penistaan":');
  });

  it("memuat kategori kelima mode", () => {
    const p = buildSystemPrompt(all);
    for (const k of ["judol", "hinaan", "pelecehan", "penistaan", "sara"]) expect(p).toContain(`- "${k}"`);
  });
});

describe("mode kustom", () => {
  const custom = { name: "Spoiler", definition: "membocorkan akhir cerita film atau series" };

  it("definisi kustom masuk prompt hanya kalau modenya aktif & terisi", () => {
    expect(buildSystemPrompt({ ...all, kustom: true }, custom)).toContain('- "kustom": (Spoiler) kategori buatan pengguna: membocorkan akhir cerita');
    expect(buildSystemPrompt(all, custom)).not.toContain('- "kustom"');
    expect(buildSystemPrompt({ ...all, kustom: true }, { name: "x", definition: "" })).not.toContain('- "kustom"');
  });

  it("verdict kustom membawa nama tampilannya", () => {
    const [v] = parseAiResponse('{"i":"1","k":"kustom","s":82,"a":"bocor ending"}', ["1"], { ...all, kustom: true }, "Spoiler");
    expect(v).toMatchObject({ mode: "kustom", category: "kustom", label: "Spoiler" });
    const [off] = parseAiResponse('{"i":"1","k":"kustom","s":82}', ["1"], all, "Spoiler");
    expect(off.category).toBe("aman");
  });
});

describe("contoh belajar di prompt", () => {
  it("contoh dikirim sebelum komentar yang dinilai", () => {
    const u = buildUserPrompt([{ input: { id: "1", text: "halo" } }], [{ text: "gacor parah", label: "judol" }]);
    expect(u.indexOf("contoh")).toBeLessThan(u.indexOf("Klasifikasikan"));
    expect(u).toContain('"k":"judol"');
    expect(buildUserPrompt([{ input: { id: "1", text: "halo" } }])).not.toContain("contoh");
  });
});

describe("parse respons AI", () => {
  it("membaca format ringkas", () => {
    const v = parseAiResponse('{"r":[{"i":"1","k":"hinaan","s":88,"a":"menghina fisik"},{"i":"2","k":"aman","s":70,"a":"kritik"}]}', ["1", "2"], all);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ id: "1", mode: "kebencian", category: "hinaan", score: 88, source: "ai" });
    expect(v[1].score).toBeLessThan(30);
  });

  it("toleran terhadap code fence & teks tambahan", () => {
    expect(extractJson('```json\n{"r":[]}\n```')).toEqual({ r: [] });
    expect(extractJson('Berikut hasilnya: {"r":[]} semoga membantu')).toEqual({ r: [] });
  });

  it("kategori tak dikenal / mode mati → aman", () => {
    const v = parseAiResponse('{"r":[{"i":"1","k":"bingung","s":90},{"i":"2","k":"judol","s":95}]}', ["1", "2"], { ...all, judol: false });
    expect(v.map((x) => x.category)).toEqual(["aman", "aman"]);
  });

  it("tiap kategori masuk ke modenya sendiri, mode mati → aman", () => {
    const text = ['{"i":"1","k":"pelecehan","s":85}', '{"i":"2","k":"penistaan","s":90}', '{"i":"3","k":"sara","s":80}'].join("\n");
    expect(parseAiResponse(text, ["1", "2", "3"], all).map((x) => x.mode)).toEqual(["pelecehan", "agama", "sara"]);
    const off = parseAiResponse(text, ["1", "2", "3"], { ...all, agama: false });
    expect(off.map((x) => x.category)).toEqual(["pelecehan", "aman", "sara"]);
  });

  it("mengabaikan id yang tidak diminta & membatasi skor", () => {
    const v = parseAiResponse('[{"id":"9","category":"sara","score":50},{"id":"1","category":"ancaman","score":150}]', ["1"], all);
    expect(v).toEqual([expect.objectContaining({ id: "1", category: "ancaman", score: 100 })]);
  });
});

describe("format JSON Lines (streaming)", () => {
  it("membaca satu verdict per baris", () => {
    const text = '{"i":"1","k":"judol","s":95,"a":"promosi slot"}\n{"i":"2","k":"aman","s":5,"a":"kritik"}\n';
    const v = parseAiResponse(text, ["1", "2"], all);
    expect(v.map((x) => x.category)).toEqual(["judol", "aman"]);
  });

  it("mengabaikan code fence & baris yang belum lengkap", () => {
    const text = '```jsonl\n{"i":"1","k":"hinaan","s":80,"a":"x"}\n{"i":"2","k":"sa';
    expect(parseAiResponse(text, ["1", "2"], all)).toHaveLength(1);
  });
});

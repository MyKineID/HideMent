import { describe, expect, it } from "vitest";
import { ExampleIndex, mergeExamples, parseExamples } from "../src/core/examples";
import type { Category } from "../src/core/types";

describe("baca file contoh", () => {
  it("JSON Lines (format dataset riset)", () => {
    const raw = '{"text": "PULAU138 pasti wd", "label": "judol", "note": "x"}\n{"text": "editingnya jelek", "label": "aman"}\nrusak\n{"text": "", "label": "aman"}';
    expect(parseExamples(raw, "import", 1).map((e) => [e.text, e.label])).toEqual([
      ["PULAU138 pasti wd", "judol"],
      ["editingnya jelek", "aman"],
    ]);
  });

  it("array JSON & label lama", () => {
    const ex = parseExamples('[{"t":"dasar bodoh","k":"toxic"},{"text":"x","label":"ngawur"}]');
    expect(ex.map((e) => e.label)).toEqual(["hinaan"]);
  });

  it("CSV dengan header, kutip, dan koma di dalam teks", () => {
    const ex = parseExamples('label,text\nsara,"orang suku itu, semuanya ""malas"""\naman,mantap bang');
    expect(ex.map((e) => [e.label, e.text])).toEqual([
      ["sara", 'orang suku itu, semuanya "malas"'],
      ["aman", "mantap bang"],
    ]);
  });

  it("gabung: teks yang sama memakai label terbaru", () => {
    const a = parseExamples('{"text":"Gacor Parah","label":"judol"}', "import", 1);
    const b = parseExamples('{"text":"gacor parah","label":"aman"}', "manual", 2);
    expect(mergeExamples(a, b)).toEqual([expect.objectContaining({ label: "aman", source: "manual" })]);
  });
});

describe("pilih contoh paling mirip", () => {
  const index = new ExampleIndex([
    { text: "PULAU138 gacor maxwin pasti wd", label: "judol" },
    { text: "editing videonya kurang rapi bang", label: "aman" },
    { text: "dasar orang bodoh gak guna", label: "hinaan" },
  ]);
  const all = new Set<Category>(["judol", "aman", "hinaan"]);

  it("tahan huruf hias & angka pengganti", () => {
    expect(index.pick(["𝐏𝐔𝐋𝐀𝐔𝟏𝟑𝟖 g4c0r maxwin"], { allowed: all })[0]?.label).toBe("judol");
  });

  it("melewati kategori yang modenya mati & yang tidak mirip", () => {
    expect(index.pick(["dasar bodoh gak guna"], { allowed: new Set<Category>(["aman"]) })).toEqual([]);
    expect(index.pick(["resep rendang padang"], { allowed: all })).toEqual([]);
  });

  it("dibatasi jumlahnya dan tanpa duplikat", () => {
    const picked = index.pick(["pulau138 gacor", "pulau138 maxwin"], { allowed: all, perItem: 2, max: 3 });
    expect(new Set(picked).size).toBe(picked.length);
    expect(picked.length).toBeLessThanOrEqual(3);
  });
});

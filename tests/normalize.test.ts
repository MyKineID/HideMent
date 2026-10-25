import { describe, expect, it } from "vitest";
import { foldUnicode, hasFancyUnicode, normalize } from "../src/core/normalize";

describe("normalize", () => {
  it("melipat huruf Unicode hias ke ASCII", () => {
    expect(foldUnicode("𝐒𝐋𝐎𝐓 𝓖𝓐𝓒𝓞𝓡")).toBe("slot gacor");
    expect(foldUnicode("ⓜⓐⓧⓦⓘⓝ")).toBe("maxwin");
    expect(foldUnicode("ｇａｃｏｒ")).toBe("gacor");
    expect(foldUnicode("ꜱʟᴏᴛ")).toBe("slot");
  });

  it("menghapus karakter zero-width dan huruf Kiril tiruan", () => {
    expect(foldUnicode("ga​cor")).toBe("gacor");
    expect(foldUnicode("ѕlоt")).toBe("slot");
  });

  it("membalik leetspeak & huruf berulang", () => {
    expect(normalize("G4C0RRRR p4st1 WD").deleet).toBe("gacor pasti wd");
    expect(normalize("m4xw1n").compact).toBe("maxwin");
  });

  it("tidak mengubah angka murni", () => {
    expect(normalize("harga 100 ribu").deleet).toBe("harga 100 ribu");
  });

  it("mendeteksi pemakaian huruf hias", () => {
    expect(hasFancyUnicode("𝐒𝐋𝐎𝐓")).toBe(true);
    expect(hasFancyUnicode("biasa saja")).toBe(false);
  });
});

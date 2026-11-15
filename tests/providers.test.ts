import { describe, expect, it, vi } from "vitest";
import { DecisionEngine } from "../src/core/engine";
import {
  GEMINI_BATCH_SIZE,
  GEMINI_DEFAULT_MODEL,
  GeminiDecisionProvider,
  GeminiError,
  LocalDecisionProvider,
  buildGeminiSystemPrompt,
  buildGeminiUserPrompt,
  fastPathVerdict,
  parseGeminiResults,
} from "../src/core/providers";
import { VerdictCache } from "../src/core/verdict-cache";

const MODES = { judol: true, kebencian: true, pelecehan: true, agama: true, sara: true, kustom: false };
const CTX = { modes: MODES, custom: { name: "", definition: "" }, customKeywords: [] as string[] };

/** Stub fetch yang mengembalikan daftar hasil Gemini dari antrean respons JSON. */
function stubFetch(responses: unknown[], statuses: number[] = []) {
  const calls: unknown[] = [];
  let i = 0;
  const fn = vi.fn(async (_url: string, init?: { body?: string }) => {
    calls.push(init ? JSON.parse(init.body as string) : null);
    const status = statuses[i] ?? 200;
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as unknown as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const geminiOk = (rows: { id: number; category: string; score: number; reason: string }[]) => ({
  choices: [{ message: { content: JSON.stringify(rows) } }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
});

describe("prompt Gemini", () => {
  it("memuat daftar label aktif dan format JSON-only", () => {
    const prompt = buildGeminiSystemPrompt(CTX);
    expect(prompt).toContain("judol");
    expect(prompt).toContain("sarkasme");
    expect(prompt).toContain("aman");
    expect(prompt).toContain("HANYA dengan JSON");
    expect(prompt).toContain("kritik isi atau karya");
  });

  it("hanya memuat kategori dari mode yang aktif", () => {
    const prompt = buildGeminiSystemPrompt({ modes: { ...MODES, kebencian: false, pelecehan: false, agama: false, sara: false } });
    expect(prompt).not.toContain("hinaan");
    expect(prompt).not.toContain("pelecehan");
    expect(prompt).toContain("judol");
  });

  it("komentar diberi nomor berurutan", () => {
    expect(buildGeminiUserPrompt([{ id: "a", text: "halo" }, { id: "b", text: "cek bio" }])).toBe("1. halo\n2. cek bio");
  });
});

describe("parse jawaban Gemini", () => {
  const comments = [
    { id: "a", text: "cek bio ya wd 2jt" },
    { id: "b", text: "videonya bagus banget" },
  ];
  const active = new Set(["judol", "phishing", "scam", "spam", "hinaan", "perundungan", "ancaman", "sarkasme", "pelecehan", "penistaan", "sara", "aman"] as const);

  it("menerima JSON valid dan membatasi skor 0-100", () => {
    const rows = parseGeminiResults(
      '```json\n[{"id":1,"category":"judol","score":150,"reason":"promo judol"},{"id":2,"category":"aman","score":5,"reason":"pujian"}]\n```',
      comments,
      active as never,
    );
    expect(rows[0].score).toBe(100);
    expect(rows[1].category).toBe("aman");
  });

  it("gagal kalau bukan JSON", () => {
    expect(() => parseGeminiResults("bukan json", comments, active as never)).toThrow(GeminiError);
  });

  it("gagal kalau ada komentar yang tidak dijawab", () => {
    expect(() => parseGeminiResults('[{"id":1,"category":"judol","score":90,"reason":"x"}]', comments, active as never)).toThrow(/hanya memuat 1 dari 2/);
  });

  it("gagal kalau kategorinya tidak dikenal", () => {
    expect(() =>
      parseGeminiResults(
        '[{"id":1,"category":"judol","score":90,"reason":"x"},{"id":2,"category":"tidak-ada","score":90,"reason":"x"}]',
        comments,
        active as never,
      ),
    ).toThrow(GeminiError);
  });
});

describe("penyedia Gemini", () => {
  it("mengembalikan Decision dengan source gemini dan mencatat token", async () => {
    const { fn, calls } = stubFetch([
      geminiOk([
        { id: 1, category: "judol", score: 92, reason: "promo judi" },
        { id: 2, category: "aman", score: 4, reason: "pujian" },
      ]),
    ]);
    const p = new GeminiDecisionProvider({ apiKey: "kunci-tes", model: GEMINI_DEFAULT_MODEL, fetchFn: fn });
    const out = await p.decide(
      [
        { id: "a", text: "cek bio ya wd 2jt" },
        { id: "b", text: "videonya bagus banget" },
      ],
      CTX,
    );
    expect(out[0].verdict.source).toBe("gemini");
    expect(out[0].verdict.category).toBe("judol");
    expect(out[0].verdict.score).toBe(92);
    expect(out[1].verdict.category).toBe("aman");
    expect(out[1].verdict.score).toBeLessThan(30);
    expect(p.totalUsage.totalTokens).toBe(120);
    expect(calls).toHaveLength(1);
    const body = calls[0] as { model: string; messages: unknown[] };
    expect(body.model).toBe("gemini-2.5-flash");
  });

  it("membagi komentar jadi batch 20", async () => {
    const comments = Array.from({ length: 25 }, (_, i) => ({ id: String(i), text: `komentar ${i}` }));
    const rows = (from: number, n: number) => Array.from({ length: n }, (_, k) => ({ id: from + k, category: "aman", score: 1, reason: "aman" }));
    const { fn, calls } = stubFetch([geminiOk(rows(1, 20)), geminiOk(rows(1, 5))]);
    const p = new GeminiDecisionProvider({ apiKey: "kunci-tes", model: GEMINI_DEFAULT_MODEL, fetchFn: fn });
    const out = await p.decide(comments, CTX);
    expect(out).toHaveLength(25);
    expect(calls).toHaveLength(2);
    expect(GEMINI_BATCH_SIZE).toBe(20);
  });

  it("403 menyampaikan pesan asli Google (mis. free tier tidak tersedia, perlu penagihan)", async () => {
    /* Endpoint OpenAI-compatible membungkus error dalam array, seperti jawaban asli Google. */
    const body = [{ error: { message: "The Gemini API free tier is not available for this project. To use the Gemini API, please set up billing." } }];
    const first = stubFetch([body], [403]);
    const p = new GeminiDecisionProvider({ apiKey: "kunci-tes", model: GEMINI_DEFAULT_MODEL, fetchFn: first.fn });
    await expect(p.decide([{ id: "a", text: "halo" }], CTX)).rejects.toMatchObject({ kind: "auth" });
    expect(first.fn).toHaveBeenCalledTimes(1);
    const second = stubFetch([body], [403]);
    const p2 = new GeminiDecisionProvider({ apiKey: "kunci-tes", model: GEMINI_DEFAULT_MODEL, fetchFn: second.fn });
    await expect(p2.decide([{ id: "a", text: "halo" }], CTX)).rejects.toThrow(/free tier is not available/);
  });

  it("401 berarti auth, 429 berarti rate limit (tidak di-retry)", async () => {
    const { fn } = stubFetch([{}], [401]);
    const p = new GeminiDecisionProvider({ apiKey: "kunci-salah", model: GEMINI_DEFAULT_MODEL, fetchFn: fn });
    await expect(p.decide([{ id: "a", text: "halo" }], CTX)).rejects.toMatchObject({ kind: "auth" });
    expect(fn).toHaveBeenCalledTimes(1);

    const slow = stubFetch([{}], [429]);
    const p2 = new GeminiDecisionProvider({ apiKey: "kunci-tes", model: GEMINI_DEFAULT_MODEL, fetchFn: slow.fn });
    await expect(p2.decide([{ id: "a", text: "halo" }], CTX)).rejects.toMatchObject({ kind: "rate-limit" });
  });

  it("jawaban yang gagal di-parse dicoba sekali lagi, lalu gagal", async () => {
    const { fn } = stubFetch([{ choices: [{ message: { content: "bukan json" } }] }]);
    const p = new GeminiDecisionProvider({ apiKey: "kunci-tes", model: GEMINI_DEFAULT_MODEL, fetchFn: fn });
    await expect(p.decide([{ id: "a", text: "halo" }], CTX)).rejects.toMatchObject({ kind: "parse" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(p.failureCount).toBe(1);
  });

  it("tanpa API key langsung gagal sebelum fetch", async () => {
    const { fn } = stubFetch([geminiOk([])]);
    const p = new GeminiDecisionProvider({ apiKey: "", model: GEMINI_DEFAULT_MODEL, fetchFn: fn });
    await expect(p.decide([{ id: "a", text: "halo" }], CTX)).rejects.toMatchObject({ kind: "auth" });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("penyedia lokal", () => {
  it("membungkus DecisionEngine dan tetap memakai source model/rule", async () => {
    const p = new LocalDecisionProvider(new DecisionEngine());
    const out = await p.decide([{ id: "a", text: "videonya bagus banget kak" }], CTX);
    expect(out[0].verdict.category).toBe("aman");
    expect(out[0].verdict.source).toBe("model");
  });
});

describe("fast path aturan judol", () => {
  it("judol yang jelas diputuskan aturan tanpa model", () => {
    const v = fastPathVerdict({ id: "a", text: "PULAU138 pasti wd, cek bio" }, CTX);
    expect(v?.source).toBe("rule");
    expect(v?.category).toBe("judol");
  });

  it("peringatan soal judol bukan judol", () => {
    expect(fastPathVerdict({ id: "a", text: "hati-hati, itu situs judol, jangan klik" }, CTX)).toBeNull();
  });

  it("komentar biasa tidak kena fast path", () => {
    expect(fastPathVerdict({ id: "a", text: "videonya bagus banget kak" }, CTX)).toBeNull();
  });

  it("mati kalau mode judol mati", () => {
    expect(fastPathVerdict({ id: "a", text: "PULAU138 pasti wd, cek bio" }, { ...CTX, modes: { ...MODES, judol: false } })).toBeNull();
  });
});

describe("cache verdict", () => {
  it("teks yang sama setelah normalisasi memakai kunci yang sama; penyedia dan model membedakan kunci", () => {
    const cache = new VerdictCache(2);
    const modes = { judol: true };
    const a = cache.key("local", "local", "cek bio ya wd 2jt", modes);
    const b = cache.key("local", "local", "cek bio ya wd 2jt", modes);
    const c = cache.key("gemini", "gemini-2.5-flash", "cek bio ya wd 2jt", modes);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const verdict = { id: "x", mode: "judol", category: "judol", score: 90, reason: "promo", source: "rule" } as never;
    cache.set(a, { verdict, probs: {}, similar: [], us: 1 });
    expect(cache.get(a)?.verdict).toEqual(verdict);
    expect(cache.size).toBe(1);
  });

  it("melebihi batas, entri tertua dibuang", () => {
    const cache = new VerdictCache(2);
    cache.set("k1", { verdict: { id: "1" }, probs: {}, similar: [], us: 0 } as never);
    cache.set("k2", { verdict: { id: "2" }, probs: {}, similar: [], us: 0 } as never);
    cache.set("k3", { verdict: { id: "3" }, probs: {}, similar: [], us: 0 } as never);
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k3")).toBeDefined();
  });
});

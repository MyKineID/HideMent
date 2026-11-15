import { DecisionEngine, type DecideContext, type Decision } from "./engine";
import { isWarning } from "./engine/features";
import { toDoc } from "./engine/text";
import { analyzeRules, RULE_DIRECT_THRESHOLD } from "./judol-rules";
import { normalize } from "./normalize";
import { CATEGORY_LABEL, modeOf, type Category, type CommentInput, type Verdict } from "./types";
import { safeMode as engineSafeMode } from "./engine";

/**
 * Penyedia keputusan HideMent: dua pilihan di Pengaturan, "Model keputusan".
 *
 * - "local": mesin keputusan lokal Raphael (DecisionEngine). Bawaan. Gratis, tanpa
 *   internet, tanpa API key.
 * - "gemini": penilaian lewat Gemini API (endpoint OpenAI-compatible Google).
 *   Opt-in, butuh API key pengguna. Teks komentar dikirim ke Google hanya saat
 *   pilihan ini aktif.
 *
 * Kedua penyedia mengembalikan bentuk Decision yang sama, jadi service worker,
 * overlay, dan antrian tidak perlu tahu model mana yang dipakai.
 */

export type ProviderId = "local" | "gemini";

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  local: "Lokal Raphael",
  gemini: "Gemini",
};

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
export const GEMINI_BATCH_SIZE = 20;
export const GEMINI_TIMEOUT_MS = 30000;
export const GEMINI_MAX_RETRIES = 1;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface DecisionProvider {
  id: ProviderId;
  label: string;
  decide(comments: CommentInput[], ctx: DecideContext): Promise<Decision[]>;
}

/** Kategori yang boleh muncul sebagai jawaban model, sesuai panduan pelabelan. */
export const GEMINI_CATEGORIES: Category[] = [
  "judol",
  "phishing",
  "scam",
  "spam",
  "hinaan",
  "perundungan",
  "ancaman",
  "sarkasme",
  "pelecehan",
  "penistaan",
  "sara",
  "kustom",
  "aman",
];

const CATEGORY_DEFINITION: Record<Category, string> = {
  judol: "promosi judi online, testimoni menang/WD, nama situs merek+angka, ajakan cek bio atau ketik di Google",
  phishing: "link atau ajakan ke situs palsu, pencurian akun/OTP, meniru bank, e-wallet, atau platform",
  scam: "penipuan: hadiah palsu, investasi bodong, pinjol ilegal, minta transfer atau hubungi admin",
  spam: "promosi berulang atau tidak relevan selain judi (follow-for-follow, jualan, bot)",
  hinaan: "menghina fisik, kecerdasan, atau martabat orang secara langsung",
  perundungan: "merundung, mengajak mengeroyok, menyuruh bunuh diri, mempermalukan orang",
  ancaman: "ancaman kekerasan, doxing, intimidasi",
  sarkasme: "sindiran yang tujuannya merendahkan orang (pujian palsu, ejekan terselubung)",
  pelecehan: "komentar cabul atau mesum ke seseorang, objektifikasi tubuh, ajakan seksual",
  penistaan: "menghina atau mengolok-olok ajaran, kitab suci, nabi atau tokoh suci, simbol, atau ibadah suatu agama",
  sara: "kebencian, hasutan, atau stereotip merendahkan terhadap kelompok orang berdasarkan suku, ras, etnis, agama, atau golongan",
  kustom: "kategori buatan pengguna (lihat definisi mode kustom)",
  aman: "bukan berbahaya: kritik isi atau karya sekeras apa pun, kata kasar sebagai ekspresi bukan serangan, pujian tulus",
};

export function buildGeminiSystemPrompt(ctx: DecideContext): string {
  const active: Category[] = [];
  const modes = ctx.modes;
  const order: Category[] = [
    "judol",
    "phishing",
    "scam",
    "spam",
    "hinaan",
    "perundungan",
    "ancaman",
    "sarkasme",
    "pelecehan",
    "penistaan",
    "sara",
    "kustom",
  ];
  const modeOfCategory: Record<string, string> = {
    judol: "judol",
    phishing: "judol",
    scam: "judol",
    spam: "judol",
    hinaan: "kebencian",
    perundungan: "kebencian",
    ancaman: "kebencian",
    sarkasme: "kebencian",
    pelecehan: "pelecehan",
    penistaan: "agama",
    sara: "sara",
    kustom: "kustom",
  };
  for (const cat of order) {
    if (modes[modeOfCategory[cat] as keyof typeof modes]) active.push(cat);
  }
  const lines = active.map((c) => `- ${c}: ${CATEGORY_DEFINITION[c]}`).join("\n");
  const custom = ctx.custom?.definition ? `\nKategori kustom ("${ctx.custom.name || "Kustom"}"): ${ctx.custom.definition}\n` : "";
  return [
    "Kamu adalah penilai komentar berbahasa Indonesia untuk ekstensi HideMent.",
    "Nilai setiap komentar dan jawab HANYA dengan JSON, tanpa teks lain.",
    "Aturan: kritik isi atau karya sekeras apa pun itu AMAN. Kata kasar sebagai ekspresi, bukan serangan ke orang, itu AMAN.",
    "Nada positif bukan berarti aman (promosi judi sering bernada positif). Nada negatif bukan berarti berbahaya (kritik sering bernada negatif).",
    "Kalau ada beberapa kategori, pilih yang paling berbahaya.",
    "Kategori yang dipakai:",
    lines,
    "- aman: bukan berbahaya",
    custom,
    'Format jawaban: [{"id": 1, "category": "judol", "score": 0-100, "reason": "alasan singkat"}, ...].',
    "id harus sama dengan nomor komentar yang diberikan. score adalah keyakinan 0-100. score di bawah 30 berarti aman.",
    "reason maksimal 20 kata, bahasa Indonesia.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildGeminiUserPrompt(comments: CommentInput[]): string {
  return comments.map((c, i) => `${i + 1}. ${c.text}`).join("\n");
}

export interface GeminiRawResult {
  id: number;
  category: Category;
  score: number;
  reason: string;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate-limit" | "timeout" | "parse" | "api" | "network",
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/** Pesan error dari body jawaban Google (kalau ada), tanpa pernah memuat key. */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as unknown;
    /* Endpoint OpenAI-compatible membungkus error dalam array: [{ error: { message } }]. */
    const first = Array.isArray(data) ? data[0] : data;
    const message = (first as { error?: { message?: string } } | null)?.error?.message;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}

function stripCodeFence(text: string): string {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}

/** Parse dan validasi jawaban Gemini. Gagal kalau bentuknya tidak sesuai: pemanggil yang memutuskan (retry atau fallback). */
export function parseGeminiResults(raw: string, comments: CommentInput[], active: Set<Category>): GeminiRawResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new GeminiError("Jawaban Gemini bukan JSON yang valid.", "parse");
  }
  if (!Array.isArray(parsed)) throw new GeminiError("Jawaban Gemini bukan daftar JSON.", "parse");
  const byId = new Map<number, GeminiRawResult>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { id, category, score, reason } = item as Record<string, unknown>;
    const n = typeof id === "number" ? id : Number(id);
    if (!Number.isInteger(n) || n < 1 || n > comments.length) continue;
    if (typeof category !== "string" || !GEMINI_CATEGORIES.includes(category as Category)) continue;
    if (category !== "aman" && !active.has(category as Category)) continue;
    const s = typeof score === "number" ? score : Number(score);
    if (!Number.isFinite(s)) continue;
    byId.set(n, {
      id: n,
      category: category as Category,
      score: Math.max(0, Math.min(100, Math.round(s))),
      reason: typeof reason === "string" ? reason.slice(0, 240) : "",
    });
  }
  if (byId.size !== comments.length) {
    throw new GeminiError(`Jawaban Gemini hanya memuat ${byId.size} dari ${comments.length} komentar.`, "parse");
  }
  return comments.map((_, i) => byId.get(i + 1)!);
}

function toDecision(c: CommentInput, r: GeminiRawResult, ctx: DecideContext, us: number): Decision {
  const safe = r.category === "aman" || r.score < 30;
  const category: Category = safe ? "aman" : r.category;
  const score = safe ? Math.min(29, r.score) : r.score;
  const verdict: Verdict = {
    id: c.id,
    mode: category === "aman" ? engineSafeMode(ctx.modes) : (modeOf(category) ?? "judol"),
    category,
    score,
    reason: r.reason || (safe ? "tidak ada tanda berbahaya" : `${CATEGORY_LABEL[category]} ${score}%`),
    source: "gemini",
    ...(category === "kustom" && ctx.custom?.name ? { label: ctx.custom.name } : {}),
  };
  return { verdict, probs: { [category]: score / 100 }, similar: [], us };
}

export class LocalDecisionProvider implements DecisionProvider {
  readonly id: ProviderId = "local";
  readonly label = PROVIDER_LABEL.local;

  constructor(private engine: DecisionEngine) {}

  async decide(comments: CommentInput[], ctx: DecideContext): Promise<Decision[]> {
    return comments.map((c) => this.engine.decide(c, ctx));
  }
}

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  batchSize?: number;
  timeoutMs?: number;
  /** Untuk test: ganti fetch global. */
  fetchFn?: typeof fetch;
}

interface ChatCompletionsResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class GeminiDecisionProvider implements DecisionProvider {
  readonly id: ProviderId = "gemini";
  readonly label = PROVIDER_LABEL.gemini;
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private failures = 0;

  constructor(private opts: GeminiProviderOptions) {}

  get totalUsage(): TokenUsage {
    return { ...this.usage };
  }

  get failureCount(): number {
    return this.failures;
  }

  async decide(comments: CommentInput[], ctx: DecideContext): Promise<Decision[]> {
    if (!this.opts.apiKey) throw new GeminiError("API key Gemini belum diisi di Pengaturan.", "auth");
    const out: Decision[] = [];
    const batchSize = Math.max(1, Math.min(50, this.opts.batchSize ?? GEMINI_BATCH_SIZE));
    for (let i = 0; i < comments.length; i += batchSize) {
      const batch = comments.slice(i, i + batchSize);
      const decisions = await this.decideBatch(batch, ctx);
      out.push(...decisions);
    }
    return out;
  }

  private async decideBatch(batch: CommentInput[], ctx: DecideContext): Promise<Decision[]> {
    const active = new Set<Category>();
    for (const m of Object.keys(ctx.modes) as (keyof DecideContext["modes"])[]) {
      if (!ctx.modes[m]) continue;
      const cats: Category[] =
        m === "judol"
          ? ["judol", "phishing", "scam", "spam"]
          : m === "kebencian"
            ? ["hinaan", "perundungan", "ancaman", "sarkasme"]
            : m === "pelecehan"
              ? ["pelecehan"]
              : m === "agama"
                ? ["penistaan"]
                : m === "sara"
                  ? ["sara"]
                  : ["kustom"];
      for (const c of cats) active.add(c);
    }
    const started = Date.now();
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      try {
        const raw = await this.callApi(batch, ctx, attempt > 0);
        const results = parseGeminiResults(raw, batch, active);
        const us = Math.round(((Date.now() - started) * 1000) / batch.length);
        return batch.map((c, i) => toDecision(c, results[i], ctx, us));
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (e instanceof GeminiError && (e.kind === "auth" || e.kind === "rate-limit")) break;
        if (attempt < GEMINI_MAX_RETRIES) continue;
      }
    }
    this.failures++;
    throw lastError ?? new GeminiError("Gemini gagal menilai komentar.", "api");
  }

  private async callApi(batch: CommentInput[], ctx: DecideContext, isRetry: boolean): Promise<string> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? GEMINI_TIMEOUT_MS);
    try {
      const system = buildGeminiSystemPrompt(ctx);
      const user = buildGeminiUserPrompt(batch) + (isRetry ? "\n\nBalas HANYA dengan JSON yang valid, tanpa teks lain." : "");
      const res = await fetchFn(`${GEMINI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify({
          model: this.opts.model || GEMINI_DEFAULT_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      if (res.status === 401) {
        throw new GeminiError("API key Gemini ditolak. Periksa key di Pengaturan.", "auth");
      }
      if (res.status === 403) {
        /* 403 dari Google biasanya bukan key salah, tapi proyeknya: free tier
           tidak tersedia atau penagihan belum diaktifkan. Sampaikan pesan
           aslinya supaya pengguna tahu apa yang harus dilakukan. */
        const detail = await readErrorMessage(res);
        throw new GeminiError(
          detail ? `Akses Gemini ditolak: ${detail.slice(0, 200)}` : "Akses Gemini ditolak (403). Periksa izin dan penagihan proyek Google.",
          "auth",
        );
      }
      if (res.status === 429) {
        throw new GeminiError("Gemini membatasi request (rate limit). Coba lagi sebentar lagi.", "rate-limit");
      }
      if (!res.ok) {
        const detail = await readErrorMessage(res);
        throw new GeminiError(
          detail ? `Gemini mengembalikan HTTP ${res.status}: ${detail.slice(0, 200)}` : `Gemini mengembalikan HTTP ${res.status}.`,
          "api",
        );
      }
      const data = (await res.json()) as ChatCompletionsResponse;
      if (data.usage) {
        this.usage.inputTokens += data.usage.prompt_tokens ?? 0;
        this.usage.outputTokens += data.usage.completion_tokens ?? 0;
        this.usage.totalTokens += data.usage.total_tokens ?? (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0);
      }
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new GeminiError("Gemini mengembalikan jawaban kosong.", "parse");
      }
      return content;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      if ((e as Error).name === "AbortError") throw new GeminiError("Gemini kehabisan waktu (timeout).", "timeout");
      throw new GeminiError("Tidak bisa menghubungi Gemini. Periksa internet.", "network");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Fast path aturan judol: judol yang jelas langsung diputuskan aturan lokal,
 * tanpa memanggil model apa pun. dipakai service worker dan eval supaya
 * keduanya memakai aturan yang sama. Kembalikan null kalau bukan judol jelas.
 */
export function fastPathVerdict(c: CommentInput, ctx: DecideContext): Verdict | null {
  if (!ctx.modes.judol) return null;
  const n = normalize(c.text);
  const rules = analyzeRules(c.text, ctx.customKeywords ?? [], n);
  if (rules.trivial) {
    return { id: c.id, mode: "judol", category: "aman", score: 0, reason: "terlalu pendek", source: "rule" };
  }
  const doc = toDoc(c.text, n);
  if (rules.judolCategory === "judol" && rules.judolScore >= RULE_DIRECT_THRESHOLD && !isWarning(doc)) {
    return {
      id: c.id,
      mode: "judol",
      category: "judol",
      score: rules.judolScore,
      reason: rules.reasons.join("; "),
      source: "rule",
    };
  }
  return null;
}

/** Kunci cache: teks yang sudah dinormalisasi + penyedia + model + mode aktif. */
export function verdictCacheKey(provider: ProviderId, model: string, text: string, modes: Record<string, boolean>): string {
  const active = Object.entries(modes)
    .filter(([, on]) => on)
    .map(([m]) => m)
    .sort()
    .join(",");
  return `${provider}|${model}|${active}|${normalize(text).deleet}`;
}

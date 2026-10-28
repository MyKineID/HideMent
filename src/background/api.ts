import type { Settings } from "../core/settings";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly timeout = false,
  ) {
    super(message);
  }
}

export function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "");
}

/** Base URL yang sudah dirapikan, atau ApiError yang jelas kalau bukan alamat http(s). */
export function validBase(url: string): string {
  const base = trimBase(url);
  if (!base) throw new ApiError("Base URL belum diisi");
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new ApiError(`Base URL tidak valid: "${base}". Contoh yang benar: http://localhost:20128/v1`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new ApiError("Base URL harus diawali http:// atau https://");
  return base;
}

function headers(apiKey: string): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new ApiError(`Tidak ada respons dalam ${Math.round(timeoutMs / 1000)} detik`, undefined, true);
    throw new ApiError(`Tidak bisa terhubung ke ${new URL(url).host}: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const j = JSON.parse(body);
    return j.error?.message ?? j.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200) || res.statusText;
  }
}

export interface ModelList {
  baseUrl: string;
  models: string[];
}

export async function listModels(baseUrl: string, apiKey: string, timeoutMs = 15000): Promise<ModelList> {
  const base = validBase(baseUrl);
  const candidates = /\/v\d+$/.test(base) ? [base] : [base, `${base}/v1`];
  let lastError: ApiError | undefined;

  for (const candidate of candidates) {
    try {
      const res = await request(`${candidate}/models`, { headers: headers(apiKey) }, timeoutMs);
      if (!res.ok) {
        lastError = new ApiError(`HTTP ${res.status}: ${await errorText(res)}`, res.status);
        if (res.status === 401 || res.status === 403) throw lastError;
        continue;
      }
      const data = await res.json();
      const rows: unknown[] = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
      const models = rows
        .map((m) => (typeof m === "string" ? m : ((m as { id?: string; name?: string }).id ?? (m as { name?: string }).name)))
        .filter((m): m is string => Boolean(m))
        .sort((a, b) => a.localeCompare(b));
      return { baseUrl: candidate, models };
    } catch (e) {
      lastError = e instanceof ApiError ? e : new ApiError(String(e));
      if (lastError.status === 401 || lastError.status === 403) throw lastError;
    }
  }
  throw lastError ?? new ApiError("Gagal mengambil daftar model");
}

export interface ChatResult {
  content: string;
  latencyMs: number;
}

let jsonModeUnsupported = false;

export async function chat(api: Settings["api"], system: string, user: string): Promise<ChatResult> {
  const base = validBase(api.baseUrl);
  const started = Date.now();
  const send = (jsonMode: boolean) =>
    request(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: headers(api.apiKey),
        body: JSON.stringify({
          model: api.model,
          temperature: 0,
          stream: false,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      },
      api.timeoutMs,
    );

  let res = await send(!jsonModeUnsupported);
  if (res.status === 400 && !jsonModeUnsupported) {
    jsonModeUnsupported = true;
    res = await send(false);
  }
  if (!res.ok) throw new ApiError(`HTTP ${res.status}: ${await errorText(res)}`, res.status);

  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "";
  if (!content) throw new ApiError("Respons AI kosong");
  return { content, latencyMs: Date.now() - started };
}

export interface StreamResult extends ChatResult {
  /** Waktu sampai token pertama diterima (ms). */
  ttftMs: number;
}

/**
 * Chat dengan streaming (SSE). `onText` dipanggil setiap ada potongan teks baru,
 * sehingga hasil per komentar bisa diproses sebelum jawaban AI selesai.
 * Kalau server tidak mendukung streaming, jawaban biasa diteruskan sekali di akhir.
 */
export async function chatStream(
  api: Settings["api"],
  system: string,
  user: string,
  onText: (chunk: string) => void,
): Promise<StreamResult> {
  const base = validBase(api.baseUrl);
  const started = Date.now();
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), api.timeoutMs);
  const resetIdle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), api.timeoutMs);
  };

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: headers(api.apiKey),
      signal: ctrl.signal,
      body: JSON.stringify({
        model: api.model,
        temperature: 0,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") throw new ApiError(`Tidak ada respons dalam ${Math.round(api.timeoutMs / 1000)} detik`, undefined, true);
    throw new ApiError(`Tidak bisa terhubung ke ${new URL(base).host}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new ApiError(`HTTP ${res.status}: ${await errorText(res)}`, res.status);
  }

  let content = "";
  let ttftMs = 0;
  const push = (t: string) => {
    if (!t) return;
    if (!ttftMs) ttftMs = Date.now() - started;
    content += t;
    onText(t);
  };

  try {
    if (!(res.headers.get("content-type") ?? "").includes("event-stream") || !res.body) {
      const data = await res.json();
      push(data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "");
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            push(j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text ?? "");
          } catch {
            /* potongan SSE tidak lengkap */
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new ApiError(`Respons berhenti lebih dari ${Math.round(api.timeoutMs / 1000)} detik`, undefined, true);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!content) throw new ApiError("Respons AI kosong");
  return { content, latencyMs: Date.now() - started, ttftMs };
}

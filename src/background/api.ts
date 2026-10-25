import type { Settings } from "../core/settings";

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "");
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
    if ((e as Error).name === "AbortError") throw new ApiError(`Timeout setelah ${Math.round(timeoutMs / 1000)} detik`);
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
  const base = trimBase(baseUrl);
  if (!base) throw new ApiError("Base URL belum diisi");
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
  const base = trimBase(api.baseUrl);
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

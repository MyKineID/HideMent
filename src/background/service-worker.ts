import { prefilter } from "../core/judol-rules";
import { DEFAULT_SETTINGS, isApiConfigured, loadSettings, onSettingsChanged, priorityOf, type Settings } from "../core/settings";
import type { CommentInput, Platform, QueueItem, Verdict } from "../core/types";
import { hashText } from "../core/normalize";
import type { Msg, ReportResult, StatusInfo, TabMsg } from "../shared/messages";
import { ApiError, chat, listModels } from "./api";
import { Batcher } from "./batcher";
import { cacheKey, clearCache, getCached, setCached } from "./cache";

let settings: Settings = DEFAULT_SETTINGS;
const ready = loadSettings().then((s) => (settings = s));
onSettingsChanged((s) => {
  const turnedOn = s.report.autoQueue && !settings.report.autoQueue;
  settings = s;
  if (turnedOn) {
    for (const q of queue) if (q.priority === "tinggi" && !q.report) q.report = "pending";
    flushQueue();
  }
});

const batcher = new Batcher(() => settings);

const QUEUE_KEY = "queue";
const QUEUE_MAX = 500;
let queue: QueueItem[] = [];
const queueReady = chrome.storage.session.get(QUEUE_KEY).then((r) => (queue = (r[QUEUE_KEY] ?? []) as QueueItem[]));
let queueTimer: ReturnType<typeof setTimeout> | undefined;

const tabCounts = new Map<number, { scanned: number; high: number; medium: number }>();

function countsFor(tabId: number) {
  let c = tabCounts.get(tabId);
  if (!c) tabCounts.set(tabId, (c = { scanned: 0, high: 0, medium: 0 }));
  return c;
}

function updateBadge(tabId: number): void {
  const c = countsFor(tabId);
  const n = c.high + c.medium;
  void chrome.action.setBadgeText({ tabId, text: n ? String(n > 999 ? "999+" : n) : "" });
  void chrome.action.setBadgeBackgroundColor({ tabId, color: c.high ? "#c1121f" : "#f5a524" });
}

function flushQueue(): void {
  clearTimeout(queueTimer);
  queueTimer = setTimeout(() => {
    void chrome.storage.session.set({ [QUEUE_KEY]: queue });
    chrome.runtime.sendMessage({ type: "queueUpdated", queue }).catch(() => undefined);
  }, 300);
}

function record(tabId: number, platform: Platform, url: string, c: CommentInput, v: Verdict): void {
  const counts = countsFor(tabId);
  counts.scanned++;
  const priority = priorityOf(v.score, settings.thresholds);
  if (v.category === "aman" || priority === "rendah") return;
  if (priority === "tinggi") counts.high++;
  else counts.medium++;
  updateBadge(tabId);

  const key = hashText(`${platform}|${c.author ?? ""}|${c.text}`);
  const prev = queue.find((q) => q.key === key);
  queue = queue.filter((q) => q.key !== key);
  queue.unshift({
    key, tabId, platform, url: c.url ?? url, pageUrl: url, commentId: c.id, author: c.author ?? "", text: c.text.slice(0, 1000),
    verdict: v, priority, at: Date.now(),
    report: prev?.report ?? (settings.report.autoQueue && priority === "tinggi" ? "pending" : undefined),
  });
  if (queue.length > QUEUE_MAX) queue.length = QUEUE_MAX;
  flushQueue();
}

function sendToTab(tabId: number, msg: TabMsg): void {
  chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

function isWhitelisted(author?: string): boolean {
  if (!author) return false;
  const a = author.toLowerCase().replace(/^@/, "");
  return settings.whitelist.some((w) => w.toLowerCase().replace(/^@/, "") === a);
}

async function analyze(tabId: number, platform: Platform, url: string, comments: CommentInput[]): Promise<Verdict[]> {
  await Promise.all([ready, queueReady]);
  const immediate: Verdict[] = [];
  const aiOk = isApiConfigured(settings);

  for (const c of comments) {
    if (isWhitelisted(c.author)) {
      immediate.push({ id: c.id, mode: "toxic", category: "aman", score: 0, reason: "akun di whitelist", source: "rule" });
      continue;
    }
    const pf = prefilter(c, settings.modes, settings.customKeywords);
    if (pf.verdict) {
      immediate.push(pf.verdict);
      record(tabId, platform, url, c, pf.verdict);
      continue;
    }
    if (!pf.needsAi) continue;

    const key = cacheKey(c.text, settings.modes, settings.api.model);
    const hit = await getCached(key);
    if (hit) {
      const v: Verdict = { ...hit, id: c.id, source: "cache" };
      immediate.push(v);
      record(tabId, platform, url, c, v);
      continue;
    }
    if (!aiOk) continue;

    void batcher.classify({ input: c, hint: pf.hint }).then((v) => {
      if (!v) return;
      void setCached(key, v);
      record(tabId, platform, url, c, v);
      sendToTab(tabId, { type: "verdicts", verdicts: [v] });
    });
  }
  return immediate;
}

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  switch (msg.type) {
    case "analyze": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return [];
      return analyze(tabId, msg.platform, msg.url, msg.comments);
    }
    case "listModels":
      return listModels(msg.baseUrl, msg.apiKey);
    case "testConnection": {
      const api = { ...settings.api, timeoutMs: Math.min(settings.api.timeoutMs, 15000) };
      try {
        const res = await chat(api, 'Balas hanya JSON: {"ok":true}', "tes");
        return { ok: true, latencyMs: res.latencyMs, reply: res.content.slice(0, 120) };
      } catch (e) {
        if (e instanceof ApiError && e.timeout) {
          throw new Error(
            `Model "${api.model}" tidak merespons dalam ${api.timeoutMs / 1000} detik. Server-nya terhubung, tapi model ini kemungkinan sedang bermasalah di 9router. Coba pilih model lain.`,
          );
        }
        throw e;
      }
    }
    case "getQueue":
      await queueReady;
      return queue;
    case "clearQueue":
      queue = [];
      for (const [tabId, c] of tabCounts) {
        c.high = c.medium = 0;
        updateBadge(tabId);
      }
      flushQueue();
      return true;
    case "removeQueueItem":
      queue = queue.filter((q) => q.key !== msg.key);
      flushQueue();
      return true;
    case "setReportStatus": {
      const item = queue.find((q) => q.key === msg.key);
      if (item) item.report = msg.status;
      flushQueue();
      return true;
    }
    case "ensureContent":
      return ensureContent(msg.tabId);
    case "startReport": {
      if (!(await ensureContent(queue.find((q) => q.key === msg.key)?.tabId ?? -1))) {
        throw new Error("Tab ini belum tersambung ke Tempest. Refresh halamannya lalu coba lagi.");
      }
      const item = queue.find((q) => q.key === msg.key);
      if (!item) throw new Error("Komentar tidak ada di antrian");
      try {
        await chrome.tabs.update(item.tabId, { active: true });
      } catch {
        throw new Error("Tab komentar ini sudah ditutup. Buka lagi halamannya.");
      }
      const res = (await chrome.tabs.sendMessage(item.tabId, { type: "reportComment", commentId: item.commentId, text: item.text, verdict: item.verdict } satisfies TabMsg)) as ReportResult | undefined;
      if (!res) throw new Error("Halaman belum siap. Refresh tab lalu coba lagi.");
      return res;
    }
    case "clearCache":
      await clearCache();
      return true;
    case "focusComment": {
      const tab = await chrome.tabs.update(msg.tabId, { active: true });
      if (!(await ensureContent(msg.tabId))) return false;
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      const found = await chrome.tabs
        .sendMessage(msg.tabId, { type: "focusComment", commentId: msg.commentId, text: msg.text } satisfies TabMsg)
        .catch(() => false);
      return Boolean(found);
    }
    case "getStatus": {
      const tabId = msg.tabId ?? sender.tab?.id;
      const info: StatusInfo = {
        configured: isApiConfigured(settings),
        model: settings.api.model,
        tabCounts: tabId !== undefined ? { ...countsFor(tabId) } : { scanned: 0, high: 0, medium: 0 },
        ...batcher.stats,
      };
      return info;
    }
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  handle(msg, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (e: Error) => sendResponse({ ok: false, error: e.message }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => tabCounts.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) {
    tabCounts.delete(tabId);
    updateBadge(tabId);
  }
});

const CONTENT_MATCHES = chrome.runtime.getManifest().content_scripts?.[0]?.matches ?? [];

/** Pasang content script ke tab yang sudah terbuka (Chrome tidak melakukannya sendiri setelah ekstensi di-reload). */
async function injectContent(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch {
    return false;
  }
}

async function pingTab(tabId: number): Promise<boolean> {
  const res = (await chrome.tabs.sendMessage(tabId, { type: "ping" } satisfies TabMsg).catch(() => null)) as { ok?: boolean } | null;
  return Boolean(res?.ok);
}

/** Pastikan tab punya content script yang hidup; pasang ulang kalau koneksinya putus. */
async function ensureContent(tabId: number): Promise<boolean> {
  if (await pingTab(tabId)) return true;
  if (!(await injectContent(tabId))) return false;
  await new Promise((r) => setTimeout(r, 300));
  return pingTab(tabId);
}

chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === "install") void chrome.runtime.openOptionsPage();
  const tabs = await chrome.tabs.query({ url: CONTENT_MATCHES });
  await Promise.all(tabs.map((t) => (t.id !== undefined && !t.discarded ? injectContent(t.id) : null)));
});

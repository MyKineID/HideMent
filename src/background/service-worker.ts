import { prefilter } from "../core/judol-rules";
import { DEFAULT_SETTINGS, isApiConfigured, loadSettings, onSettingsChanged, priorityOf, type Settings } from "../core/settings";
import type { CommentInput, Platform, QueueItem, Verdict } from "../core/types";
import { hashText } from "../core/normalize";
import type { Msg, StatusInfo, TabMsg } from "../shared/messages";
import { chat, listModels } from "./api";
import { Batcher } from "./batcher";
import { cacheKey, clearCache, getCached, setCached } from "./cache";

let settings: Settings = DEFAULT_SETTINGS;
const ready = loadSettings().then((s) => (settings = s));
onSettingsChanged((s) => (settings = s));

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
  queue = queue.filter((q) => q.key !== key);
  queue.unshift({
    key, tabId, platform, url, commentId: c.id, author: c.author ?? "", text: c.text.slice(0, 1000),
    verdict: v, priority, at: Date.now(),
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
      const res = await chat(settings.api, 'Balas hanya JSON: {"ok":true}', "tes");
      return { ok: true, latencyMs: res.latencyMs, reply: res.content.slice(0, 120) };
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
    case "clearCache":
      await clearCache();
      return true;
    case "focusComment":
      await chrome.tabs.update(msg.tabId, { active: true });
      sendToTab(msg.tabId, { type: "focusComment", commentId: msg.commentId });
      return true;
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

chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") void chrome.runtime.openOptionsPage();
});

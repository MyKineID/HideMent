import { hashText } from "../core/normalize";
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type Settings } from "../core/settings";
import type { CommentInput, Verdict } from "../core/types";
import { send, type TabMsg } from "../shared/messages";
import { detectAdapter } from "./adapters";
import { applyVerdict, clearMarks, focusElement } from "./overlay";
import { runReportFlow } from "./report-helper";
import { FastScanner } from "./fast-scan";

const adapter = detectAdapter(location.hostname);

const SCAN_THROTTLE_MS = 400;
const SEND_DELAY_MS = 120;
const MAX_PER_MESSAGE = 60;
const MAX_TEXT = 1500;

let settings: Settings = DEFAULT_SETTINGS;
let seq = 0;
const prefix = Math.random().toString(36).slice(2, 6);
const elements = new Map<string, HTMLElement>();
const verdicts = new Map<string, Verdict>();
const outbox = new Map<string, CommentInput>();
let sendTimer: ReturnType<typeof setTimeout> | undefined;
let scanTimer: ReturnType<typeof setTimeout> | undefined;
let observer: MutationObserver | undefined;
/** Saat Pindai Cepat berjalan, komentar langsung dianalisis tanpa menunggu terlihat di layar. */
let eager = false;
const sentFingerprints = new Set<string>();
let lastUrl = location.href;
let autoScanTimer: ReturnType<typeof setTimeout> | undefined;

function active(): boolean {
  return Boolean(adapter && settings.enabled && settings.platforms[adapter.platform] && (settings.modes.judol || settings.modes.toxic));
}

const visibility = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      visibility.unobserve(e.target);
      queueForAnalysis(e.target as HTMLElement);
    }
  },
  { rootMargin: "800px 0px" },
);

function queueForAnalysis(el: HTMLElement): void {
  const id = el.dataset.rgId;
  if (!id || verdicts.has(id) || !adapter) return;
  const text = adapter.getText(el).slice(0, MAX_TEXT);
  if (!text) return;
  sentFingerprints.add(el.dataset.rgFp ?? text);
  outbox.set(id, { id, text, author: adapter.getAuthor(el) });
  clearTimeout(sendTimer);
  sendTimer = setTimeout(flush, outbox.size >= MAX_PER_MESSAGE ? 0 : SEND_DELAY_MS);
}

async function flush(): Promise<void> {
  if (!adapter || !outbox.size) return;
  const batch = [...outbox.values()].slice(0, MAX_PER_MESSAGE);
  batch.forEach((c) => outbox.delete(c.id));
  if (outbox.size) sendTimer = setTimeout(flush, 50);
  try {
    const res = await send<Verdict[]>({ type: "analyze", platform: adapter.platform, url: location.href, comments: batch });
    res.forEach(applyOne);
  } catch {
    /* service worker sedang restart; komentar akan dipindai ulang saat scan berikutnya */
  }
}

function applyOne(v: Verdict): void {
  const el = elements.get(v.id);
  if (!el || !adapter) return;
  if (!el.isConnected) {
    elements.delete(v.id);
    return;
  }
  verdicts.set(v.id, v);
  applyVerdict(el, adapter, v, settings, {
    onDismiss: (target, verdict) => {
      clearMarks(target, adapter);
      verdicts.set(verdict.id, { ...verdict, category: "aman", score: 0, reason: "ditandai aman oleh pengguna" });
      void recordFeedback(adapter.getText(target), verdict);
    },
  });
}

async function recordFeedback(text: string, v: Verdict): Promise<void> {
  const raw = await chrome.storage.local.get("feedback");
  const list = ((raw.feedback ?? []) as unknown[]).slice(-999);
  list.push({ text, predicted: v.category, score: v.score, source: v.source, label: "aman", platform: adapter?.platform, at: Date.now() });
  await chrome.storage.local.set({ feedback: list });
}

function scan(): void {
  if (!active() || !adapter) return;
  for (const el of adapter.findComments(document)) {
    const text = adapter.getText(el);
    if (!text) continue;
    const fingerprint = hashText(text);
    let id = el.dataset.rgId;
    if (id && el.dataset.rgFp !== fingerprint) {
      verdicts.delete(id);
      clearMarks(el, adapter);
      id = undefined;
    }
    if (!id) {
      id = `${prefix}${++seq}`;
      el.dataset.rgId = id;
      el.dataset.rgFp = fingerprint;
      elements.set(id, el);
      if (eager) queueForAnalysis(el);
      else visibility.observe(el);
    } else if (eager && !verdicts.has(id) && !outbox.has(id)) {
      queueForAnalysis(el);
    }
  }
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    sentFingerprints.clear();
    scheduleAutoScan();
  }
  if (elements.size > 4000) {
    for (const [id, el] of elements) {
      if (el.isConnected) continue;
      elements.delete(id);
      verdicts.delete(id);
    }
  }
}

const scanner = adapter
  ? new FastScanner({
      adapter,
      scanNow: () => {
        scan();
        return sentFingerprints.size;
      },
      setEager: (on) => {
        eager = on;
        if (!on) void flush();
      },
      max: () => settings.scan.max,
      replies: () => settings.scan.replies,
    })
  : null;

function scheduleAutoScan(): void {
  clearTimeout(autoScanTimer);
  if (!adapter || !active() || settings.scan.method !== "fast" || !adapter.isPostPage(new URL(location.href))) return;
  autoScanTimer = setTimeout(() => void scanner?.run(), 1800);
}

function scheduleScan(): void {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = undefined;
    scan();
  }, SCAN_THROTTLE_MS);
}

function start(): void {
  if (observer || !active()) return;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scan();
  scheduleAutoScan();
}

function stop(): void {
  scanner?.stop();
  clearTimeout(autoScanTimer);
  observer?.disconnect();
  observer = undefined;
  if (!adapter) return;
  for (const el of elements.values()) clearMarks(el, adapter);
}

function reapplyAll(): void {
  if (!adapter) return;
  for (const v of verdicts.values()) applyOne(v);
}

chrome.runtime.onMessage.addListener((msg: TabMsg, _sender, sendResponse) => {
  if (msg.type === "reportComment") {
    const el = elements.get(msg.commentId);
    if (!el?.isConnected || !adapter) {
      sendResponse({ stage: "none", reason: "", note: "Komentar sudah tidak ada di halaman (mungkin halaman berganti). Buka ulang komentarnya." });
      return;
    }
    el.classList.remove("rg-hidden-host");
    void runReportFlow(el, adapter, msg.verdict, () => {
      chrome.runtime.sendMessage({ type: "reportSubmitted", commentId: msg.commentId }).catch(() => undefined);
    }).then(sendResponse);
    return true;
  }
  if (msg.type === "fastScan") {
    if (!active()) {
      sendResponse({ ok: false, note: "Tempest nonaktif di situs ini." });
      return;
    }
    void scanner?.run();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "stopScan") scanner?.stop();
  if (msg.type === "verdicts") msg.verdicts.forEach(applyOne);
  if (msg.type === "focusComment") {
    const el = elements.get(msg.commentId);
    if (el?.isConnected) focusElement(el);
  }
  if (msg.type === "rescan") {
    verdicts.clear();
    for (const el of elements.values()) {
      if (adapter) clearMarks(el, adapter);
      delete el.dataset.rgId;
    }
    elements.clear();
    scan();
  }
});

if (adapter) {
  void loadSettings().then((s) => {
    settings = s;
    start();
  });
  onSettingsChanged((s) => {
    const prev = settings;
    settings = s;
    if (!active()) return stop();
    start();
    const modesChanged = prev.modes.judol !== s.modes.judol || prev.modes.toxic !== s.modes.toxic;
    if (modesChanged || prev.api.model !== s.api.model) {
      verdicts.clear();
      for (const el of elements.values()) {
        clearMarks(el, adapter);
        visibility.observe(el);
      }
    } else reapplyAll();
  });
}

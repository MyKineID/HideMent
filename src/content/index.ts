import { hashText } from "../core/normalize";
import { activeModes, DEFAULT_SETTINGS, loadSettings, onSettingsChanged, priorityOf, type Settings } from "../core/settings";
import { MODES, type CommentInput, type Verdict } from "../core/types";
import { send, type CollectedComment, type FastScanReply, type PostInfo, type TabMsg } from "../shared/messages";
import { detectAdapter } from "./adapters";
import { applyVerdict, clearMarks, focusElement } from "./overlay";
import { postIdOf } from "../core/links";
import { runReportFlow } from "./report-helper";
import { FastScanner, scrollerFor } from "./fast-scan";

const adapter = detectAdapter(location.hostname);

/* Setiap kali content script dipasang (termasuk setelah ekstensi di-reload), ia "mengklaim" halaman.
   Salinan lama yang koneksinya ke ekstensi sudah putus akan pensiun sendiri tanpa menghapus tanda di halaman. */
const TOKEN = Math.random().toString(36).slice(2);
document.documentElement.dataset.hidement = TOKEN;
let retired = false;

function orphaned(): boolean {
  return document.documentElement.dataset.hidement !== TOKEN || !chrome.runtime?.id;
}

function retire(): void {
  if (retired) return;
  retired = true;
  observer?.disconnect();
  observer = undefined;
  visibility.disconnect();
  clearTimeout(sendTimer);
  clearTimeout(scanTimer);
  clearTimeout(autoScanTimer);
  scanner?.stop();
}

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
/** Komentar unik (per fingerprint teks) yang sudah terlihat di postingan yang sedang dibuka; direset saat pindah halaman. */
const pageComments = new Map<string, { text: string; author: string }>();
/**
 * Hasil analisis per fingerprint teks. X & Instagram membuang komentar dari DOM saat digulir lalu membuatnya ulang;
 * dengan peta ini label langsung dipasang lagi tanpa dianalisis ulang, jadi saat scroll manual tinggal dilihat.
 */
const verdictByFp = new Map<string, Verdict>();
const VERDICT_MEMORY = 6000;
let lastUrl = location.href;
/** Postingan tempat pengguna sudah menekan Analyze (mode "manual"); di postingan lain tidak ada yang dianalisis. */
let armedPost: string | null = null;
const postKey = () => postIdOf(location.href) ?? location.href;

function analyzeAllowed(): boolean {
  return settings.scan.method !== "manual" || armedPost === postKey();
}
let autoScanTimer: ReturnType<typeof setTimeout> | undefined;

function active(): boolean {
  return Boolean(adapter && settings.enabled && settings.platforms[adapter.platform] && Object.values(activeModes(settings)).some(Boolean));
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
  outbox.set(id, { id, text, author: adapter.getAuthor(el), url: adapter.getPermalink(el) ?? undefined });
  clearTimeout(sendTimer);
  sendTimer = setTimeout(flush, outbox.size >= MAX_PER_MESSAGE ? 0 : SEND_DELAY_MS);
}

async function flush(): Promise<void> {
  if (orphaned()) return retire();
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
  /* Diingat walau elemennya sudah dibuang platform: saat komentar itu digambar ulang, labelnya langsung dipasang. */
  remember(el, v);
  if (!el.isConnected) {
    elements.delete(v.id);
    return;
  }
  verdicts.set(v.id, v);
  applyVerdict(el, adapter, v, settings, {
    onDismiss: (target, verdict) => {
      clearMarks(target, adapter);
      const safe: Verdict = { ...verdict, category: "aman", score: 0, reason: "ditandai aman oleh pengguna" };
      verdicts.set(verdict.id, safe);
      remember(target, safe);
      void recordFeedback(adapter.getText(target), verdict);
    },
  });
}

function remember(el: HTMLElement, v: Verdict): void {
  const fp = el.dataset.rgFp;
  if (!fp) return;
  verdictByFp.delete(fp);
  verdictByFp.set(fp, v);
  if (verdictByFp.size > VERDICT_MEMORY) verdictByFp.delete(verdictByFp.keys().next().value!);
}

/* Ditulis berurutan: klik "Bukan berbahaya" beruntun tidak boleh saling menimpa daftar di storage. */
let feedbackChain: Promise<void> = Promise.resolve();

function recordFeedback(text: string, v: Verdict): Promise<void> {
  const entry = { text, predicted: v.category, score: v.score, source: v.source, label: "aman", platform: adapter?.platform, at: Date.now() };
  feedbackChain = feedbackChain
    .then(async () => {
      const raw = await chrome.storage.local.get("feedback");
      const list = ((raw.feedback ?? []) as unknown[]).slice(-999);
      list.push(entry);
      await chrome.storage.local.set({ feedback: list });
    })
    .catch(() => undefined);
  return feedbackChain;
}

function scan(): void {
  if (orphaned()) return retire();
  if (!active() || !adapter) return;
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    pageComments.clear();
    scheduleAutoScan();
  }
  if (!analyzeAllowed()) return;
  for (const el of adapter.findComments(document)) {
    const text = adapter.getText(el);
    if (!text) continue;
    const fingerprint = hashText(text);
    if (!pageComments.has(fingerprint)) pageComments.set(fingerprint, { text, author: adapter.getAuthor(el) });
    let id = el.dataset.rgId;
    if (id && !elements.has(id)) id = undefined;
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
      const known = verdictByFp.get(fingerprint);
      if (known) applyOne({ ...known, id });
      else if (eager) queueForAnalysis(el);
      else visibility.observe(el);
    } else if (eager && !verdicts.has(id) && !outbox.has(id)) {
      queueForAnalysis(el);
    }
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
        return pageComments.size;
      },
      setEager: (on) => {
        eager = on;
        if (!on) void flush();
      },
      max: () => settings.scan.max,
      replies: () => settings.scan.replies,
      total: () => adapter.getCommentCount(document, new URL(location.href)),
    })
  : null;

function scheduleAutoScan(): void {
  clearTimeout(autoScanTimer);
  if (!adapter || !active() || settings.scan.method !== "fast" || !adapter.isPostPage(new URL(location.href))) return;
  autoScanTimer = setTimeout(() => void scanner?.run(), 1800);
}

/**
 * Cari komentar: lewat id dulu, lalu teksnya. Kalau sudah dihapus dari DOM (X/TikTok), gulir wadah komentar
 * (panel komentar TikTok/Instagram, atau jendela untuk YouTube/X) untuk mencarinya, jadi pengguna tidak perlu scroll sendiri.
 */
async function findComment(id: string, text: string, mode: "dom" | "scroll" = "scroll"): Promise<HTMLElement | null> {
  if (!adapter) return null;
  const byId = elements.get(id);
  if (byId?.isConnected) return byId;
  const needle = text.trim().slice(0, 120);
  const byText = () => adapter.findComments(document).find((el) => adapter.getText(el).startsWith(needle)) ?? null;
  let hit = byText();
  if (hit) return hit;
  if (mode === "dom") {
    /* Halaman link komentar baru saja dibuka: tunggu sebentar sampai komentarnya digambar, tanpa menggulir. */
    for (let i = 0; i < 16 && !hit; i++) {
      await new Promise((r) => setTimeout(r, 250));
      hit = byText();
    }
    return hit;
  }
  if (adapter.openComments?.(document)) {
    for (let i = 0; i < 15 && !adapter.findComments(document).length; i++) await new Promise((r) => setTimeout(r, 300));
    if ((hit = byText())) return hit;
  }
  const comments = adapter.findComments(document);
  const box = scrollerFor(comments[comments.length - 1]);
  const getY = () => (box ? box.scrollTop : scrollY);
  const setY = (y: number) => (box ? (box.scrollTop = y) : window.scrollTo({ top: y }));
  const startY = getY();
  setY(0);
  for (let i = 0; i < 60 && !hit; i++) {
    await new Promise((r) => setTimeout(r, 300));
    hit = byText();
    if (hit) break;
    const before = getY();
    setY(before + (box ? box.clientHeight : innerHeight) * 0.8);
    if (getY() === before) break;
  }
  if (!hit) setY(startY);
  return hit;
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

/** Ringkasan postingan yang sedang dibuka untuk popup & side panel: jumlah komentar platform dan sebaran label. */
function postInfo(): PostInfo {
  const url = new URL(location.href);
  const info: PostInfo = {
    isPost: Boolean(adapter?.isPostPage(url)),
    total: adapter?.getCommentCount(document, url) ?? null,
    seen: pageComments.size,
    analyzed: false,
    aman: 0,
    sedang: 0,
    tinggi: 0,
  };
  info.analyzed = analyzeAllowed();
  if (!info.analyzed) return info;
  for (const fp of pageComments.keys()) {
    const v = verdictByFp.get(fp);
    if (!v) continue;
    const p = v.category === "aman" ? "rendah" : priorityOf(v.score, settings.thresholds);
    info[p === "rendah" ? "aman" : p]++;
  }
  return info;
}

function collect(): CollectedComment[] {
  return [...pageComments].map(([fp, c]) => ({ ...c, verdict: verdictByFp.get(fp) }));
}

function reapplyAll(): void {
  if (!adapter) return;
  for (const v of verdicts.values()) applyOne(v);
}

chrome.runtime.onMessage.addListener((msg: TabMsg, _sender, sendResponse) => {
  if (retired) return;
  if (msg.type === "ping") {
    sendResponse({ ok: true, platform: adapter?.platform ?? null, active: active() });
    return;
  }
  if (msg.type === "postInfo") {
    sendResponse(postInfo());
    return;
  }
  if (msg.type === "collect") {
    sendResponse(collect());
    return;
  }
  if (msg.type === "reportComment") {
    armedPost = postKey();
    void findComment(msg.commentId, msg.text, msg.find).then((el) => {
      if (!el || !adapter) {
        sendResponse({
          stage: "none",
          reason: "",
          note: "Komentar ini tidak ditemukan lagi di halaman (mungkin halaman berganti). Buka ulang postingannya.",
          missing: msg.find === "dom",
        });
        return;
      }
      el.classList.remove("rg-hidden-host");
      void runReportFlow(el, adapter, msg.verdict, {
        auto: msg.auto,
        onSubmitted: () => chrome.runtime.sendMessage({ type: "reportSubmitted", commentId: msg.commentId }).catch(() => undefined),
      }).then(sendResponse);
    });
    return true;
  }
  if (msg.type === "fastScan") {
    const reply = (r: FastScanReply) => sendResponse(r);
    if (!active() || !adapter) return reply({ ok: false, note: "HideMent nonaktif di situs ini." });
    if (!adapter.isPostPage(new URL(location.href))) {
      return reply({ ok: false, note: "Masuk ke postingannya dulu (buka satu video/postingan), lalu klik Analyze lagi." });
    }
    armedPost = postKey();
    void scanner?.run();
    reply({ ok: true, total: adapter.getCommentCount(document, new URL(location.href)) });
    return;
  }
  if (msg.type === "stopScan") scanner?.stop();
  if (msg.type === "verdicts") msg.verdicts.forEach(applyOne);
  if (msg.type === "focusComment") {
    void findComment(msg.commentId, msg.text).then((el) => {
      if (el) focusElement(el);
      sendResponse(Boolean(el));
    });
    return true;
  }
  if (msg.type === "rescan") {
    verdicts.clear();
    verdictByFp.clear();
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
    const [was, now] = [activeModes(prev), activeModes(s)];
    const modesChanged = MODES.some((m) => was[m] !== now[m]) || (now.kustom && prev.custom.definition !== s.custom.definition);
    if (modesChanged || prev.api.model !== s.api.model) {
      verdicts.clear();
      verdictByFp.clear();
      for (const el of elements.values()) {
        clearMarks(el, adapter);
        visibility.observe(el);
      }
    } else reapplyAll();
  });
}

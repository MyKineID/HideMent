import { DecisionEngine } from "../core/engine";
import { activeModes, DEFAULT_SETTINGS, loadSettings, onSettingsChanged, priorityOf, type Settings } from "../core/settings";
import { EXAMPLES_KEY, learningExamples, type Example } from "../core/examples";
import type { CommentInput, Platform, QueueItem, Verdict } from "../core/types";
import { hashText } from "../core/normalize";
import { postIdOf } from "../core/links";
import type { Msg, ReportResult, StatusInfo, TabMsg } from "../shared/messages";

let settings: Settings = DEFAULT_SETTINGS;
const ready = loadSettings().then((s) => (settings = s));
onSettingsChanged((s) => {
  const turnedOn = s.report.autoQueue && !settings.report.autoQueue;
  const learnChanged = s.learn.enabled !== settings.learn.enabled || s.learn.includeFeedback !== settings.learn.includeFeedback;
  settings = s;
  if (learnChanged) engineDirty = true;
  if (turnedOn) {
    for (const q of queue) if (q.priority === "tinggi" && !q.report) q.report = "pending";
    flushQueue();
  }
});

/* ── mesin keputusan lokal ─────────────────────────────────────────────
 * Dibangun ulang (melatih Naive Bayes dari seed + contoh belajar, puluhan milidetik) hanya saat contoh,
 * catatan "Bukan berbahaya", atau saklar belajar berubah; bukan per komentar. */
let examples: Example[] = [];
let feedback: { text?: string; label?: string }[] = [];
let engine: DecisionEngine | null = null;
let engineDirty = true;
const engineStats = { analyzed: 0, totalUs: 0 };

const examplesReady = chrome.storage.local.get([EXAMPLES_KEY, "feedback"]).then((r) => {
  examples = (r[EXAMPLES_KEY] ?? []) as Example[];
  feedback = (r.feedback ?? []) as typeof feedback;
});

/** Beberapa komentar pemanasan supaya penilaian pertama tidak menanggung waktu kompilasi JIT (tidak dihitung di statistik). */
const WARMUP = ["Dasar goblok lu, muka kayak monyet", "Videonya bagus banget kak", "cek bio aku ya, wd 2jt", "Orang [suku X] licik semua", "Open BO kak? 🤤"];
const ALL_MODES = { judol: true, kebencian: true, pelecehan: true, agama: true, sara: true, kustom: false };

function getEngine(): DecisionEngine {
  if (!engine || engineDirty) {
    engine = new DecisionEngine({ examples: learningExamples(examples, feedback, settings.learn) });
    for (const text of WARMUP) engine.decide({ id: "warmup", text }, { modes: ALL_MODES });
    engineDirty = false;
  }
  return engine;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[EXAMPLES_KEY]) examples = (changes[EXAMPLES_KEY].newValue ?? []) as Example[];
  if (changes.feedback) feedback = (changes.feedback.newValue ?? []) as typeof feedback;
  if (changes[EXAMPLES_KEY] || changes.feedback) engineDirty = true;
});

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


function isWhitelisted(author?: string): boolean {
  if (!author) return false;
  const a = author.toLowerCase().replace(/^@/, "");
  return settings.whitelist.some((w) => w.toLowerCase().replace(/^@/, "") === a);
}

async function analyze(tabId: number, platform: Platform, url: string, comments: CommentInput[]): Promise<Verdict[]> {
  await Promise.all([ready, queueReady, examplesReady]);
  const modes = activeModes(settings);
  /* Tidak ada mode yang dinyalakan: tidak ada yang perlu dinilai (sama seperti sebelumnya, komentar tidak diberi label). */
  if (!Object.values(modes).some(Boolean)) return [];
  const e = getEngine();
  const ctx = { modes, custom: settings.custom, customKeywords: settings.customKeywords };
  const out: Verdict[] = [];
  for (const c of comments) {
    if (isWhitelisted(c.author)) {
      out.push({ id: c.id, mode: "judol", category: "aman", score: 0, reason: "akun di whitelist", source: "rule" });
      continue;
    }
    const d = e.decide(c, ctx);
    engineStats.analyzed++;
    engineStats.totalUs += d.us;
    out.push(d.verdict);
    record(tabId, platform, url, c, d.verdict);
  }
  return out;
}

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  switch (msg.type) {
    case "analyze": {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return [];
      return analyze(tabId, msg.platform, msg.url, msg.comments);
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
        throw new Error("Tab ini belum tersambung ke HideMent. Refresh halamannya lalu coba lagi.");
      }
      const item = queue.find((q) => q.key === msg.key);
      if (!item) throw new Error("Komentar tidak ada di antrian");
      let tab: chrome.tabs.Tab | undefined;
      try {
        tab = await chrome.tabs.update(item.tabId, { active: true });
      } catch {
        throw new Error("Tab komentar ini sudah ditutup. Buka lagi halamannya.");
      }
      const report = (find: "dom" | "scroll") =>
        chrome.tabs.sendMessage(item.tabId, {
          type: "reportComment", commentId: item.commentId, text: item.text, verdict: item.verdict, auto: msg.auto, find,
        } satisfies TabMsg) as Promise<ReportResult | undefined>;
      /*
       * Urutan supaya terasa instan dan halaman tidak digulir:
       * 1. komentarnya masih ada di halaman yang tampil → langsung buka menu lapornya;
       * 2. tidak ada, tapi punya link sendiri (X, YouTube, IG) → buka link komentar itu, lalu lapor di sana;
       * 3. tanpa link (TikTok) → buka lagi postingannya dan cari di panel komentar.
       */
      const permalink = item.url && item.url !== item.pageUrl ? item.url : null;
      let res = await report("dom");
      if (res?.missing && permalink) {
        if (!samePage(tab?.url, permalink)) await openAndWait(item.tabId, permalink);
        res = await report("dom");
      }
      if (!res || res.missing) {
        await reopenPost(item.tabId, (await chrome.tabs.get(item.tabId).catch(() => tab))?.url, item.pageUrl);
        res = await report("scroll");
      }
      if (!res) throw new Error("Halaman belum siap. Refresh tab lalu coba lagi.");
      return res;
    }
    case "tryEngine": {
      /* "Coba mesin" di Pengaturan: nilai satu kalimat dengan mesin & contoh belajar yang sama, semua mode aktif ditampilkan. */
      await examplesReady;
      const modes = activeModes(settings);
      const anyOn = Object.values(modes).some(Boolean);
      return getEngine().decide(
        { id: "uji", text: msg.text },
        { modes: anyOn ? modes : { ...modes, judol: true }, custom: settings.custom, customKeywords: settings.customKeywords },
      );
    }
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
      await examplesReady;
      const e = getEngine();
      const info: StatusInfo = {
        tabCounts: tabId !== undefined ? { ...countsFor(tabId) } : { scanned: 0, high: 0, medium: 0 },
        engine: {
          examples: e.stats.examples,
          seed: e.stats.seed,
          analyzed: engineStats.analyzed,
          avgUs: engineStats.analyzed ? Math.round(engineStats.totalUs / engineStats.analyzed) : 0,
        },
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

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCounts.delete(tabId);
});
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

function waitTabLoaded(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/** Halaman yang sama: path dan parameter penentu isi (YouTube: v & lc) sama, query pelacak diabaikan. */
function samePage(a: string | undefined, b: string): boolean {
  if (!a) return false;
  try {
    const [x, y] = [new URL(a), new URL(b)];
    const key = (u: URL) => `${u.host}${u.pathname.replace(/\/$/, "")}?v=${u.searchParams.get("v") ?? ""}&lc=${u.searchParams.get("lc") ?? ""}`;
    return key(x) === key(y);
  } catch {
    return false;
  }
}

async function openAndWait(tabId: number, url: string): Promise<void> {
  const loaded = waitTabLoaded(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
  await ensureContent(tabId);
}

/** Tab sudah pindah ke postingan lain sejak komentar ini dianalisis: buka lagi postingan asalnya sebelum melapor. */
async function reopenPost(tabId: number, current: string | undefined, pageUrl: string | undefined): Promise<void> {
  if (!pageUrl || !current) return;
  const [now, then] = [postIdOf(current), postIdOf(pageUrl)];
  if (!then || now === then) return;
  await chrome.tabs.update(tabId, { url: pageUrl });
  await waitTabLoaded(tabId);
  await ensureContent(tabId);
  await new Promise((r) => setTimeout(r, 2500));
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

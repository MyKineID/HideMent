import { verdictLabel, type Mode, type QueueItem, type ReportStatus } from "../core/types";
import {
  send,
  type BroadcastMsg,
  type CollectedComment,
  type FastScanReply,
  type PostInfo,
  type ReportResult,
  type ScanProgress,
  type StatusInfo,
  type TabMsg,
} from "../shared/messages";
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type Settings } from "../core/settings";
import { EXAMPLES_KEY, mergeExamples, type Example } from "../core/examples";
import { autoReportCandidates, learnFromComments, reviewedLabel, reviewExample, reviewMap, toDatasetRow, toJsonl, type ReviewMap } from "../core/dataset";
import { extractPostLinks, type PostLink } from "../core/links";
import { $, download } from "../shared/dom";
import { hydrateIcons, icon } from "../shared/icons";
import { confirmDialog, enhanceAll } from "../shared/ui";

const PLATFORM_LABEL: Record<QueueItem["platform"], string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", x: "X" };
const SUPPORTED_RE = /^https:\/\/(www\.|m\.)?(youtube|instagram|tiktok|x|twitter)\.com\//;
/** Jeda antar laporan otomatis supaya platform tidak menganggapnya spam dan form sempat tertutup rapi. */
const REPORT_GAP_MS = 2500;
const AUTO_REPORT_MAX = 50;

let queue: QueueItem[] = [];
let mode: "all" | Mode = "all";
let settings: Settings = DEFAULT_SETTINGS;
let reportingKey: string | null = null;
let reviews: ReviewMap = new Map();

const RTAG: Record<ReportStatus, string> = { pending: "Menunggu lapor", done: "Sudah dilapor", skipped: "Dilewati", failed: "Gagal lapor" };

const list = $("#list");
const tpl = $<HTMLTemplateElement>("#itemTpl");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => n.toLocaleString("id-ID");

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s} dtk lalu`;
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  return `${Math.round(s / 3600)} jam lalu`;
}

function filtered(): QueueItem[] {
  const prio = $<HTMLSelectElement>("#prioFilter").value;
  const sort = $<HTMLSelectElement>("#sort").value;
  const q = $<HTMLInputElement>("#search").value.trim().toLowerCase();
  const rows = queue.filter(
    (it) =>
      (mode === "all" || it.verdict.mode === mode) &&
      (prio === "all" || it.priority === prio) &&
      (!q || it.text.toLowerCase().includes(q) || it.author.toLowerCase().includes(q)),
  );
  return rows.sort((a, b) => (sort === "time" ? b.at - a.at : b.verdict.score - a.verdict.score || b.at - a.at));
}

/* ── lapor ─────────────────────────────────────────────── */

interface AutoRun {
  total: number;
  done: number;
  sent: number;
  failed: number;
  abort: boolean;
}

let auto: AutoRun | null = null;
let result: { text: string; tone: "ok" | "err" } | null = null;

function renderReportBar(): void {
  const bar = $("#rbar");
  const candidates = autoReportCandidates(queue, reviews);
  const done = queue.filter((q) => q.report === "done").length;
  bar.hidden = !settings.report.autoQueue && !reportingKey && !candidates.length && !result;
  $("#rCount").textContent = candidates.length
    ? `${candidates.length} prioritas tinggi siap dilapor · ${done} sudah dilapor`
    : done
      ? `Semua beres · ${done} sudah dilapor`
      : "Komentar prioritas tinggi akan muncul di sini.";
  const rAuto = $<HTMLButtonElement>("#rAuto");
  rAuto.disabled = !candidates.length || Boolean(auto) || linkRunning;
  rAuto.querySelector(".lbl")!.textContent = candidates.length ? `Laporkan semua otomatis (${candidates.length})` : "Laporkan semua otomatis";
  $<HTMLButtonElement>("#rNext").disabled = !candidates.length || linkRunning;

  const active = queue.find((q) => q.key === reportingKey);
  $("#rIdle").hidden = Boolean(active);
  $("#rActive").hidden = !active;
  $("#rManual").hidden = Boolean(auto);
  $("#rMeter").hidden = !auto;
  if (auto) $("#rFill").style.width = `${(auto.done / Math.max(1, auto.total)) * 100}%`;
  if (active) $("#rTarget").textContent = `@${active.author || "anonim"} · ${verdictLabel(active.verdict)} ${active.verdict.score}`;

  const res = $("#rResult");
  res.hidden = !result || Boolean(active);
  if (result) {
    res.textContent = result.text;
    res.dataset.tone = result.tone;
  }
}

function setNote(text: string, err = false): void {
  const n = $("#rNote");
  n.textContent = text;
  n.classList.toggle("err", err);
}

async function startReport(it: QueueItem): Promise<void> {
  reportingKey = it.key;
  result = null;
  setNote("Membuka menu laporan di halaman…");
  render();
  try {
    const r = await send<ReportResult>({ type: "startReport", key: it.key });
    const msg = {
      sent: `Laporan terkirim dengan alasan "${r.reason}".`,
      submit: `Alasan "${r.reason}" sudah dipilih dan tombol kirim sudah difokuskan. Tekan Enter atau klik Kirim di halaman. HideMent lanjut otomatis setelah itu.`,
      reason: `Alasan "${r.reason}" sudah dipilih. Periksa di halaman, tekan Berikutnya / Kirim, lalu klik "Sudah dilapor".`,
      dialog: `Form laporan sudah terbuka. Pilih alasan "${r.reason}", kirim, lalu klik "Sudah dilapor".`,
      menu: `Menu sudah dibuka. Pilih "Laporkan", lalu "${r.reason}", kirim, lalu klik "Sudah dilapor".`,
      none: r.note || "Tidak bisa membuka menu laporan otomatis.",
    }[r.stage];
    setNote(msg, r.stage === "none");
  } catch (e) {
    setNote((e as Error).message, true);
  }
}

async function finishReport(status: "done" | "skipped"): Promise<void> {
  if (!reportingKey) return;
  const key = reportingKey;
  const item = queue.find((q) => q.key === key);
  if (item) item.report = status;
  reportingKey = null;
  await send({ type: "setReportStatus", key, status });
  const next = autoReportCandidates(queue, reviews)[0];
  if (next) await startReport(next);
  else render();
}

/**
 * Lapor otomatis: HideMent membuka menu, memilih alasan, MENEKAN KIRIM, dan menunggu konfirmasi platform
 * untuk setiap komentar. Komentar yang alasannya tidak cocok otomatis ditandai "Gagal lapor", tidak dikirim.
 */
async function runAutoReport(items: QueueItem[], onStep?: (run: AutoRun) => void): Promise<AutoRun> {
  const targets = items.slice(0, AUTO_REPORT_MAX);
  const run: AutoRun = { total: targets.length, done: 0, sent: 0, failed: 0, abort: false };
  auto = run;
  result = null;
  for (const it of targets) {
    if (run.abort) break;
    reportingKey = it.key;
    setNote(`Melapor otomatis ${run.done + 1} dari ${run.total} · ${run.sent} sukses${run.failed ? ` · ${run.failed} gagal` : ""}`);
    render();
    const r = await send<ReportResult>({ type: "startReport", key: it.key, auto: true }).catch(
      (e: Error): ReportResult => ({ stage: "none", reason: "", note: e.message }),
    );
    const status: ReportStatus = r.stage === "sent" ? "done" : "failed";
    it.report = status;
    if (status === "done") run.sent++;
    else run.failed++;
    run.done++;
    await send({ type: "setReportStatus", key: it.key, status }).catch(() => undefined);
    onStep?.(run);
    render();
    if (!run.abort && run.done < run.total) await sleep(REPORT_GAP_MS);
  }
  reportingKey = null;
  auto = null;
  render();
  return run;
}

function reportSummary(run: Pick<AutoRun, "sent" | "failed">, left = 0): { text: string; tone: "ok" | "err" } | null {
  if (!run.sent && !run.failed) return null;
  if (!run.sent) {
    return { tone: "err", text: `Gagal melapor ${run.failed} komentar. Pastikan sudah login di platformnya, lalu coba "Satu per satu".` };
  }
  const extra = [run.failed ? `${run.failed} gagal (bisa dilapor manual)` : "", left ? `${left} sisanya belum, klik lagi untuk lanjut` : ""].filter(Boolean);
  return { tone: "ok", text: `Sukses! ${run.sent} komentar berhasil dilaporkan${extra.length ? `. ${extra.join(", ")}` : ""}.` };
}

$("#rAuto").addEventListener("click", async () => {
  const candidates = autoReportCandidates(queue, reviews);
  if (!candidates.length || auto) return;
  const n = Math.min(candidates.length, AUTO_REPORT_MAX);
  const ok = await confirmDialog({
    title: "Laporkan otomatis",
    message:
      `HideMent akan MENGIRIM laporan untuk ${n} komentar prioritas tinggi memakai akunmu di platform itu, satu per satu. ` +
      `Komentar yang alasannya tidak cocok otomatis tidak dikirim. Tandai "Salah, aman" dulu kalau ada deteksi yang keliru.`,
    confirmText: `Laporkan ${n} komentar`,
    danger: true,
  });
  if (!ok) return;
  const run = await runAutoReport(candidates);
  result = reportSummary(run, candidates.length - run.done);
  render();
});
$("#rNext").addEventListener("click", () => {
  const next = autoReportCandidates(queue, reviews)[0];
  if (next) void startReport(next);
});
$("#rDone").addEventListener("click", () => void finishReport("done"));
$("#rSkip").addEventListener("click", () => void finishReport("skipped"));
$("#rStop").addEventListener("click", () => {
  if (auto) {
    auto.abort = true;
    setNote("Berhenti setelah laporan yang sedang berjalan…");
    return;
  }
  reportingKey = null;
  render();
});

/* ── data belajar AI ───────────────────────────────────── */

async function addExamples(incoming: Example[]): Promise<void> {
  if (!incoming.length) return;
  const raw = await chrome.storage.local.get(EXAMPLES_KEY);
  const next = mergeExamples((raw[EXAMPLES_KEY] ?? []) as Example[], incoming);
  await chrome.storage.local.set({ [EXAMPLES_KEY]: next });
}

const review = (it: QueueItem, correct: boolean) => addExamples([reviewExample(it, correct)]);

function setExamples(examples: Example[]): void {
  reviews = reviewMap(examples);
  render();
}

void chrome.storage.local.get(EXAMPLES_KEY).then((r) => setExamples((r[EXAMPLES_KEY] ?? []) as Example[]));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[EXAMPLES_KEY]) setExamples((changes[EXAMPLES_KEY].newValue ?? []) as Example[]);
});

/* ── daftar ────────────────────────────────────────────── */

/* Kartu dipakai ulang per kunci (bukan dibuat ulang) supaya tombol yang sedang diklik tidak terganti
   saat antrian diperbarui setiap beberapa ratus milidetik ketika memindai. */
const nodes = new Map<string, HTMLElement>();
let pointerDown = false;
let renderPending = false;

function setText(el: Element | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function makeNode(it: QueueItem): HTMLElement {
  const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
  node.dataset.key = it.key;
  const plat = node.querySelector<HTMLElement>(".plat-ico")!;
  plat.innerHTML = icon(it.platform, 13);
  plat.title = PLATFORM_LABEL[it.platform];
  const text = node.querySelector<HTMLElement>(".text")!;
  const toggle = () => text.setAttribute("aria-expanded", String(text.classList.toggle("open")));
  text.addEventListener("click", toggle);
  text.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle();
  });
  hydrateIcons(node);
  return node;
}

function fillNode(node: HTMLElement, it: QueueItem): void {
  const learned = reviewedLabel(reviews, it);
  node.className = `item ${it.priority} ${it.verdict.mode}${it.key === reportingKey ? " reporting" : ""}${learned === "aman" ? " wrong" : ""}`;
  setText(node.querySelector(".prio"), it.priority === "tinggi" ? "Tinggi" : "Sedang");
  setText(node.querySelector(".cat"), verdictLabel(it.verdict));
  setText(node.querySelector(".score"), String(it.verdict.score));
  setText(node.querySelector(".author"), it.author ? `@${it.author}` : "anonim");
  setText(node.querySelector(".time"), ago(it.at));
  setText(node.querySelector(".text"), it.text);
  setText(node.querySelector(".reason"), `${it.verdict.reason || "—"} (${it.verdict.source === "rule" ? "aturan lokal" : "AI"})`);
  const rtag = node.querySelector<HTMLElement>(".rtag")!;
  rtag.hidden = !it.report;
  if (it.report) {
    rtag.className = `rtag ${it.report}`;
    setText(rtag, RTAG[it.report]);
  }
  const ltag = node.querySelector<HTMLElement>(".ltag")!;
  ltag.hidden = !learned;
  ltag.className = `ltag${learned === "aman" ? " wrong" : ""}`;
  setText(ltag, learned === "aman" ? "Data AI: aman" : "Data AI: benar");
  node.querySelector('[data-a="right"]')!.setAttribute("aria-pressed", String(Boolean(learned) && learned !== "aman"));
  node.querySelector('[data-a="wrong"]')!.setAttribute("aria-pressed", String(learned === "aman"));
  node.querySelector<HTMLElement>('[data-a="report"]')!.hidden = !settings.report.assist && !settings.report.autoQueue;
}

function render(): void {
  if (pointerDown) {
    renderPending = true;
    return;
  }
  renderReportBar();
  renderLinks();
  scanBtn.disabled = scanning || linkRunning;
  const rows = filtered();
  const high = queue.filter((q) => q.priority === "tinggi").length;
  $("#total").innerHTML = `<b>${queue.length}</b>komentar`;
  const tag = $("#highTag");
  tag.hidden = high === 0;
  tag.innerHTML = `<b>${high}</b>tinggi`;
  $("#empty").hidden = rows.length > 0;
  list.hidden = rows.length === 0;
  $("#emptyText").textContent = queue.length
    ? "Tidak ada komentar yang cocok dengan filter ini."
    : 'Belum ada komentar berbahaya. Buka satu postingan lalu klik "Analyze komentar postingan ini", atau tempel link di "Analyze dari link".';

  const keep = new Set(rows.map((r) => r.key));
  for (const [key, node] of nodes) {
    if (!keep.has(key)) {
      node.remove();
      nodes.delete(key);
    }
  }
  rows.forEach((it, i) => {
    let node = nodes.get(it.key);
    if (!node) nodes.set(it.key, (node = makeNode(it)));
    fillNode(node, it);
    if (list.children[i] !== node) list.insertBefore(node, list.children[i] ?? null);
  });
}

list.addEventListener("pointerdown", () => (pointerDown = true));
addEventListener("pointerup", () => {
  pointerDown = false;
  if (renderPending) {
    renderPending = false;
    setTimeout(render, 0);
  }
});

function flash(btn: HTMLButtonElement, label: string, ms = 1800): void {
  const span = btn.querySelector<HTMLElement>(".lbl") ?? btn;
  const prev = span.dataset.label ?? span.textContent ?? "";
  span.dataset.label = prev;
  span.textContent = label;
  setTimeout(() => (span.textContent = prev), ms);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

list.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-a]");
  const key = btn?.closest<HTMLElement>(".item")?.dataset.key;
  const it = queue.find((q) => q.key === key);
  if (!btn || !it) return;
  switch (btn.dataset.a) {
    case "report":
      if (auto) return;
      if (it.report !== "pending") {
        it.report = "pending";
        await send({ type: "setReportStatus", key: it.key, status: "pending" });
      }
      await startReport(it);
      break;
    case "focus": {
      if (it.url && it.url !== it.pageUrl) {
        const src = await chrome.tabs.get(it.tabId).catch(() => null);
        await chrome.tabs.create({ url: it.url, active: true, ...(src ? { index: src.index + 1, windowId: src.windowId, openerTabId: src.id } : {}) });
        flash(btn, "Dibuka");
        break;
      }
      flash(btn, "Mencari…", 8000);
      const found = await send<boolean>({ type: "focusComment", tabId: it.tabId, commentId: it.commentId, text: it.text }).catch(() => null);
      if (found === null) {
        await chrome.tabs.create({ url: it.url });
        flash(btn, "Dibuka");
      } else flash(btn, found ? "Ketemu" : "Tidak ada");
      break;
    }
    case "copy": {
      const ok = await copyText(`[${verdictLabel(it.verdict)} ${it.verdict.score}] @${it.author}: ${it.text}\n${it.url}`);
      flash(btn, ok ? "Disalin" : "Gagal");
      break;
    }
    case "done":
      queue = queue.filter((q) => q.key !== it.key);
      render();
      await send({ type: "removeQueueItem", key: it.key });
      break;
    case "right":
    case "wrong":
      await review(it, btn.dataset.a === "right");
      flash(btn, "Disimpan ke data AI");
      break;
  }
});

$("#modeFilter").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-v]");
  if (!b) return;
  mode = b.dataset.v as typeof mode;
  $("#modeFilter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  render();
});
["#prioFilter", "#sort"].forEach((s) => $(s).addEventListener("change", render));
$("#search").addEventListener("input", render);

$("#clear").addEventListener("click", async () => {
  if (!queue.length) return;
  const ok = await confirmDialog({
    title: "Konfirmasi",
    message: `Kosongkan ${queue.length} komentar dari antrian? Komentar di halaman tetap ditandai.`,
    confirmText: "Kosongkan",
    danger: true,
  });
  if (!ok) return;
  await send({ type: "clearQueue" });
  queue = [];
  result = null;
  render();
});

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$("#exportCsv").addEventListener("click", () => {
  const head = ["waktu", "platform", "akun", "mode", "kategori", "skor", "prioritas", "sumber", "alasan", "teks", "url"];
  const rows = filtered().map((it) =>
    [new Date(it.at).toISOString(), it.platform, it.author, it.verdict.mode, it.verdict.category, it.verdict.score, it.priority, it.verdict.source, it.verdict.reason, it.text, it.url]
      .map(csvCell)
      .join(","),
  );
  download(`hidement-antrian-${Date.now()}.csv`, "﻿" + [head.join(","), ...rows].join("\n"), "text/csv");
});

/** Dataset untuk evaluasi/riset (format sama dengan research/dataset): label hasil cek pengguna kalau ada. */
$("#exportData").addEventListener("click", (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  const rows = filtered().map((it) => toDatasetRow(it, reviews));
  if (!rows.length) return flash(btn, "Kosong");
  download(`hidement-dataset-${Date.now()}.jsonl`, toJsonl(rows), "application/x-ndjson");
});

/* ── Analyze komentar postingan ini ────────────────────── */

let scanTab: number | undefined;
let scanning = false;
const scanBtn = $<HTMLButtonElement>("#fastScan");
const scanLabel = scanBtn.querySelector<HTMLElement>(".lbl")!;
const stopBtn = $<HTMLButtonElement>("#stopScan");
const scanStatus = $("#scanStatus");

/** Pesan penting (gagal, perlu login) ditahan sebentar supaya tidak langsung tertimpa ringkasan postingan. */
let noteUntil = 0;

function showScanNote(text: string): void {
  scanStatus.hidden = false;
  scanStatus.textContent = text;
  noteUntil = Date.now() + 6000;
}

/** Ringkasan postingan di tab aktif: jumlah komentar menurut platform + berapa yang sudah dianalisis dan labelnya. */
async function refreshPostInfo(): Promise<void> {
  if (scanning || linkRunning || Date.now() < noteUntil) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !SUPPORTED_RE.test(tab.url ?? "")) return;
  const info = (await chrome.tabs.sendMessage(tab.id, { type: "postInfo" } satisfies TabMsg).catch(() => null)) as PostInfo | null;
  if (!info || scanning || linkRunning) return;
  scanStatus.hidden = false;
  if (!info.isPost) {
    scanStatus.textContent = "Buka satu postingan/video untuk menganalisis komentarnya.";
    $("#scanMeter").hidden = true;
    return;
  }
  const labeled = info.aman + info.sedang + info.tinggi;
  scanStatus.innerHTML = info.total != null ? `<b>${fmt(info.total)}</b>` : `<b>${fmt(info.seen)}</b>`;
  scanStatus.append(
    info.total != null ? "komentar di postingan ini" : "komentar terlihat",
    labeled ? ` · ${fmt(labeled)} dianalisis: ${info.aman} aman · ${info.sedang} sedang · ${info.tinggi} tinggi` : info.analyzed ? " · menganalisis…" : " · tekan Analyze untuk mendeteksi",
  );
  $("#scanMeter").hidden = info.total == null;
  if (info.total) $("#scanFill").style.width = `${Math.min(100, (labeled / info.total) * 100)}%`;
}

/** Sambungkan ke tab lalu minta content script menganalisis semua komentar postingan yang sedang dibuka. */
async function analyzeTab(tabId: number): Promise<FastScanReply> {
  if (!(await send<boolean>({ type: "ensureContent", tabId }).catch(() => false))) {
    return { ok: false, note: "HideMent belum tersambung ke tab ini. Refresh halamannya (F5), lalu coba lagi." };
  }
  scanTab = tabId;
  const r = (await chrome.tabs.sendMessage(tabId, { type: "fastScan" } satisfies TabMsg).catch(() => null)) as FastScanReply | null;
  return r ?? { ok: false, note: "Halaman belum siap. Refresh tab lalu coba lagi." };
}

scanBtn.addEventListener("click", async () => {
  if (scanning || linkRunning) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return;
  if (!SUPPORTED_RE.test(tab.url ?? "")) return showScanNote("Tab aktif bukan YouTube / Instagram / TikTok / X.");
  showScanNote("Menyambungkan ke postingan…");
  const r = await analyzeTab(tab.id);
  if (!r.ok) return showScanNote(r.note ?? "Gagal menganalisis.");
  if (r.total) showScanNote(`Postingan ini punya ${fmt(r.total)} komentar. Menganalisis…`);
});
stopBtn.addEventListener("click", () => {
  if (scanTab !== undefined) chrome.tabs.sendMessage(scanTab, { type: "stopScan" } satisfies TabMsg).catch(() => undefined);
});

function renderScan(msg: ScanProgress): void {
  scanning = msg.state === "running";
  scanBtn.disabled = scanning || linkRunning;
  scanBtn.classList.toggle("busy", scanning);
  scanLabel.textContent = scanning ? "Menganalisis komentar…" : "Analyze komentar postingan ini";
  stopBtn.hidden = !scanning;
  $("#scanMeter").hidden = false;
  $("#scanFill").style.width = `${Math.min(100, (msg.loaded / Math.max(1, msg.max)) * 100)}%`;
  scanStatus.hidden = false;
  if (msg.state === "error") {
    scanStatus.textContent = msg.note ?? "Gagal menganalisis";
    return;
  }
  const of = msg.total ? ` dari ${fmt(msg.total)}` : "";
  const tail = scanning ? "komentar dianalisis" : msg.state === "stopped" ? "komentar dianalisis · dihentikan" : "komentar dianalisis · selesai";
  scanStatus.innerHTML = `<b>${fmt(msg.loaded)}</b>`;
  scanStatus.append(`${of} ${tail}${msg.note ? ` · ${msg.note}` : ""}`.trim());
}

/* ── Analyze dari link ─────────────────────────────────── */

type JobState = "wait" | "open" | "scan" | "ai" | "report" | "done" | "error";

interface Job extends PostLink {
  state: JobState;
  loaded: number;
  total: number | null;
  found: number;
  sent: number;
  failed: number;
  learned: number;
  note: string;
}

const linkInput = $<HTMLTextAreaElement>("#linkInput");
const linkRunBtn = $<HTMLButtonElement>("#linkRun");
const linkStopBtn = $<HTMLButtonElement>("#linkStop");
const linkList = $("#linkList");
let jobs: Job[] = [];
let linkRunning = false;
let linkAbort = false;
let runnerTab: number | undefined;
let linkSummary = "";
const scanWaiters = new Map<number, (p: ScanProgress | null) => void>();

function jobStatus(j: Job): string {
  const of = j.total ? ` / ${fmt(j.total)}` : "";
  switch (j.state) {
    case "wait":
      return "Menunggu";
    case "open":
      return "Membuka postingan…";
    case "scan":
      return `Menganalisis ${fmt(j.loaded)}${of} komentar`;
    case "ai":
      return `${fmt(j.loaded)}${of} komentar · menunggu hasil AI…`;
    case "report":
      return `${j.found} berbahaya · melapor ${j.sent + j.failed}/${Math.min(j.found, AUTO_REPORT_MAX)}…`;
    case "done":
      return [
        `${fmt(j.loaded)}${j.total ? ` dari ${fmt(j.total)}` : ""} komentar`,
        `${j.found} berbahaya`,
        j.sent ? `${j.sent} dilapor ✓` : "",
        j.failed ? `${j.failed} gagal` : "",
        j.learned ? `${j.learned} dipelajari AI` : "",
        j.note,
      ]
        .filter(Boolean)
        .join(" · ");
    case "error":
      return j.note;
  }
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "");
}

function renderLinks(): void {
  const links = extractPostLinks(linkInput.value);
  linkRunBtn.disabled = !links.length || linkRunning || Boolean(auto) || scanning;
  linkRunBtn.querySelector(".lbl")!.textContent = linkRunning ? "Sedang berjalan…" : links.length ? `Analyze ${links.length} link` : "Analyze link";
  linkStopBtn.hidden = !linkRunning;
  linkInput.disabled = linkRunning;
  setText($("#linkSummary"), linkSummary || (links.length ? `${links.length} link terdeteksi` : "Tempel link video TikTok, YouTube, IG, atau X"));

  linkList.hidden = !jobs.length;
  jobs.forEach((j, i) => {
    let li = linkList.children[i] as HTMLElement | undefined;
    if (!li) {
      li = document.createElement("li");
      li.innerHTML = `<span class="plat-ico"></span><span class="lk-url"></span><span class="lk-stat"></span>`;
      linkList.append(li);
    }
    if (li.dataset.url !== j.url) {
      li.dataset.url = j.url;
      li.querySelector(".plat-ico")!.innerHTML = icon(j.platform, 13);
      setText(li.querySelector(".lk-url"), shortUrl(j.url));
      li.querySelector<HTMLElement>(".lk-url")!.title = j.url;
    }
    li.dataset.state = j.state;
    setText(li.querySelector(".lk-stat"), jobStatus(j));
  });
  while (linkList.children.length > jobs.length) linkList.lastElementChild!.remove();
}

/** Tunggu tab selesai memuat halaman (status "complete"), termasuk redirect link pendek seperti vt.tiktok.com. */
function tabLoaded(tabId: () => number | undefined, timeoutMs = 25000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId() && info.status === "complete" && SUPPORTED_RE.test(tab.url ?? "")) done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/** Satu tab dipakai bergantian untuk semua link supaya tidak membuka puluhan tab. */
async function openInRunner(url: string): Promise<number> {
  let id = runnerTab;
  const loaded = tabLoaded(() => id);
  const reused = id !== undefined ? await chrome.tabs.update(id, { url, active: true }).catch(() => null) : null;
  if (!reused) {
    const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const created = await chrome.tabs.create({ url, active: true, ...(cur ? { index: cur.index + 1, windowId: cur.windowId } : {}) });
    id = runnerTab = created.id;
  }
  await loaded;
  return id!;
}

function waitScanEnd(tabId: number, timeoutMs: number): Promise<ScanProgress | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = (p: ScanProgress | null) => {
      clearTimeout(timer);
      scanWaiters.delete(tabId);
      resolve(p);
    };
    scanWaiters.set(tabId, finish);
  });
}

/** Tunggu sampai semua komentar tab ini selesai dinilai AI (dua kali berturut-turut tidak ada yang tertunda). */
async function waitAi(tabId: number, maxMs = 120000): Promise<void> {
  const end = Date.now() + maxMs;
  let idle = 0;
  while (Date.now() < end && !linkAbort && idle < 2) {
    const s = await send<StatusInfo>({ type: "getStatus", tabId }).catch(() => null);
    idle = !s || s.pendingAi === 0 ? idle + 1 : 0;
    await sleep(1000);
  }
}

async function runJob(job: Job, autoReport: boolean, learn: boolean): Promise<void> {
  const fail = (note: string) => {
    job.state = "error";
    job.note = note;
  };
  job.state = "open";
  render();
  const tabId = await openInRunner(job.url);
  await sleep(2500);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !SUPPORTED_RE.test(tab.url ?? "")) return fail("Link tidak membuka postingan (link mati / perlu login).");
  if (linkAbort) return fail("Dihentikan");

  const startedAt = Date.now();
  const ended = waitScanEnd(tabId, 6 * 60_000);
  const r = await analyzeTab(tabId);
  if (!r.ok) {
    scanWaiters.get(tabId)?.(null);
    return fail(r.note ?? "Gagal menganalisis.");
  }
  job.total = r.total ?? null;
  job.state = "scan";
  render();
  const end = await ended;
  if (end?.state === "error") return fail(end.note ?? "Komentar tidak ditemukan.");
  if (end) job.loaded = end.loaded;
  if (end?.note) job.note = end.note;

  job.state = "ai";
  render();
  await waitAi(tabId);
  await sleep(500);
  queue = await send<QueueItem[]>({ type: "getQueue" }).catch(() => queue);
  const found = queue.filter((q) => q.tabId === tabId && q.at >= startedAt);
  job.found = found.length;

  if (learn && !linkAbort) {
    const comments = ((await chrome.tabs.sendMessage(tabId, { type: "collect" } satisfies TabMsg).catch(() => null)) as CollectedComment[] | null) ?? [];
    const learned = learnFromComments(comments, settings.thresholds);
    await addExamples(learned);
    job.learned = learned.length;
    render();
  }

  if (autoReport && !linkAbort) {
    const targets = autoReportCandidates(found, reviews);
    if (targets.length) {
      job.state = "report";
      render();
      const run = await runAutoReport(targets, (r) => {
        job.sent = r.sent;
        job.failed = r.failed;
        renderLinks();
      });
      if (linkAbort) run.abort = true;
    }
  }
  job.state = "done";
}

async function runLinks(): Promise<void> {
  const links = extractPostLinks(linkInput.value);
  if (!links.length || linkRunning) return;
  const autoReport = $<HTMLInputElement>("#linkAutoReport").checked;
  const learn = $<HTMLInputElement>("#linkLearn").checked;
  if (autoReport) {
    const ok = await confirmDialog({
      title: "Analyze & laporkan",
      message:
        `HideMent akan membuka ${links.length} postingan satu per satu, menganalisis semua komentarnya, lalu MENGIRIM laporan ` +
        `untuk komentar prioritas tinggi memakai akunmu (maks. ${AUTO_REPORT_MAX} per postingan). Lanjutkan?`,
      confirmText: "Mulai",
      danger: true,
    });
    if (!ok) return;
  }
  jobs = links.map((l) => ({ ...l, state: "wait", loaded: 0, total: null, found: 0, sent: 0, failed: 0, learned: 0, note: "" }));
  linkRunning = true;
  linkAbort = false;
  linkSummary = "";
  result = null;
  render();
  try {
    for (const job of jobs) {
      if (linkAbort) break;
      await runJob(job, autoReport, learn).catch((e: Error) => {
        job.state = "error";
        job.note = e.message;
      });
      render();
    }
  } finally {
    for (const j of jobs) if (j.state !== "done" && j.state !== "error") Object.assign(j, { state: "error", note: "Dihentikan" });
    linkRunning = false;
    const sum = (k: "loaded" | "found" | "sent" | "failed" | "learned") => jobs.reduce((n, j) => n + j[k], 0);
    const finished = jobs.filter((j) => j.state === "done").length;
    linkSummary = [
      `Selesai ${finished}/${jobs.length} postingan`,
      `${fmt(sum("loaded"))} komentar`,
      `${sum("found")} berbahaya`,
      autoReport ? `${sum("sent")} dilapor` : "",
      learn ? `${sum("learned")} dipelajari AI` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (autoReport) result = reportSummary({ sent: sum("sent"), failed: sum("failed") });
    render();
  }
}

linkInput.addEventListener("input", () => {
  if (!linkRunning) {
    jobs = [];
    linkSummary = "";
  }
  renderLinks();
});
linkRunBtn.addEventListener("click", () => void runLinks());
linkStopBtn.addEventListener("click", () => {
  linkAbort = true;
  if (auto) auto.abort = true;
  if (runnerTab !== undefined) chrome.tabs.sendMessage(runnerTab, { type: "stopScan" } satisfies TabMsg).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((id) => {
  if (id === runnerTab) runnerTab = undefined;
  scanWaiters.get(id)?.(null);
});

/** Halaman Pengaturan → "Pelajari komentar dari link" menitipkan daftar link di storage.session lalu membuka panel ini. */
const LEARN_KEY = "learnLinks";

async function takeLearnRequest(): Promise<void> {
  const text = (await chrome.storage.session.get(LEARN_KEY))[LEARN_KEY] as string | undefined;
  if (!text || linkRunning) return;
  await chrome.storage.session.remove(LEARN_KEY);
  linkInput.value = text;
  $<HTMLDetailsElement>("#linkBox").open = true;
  $<HTMLInputElement>("#linkLearn").checked = true;
  $<HTMLInputElement>("#linkAutoReport").checked = false;
  jobs = [];
  linkSummary = "";
  renderLinks();
  void runLinks();
}

void takeLearnRequest();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[LEARN_KEY]?.newValue) void takeLearnRequest();
});
setInterval(() => void refreshPostInfo(), 2000);
chrome.tabs.onActivated.addListener(() => void refreshPostInfo());

/* ── pesan dari halaman & service worker ───────────────── */

chrome.runtime.onMessage.addListener((msg: BroadcastMsg | ScanProgress | { type: "reportSubmitted"; commentId: string }, sender) => {
  if (msg.type === "reportSubmitted") {
    const active = queue.find((q) => q.key === reportingKey);
    if (!auto && active && active.commentId === msg.commentId && active.tabId === sender.tab?.id) {
      setNote("Laporan terkirim. Lanjut ke komentar berikutnya…");
      setTimeout(() => void finishReport("done"), 1200);
    }
    return;
  }
  if (msg.type === "scanProgress") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const job = tabId === runnerTab ? jobs.find((j) => j.state === "scan") : undefined;
    if (job) {
      job.loaded = msg.loaded;
      job.total = msg.total ?? job.total;
      renderLinks();
    }
    if (msg.state !== "running") scanWaiters.get(tabId)?.(msg);
    if (scanTab !== undefined && tabId !== scanTab) return;
    scanTab = tabId;
    renderScan(msg);
    return;
  }
  if (msg.type === "queueUpdated") {
    queue = msg.queue;
    render();
  }
});

void loadSettings().then((s) => {
  settings = s;
  render();
});
onSettingsChanged((s) => {
  settings = s;
  render();
});

hydrateIcons();
enhanceAll();
void send<QueueItem[]>({ type: "getQueue" }).then((q) => {
  queue = q;
  render();
});
setInterval(() => {
  for (const it of queue) setText(nodes.get(it.key)?.querySelector(".time") ?? null, ago(it.at));
}, 30000);

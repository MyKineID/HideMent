import { CATEGORY_LABEL, type QueueItem } from "../core/types";
import { send, type BroadcastMsg, type ReportResult, type ScanProgress, type TabMsg } from "../shared/messages";
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type Settings } from "../core/settings";
import { $, download } from "../shared/dom";
import { hydrateIcons, pixelIcon } from "../shared/pixel-icons";
import { confirmDialog, enhanceAll } from "../shared/ui";

const PLATFORM_LABEL: Record<QueueItem["platform"], string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", x: "X" };

let queue: QueueItem[] = [];
let mode: "all" | "judol" | "toxic" = "all";
let settings: Settings = DEFAULT_SETTINGS;
let reportingKey: string | null = null;

const RTAG: Record<string, string> = { pending: "Menunggu lapor", done: "Sudah dilapor", skipped: "Dilewati" };

const list = $("#list");
const tpl = $<HTMLTemplateElement>("#itemTpl");

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

function pendingReports(): QueueItem[] {
  return queue.filter((q) => q.report === "pending").sort((a, b) => b.verdict.score - a.verdict.score || b.at - a.at);
}

function renderReportBar(): void {
  const bar = $("#rbar");
  bar.hidden = !settings.report.autoQueue && !reportingKey;
  const pending = pendingReports();
  const done = queue.filter((q) => q.report === "done").length;
  $("#rCount").textContent = pending.length
    ? `${pending.length} menunggu · ${done} sudah dilapor`
    : done
      ? `Semua beres · ${done} sudah dilapor`
      : "Komentar TINGGI akan otomatis masuk ke sini.";
  $<HTMLButtonElement>("#rNext").disabled = pending.length === 0;
  const active = queue.find((q) => q.key === reportingKey);
  $("#rIdle").hidden = Boolean(active);
  $("#rActive").hidden = !active;
  if (active) $("#rTarget").textContent = `@${active.author || "anonim"} · ${CATEGORY_LABEL[active.verdict.category]} ${active.verdict.score}`;
}

function setNote(text: string, err = false): void {
  const n = $("#rNote");
  n.textContent = text;
  n.classList.toggle("err", err);
}

async function startReport(it: QueueItem): Promise<void> {
  reportingKey = it.key;
  setNote("Membuka menu laporan di halaman…");
  render();
  try {
    const r = await send<ReportResult>({ type: "startReport", key: it.key });
    const msg = {
      reason: `Alasan "${r.reason}" sudah dipilih. Periksa di halaman, tekan Berikutnya / Kirim, lalu klik "Sudah dilapor".`,
      dialog: `Form laporan sudah terbuka. Pilih alasan "${r.reason}", kirim, lalu klik "Sudah dilapor".`,
      menu: `Menu sudah dibuka. Pilih "Laporkan" → "${r.reason}", kirim, lalu klik "Sudah dilapor".`,
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
  const next = pendingReports()[0];
  if (next) await startReport(next);
  else render();
}

function render(): void {
  renderReportBar();
  const rows = filtered();
  const high = queue.filter((q) => q.priority === "tinggi").length;
  $("#total").textContent = `${queue.length} komentar`;
  const tag = $("#highTag");
  tag.hidden = high === 0;
  tag.textContent = `${high} tinggi`;
  $("#empty").hidden = rows.length > 0;
  list.hidden = rows.length === 0;
  $("#emptyText").textContent = queue.length
    ? "Tidak ada komentar yang cocok dengan filter ini."
    : "Belum ada komentar berbahaya. Buka kolom komentar di YouTube, Instagram, TikTok, atau X.";

  list.replaceChildren(
    ...rows.map((it) => {
      const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
      node.classList.add(it.priority, it.verdict.mode);
      node.dataset.key = it.key;
      const prio = node.querySelector(".prio")!;
      prio.classList.add(it.priority);
      prio.textContent = it.priority === "tinggi" ? "Tinggi" : "Sedang";
      node.querySelector(".cat")!.textContent = CATEGORY_LABEL[it.verdict.category];
      node.querySelector(".score")!.textContent = String(it.verdict.score);
      const plat = node.querySelector<HTMLElement>(".plat-ico")!;
      plat.innerHTML = pixelIcon(it.platform, 12);
      plat.title = PLATFORM_LABEL[it.platform];
      node.querySelector(".author")!.textContent = it.author ? `@${it.author}` : "anonim";
      node.querySelector(".time")!.textContent = ago(it.at);
      const text = node.querySelector<HTMLElement>(".text")!;
      text.textContent = it.text;
      text.addEventListener("click", () => text.classList.toggle("open"));
      const rtag = node.querySelector<HTMLElement>(".rtag")!;
      if (it.report) {
        rtag.hidden = false;
        rtag.className = `rtag ${it.report}`;
        rtag.textContent = RTAG[it.report];
      }
      if (!settings.report.assist && !settings.report.autoQueue) node.querySelector('[data-a="report"]')!.remove();
      node.classList.toggle("reporting", it.key === reportingKey);
      node.querySelector(".reason")!.textContent = `${it.verdict.reason || "—"} (${it.verdict.source === "rule" ? "aturan lokal" : "AI"})`;
      return node;
    }),
  );
}

list.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-a]");
  const key = btn?.closest<HTMLElement>(".item")?.dataset.key;
  const it = queue.find((q) => q.key === key);
  if (!btn || !it) return;
  if (btn.dataset.a === "report") {
    if (!it.report || it.report !== "pending") {
      it.report = "pending";
      await send({ type: "setReportStatus", key: it.key, status: "pending" });
    }
    await startReport(it);
  }
  if (btn.dataset.a === "focus") {
    await send({ type: "focusComment", tabId: it.tabId, commentId: it.commentId }).catch(async () => {
      await chrome.tabs.create({ url: it.url });
    });
  }
  if (btn.dataset.a === "copy") {
    await navigator.clipboard.writeText(`[${CATEGORY_LABEL[it.verdict.category]} ${it.verdict.score}] @${it.author}: ${it.text}\n${it.url}`);
    btn.textContent = "Disalin";
  }
  if (btn.dataset.a === "done") {
    queue = queue.filter((q) => q.key !== it.key);
    render();
    await send({ type: "removeQueueItem", key: it.key });
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
  download(`tempest-antrian-${Date.now()}.csv`, "﻿" + [head.join(","), ...rows].join("\n"), "text/csv");
});

let scanTab: number | undefined;
let scanning = false;
const scanBtn = $<HTMLButtonElement>("#fastScan");
scanBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (scanning && scanTab !== undefined) {
    chrome.tabs.sendMessage(scanTab, { type: "stopScan" } satisfies TabMsg).catch(() => undefined);
    return;
  }
  if (tab?.id === undefined) return;
  scanTab = tab.id;
  const r = (await chrome.tabs.sendMessage(tab.id, { type: "fastScan" } satisfies TabMsg).catch(() => null)) as { ok: boolean; note?: string } | null;
  if (!r?.ok) scanBtn.textContent = r?.note ?? "Buka postingan YouTube / IG / TikTok / X dulu";
});

chrome.runtime.onMessage.addListener((msg: BroadcastMsg | ScanProgress, sender) => {
  if (msg.type === "scanProgress") {
    if (scanTab !== undefined && sender.tab?.id !== scanTab) return;
    scanTab = sender.tab?.id;
    scanning = msg.state === "running";
    scanBtn.textContent = scanning
      ? `■ Stop · ${msg.loaded} komentar dimuat`
      : msg.state === "error"
        ? (msg.note ?? "Gagal memindai")
        : `✓ ${msg.loaded} komentar dipindai · pindai lagi`;
    scanBtn.classList.toggle("ghost", scanning);
    $("#scanMeter").hidden = false;
    $("#scanFill").style.width = `${Math.min(100, (msg.loaded / msg.max) * 100)}%`;
    return;
  }
  if (msg.type === "queueUpdated") {
    queue = msg.queue;
    render();
  }
});

$("#rNext").addEventListener("click", () => {
  const next = pendingReports()[0];
  if (next) void startReport(next);
});
$("#rDone").addEventListener("click", () => void finishReport("done"));
$("#rSkip").addEventListener("click", () => void finishReport("skipped"));
$("#rStop").addEventListener("click", () => {
  reportingKey = null;
  render();
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
setInterval(() => list.querySelectorAll(".time").length && render(), 30000);

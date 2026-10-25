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
      submit: `Alasan "${r.reason}" sudah dipilih dan tombol kirim sudah difokuskan. Tekan Enter atau klik Kirim di halaman. Tempest lanjut otomatis setelah itu.`,
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
  const next = pendingReports()[0];
  if (next) await startReport(next);
  else render();
}

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
  plat.innerHTML = pixelIcon(it.platform, 12);
  plat.title = PLATFORM_LABEL[it.platform];
  const text = node.querySelector<HTMLElement>(".text")!;
  text.addEventListener("click", () => text.classList.toggle("open"));
  hydrateIcons(node);
  return node;
}

function fillNode(node: HTMLElement, it: QueueItem): void {
  node.className = `item ${it.priority} ${it.verdict.mode}${it.key === reportingKey ? " reporting" : ""}`;
  const prio = node.querySelector<HTMLElement>(".prio")!;
  prio.className = `tag prio ${it.priority}`;
  setText(prio, it.priority === "tinggi" ? "Tinggi" : "Sedang");
  setText(node.querySelector(".cat"), CATEGORY_LABEL[it.verdict.category]);
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
  node.querySelector<HTMLElement>('[data-a="report"]')!.hidden = !settings.report.assist && !settings.report.autoQueue;
}

function render(): void {
  if (pointerDown) {
    renderPending = true;
    return;
  }
  renderReportBar();
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
    : "Belum ada komentar berbahaya. Buka kolom komentar di YouTube, Instagram, TikTok, atau X.";

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
      const ok = await copyText(`[${CATEGORY_LABEL[it.verdict.category]} ${it.verdict.score}] @${it.author}: ${it.text}\n${it.url}`);
      flash(btn, ok ? "Disalin" : "Gagal");
      break;
    }
    case "done":
      queue = queue.filter((q) => q.key !== it.key);
      render();
      await send({ type: "removeQueueItem", key: it.key });
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
const scanLabel = scanBtn.querySelector<HTMLElement>(".lbl")!;
const stopBtn = $<HTMLButtonElement>("#stopScan");
const scanStatus = $("#scanStatus");

scanBtn.addEventListener("click", async () => {
  if (scanning) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const fail = (text: string) => {
    scanStatus.hidden = false;
    scanStatus.textContent = text;
  };
  if (tab?.id === undefined) return;
  if (!/^https:\/\/(www\.|m\.)?(youtube|instagram|tiktok|x|twitter)\.com\//.test(tab.url ?? "")) {
    return fail("Tab aktif bukan YouTube / Instagram / TikTok / X.");
  }
  scanTab = tab.id;
  fail("Menyambungkan ke tab…");
  if (!(await send<boolean>({ type: "ensureContent", tabId: tab.id }).catch(() => false))) {
    return fail("Tempest belum tersambung ke tab ini. Refresh halamannya (F5), lalu coba lagi.");
  }
  const r = (await chrome.tabs.sendMessage(tab.id, { type: "fastScan" } satisfies TabMsg).catch(() => null)) as { ok: boolean; note?: string } | null;
  if (!r?.ok) fail(r?.note ?? "Halaman belum siap. Refresh tab lalu coba lagi.");
});
stopBtn.addEventListener("click", () => {
  if (scanTab !== undefined) chrome.tabs.sendMessage(scanTab, { type: "stopScan" } satisfies TabMsg).catch(() => undefined);
});

function renderScan(msg: ScanProgress): void {
  scanning = msg.state === "running";
  scanBtn.disabled = scanning;
  scanBtn.classList.toggle("busy", scanning);
  scanLabel.textContent = scanning ? "Memindai komentar…" : "Pindai semua komentar";
  stopBtn.hidden = !scanning;
  $("#scanMeter").hidden = false;
  $("#scanFill").style.width = `${Math.min(100, (msg.loaded / msg.max) * 100)}%`;
  scanStatus.hidden = false;
  scanStatus.innerHTML =
    msg.state === "error"
      ? ""
      : `<b>${msg.loaded}</b>${scanning ? "komentar dimuat" : msg.state === "stopped" ? "komentar dipindai · dihentikan" : "komentar dipindai · selesai"}`;
  if (msg.state === "error") scanStatus.textContent = msg.note ?? "Gagal memindai";
}

chrome.runtime.onMessage.addListener((msg: BroadcastMsg | ScanProgress | { type: "reportSubmitted"; commentId: string }, sender) => {
  if (msg.type === "reportSubmitted") {
    const active = queue.find((q) => q.key === reportingKey);
    if (active && active.commentId === msg.commentId && active.tabId === sender.tab?.id) {
      setNote("Laporan terkirim. Lanjut ke komentar berikutnya…");
      setTimeout(() => void finishReport("done"), 1200);
    }
    return;
  }
  if (msg.type === "scanProgress") {
    if (scanTab !== undefined && sender.tab?.id !== scanTab) return;
    scanTab = sender.tab?.id;
    renderScan(msg);
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
setInterval(() => {
  for (const it of queue) setText(nodes.get(it.key)?.querySelector(".time") ?? null, ago(it.at));
}, 30000);

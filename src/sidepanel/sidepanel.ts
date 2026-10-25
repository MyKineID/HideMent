import { CATEGORY_LABEL, type QueueItem } from "../core/types";
import { send, type BroadcastMsg } from "../shared/messages";
import { $, download } from "../shared/dom";

const PLATFORM_LABEL: Record<QueueItem["platform"], string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", x: "X" };

let queue: QueueItem[] = [];
let mode: "all" | "judol" | "toxic" = "all";

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

function render(): void {
  const rows = filtered();
  const high = queue.filter((q) => q.priority === "tinggi").length;
  $("#summary").textContent = `${queue.length} komentar · ${high} prioritas tinggi`;
  $("#empty").hidden = rows.length > 0;
  list.hidden = rows.length === 0;

  list.replaceChildren(
    ...rows.map((it) => {
      const node = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement;
      node.classList.add(it.priority, it.verdict.mode);
      node.dataset.key = it.key;
      const prio = node.querySelector(".prio")!;
      prio.classList.add(it.priority);
      prio.textContent = it.priority === "tinggi" ? "TINGGI" : "SEDANG";
      node.querySelector(".cat")!.textContent = CATEGORY_LABEL[it.verdict.category];
      node.querySelector(".score")!.textContent = String(it.verdict.score);
      node.querySelector(".plat")!.textContent = PLATFORM_LABEL[it.platform];
      node.querySelector(".author")!.textContent = it.author ? `@${it.author}` : "anonim";
      node.querySelector(".time")!.textContent = ago(it.at);
      const text = node.querySelector<HTMLElement>(".text")!;
      text.textContent = it.text;
      text.addEventListener("click", () => text.classList.toggle("open"));
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
  if (btn.dataset.a === "focus") {
    await send({ type: "focusComment", tabId: it.tabId, commentId: it.commentId }).catch(async () => {
      await chrome.tabs.create({ url: it.url });
    });
  }
  if (btn.dataset.a === "copy") {
    await navigator.clipboard.writeText(`[${CATEGORY_LABEL[it.verdict.category]} ${it.verdict.score}] @${it.author}: ${it.text}\n${it.url}`);
    btn.textContent = "✓ Disalin";
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
  $("#modeFilter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  render();
});
["#prioFilter", "#sort"].forEach((s) => $(s).addEventListener("change", render));
$("#search").addEventListener("input", render);

$("#clear").addEventListener("click", async () => {
  if (!queue.length || !confirm("Kosongkan seluruh antrian?")) return;
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

chrome.runtime.onMessage.addListener((msg: BroadcastMsg) => {
  if (msg.type === "queueUpdated") {
    queue = msg.queue;
    render();
  }
});

void send<QueueItem[]>({ type: "getQueue" }).then((q) => {
  queue = q;
  render();
});
setInterval(() => list.querySelectorAll(".time").length && render(), 30000);

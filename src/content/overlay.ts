import { priorityOf, type ActionKind, type Settings } from "../core/settings";
import { CATEGORY_LABEL, type Priority, type Verdict } from "../core/types";
import type { Adapter } from "./adapters/types";
import { openReportHelper } from "./report-helper";

const MARK_CLASSES = ["rg-hl-tinggi", "rg-hl-sedang", "rg-hl-aman", "rg-hidden-host"];
const SOURCE_LABEL: Record<Verdict["source"], string> = { rule: "Aturan lokal", ai: "AI · 9router", cache: "AI (cache)" };

export interface OverlayCallbacks {
  onDismiss(el: HTMLElement, v: Verdict): void;
}

function resolveAction(v: Verdict, priority: Priority, s: Settings): ActionKind | "none" {
  if (v.category === "aman" || priority === "rendah") return "none";
  let action: ActionKind = s.categoryAction[v.category] ?? (s.display.hide ? "hide" : s.display.blur ? "blur" : "highlight");
  if (priority === "sedang" && action !== "highlight") action = action === "hide" ? "blur" : "highlight";
  if (action === "hide" && !s.display.hide) action = "blur";
  if (action === "blur" && !s.display.blur) action = "highlight";
  return action;
}

export function clearMarks(el: HTMLElement, adapter: Adapter): void {
  el.classList.remove(...MARK_CLASSES);
  el.querySelectorAll(":scope .rg-badge, :scope .rg-chiprow").forEach((n) => n.remove());
  const t = adapter.getTextEl(el);
  t?.classList.remove("rg-blur", "rg-revealed");
  t?.removeAttribute("data-rg-reveal");
}

type Level = Priority | "aman";

const LEVEL_LABEL: Record<Level, string> = { tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah", aman: "Aman" };
const MODE_LABEL: Record<Verdict["mode"], string> = { judol: "Anti Judol / Phising", toxic: "Anti Toxic" };

function span(cls: string, text = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

/** Meteran blok pixel: `cells` blok, menyala sebanding skor. */
function meter(score: number, cells: number, cls: string): HTMLSpanElement {
  const m = span(cls);
  const lit = score > 0 ? Math.max(1, Math.ceil((score / 100) * cells)) : 0;
  for (let i = 0; i < cells; i++) m.append(span(i < lit ? "on" : ""));
  return m;
}

function buildBadge(v: Verdict, level: Level, el: HTMLElement, adapter: Adapter, cb: OverlayCallbacks): HTMLElement {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = `rg-badge rg-p-${level}`;
  badge.setAttribute("aria-label", `Tempest: ${LEVEL_LABEL[level]}, ${CATEGORY_LABEL[v.category]}, skor ${v.score}. Klik untuk detail.`);
  badge.title = "Tempest · klik untuk detail";

  badge.append(span("rg-b-lvl", LEVEL_LABEL[level]));
  if (level !== "aman") badge.append(span("rg-b-cat", CATEGORY_LABEL[v.category]));
  const sc = span("rg-b-score");
  sc.append(span("rg-b-num", String(v.score)), meter(v.score, 5, "rg-b-meter"));
  badge.append(sc);

  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePopover(badge, v, level, el, adapter, cb);
  });
  return badge;
}

function togglePopover(badge: HTMLElement, v: Verdict, level: Level, el: HTMLElement, adapter: Adapter, cb: OverlayCallbacks): void {
  const existing = document.querySelector<HTMLElement>(".rg-pop");
  if (existing) {
    existing.remove();
    if (existing.dataset.for === el.dataset.rgId) return;
  }
  const pop = document.createElement("div");
  pop.className = `rg-pop rg-p-${level}`;
  pop.dataset.for = el.dataset.rgId ?? "";
  pop.setAttribute("role", "dialog");
  pop.innerHTML = `
    <div class="rg-pop-name">TEMPEST</div>
    <button type="button" class="rg-pop-x" data-a="close" aria-label="Tutup">×</button>
    <div class="rg-pop-head"><span class="rg-pop-lvl"></span><span class="rg-pop-title"></span></div>
    <div class="rg-pop-scorebar"><span class="rg-pop-num"></span></div>
    <dl class="rg-pop-rows">
      <dt>Alasan</dt><dd class="rg-r-reason"></dd>
      <dt>Mode</dt><dd class="rg-r-mode"></dd>
      <dt>Sumber</dt><dd class="rg-r-src"></dd>
    </dl>
    <div class="rg-pop-actions">
      <button type="button" class="rg-btn rg-btn-red" data-a="report">Bantu laporkan</button>
      <button type="button" class="rg-btn" data-a="dismiss">Bukan berbahaya</button>
    </div>`;
  pop.querySelector(".rg-pop-lvl")!.textContent = LEVEL_LABEL[level];
  pop.querySelector(".rg-pop-title")!.textContent = level === "aman" ? "Komentar aman" : CATEGORY_LABEL[v.category];
  pop.querySelector(".rg-pop-num")!.textContent = `${v.score}/100`;
  pop.querySelector(".rg-pop-scorebar")!.prepend(meter(v.score, 20, "rg-pop-meter"));
  pop.querySelector(".rg-r-reason")!.textContent = v.reason || "—";
  pop.querySelector(".rg-r-mode")!.textContent = MODE_LABEL[v.mode];
  pop.querySelector(".rg-r-src")!.textContent = SOURCE_LABEL[v.source];
  if (level === "aman") pop.querySelector(".rg-pop-actions")!.remove();

  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (a === "report") openReportHelper(el, adapter, v);
    if (a === "dismiss") cb.onDismiss(el, v);
    if (a) pop.remove();
  });
  document.body.appendChild(pop);
  const r = badge.getBoundingClientRect();
  const below = r.bottom + 8 + pop.offsetHeight < innerHeight;
  pop.style.top = `${window.scrollY + (below ? r.bottom + 8 : r.top - pop.offsetHeight - 8)}px`;
  pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + innerWidth - pop.offsetWidth - 12))}px`;
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && pop.remove();
  document.addEventListener("keydown", onKey, { once: true });
  setTimeout(() => document.addEventListener("click", () => pop.remove(), { once: true }), 0);
}

function applyBlur(textEl: HTMLElement, s: Settings): void {
  if (textEl.dataset.rgReveal === "1") return;
  textEl.classList.add("rg-blur");
  if (!s.display.clickToReveal) return;
  textEl.addEventListener(
    "click",
    (e) => {
      if (!textEl.classList.contains("rg-blur")) return;
      e.preventDefault();
      e.stopPropagation();
      textEl.classList.remove("rg-blur");
      textEl.classList.add("rg-revealed");
      textEl.dataset.rgReveal = "1";
    },
    { capture: true },
  );
}

function applyHide(el: HTMLElement, v: Verdict): void {
  el.classList.add("rg-hidden-host");
  const bar = document.createElement("div");
  bar.className = "rg-hidden-bar";
  bar.innerHTML = `<span></span><button type="button">Tampilkan</button>`;
  bar.querySelector("span")!.textContent = `■ Disembunyikan · ${CATEGORY_LABEL[v.category]} · ${v.score}`;
  bar.querySelector("button")!.addEventListener("click", (e) => {
    e.stopPropagation();
    el.classList.remove("rg-hidden-host");
    bar.remove();
  });
  el.before(bar);
}

export function applyVerdict(el: HTMLElement, adapter: Adapter, v: Verdict, s: Settings, cb: OverlayCallbacks): Priority {
  clearMarks(el, adapter);
  if (el.previousElementSibling?.classList.contains("rg-hidden-bar")) el.previousElementSibling.remove();
  const priority = priorityOf(v.score, s.thresholds);
  const isSafe = v.category === "aman" || priority === "rendah";
  const action = resolveAction(v, priority, s);

  if (s.display.showBadge && (!isSafe || s.display.showSafeBadge)) {
    const badge = buildBadge(v, isSafe ? "aman" : priority, el, adapter, cb);
    const slot = adapter.getBadgeSlot(el);
    if (slot?.where === "row") {
      const row = document.createElement("div");
      row.className = "rg-chiprow";
      row.append(badge);
      slot.node.before(row);
    } else (slot?.node ?? el).append(badge);
  }
  if (isSafe) {
    if (s.display.showSafeBadge && s.display.highlight) el.classList.add("rg-hl-aman");
    return priority;
  }
  if (s.display.highlight) el.classList.add(`rg-hl-${priority}`);

  const textEl = adapter.getTextEl(el);
  if (action === "blur" && textEl) applyBlur(textEl, s);
  if (action === "hide") applyHide(el, v);
  return priority;
}

export function focusElement(el: HTMLElement): void {
  el.classList.remove("rg-hidden-host");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("rg-flash");
  setTimeout(() => el.classList.remove("rg-flash"), 2200);
}

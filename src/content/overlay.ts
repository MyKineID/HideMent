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
  el.querySelectorAll(":scope .rg-badge, :scope .rg-hidden-bar").forEach((n) => n.remove());
  const t = adapter.getTextEl(el);
  t?.classList.remove("rg-blur", "rg-revealed");
  t?.removeAttribute("data-rg-reveal");
}

function icon(priority: Priority | "aman"): string {
  return priority === "tinggi" ? "⛔" : priority === "sedang" ? "⚠" : "✓";
}

function buildBadge(v: Verdict, priority: Priority | "aman", el: HTMLElement, adapter: Adapter, cb: OverlayCallbacks): HTMLElement {
  const badge = document.createElement("span");
  badge.className = `rg-badge rg-p-${priority}`;
  badge.title = `${CATEGORY_LABEL[v.category]} · skor ${v.score}\n${v.reason}\n(${SOURCE_LABEL[v.source]})`;
  badge.innerHTML = `<span class="rg-badge-ico"></span><span class="rg-badge-txt"></span>`;
  badge.querySelector(".rg-badge-ico")!.textContent = icon(priority);
  badge.querySelector(".rg-badge-txt")!.textContent =
    v.category === "aman" ? "Aman" : `${CATEGORY_LABEL[v.category]} · ${v.score}`;
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePopover(badge, v, el, adapter, cb);
  });
  return badge;
}

function togglePopover(badge: HTMLElement, v: Verdict, el: HTMLElement, adapter: Adapter, cb: OverlayCallbacks): void {
  const existing = document.querySelector(".rg-pop");
  if (existing) {
    existing.remove();
    if ((existing as HTMLElement).dataset.for === el.dataset.rgId) return;
  }
  const pop = document.createElement("div");
  pop.className = "rg-pop";
  pop.dataset.for = el.dataset.rgId ?? "";
  pop.innerHTML = `
    <div class="rg-pop-head"><span class="rg-pop-title"></span><span class="rg-pop-score"></span></div>
    <div class="rg-pop-reason"></div>
    <div class="rg-pop-src"></div>
    <div class="rg-pop-actions">
      <button type="button" data-a="report">🚩 Bantu laporkan</button>
      <button type="button" data-a="dismiss">Bukan berbahaya</button>
    </div>`;
  pop.querySelector(".rg-pop-title")!.textContent = CATEGORY_LABEL[v.category];
  pop.querySelector(".rg-pop-score")!.textContent = `${v.score}/100`;
  pop.querySelector(".rg-pop-reason")!.textContent = v.reason || "—";
  pop.querySelector(".rg-pop-src")!.textContent = `Sumber: ${SOURCE_LABEL[v.source]}`;
  if (v.category === "aman") pop.querySelector('[data-a="report"]')!.remove();

  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = (e.target as HTMLElement).closest("button")?.dataset.a;
    if (a === "report") openReportHelper(el, adapter, v);
    if (a === "dismiss") cb.onDismiss(el, v);
    if (a) pop.remove();
  });
  document.body.appendChild(pop);
  const r = badge.getBoundingClientRect();
  pop.style.top = `${window.scrollY + r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + innerWidth - pop.offsetWidth - 8))}px`;
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
  bar.querySelector("span")!.textContent = `⛔ Komentar disembunyikan: ${CATEGORY_LABEL[v.category]} (${v.score})`;
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
    const anchor = adapter.getBadgeAnchor(el) ?? el;
    anchor.appendChild(buildBadge(v, isSafe ? "aman" : priority, el, adapter, cb));
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

import { priorityOf, type ActionKind, type Settings } from "../core/settings";
import { CATEGORY_LABEL, type Priority, type Verdict } from "../core/types";
import type { Adapter } from "./adapters/types";
import { runReportFlow } from "./report-helper";
import { icon } from "../shared/icons";

const MARK_CLASSES = ["rg-hl-tinggi", "rg-hl-sedang", "rg-hl-aman", "rg-hidden-host"];
const SOURCE_LABEL: Record<Verdict["source"], string> = { rule: "Aturan lokal (tanpa AI)", ai: "AI", cache: "AI (dari cache)" };

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
  el.querySelectorAll(":scope .rg-badge, :scope .rg-chiprow, :scope .rg-blur-hint").forEach((n) => n.remove());
  const t = adapter.getTextEl(el);
  if (!t) return;
  t.classList.remove("rg-blur", "rg-revealed");
  t.removeAttribute("data-rg-reveal");
  unsetBlurA11y(t);
}

type Level = Priority | "aman";

const LEVEL_LABEL: Record<Level, string> = { tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah", aman: "Aman" };
const MODE_LABEL: Record<Verdict["mode"], string> = { judol: "Judi online / phising", toxic: "Toxic" };

function span(cls: string, text = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

/** Label ringkas di samping nama akun: skor + kategori. Tingkat bahaya dibedakan lewat warna dan teks aksesibel. */
function buildBadge(v: Verdict, level: Level, el: HTMLElement, adapter: Adapter, cb: OverlayCallbacks, assist: boolean): HTMLElement {
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = `rg-badge rg-p-${level}`;
  badge.setAttribute("aria-haspopup", "dialog");
  badge.setAttribute("aria-expanded", "false");
  badge.setAttribute("aria-label", `HideMent: prioritas ${LEVEL_LABEL[level].toLowerCase()}, ${CATEGORY_LABEL[v.category]}, skor ${v.score}. Buka detail.`);
  badge.title = "HideMent · klik untuk detail";

  if (level === "aman") badge.append(span("rg-b-cat", "Aman"));
  else badge.append(span("rg-b-num", String(v.score)), span("rg-b-cat", CATEGORY_LABEL[v.category]));

  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePopover(badge, v, level, el, adapter, cb, assist);
  });
  return badge;
}

let openPop: { pop: HTMLElement; close(refocus: boolean): void } | null = null;

function togglePopover(badge: HTMLElement, v: Verdict, level: Level, el: HTMLElement, adapter: Adapter, cb: OverlayCallbacks, assist: boolean): void {
  const wasSame = openPop?.pop.dataset.for === el.dataset.rgId;
  openPop?.close(false);
  if (wasSame) return;

  const pop = document.createElement("div");
  pop.className = `rg-pop rg-p-${level}`;
  pop.dataset.for = el.dataset.rgId ?? "";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Detail HideMent");
  pop.innerHTML = `
    <div class="rg-pop-head">
      <div class="rg-pop-titles"><span class="rg-pop-kicker"></span><span class="rg-pop-title"></span></div>
      <span class="rg-pop-score"></span>
      <button type="button" class="rg-pop-x" data-a="close" aria-label="Tutup">${icon("close", 14)}</button>
    </div>
    <div class="rg-pop-bar" aria-hidden="true"><i></i></div>
    <dl class="rg-pop-rows">
      <dt>Alasan</dt><dd class="rg-r-reason"></dd>
      <dt>Jenis</dt><dd class="rg-r-mode"></dd>
      <dt>Sumber</dt><dd class="rg-r-src"></dd>
    </dl>
    <div class="rg-pop-actions">
      <button type="button" class="rg-btn" data-a="report">Bantu laporkan</button>
      <button type="button" class="rg-btn" data-a="dismiss">Bukan berbahaya</button>
    </div>`;
  pop.querySelector(".rg-pop-kicker")!.textContent = level === "aman" ? "HideMent" : `HideMent · prioritas ${LEVEL_LABEL[level].toLowerCase()}`;
  pop.querySelector(".rg-pop-title")!.textContent = level === "aman" ? "Komentar aman" : CATEGORY_LABEL[v.category];
  pop.querySelector(".rg-pop-score")!.textContent = String(v.score);
  pop.querySelector<HTMLElement>(".rg-pop-bar i")!.style.width = `${Math.max(2, v.score)}%`;
  pop.querySelector(".rg-r-reason")!.textContent = v.reason || "—";
  pop.querySelector(".rg-r-mode")!.textContent = MODE_LABEL[v.mode];
  pop.querySelector(".rg-r-src")!.textContent = SOURCE_LABEL[v.source];
  if (level === "aman") pop.querySelector(".rg-pop-actions")!.remove();
  else if (!assist) pop.querySelector('[data-a="report"]')!.remove();

  const onDocClick = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && e.target !== badge) close(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
    }
  };
  const close = (refocus: boolean) => {
    pop.remove();
    badge.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (openPop?.pop === pop) openPop = null;
    if (refocus) badge.focus();
  };

  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
    if (!a) return;
    close(a === "close");
    if (a === "report") void runReportFlow(el, adapter, v);
    if (a === "dismiss") cb.onDismiss(el, v);
  });

  document.body.appendChild(pop);
  const r = badge.getBoundingClientRect();
  const below = r.bottom + 8 + pop.offsetHeight < innerHeight;
  pop.style.top = `${window.scrollY + (below ? r.bottom + 8 : r.top - pop.offsetHeight - 8)}px`;
  pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + innerWidth - pop.offsetWidth - 12))}px`;
  badge.setAttribute("aria-expanded", "true");
  openPop = { pop, close };
  document.addEventListener("click", onDocClick, true);
  document.addEventListener("keydown", onKey, true);
  pop.querySelector<HTMLElement>(".rg-pop-actions .rg-btn, .rg-pop-x")?.focus({ preventScroll: true });
}

/* ── blur ─────────────────────────────────────────── */

function setBlurA11y(t: HTMLElement): void {
  t.tabIndex = 0;
  t.setAttribute("role", "button");
  t.setAttribute("aria-label", "Komentar diburamkan oleh HideMent. Tekan untuk melihat.");
}

function unsetBlurA11y(t: HTMLElement): void {
  if (!t.hasAttribute("data-rg-a11y")) return;
  t.removeAttribute("tabindex");
  t.removeAttribute("role");
  t.removeAttribute("aria-label");
  t.removeAttribute("data-rg-a11y");
}

function applyBlur(textEl: HTMLElement, s: Settings): void {
  if (textEl.dataset.rgReveal === "1") return;
  textEl.classList.add("rg-blur");
  if (!s.display.clickToReveal) return;

  textEl.setAttribute("data-rg-a11y", "1");
  setBlurA11y(textEl);
  const hint = document.createElement("span");
  hint.className = "rg-blur-hint";
  hint.textContent = "Diburamkan oleh HideMent · klik untuk lihat";
  textEl.after(hint);

  const reveal = (e: Event) => {
    if (!textEl.classList.contains("rg-blur")) return;
    e.preventDefault();
    e.stopPropagation();
    textEl.classList.remove("rg-blur");
    textEl.classList.add("rg-revealed");
    textEl.dataset.rgReveal = "1";
    unsetBlurA11y(textEl);
    hint.remove();
  };
  textEl.addEventListener("click", reveal, { capture: true });
  textEl.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && reveal(e), { capture: true });
  hint.addEventListener("click", reveal);
}

function applyHide(el: HTMLElement, v: Verdict): void {
  el.classList.add("rg-hidden-host");
  const bar = document.createElement("div");
  bar.className = "rg-hidden-bar";
  bar.innerHTML = `<span></span><button type="button">Tampilkan</button>`;
  bar.querySelector("span")!.textContent = `1 komentar disembunyikan · ${CATEGORY_LABEL[v.category]} · ${v.score}`;
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
    const badge = buildBadge(v, isSafe ? "aman" : priority, el, adapter, cb, s.report.assist);
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

import { CATEGORY_LABEL, type Category, type Verdict } from "../core/types";
import type { ReportResult } from "../shared/messages";
import type { Adapter } from "./adapters/types";

/*
 * Alur lapor semi-otomatis: buka menu ⋯ → klik "Laporkan" → pilih alasan.
 * Tempest SELALU berhenti sebelum tombol kirim; pengguna yang mengirim laporan.
 */

const REPORT_ITEM_RE = /^(laporkan|report|lapor)(\s+(komentar|postingan|post|comment|tweet|kiriman))?\b/i;
const FINAL_BUTTON_RE = /^(kirim|submit|send|laporkan|report|selesai|done|berikutnya|next|lanjut|batal|cancel|tutup|close|kembali|back)$/i;

/** Pola alasan per kategori, urut dari yang paling tepat. Pola pertama yang cocok menang. */
export const REASON_RE: Record<Category, RegExp[]> = {
  judol: [/perjudian|judi|gambling/i, /spam|menyesatkan|misleading/i],
  spam: [/spam|menyesatkan|misleading/i],
  phishing: [/phishing|penipuan|scam|fraud|peniruan|impersonat/i, /spam/i],
  scam: [/penipuan|scam|fraud/i, /spam|menyesatkan/i],
  hinaan: [/pelecehan|penindasan|perundungan|bullying|harassment|penyalahgunaan|abuse/i, /kasar/i],
  perundungan: [/perundungan|penindasan|bullying/i, /pelecehan|harassment|penyalahgunaan|abuse/i],
  sarkasme: [/pelecehan|penindasan|perundungan|bullying|harassment|penyalahgunaan|abuse/i],
  sara: [/kebencian|hate|benci/i],
  ancaman: [/kekerasan|ancaman|violen|threat/i],
  pelecehan: [/seksual|sexual/i, /pelecehan|harassment/i],
  aman: [],
};

const MENU_SEL =
  '[role="menuitem"], tp-yt-paper-item, ytd-menu-service-item-renderer, [role="menu"] [role="button"], [role="dialog"] button, [role="dialog"] [role="button"], [role="listbox"] li, li[data-e2e], button';
const DIALOG_SEL = '[role="dialog"], [aria-modal="true"], tp-yt-paper-dialog, ytd-popup-container, [data-e2e*="report" i]';
const OPTION_SEL = '[role="radio"], [role="option"], [role="menuitemradio"], label, [role="button"], button, li, tp-yt-paper-radio-button';

/** Pilih teks alasan paling spesifik (terpendek) yang cocok dengan kategori; tombol kirim/lanjut tidak pernah dipilih. */
export function pickReason(category: Category, options: string[]): string | null {
  const usable = options.filter((t) => t && t.length <= 140 && !FINAL_BUTTON_RE.test(t));
  for (const re of REASON_RE[category]) {
    const hits = usable.filter((t) => re.test(t)).sort((a, b) => a.length - b.length);
    if (hits.length) return hits[0];
  }
  return null;
}

const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const visible = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;
const ours = (el: Element) => Boolean(el.closest(".rg-pop, .rg-toast, .rg-badge, .rg-chiprow, .rg-hidden-bar"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(find: () => T | null | undefined, timeoutMs = 3500): Promise<T | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hit = find();
    if (hit) return hit;
    await sleep(120);
  }
  return null;
}

function findReportItem(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(MENU_SEL)) {
    if (ours(el) || !visible(el)) continue;
    if (REPORT_ITEM_RE.test(textOf(el)) && textOf(el).length < 40) return el;
  }
  return null;
}

function findReasonOption(category: Category): HTMLElement | null {
  const candidates = new Map<string, HTMLElement>();
  for (const root of document.querySelectorAll<HTMLElement>(DIALOG_SEL)) {
    if (!visible(root) || ours(root)) continue;
    for (const el of root.querySelectorAll<HTMLElement>(OPTION_SEL)) {
      const t = textOf(el);
      if (t && visible(el) && !ours(el) && !candidates.has(t)) candidates.set(t, el);
    }
  }
  const pick = pickReason(category, [...candidates.keys()]);
  return pick ? candidates.get(pick)! : null;
}

function dialogOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>(DIALOG_SEL)].some((d) => visible(d) && !ours(d) && /laporkan|report|lapor/i.test(textOf(d)));
}

function toast(title: string, body: string, reason: string, ms = 10000): void {
  document.querySelector(".rg-toast")?.remove();
  const t = document.createElement("div");
  t.className = "rg-toast";
  t.setAttribute("role", "status");
  t.innerHTML = `<b></b><div class="rg-toast-body"></div><div class="rg-toast-reason"></div><small>Tempest tidak pernah mengirim laporan sendiri. Kamu yang menekan tombol kirim.</small>`;
  t.querySelector("b")!.textContent = title;
  t.querySelector(".rg-toast-body")!.textContent = body;
  const r = t.querySelector<HTMLElement>(".rg-toast-reason")!;
  r.textContent = reason;
  r.hidden = !reason;
  t.addEventListener("click", () => t.remove());
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function mark(el: HTMLElement): void {
  document.querySelectorAll(".rg-report-target").forEach((n) => n.classList.remove("rg-report-target"));
  el.classList.add("rg-report-target");
  el.scrollIntoView({ block: "nearest" });
}

export async function runReportFlow(el: HTMLElement, adapter: Adapter, v: Verdict): Promise<ReportResult> {
  const reason = adapter.reportReason(v.category);
  const label = `Saran alasan: ${reason} (${CATEGORY_LABEL[v.category]})`;
  el.scrollIntoView({ block: "center" });
  await sleep(250);

  const menuBtn = adapter.getMenuButton(el);
  if (!menuBtn) {
    toast("Bantu laporkan", 'Menu ⋯ komentar ini tidak ditemukan. Buka manual lalu pilih "Laporkan".', label);
    return { stage: "none", reason, note: "Tombol menu tidak ditemukan" };
  }
  menuBtn.click();

  const item = await waitFor(findReportItem);
  if (!item) {
    toast("Bantu laporkan", 'Menu sudah dibuka. Pilih "Laporkan" lalu alasan berikut:', label);
    return { stage: "menu", reason, note: 'Item "Laporkan" tidak ditemukan otomatis' };
  }
  item.click();

  if (!(await waitFor(() => (dialogOpen() ? true : null)))) {
    toast("Bantu laporkan", "Form laporan belum muncul. Lanjutkan manual dengan alasan berikut:", label);
    return { stage: "menu", reason, note: "Dialog laporan tidak terdeteksi" };
  }

  const option = await waitFor(() => findReasonOption(v.category), 2500);
  if (!option) {
    toast("Hampir selesai", "Form laporan sudah terbuka. Pilih alasan berikut, lalu kirim:", label);
    return { stage: "dialog", reason, note: "Pilihan alasan tidak cocok otomatis" };
  }
  option.click();
  mark(option);
  toast("Tinggal 1 langkah", `Alasan "${textOf(option)}" sudah dipilih. Periksa, lalu tekan Berikutnya / Kirim sendiri.`, "");
  return { stage: "reason", reason: textOf(option), note: "" };
}

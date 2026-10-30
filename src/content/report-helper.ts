import { verdictLabel, type Category, type Verdict } from "../core/types";
import type { ReportResult } from "../shared/messages";
import type { Adapter } from "./adapters/types";

/*
 * Alur lapor semi-otomatis: buka menu ⋯ → klik "Laporkan" → pilih alasan → lewati layar "Berikutnya"
 * → berhenti di tombol kirim (sudah difokuskan). Klik kirim SELALU dilakukan pengguna;
 * begitu pengguna mengirim, HideMent lanjut otomatis ke komentar berikutnya di antrian.
 */

const REPORT_ITEM_RE = /^(laporkan|report|lapor)(\s+(komentar|postingan|post|comment|tweet|kiriman))?\b/i;
const FINAL_BUTTON_RE = /^(kirim|submit|send|laporkan|report|selesai|done|berikutnya|next|lanjut|batal|cancel|tutup|close|kembali|back)$/i;
const NEXT_RE = /^(berikutnya|selanjutnya|next|lanjut|lanjutkan|continue)$/i;
const SUBMIT_RE = /^(kirim|kirim laporan|laporkan|submit|submit report|report|send)$/i;
const DISMISS_RE = /^(selesai|done|tutup|close|oke|ok)$/i;
const MAX_STEPS = 5;

/** Pola alasan per kategori, urut dari yang paling tepat. Pola pertama yang cocok menang. */
export const REASON_RE: Record<Category, RegExp[]> = {
  judol: [/perjudian|judi|gambling|taruhan/i, /spam|menyesatkan|misleading/i],
  spam: [/spam|menyesatkan|misleading/i],
  phishing: [/phishing|penipuan|scam|fraud|peniruan|impersonat|tautan berbahaya|malicious link|mencurigakan/i, /spam/i],
  scam: [/penipuan|scam|fraud|mencurigakan/i, /spam|menyesatkan/i],
  hinaan: [/hinaan|penghinaan|menghina|merendahkan|insult|kata kasar/i, /pelecehan|penindasan|perundungan|bullying|harassment|penyalahgunaan|penganiayaan|abuse/i, /kasar/i],
  perundungan: [/perundungan|penindasan|bullying|merundung|terarah|targeted/i, /pelecehan|harassment|penyalahgunaan|penganiayaan|abuse/i],
  sarkasme: [/hinaan|penghinaan|merendahkan|insult/i, /pelecehan|penindasan|perundungan|bullying|harassment|penyalahgunaan|penganiayaan|abuse/i],
  sara: [/kebencian|hate|benci|diskrimin|ras\b|rasis|agama|suku|etnis|slur/i],
  ancaman: [/ancaman|mengancam|threat/i, /kekerasan|violen/i],
  pelecehan: [/seksual|sexual/i, /pelecehan|harassment/i],
  penistaan: [/agama|religi|kebencian|hate|benci/i],
  kustom: [/lainnya|other|something else/i],
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

function dialogButtons(): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const root of document.querySelectorAll<HTMLElement>(DIALOG_SEL)) {
    if (!visible(root) || ours(root)) continue;
    root.querySelectorAll<HTMLElement>('button, [role="button"], tp-yt-paper-button, yt-button-shape button').forEach((b) => {
      if (visible(b) && !ours(b) && !out.includes(b)) out.push(b);
    });
  }
  return out;
}

const buttonMatching = (re: RegExp) =>
  dialogButtons().find((b) => re.test(textOf(b)) && !b.hasAttribute("disabled") && b.getAttribute("aria-disabled") !== "true") ?? null;

const dialogText = () =>
  [...document.querySelectorAll<HTMLElement>(DIALOG_SEL)].filter((d) => visible(d) && !ours(d)).map(textOf).join("|");

/** Tutup sisa layar "Terima kasih" dari laporan sebelumnya (tombol Selesai / Tutup), bukan form yang belum dikirim. */
async function dismissLeftover(): Promise<void> {
  if (buttonMatching(SUBMIT_RE)) return;
  const done = buttonMatching(DISMISS_RE);
  if (done) {
    done.click();
    await sleep(400);
  }
}

function dialogOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>(DIALOG_SEL)].some((d) => visible(d) && !ours(d) && /laporkan|report|lapor/i.test(textOf(d)));
}

function toast(title: string, body: string, reason: string, ms = 10000): void {
  document.querySelector(".rg-toast")?.remove();
  const t = document.createElement("div");
  t.className = "rg-toast";
  t.setAttribute("role", "status");
  t.innerHTML = `<b></b><div class="rg-toast-body"></div><div class="rg-toast-reason"></div><small>HideMent tidak pernah mengirim laporan sendiri. Kamu yang menekan tombol kirim.</small>`;
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

export async function runReportFlow(el: HTMLElement, adapter: Adapter, v: Verdict, onSubmitted?: () => void): Promise<ReportResult> {
  const reason = adapter.reportReason(v.category);
  const label = `Saran alasan: ${reason} (${verdictLabel(v)})`;
  await dismissLeftover();
  el.scrollIntoView({ block: "center" });
  await sleep(250);

  const menuBtn = adapter.getMenuButton(el);
  if (!menuBtn) {
    toast("Bantu laporkan", 'Menu titik tiga komentar ini tidak ditemukan. Buka manual lalu pilih "Laporkan".', label);
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

  let picked = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const submit = buttonMatching(SUBMIT_RE);
    if (submit) return handOver(submit, v, picked || reason, onSubmitted);

    const option = await waitFor(() => findReasonOption(v.category), step === 0 ? 2500 : 1200);
    if (option) {
      option.click();
      mark(option);
      picked = picked ? `${picked} / ${textOf(option)}` : textOf(option);
      await sleep(250);
    }

    const finalBtn = buttonMatching(SUBMIT_RE);
    if (finalBtn) return handOver(finalBtn, v, picked || reason, onSubmitted);

    const next = await waitFor(() => buttonMatching(NEXT_RE), 1200);
    if (!next || (!option && step > 0)) {
      toast("Pilih sendiri di layar ini", option ? "HideMent tidak yakin langkah berikutnya. Lanjutkan manual:" : "Pilihan di layar ini tidak cocok otomatis. Pilih yang paling sesuai:", label);
      return { stage: picked ? "reason" : "dialog", reason: picked || reason, note: "" };
    }
    const before = dialogText();
    next.click();
    await waitFor(() => (dialogText() !== before ? true : null), 3000);
    await sleep(200);
  }
  toast("Hampir selesai", "Form laporan sudah terisi sebagian. Lanjutkan & kirim sendiri.", label);
  return { stage: "reason", reason: picked || reason, note: "" };
}

/** Berhenti di tombol kirim: fokuskan, tandai, dan beri tahu antrian saat pengguna sendiri yang menekannya. */
function handOver(submit: HTMLElement, v: Verdict, reason: string, onSubmitted?: () => void): ReportResult {
  mark(submit);
  submit.focus();
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    submit.removeEventListener("click", onClick, true);
    submit.classList.remove("rg-report-target");
    onSubmitted?.();
  };
  submit.addEventListener("click", onClick, true);
  toast(
    "Tinggal tekan Kirim",
    `Alasan: ${reason}. Tekan Enter atau klik "${textOf(submit)}". ${onSubmitted ? "HideMent lanjut otomatis ke komentar berikutnya." : ""}`.trim(),
    `${verdictLabel(v)} · skor ${v.score}`,
    20000,
  );
  return { stage: "submit", reason, note: "" };
}

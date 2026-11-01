import { verdictLabel, type Category, type Verdict } from "../core/types";
import type { ReportResult } from "../shared/messages";
import type { Adapter } from "./adapters/types";

/*
 * Alur lapor: buka menu ⋯ → klik "Laporkan" → pilih alasan → lewati layar "Berikutnya" → tombol kirim.
 * - Mode bantu (default): berhenti di tombol kirim yang sudah difokuskan; pengguna yang menekannya,
 *   lalu HideMent lanjut otomatis ke komentar berikutnya di antrian.
 * - Mode otomatis (dipicu pengguna lewat "Laporkan semua otomatis"): HideMent sendiri yang menekan kirim,
 *   TAPI hanya kalau alasannya berhasil dipilih otomatis. Kalau ragu, form ditutup dan komentar ditandai gagal,
 *   tidak pernah dikirim dengan alasan tebakan.
 */

const REPORT_ITEM_RE = /^(laporkan|report|lapor)(\s+(komentar|postingan|post|comment|tweet|kiriman))?\b/i;
const FINAL_BUTTON_RE = /^(kirim|submit|send|laporkan|report|selesai|done|berikutnya|next|lanjut|batal|cancel|tutup|close|kembali|back)$/i;
const NEXT_RE = /^(berikutnya|selanjutnya|next|lanjut|lanjutkan|continue)$/i;
const SUBMIT_RE = /^(kirim|kirim laporan|laporkan|submit|submit report|report|send)$/i;
const DISMISS_RE = /^(selesai|done|tutup|close|oke|ok)$/i;
const CANCEL_RE = /^(batal|batalkan|cancel|tutup|close|kembali|back)$/i;
/** Layar/toast konfirmasi setelah laporan terkirim, dalam bahasa Indonesia & Inggris. */
export const SENT_RE =
  /terima kasih|thanks for|thank you|laporan(mu| kamu| anda)? (telah |sudah )?(dikirim|terkirim|diterima)|report(ed)?\s+(was\s+|has been\s+)?(sent|submitted|received)|we['’]ll review|kami akan meninjau|kamu (telah )?melaporkan|you reported|sudah dilaporkan/i;
const SENT_WAIT_MS = 7000;
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
  '[data-e2e="comment-report"], [role="menuitem"], tp-yt-paper-item, ytd-menu-service-item-renderer, [role="menu"] [role="button"], [role="dialog"] button, [role="dialog"] [role="button"], [role="listbox"] li, li[data-e2e], button';
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
const ours = (el: Element) => Boolean(el.closest(".rg-pop, .rg-toast, .rg-badge, .rg-chiprow, .rg-hidden-bar, .rg-scanbar"));
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

const FOOT_ASSIST = "HideMent tidak mengirim laporan sendiri di mode ini. Kamu yang menekan tombol kirim.";
const FOOT_AUTO = "Lapor otomatis: HideMent hanya mengirim kalau alasannya cocok.";

function toast(title: string, body: string, reason: string, ms = 10000, foot = FOOT_ASSIST, tone: "info" | "ok" | "err" = "info"): void {
  document.querySelector(".rg-toast")?.remove();
  const t = document.createElement("div");
  t.className = "rg-toast";
  t.dataset.tone = tone;
  t.setAttribute("role", "status");
  t.innerHTML = `<b></b><div class="rg-toast-body"></div><div class="rg-toast-reason"></div><small></small>`;
  t.querySelector("small")!.textContent = foot;
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

/** Tutup form laporan yang tidak jadi dikirim supaya laporan berikutnya mulai dari keadaan bersih. */
async function closeDialog(): Promise<void> {
  const escape = (target: EventTarget | null) =>
    target?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  for (let i = 0; i < 3 && dialogOpen(); i++) {
    const cancel = buttonMatching(CANCEL_RE) ?? dialogButtons().find((b) => /close|tutup/i.test(b.getAttribute("aria-label") ?? ""));
    if (cancel) cancel.click();
    else escape(document.activeElement);
    await sleep(350);
  }
  escape(document.body);
}

const liveText = () =>
  [...document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"], [aria-live], [class*="toast" i]')]
    .filter((n) => visible(n) && !ours(n))
    .map(textOf)
    .join("|");

/** Tekan kirim lalu tunggu bukti dari platform: layar "Terima kasih", toast konfirmasi, atau form tertutup. */
async function submitAndConfirm(submit: HTMLElement): Promise<boolean> {
  submit.click();
  const ok = await waitFor(() => {
    if (SENT_RE.test(dialogText()) || SENT_RE.test(liveText())) return true;
    return !submit.isConnected && !dialogOpen() ? true : null;
  }, SENT_WAIT_MS);
  await sleep(300);
  await dismissLeftover();
  if (!ok) await closeDialog();
  return Boolean(ok);
}

export interface ReportOptions {
  /** HideMent sendiri yang menekan kirim (dipicu pengguna dari "Laporkan semua otomatis" di Antrian). */
  auto?: boolean;
  /** Dipanggil saat pengguna sendiri menekan kirim (mode bantu). */
  onSubmitted?: () => void;
}

export async function runReportFlow(el: HTMLElement, adapter: Adapter, v: Verdict, opts: ReportOptions = {}): Promise<ReportResult> {
  const reason = adapter.reportReason(v.category);
  const label = `Saran alasan: ${reason} (${verdictLabel(v)})`;
  const { auto, onSubmitted } = opts;
  /* Mode otomatis tidak boleh meninggalkan form setengah jadi atau toast "pilih sendiri": gagal = tutup form & lapor balik. */
  const fail = async (stage: ReportResult["stage"], note: string): Promise<ReportResult> => {
    await closeDialog();
    toast("Lapor otomatis gagal", note, label, 5000, FOOT_AUTO, "err");
    return { stage, reason, note };
  };
  await dismissLeftover();
  el.scrollIntoView({ block: "center" });
  await sleep(250);

  const menuBtn = adapter.getMenuButton(el);
  if (!menuBtn && auto) return fail("none", "Menu titik tiga komentar ini tidak ditemukan.");
  if (!menuBtn) {
    toast("Bantu laporkan", 'Menu titik tiga komentar ini tidak ditemukan. Buka manual lalu pilih "Laporkan".', label);
    return { stage: "none", reason, note: "Tombol menu tidak ditemukan" };
  }
  menuBtn.click();

  const item = await waitFor(findReportItem);
  if (!item && auto) return fail("menu", 'Item "Laporkan" tidak muncul (pastikan sudah login).');
  if (!item) {
    toast("Bantu laporkan", 'Menu sudah dibuka. Pilih "Laporkan" lalu alasan berikut:', label);
    return { stage: "menu", reason, note: 'Item "Laporkan" tidak ditemukan otomatis' };
  }
  item.click();

  if (!(await waitFor(() => (dialogOpen() ? true : null)))) {
    if (auto) return fail("menu", "Form laporan tidak muncul.");
    toast("Bantu laporkan", "Form laporan belum muncul. Lanjutkan manual dengan alasan berikut:", label);
    return { stage: "menu", reason, note: "Dialog laporan tidak terdeteksi" };
  }

  const finish = async (submit: HTMLElement, picked: string): Promise<ReportResult> => {
    if (!auto) return handOver(submit, v, picked || reason, onSubmitted);
    if (!picked) return fail("dialog", "Alasan laporan tidak cocok otomatis, jadi tidak dikirim.");
    if (await submitAndConfirm(submit)) {
      toast("Laporan terkirim", `Alasan: ${picked}`, `${verdictLabel(v)} · skor ${v.score}`, 3500, FOOT_AUTO, "ok");
      return { stage: "sent", reason: picked, note: "" };
    }
    return fail("submit", "Tombol kirim sudah ditekan, tapi platform tidak menampilkan konfirmasi.");
  };

  let picked = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const submit = buttonMatching(SUBMIT_RE);
    if (submit) return finish(submit, picked);

    const option = await waitFor(() => findReasonOption(v.category), step === 0 ? 2500 : 1200);
    if (option) {
      option.click();
      mark(option);
      picked = picked ? `${picked} / ${textOf(option)}` : textOf(option);
      await sleep(250);
    }

    const finalBtn = buttonMatching(SUBMIT_RE);
    if (finalBtn) return finish(finalBtn, picked);

    const next = await waitFor(() => buttonMatching(NEXT_RE), 1200);
    if (!next || (!option && step > 0)) {
      if (auto) return fail(picked ? "reason" : "dialog", "Langkah form laporan tidak dikenali, jadi tidak dikirim.");
      toast("Pilih sendiri di layar ini", option ? "HideMent tidak yakin langkah berikutnya. Lanjutkan manual:" : "Pilihan di layar ini tidak cocok otomatis. Pilih yang paling sesuai:", label);
      return { stage: picked ? "reason" : "dialog", reason: picked || reason, note: "" };
    }
    const before = dialogText();
    next.click();
    await waitFor(() => (dialogText() !== before ? true : null), 3000);
    await sleep(200);
  }
  if (auto) return fail("reason", "Form laporan terlalu panjang untuk diisi otomatis.");
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

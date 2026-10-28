import type { ScanProgress } from "../shared/messages";
import type { Adapter } from "./adapters/types";

/*
 * Pindai Cepat: memuat semua komentar sebuah postingan tanpa pengguna perlu scroll.
 * HideMent menggulir wadah komentar sampai mentok, membuka "Tampilkan balasan",
 * lalu mengembalikan posisi scroll ke tempat semula.
 */

const EXPAND_RE =
  /^\d+\s+(balasan|replies|reply)$|(tampilkan|lihat|muat|show|view|load)\b.{0,30}\b(balasan|replies|reply|komentar|comments|tambahan|additional)/i;
const SKIP_RE = /sembunyikan|hide|tutup|terjemah|translate|yang asli|original/i;
const LOAD_MORE_SEL = '[aria-label*="load more comments" i], [aria-label*="muat komentar" i], [aria-label*="more comments" i]';
const BUTTON_SEL = 'button, [role="button"], tp-yt-paper-button, ytd-button-renderer, span[role="button"]';
const EXCLUDE_SEL = '[data-testid="sidebarColumn"], aside, nav, header, [role="navigation"], .rg-scanbar, .rg-pop, .rg-toast';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = (el: HTMLElement) => el.getClientRects().length > 0;

export interface FastScanDeps {
  adapter: Adapter;
  /** Pindai DOM sekarang; kembalikan jumlah komentar unik yang sudah dikirim untuk dianalisis. */
  scanNow(): number;
  setEager(on: boolean): void;
  max(): number;
  replies(): boolean;
}

function scrollerFor(el: Element | undefined): HTMLElement | null {
  for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 40) return p;
  }
  return null;
}

export class FastScanner {
  private running = false;
  private abort = false;
  private clicked = new WeakSet<Element>();
  private bar: HTMLElement | null = null;

  constructor(private deps: FastScanDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.abort = true;
  }

  private emit(state: ScanProgress["state"], loaded: number, note?: string): void {
    const msg: ScanProgress = { type: "scanProgress", state, loaded, max: this.deps.max(), note };
    chrome.runtime.sendMessage(msg).catch(() => undefined);
    this.renderBar(msg);
  }

  private renderBar(p: ScanProgress): void {
    if (!this.bar) {
      this.bar = document.createElement("div");
      this.bar.className = "rg-scanbar";
      this.bar.setAttribute("role", "status");
      this.bar.innerHTML = `<span class="rg-sb-name">HideMent</span><span class="rg-sb-text"></span><span class="rg-sb-meter"><i></i></span><button type="button" class="rg-btn">Stop</button>`;
      this.bar.querySelector("button")!.addEventListener("click", () => this.stop());
      document.body.append(this.bar);
    }
    const done = p.state !== "running";
    this.bar.dataset.state = p.state;
    const text = this.bar.querySelector<HTMLElement>(".rg-sb-text")!;
    if (p.state === "error") text.textContent = p.note ?? "Komentar tidak ditemukan";
    else {
      text.textContent = p.state === "running" ? "Memindai komentar " : p.state === "stopped" ? "Dihentikan · " : "Selesai · ";
      const b = document.createElement("b");
      b.textContent = String(p.loaded);
      text.append(b, p.state === "running" ? "" : " komentar");
    }
    this.bar.querySelector<HTMLElement>(".rg-sb-meter i")!.style.width = `${Math.min(100, (p.loaded / p.max) * 100)}%`;
    this.bar.querySelector("button")!.hidden = done;
    if (done) {
      const bar = this.bar;
      this.bar = null;
      setTimeout(() => bar.remove(), 4000);
    }
  }

  private expandReplies(root: ParentNode, limit: number): number {
    let n = 0;
    const tryClick = (el: HTMLElement | null) => {
      if (!el || n >= limit || this.clicked.has(el) || !visible(el) || el.closest(EXCLUDE_SEL)) return;
      this.clicked.add(el);
      el.click();
      n++;
    };
    root.querySelectorAll<HTMLElement>(LOAD_MORE_SEL).forEach((el) => tryClick(el.closest<HTMLElement>('button, [role="button"]') ?? el));
    if (!this.deps.replies()) return n;
    for (const el of root.querySelectorAll<HTMLElement>(BUTTON_SEL)) {
      if (n >= limit) break;
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 80 || SKIP_RE.test(t) || !EXPAND_RE.test(t)) continue;
      if (el.parentElement?.closest(BUTTON_SEL) && this.clicked.has(el.parentElement.closest(BUTTON_SEL)!)) continue;
      tryClick(el);
    }
    return n;
  }

  async run(): Promise<void> {
    if (this.running) return;
    const { adapter } = this.deps;
    this.running = true;
    this.abort = false;
    this.deps.setEager(true);
    const startY = scrollY;
    let scroller: HTMLElement | null = null;
    let scrollerStart = 0;

    try {
      this.emit("running", this.deps.scanNow());

      for (let i = 0; i < 10 && !this.abort && adapter.findComments(document).length === 0; i++) {
        window.scrollBy(0, innerHeight * 0.9);
        await sleep(700);
      }
      if (!adapter.findComments(document).length) {
        this.emit("error", 0, "Komentar tidak ditemukan. Buka kolom komentar postingan dulu.");
        return;
      }

      let last = -1;
      let stagnant = 0;
      while (!this.abort && stagnant < 4) {
        const loaded = this.deps.scanNow();
        if (loaded >= this.deps.max()) break;
        const comments = adapter.findComments(document);
        const root = comments[0]?.closest("main, [role='dialog']") ?? document;
        const expanded = this.expandReplies(root, 6);

        const sc = scrollerFor(comments[comments.length - 1]);
        if (sc && sc !== scroller) {
          scroller = sc;
          scrollerStart = sc.scrollTop;
        }
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        else window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(expanded ? 1100 : 850);

        const now = this.deps.scanNow();
        stagnant = now === last ? stagnant + 1 : 0;
        last = now;
        this.emit("running", now);
      }
      this.emit(this.abort ? "stopped" : "done", this.deps.scanNow());
    } finally {
      if (scroller) scroller.scrollTop = scrollerStart;
      window.scrollTo({ top: startY });
      this.deps.setEager(false);
      this.running = false;
    }
  }
}

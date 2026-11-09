import type { CommentBudget } from "../core/limits";
import type { ScanProgress } from "../shared/messages";
import type { Adapter } from "./adapters/types";

/*
 * Analyze komentar postingan ini: memuat semua komentar sebuah postingan tanpa pengguna perlu scroll.
 * HideMent membuka panel komentar kalau masih tertutup, membaca jumlah komentar yang ditampilkan platform,
 * menggulir wadah komentar sampai mentok, membuka "Tampilkan balasan", lalu mengembalikan posisi scroll.
 */

/* Reddit: "more replies", "1 more reply", "View more comments", "muat komentar lainnya" (FR-17).
   "Continue this thread"/"Lanjutkan utas ini" SENGAJA tidak dicocokkan: membuka halaman baru dan
   memutus pemindaian — cabang itu cukup tercatat sebagai yang tidak termuat (FR-18). */
const EXPAND_RE =
  /^\d+\s+(balasan|replies|reply)$|(tampilkan|lihat|muat|show|view|load)\b.{0,30}\b(balasan|replies|reply|komentar|comments|tambahan|additional)|^more\s+repl(y|ies)$|^\d+\s+more\s+repl(y|ies)$|^\d*\s*(balasan|komentar)\s+(lagi|lainnya)$/i;
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
  /** Kuota komentar per postingan yang berlaku sekarang (satu instansi per postingan). */
  budget(): CommentBudget;
  /** Tambah kuota postingan ini saja (tombol "Baca N lagi"); tidak mengubah pengaturan. */
  extend(n: number): void;
  /** Lanjutkan analisis setelah kuota ditambah: amati lagi (mode scroll) atau gulir lagi (Pindai Cepat). */
  resume(): void;
  replies(): boolean;
  /** Jumlah komentar menurut platform (dibaca ulang tiap putaran karena angkanya kadang baru muncul belakangan). */
  total(): number | null;
}

export const fmt = (n: number) => n.toLocaleString("id-ID");

export function scrollerFor(el: Element | undefined): HTMLElement | null {
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

  private emit(state: ScanProgress["state"], loaded: number, note?: string, reason?: ScanProgress["reason"]): void {
    const total = this.deps.total();
    const limit = this.deps.budget().limit;
    const max = total ? Math.min(limit, total) : limit;
    const msg: ScanProgress = { type: "scanProgress", state, loaded, max, total, note, limit };
    if (reason) msg.reason = reason;
    chrome.runtime.sendMessage(msg).catch(() => undefined);
    this.renderBar(msg);
  }

  /** Tuas tombol di bar pindai: Stop saat berjalan, "Baca N lagi" saat berhenti karena batas. */
  private renderBar(p: ScanProgress): void {
    if (!this.bar) {
      this.bar = document.createElement("div");
      this.bar.className = "rg-scanbar";
      this.bar.setAttribute("role", "status");
      this.bar.innerHTML = `<span class="rg-sb-name">HideMent</span><span class="rg-sb-text"></span><span class="rg-sb-meter"><i></i></span><button type="button" class="rg-btn" data-stop>Stop</button><button type="button" class="rg-btn" data-more hidden>Baca N lagi</button>`;
      this.bar.querySelector("[data-stop]")!.addEventListener("click", () => this.stop());
      this.bar.querySelector("[data-more]")!.addEventListener("click", () => {
        const n = this.deps.budget().limit;
        this.deps.extend(n);
        this.deps.resume();
      });
      document.body.append(this.bar);
    }
    const done = p.state !== "running";
    /* Berhenti karena kuota: bar tetap tampil (bawa tombol "Baca N lagi"), selainnya hilang sendiri. */
    const limitStop = done && p.state !== "error" && p.reason === "limit";
    this.bar.dataset.state = p.state;
    const text = this.bar.querySelector<HTMLElement>(".rg-sb-text")!;
    if (p.state === "error") text.textContent = p.note ?? "Komentar tidak ditemukan";
    else {
      text.textContent = p.state === "running" ? "Menganalisis " : limitStop ? "" : p.state === "stopped" ? "Dihentikan · " : "Selesai · ";
      const b = document.createElement("b");
      b.textContent = fmt(p.loaded);
      const dibaca = limitStop ? " dibaca" : "";
      text.append(b, p.total ? ` dari ${fmt(p.total)} komentar${dibaca}` : ` komentar${dibaca}`, p.note ? ` · ${p.note}` : limitStop ? " · batas tercapai" : "");
    }
    this.bar.querySelector<HTMLElement>(".rg-sb-meter i")!.style.width = `${Math.min(100, (p.loaded / p.max) * 100)}%`;
    this.bar.querySelector<HTMLElement>("[data-stop]")!.hidden = done;
    const more = this.bar.querySelector<HTMLElement>("[data-more]")!;
    more.hidden = !limitStop;
    if (limitStop) more.textContent = `Baca ${fmt(this.deps.budget().limit)} lagi`;
    if (done && !limitStop) {
      const bar = this.bar;
      this.bar = null;
      setTimeout(() => bar.remove(), 4000);
    }
  }

  /** Tampilkan bar "batas tercapai" tanpa menjalankan pindai (mode Saat scroll: kuota habis saat pengguna menggulir). */
  limitReached(budget: CommentBudget): void {
    this.renderBar({ type: "scanProgress", state: "done", loaded: budget.used, max: budget.limit, total: this.deps.total(), limit: budget.limit, reason: "limit" });
  }

  /** Buang bar pindai (dipanggil saat postingan berganti supaya info lama tidak menggantung). */
  dismiss(): void {
    this.bar?.remove();
    this.bar = null;
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

      /* TikTok dkk.: komentar ada di panel yang harus dibuka dulu. Menggulir jendela di sana justru pindah ke video lain. */
      const hasComments = () => adapter.findComments(document).length > 0;
      if (adapter.openComments) {
        for (let i = 0; i < 3 && !this.abort && !hasComments(); i++) {
          adapter.openComments(document);
          for (let t = 0; t < 12 && !hasComments(); t++) await sleep(300);
        }
      } else {
        for (let i = 0; i < 10 && !this.abort && !hasComments(); i++) {
          window.scrollBy(0, innerHeight * 0.9);
          await sleep(700);
        }
      }
      if (!hasComments()) {
        const total = this.deps.total();
        this.emit("error", 0, total === 0 ? "Postingan ini belum punya komentar." : "Komentar tidak ditemukan. Buka kolom komentar postingan dulu.");
        return;
      }

      let last = -1;
      let stagnant = 0;
      while (!this.abort && stagnant < 4) {
        const loaded = this.deps.scanNow();
        const total = this.deps.total();
        /* Kuota postingan habis → berhenti menggulir; jangan memuat komentar yang tidak akan dianalisis. */
        if (this.deps.budget().exhausted || (total && loaded >= total)) break;
        const comments = adapter.findComments(document);
        const root = comments[0]?.closest("main, [role='dialog']") ?? document;
        const expanded = this.expandReplies(root, 6);

        const sc = scrollerFor(comments[comments.length - 1]);
        if (sc && sc !== scroller) {
          scroller = sc;
          scrollerStart = sc.scrollTop;
        }
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        else if (adapter.openComments) comments[comments.length - 1]?.scrollIntoView({ block: "end" });
        else window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(expanded ? 1100 : 850);

        const now = this.deps.scanNow();
        stagnant = now === last ? stagnant + 1 : 0;
        last = now;
        this.emit("running", now);
      }
      const budget = this.deps.budget();
      const reason: ScanProgress["reason"] = this.abort ? "stopped" : budget.exhausted ? "limit" : "end";
      const loaded = reason === "limit" ? budget.used : this.deps.scanNow();
      const total = this.deps.total();
      /* Jauh di bawah jumlah resmi tapi tidak bertambah lagi: biasanya platform membatasi tamu (TikTok tanpa login hanya memberi 20). */
      const cut = reason === "end" && total && this.deps.replies() && loaded < total * 0.5;
      this.emit(this.abort ? "stopped" : "done", loaded, cut ? "Platform berhenti memuat komentar. Pastikan sudah login, lalu coba lagi." : undefined, reason);
    } finally {
      if (scroller) scroller.scrollTop = scrollerStart;
      window.scrollTo({ top: startY });
      this.deps.setEager(false);
      this.running = false;
    }
  }
}

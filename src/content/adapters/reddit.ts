import { parseCount } from "../../core/links";
import { genericReason, textOf, type Adapter, type BadgeSlot } from "./types";

/*
 * Reddit punya dua DOM yang masih dipakai:
 * - Baru (www/sh.reddit.com): web component <shreddit-comment> bertingkat. Komentar bersarang adalah
 *   elemen terpisah, jadi teks hanya dibaca dari [slot="comment"] milik elemen itu sendiri (FR-7/FR-8).
 *   Metadata diambil dari ATRIBUT (author, permalink, comment-count di shreddit-post), bukan class CSS,
 *   supaya tahan terhadap perubahan gaya Reddit (lihat PRD bagian risiko).
 * - Lama (old.reddit.com): HTML klasik .thing.comment; isi di .usertext-body .md milik .entry komentar itu,
 *   komentar bersarang ada di .child yang berada DI LUAR .entry induknya (FR-21/FR-22).
 * Catatan riset: fetch server-side ke reddit.com diblokir (login wall), jadi selektor mengikuti struktur
 * terdokumentasi di PRD dan wajib diverifikasi manual lewat checklist PR. Perubahan selektor hanya di file ini.
 */

const DELETED_RE = /^\[(?:deleted|removed|dihapus)(?: oleh (?:moderator|mod|pengguna))?\]$/i;

const onOld = (): boolean => /(^|\.)old\.reddit\.com$/.test(location.hostname);

/* ── Reddit baru ──────────────────────────────────────────────────────────── */

/** [slot="comment"] milik komentar INI; slot milik shreddit-comment yang lebih dalam diabaikan. */
function ownSlot(el: HTMLElement): HTMLElement | null {
  for (const n of el.querySelectorAll<HTMLElement>('[slot="comment"]')) {
    if (n.closest("shreddit-comment") === el) return n;
  }
  return null;
}

/* ── old.reddit ───────────────────────────────────────────────────────────── */

function ownEntry(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>(":scope > .entry");
}

function oldTextEl(el: HTMLElement): HTMLElement | null {
  return ownEntry(el)?.querySelector<HTMLElement>(":scope > .usertext .usertext-body .md") ?? null;
}

function oldAuthor(el: HTMLElement): string {
  return textOf(ownEntry(el)?.querySelector(".author")).replace(/^u\//, "");
}

function oldPermalink(el: HTMLElement): string | null {
  return ownEntry(el)?.querySelector<HTMLAnchorElement>("a.bylink")?.href ?? null;
}

/** Link "report" di ul.buttons — old.reddit tidak punya menu titik tiga; ini membuka form inline (FR-23). */
function oldReportLink(el: HTMLElement): HTMLElement | null {
  for (const a of ownEntry(el)?.querySelectorAll<HTMLElement>("ul.buttons a") ?? []) {
    if (/^(lapor|report)/i.test(textOf(a))) return a;
  }
  return null;
}

export const reddit: Adapter = {
  platform: "reddit",

  findComments: (root) =>
    onOld()
      ? [...root.querySelectorAll<HTMLElement>(".thing.comment")]
      : [...root.querySelectorAll<HTMLElement>("shreddit-comment")],

  getTextEl: (el) => (onOld() ? oldTextEl(el) : ownSlot(el)),

  /* Komentar [deleted]/[removed] dikosongkan supaya dilewati pemindaian (FR-8). */
  getText: (el) => {
    const raw = textOf(onOld() ? oldTextEl(el) : ownSlot(el));
    return DELETED_RE.test(raw) ? "" : raw;
  },

  /* Atribut author biasanya tanpa awalan; awalan u/ dibuang kalau-kalau ada (FR-9). */
  getAuthor: (el) => {
    const a = onOld()
      ? oldAuthor(el)
      : (el.getAttribute("author") ?? "").replace(/^u\//, "").trim();
    return DELETED_RE.test(a) ? "" : a;
  },

  getBadgeSlot: (el): BadgeSlot | null => {
    const t = onOld() ? oldTextEl(el) : ownSlot(el);
    return t ? { node: t, where: "row" } : null;
  },

  getMenuButton: (el) => {
    if (onOld()) return oldReportLink(el);
    /* Tombol overflow (⋯): elemen shreddit dulu (klik pada host-nya membuka menu), lalu tombol ber-label.
       Kalau Reddit kelak memindahkannya ke dalam shadow root, perluas pencarian ke el.shadowRoot (FR-12). */
    const host = el.querySelector<HTMLElement>("shreddit-overflow-menu, shreddit-comment-overflow-menu");
    if (host) return host.querySelector<HTMLElement>("button, [role='button']") ?? host;
    return (
      el.querySelector<HTMLElement>('button[aria-label*="more options" i], button[aria-label*="opsi" i]') ??
      el.querySelector<HTMLElement>('[aria-haspopup="menu"]')
    );
  },

  /* Atribut permalink berupa path relatif; dijadikan absolut supaya tombol Lihat membuka komentar (FR-10). */
  getPermalink: (el) => {
    if (onOld()) return oldPermalink(el);
    const p = el.getAttribute("permalink");
    if (!p) return null;
    try {
      return new URL(p, location.origin).href;
    } catch {
      return null;
    }
  },

  /* Pemetaan kategori → alasan lapor Reddit (FR-16). kustom/aman tidak dipetakan ke alasan Reddit:
     alurnya otomatis menolak mengirim bila tidak ada opsi yang cocok (aturan keamanan FR-26). */
  reportReason: (c) => {
    if (c === "judol" || c === "spam" || c === "phishing" || c === "scam") return "Spam";
    if (c === "hinaan" || c === "perundungan" || c === "sarkasme" || c === "pelecehan") return "Harassment";
    if (c === "ancaman") return "Threatening violence";
    if (c === "sara" || c === "penistaan") return "Hate";
    return genericReason(c);
  },

  isPostPage: (url) => /^\/r\/[^/]+\/comments\//.test(url.pathname),

  /* Atribut comment-count di shreddit-post dulu; fallback teks "N comments"/"N komentar" (FR-14). */
  getCommentCount: (doc) => {
    if (onOld()) {
      /* old.reddit: "all N comments" di atas kolom komentar; a.comments ada di halaman daftar. */
      return (
        parseCount(doc.querySelector(".commentarea .panestack-title .title")?.textContent) ??
        parseCount(doc.querySelector("a.comments")?.textContent)
      );
    }
    const attr = doc.querySelector("shreddit-post")?.getAttribute("comment-count");
    if (attr && /^\d+$/.test(attr.trim())) return Number(attr.trim());
    for (const el of doc.querySelectorAll<HTMLElement>("shreddit-post a, shreddit-post button, shreddit-post span")) {
      const t = textOf(el);
      if (/komentar|comment/i.test(t)) {
        const n = parseCount(t);
        if (n != null) return n;
      }
    }
    return null;
  },

  /* Thread normal tidak perlu ini; dari feed berbentuk modal, tombol komentar membuka halaman penuh (FR-15). */
  openComments: (doc) => {
    if (onOld()) return false;
    const btn =
      doc.querySelector<HTMLElement>('shreddit-post a[href*="#comment"], shreddit-post a[href*="/comments/"]') ??
      doc.querySelector<HTMLElement>('shreddit-post button[aria-label*="comment" i], shreddit-post button[aria-label*="komentar" i]');
    if (!btn) return false;
    btn.click();
    return true;
  },

  /* Lapor otomatis ditolak di old.reddit: formnya inline, konfirmasi pengirimannya tak terbaca (FR-23).
     Mode bantu tetap jalan: link report dibuka, HideMent berhenti sebelum tombol kirim. */
  autoReportRefusal: (url) => (/^(old|np)\.reddit\.com$/.test(url.hostname) ? "Lapor otomatis belum didukung di old.reddit." : null),
};

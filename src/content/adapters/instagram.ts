import { genericReason, textOf, type Adapter } from "./types";

const REPLY_RE = /^(reply|balas|see translation|lihat terjemahan)$/i;

function hasReplyButton(el: Element): boolean {
  for (const b of el.querySelectorAll('[role="button"], button, span')) {
    if (REPLY_RE.test(textOf(b))) return true;
  }
  return false;
}

function commentRoot(time: Element): HTMLElement | null {
  let el = time.parentElement;
  for (let i = 0; el && i < 9; i++, el = el.parentElement) {
    if (el.querySelectorAll("time").length > 1) return null;
    if (hasReplyButton(el) && el.querySelector('span[dir="auto"]')) return el as HTMLElement;
  }
  return null;
}

function authorOf(el: HTMLElement): string {
  const link = el.querySelector<HTMLAnchorElement>('a[href^="/"][role="link"], a[href^="/"]');
  return (link?.getAttribute("href") ?? "").split("/").filter(Boolean)[0] ?? "";
}

function textElOf(el: HTMLElement): HTMLElement | null {
  const author = authorOf(el);
  let best: HTMLElement | null = null;
  for (const s of el.querySelectorAll<HTMLElement>('span[dir="auto"]')) {
    if (s.closest("a, time, [role='button'], button")) continue;
    const t = textOf(s);
    if (!t || t === author || REPLY_RE.test(t)) continue;
    if (!best || t.length > textOf(best).length) best = s;
  }
  return best;
}

export const instagram: Adapter = {
  platform: "instagram",
  findComments: (root) => {
    const set = new Set<HTMLElement>();
    root.querySelectorAll("main time, div[role='dialog'] time").forEach((t) => {
      const r = commentRoot(t);
      if (r) set.add(r);
    });
    return [...set];
  },
  getTextEl: textElOf,
  getText: (el) => textOf(textElOf(el)),
  getAuthor: authorOf,
  getBadgeAnchor: (el) => el.querySelector<HTMLElement>("time")?.closest("a")?.parentElement ?? null,
  getMenuButton: (el) =>
    el.querySelector<HTMLElement>('svg[aria-label*="option" i], svg[aria-label*="opsi" i]')?.closest<HTMLElement>('[role="button"], button') ?? null,
  reportReason: (c) =>
    c === "judol" || c === "spam" ? "Spam" : c === "scam" || c === "phishing" ? "Penipuan atau kecurangan" : genericReason(c),
};

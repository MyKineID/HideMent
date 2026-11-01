import { parseCount } from "../../core/links";
import { genericReason, textOf, type Adapter } from "./types";

const TEXT_SEL = '[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]';
const CONTAINER_SEL =
  '[class*="CommentObjectWrapper"], [class*="CommentItemContainer"], [class*="DivCommentContentContainer"], [class*="CommentContentWrapper"]';
const COMMENTS_TAB_RE = /^(comments|komentar)(\s*\(?[\d.,]+\s*[kKmM]?\)?)?$/i;

function containerOf(textEl: HTMLElement): HTMLElement {
  return textEl.closest<HTMLElement>(CONTAINER_SEL) ?? textEl.parentElement?.parentElement ?? textEl;
}

/** Halaman video TikTok sekarang berupa feed: beberapa video sekaligus, masing-masing punya action bar sendiri. Ambil milik video di URL. */
function currentArticle(doc: Document, url: URL): Element | null {
  const id = url.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1];
  if (!id) return null;
  return [...doc.querySelectorAll("article")].find((a) => a.innerHTML.includes(id)) ?? null;
}

export const tiktok: Adapter = {
  platform: "tiktok",
  findComments: (root) => {
    const set = new Set<HTMLElement>();
    root.querySelectorAll<HTMLElement>(TEXT_SEL).forEach((t) => set.add(containerOf(t)));
    return [...set];
  },
  getTextEl: (el) => el.querySelector<HTMLElement>(TEXT_SEL),
  getText: (el) => textOf(el.querySelector(TEXT_SEL)),
  getAuthor: (el) =>
    textOf(el.querySelector('[data-e2e^="comment-username"]')) ||
    (el.querySelector<HTMLAnchorElement>('a[href^="/@"]')?.getAttribute("href") ?? "").replace(/^\/@/, "").split(/[/?]/)[0],
  getBadgeSlot: (el) => {
    /* Baris nama akun TikTok berupa flex; badge ditempel di ujungnya supaya tidak menambah baris. */
    const name = el.querySelector<HTMLElement>('[data-e2e^="comment-username"]');
    if (name) return { node: name, where: "inline" };
    const t = el.querySelector<HTMLElement>(TEXT_SEL);
    return t ? { node: t, where: "row" } : null;
  },
  getPermalink: () => null,
  getMenuButton: (el) =>
    el.querySelector<HTMLElement>(
      '[data-e2e="comment-more-icon"], [class*="MoreTrigger"], [class*="MoreIcon"], [aria-label*="more" i], [aria-label*="lainnya" i]',
    ),
  reportReason: (c) => (c === "judol" ? "Perjudian" : c === "spam" ? "Spam" : genericReason(c)),
  isPostPage: (url) => /\/(video|photo)\/\d+/.test(url.pathname),
  getCommentCount: (doc, url) => {
    const el =
      currentArticle(doc, url)?.querySelector('[data-e2e="comment-count"]') ??
      doc.querySelector('[data-e2e="browse-comment-count"]') ??
      doc.querySelector('[class*="DivCommentCountContainer"]') ??
      doc.querySelector('[data-e2e="comment-count"]');
    return parseCount(el?.textContent);
  },
  openComments: (doc) => {
    if (doc.querySelector(TEXT_SEL)) return false;
    /* Layout baru: panel kanan punya tab "Comments | You may like". Layout lama: ikon komentar di action bar. */
    const tab = [...doc.querySelectorAll<HTMLElement>("button, [role='tab']")].find((b) => COMMENTS_TAB_RE.test(textOf(b)));
    const icon = currentArticle(doc, new URL(location.href))?.querySelector<HTMLElement>('[data-e2e="comment-icon"]') ??
      doc.querySelector<HTMLElement>('[data-e2e="browse-comment-icon"], [data-e2e="comment-icon"]');
    const target = tab ?? icon?.closest<HTMLElement>("button, [role='button']") ?? icon;
    if (!target) return false;
    target.click();
    return true;
  },
};

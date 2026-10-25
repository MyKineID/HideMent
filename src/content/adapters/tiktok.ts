import { genericReason, textOf, type Adapter } from "./types";

const TEXT_SEL = '[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]';
const CONTAINER_SEL =
  '[class*="CommentObjectWrapper"], [class*="CommentItemContainer"], [class*="DivCommentContentContainer"], [class*="CommentContentWrapper"]';

function containerOf(textEl: HTMLElement): HTMLElement {
  return textEl.closest<HTMLElement>(CONTAINER_SEL) ?? textEl.parentElement?.parentElement ?? textEl;
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
  getBadgeAnchor: (el) =>
    el.querySelector<HTMLElement>('[data-e2e^="comment-username"]')?.parentElement ?? el.querySelector<HTMLElement>(TEXT_SEL),
  getMenuButton: (el) =>
    el.querySelector<HTMLElement>('[data-e2e="comment-more-icon"], [class*="MoreIcon"], [aria-label*="more" i], [aria-label*="lainnya" i]'),
  reportReason: (c) => (c === "judol" ? "Perjudian" : c === "spam" ? "Spam" : genericReason(c)),
};

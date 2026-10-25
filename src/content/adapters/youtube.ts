import { genericReason, textOf, type Adapter } from "./types";

export const youtube: Adapter = {
  platform: "youtube",
  findComments: (root) =>
    [...root.querySelectorAll<HTMLElement>("ytd-comment-view-model, ytd-comment-renderer")].filter(
      (el) => !el.parentElement?.closest("ytd-comment-view-model, ytd-comment-renderer"),
    ),
  getTextEl: (el) => el.querySelector<HTMLElement>("#content-text"),
  getText: (el) => textOf(el.querySelector("#content-text")),
  getAuthor: (el) => textOf(el.querySelector("#author-text")).replace(/^@/, ""),
  getBadgeSlot: (el) => {
    const node = el.querySelector<HTMLElement>("#header-author") ?? el.querySelector<HTMLElement>("#header");
    return node ? { node, where: "inline" } : null;
  },
  getMenuButton: (el) => el.querySelector<HTMLElement>("#action-menu button, ytd-menu-renderer button"),
  getPermalink: (el) =>
    el.querySelector<HTMLAnchorElement>('#published-time-text a, a[href*="lc="]')?.href ?? null,
  reportReason: (c) =>
    c === "judol" || c === "spam" || c === "phishing" || c === "scam"
      ? "Spam atau menyesatkan"
      : c === "sara"
        ? "Konten kebencian atau kasar"
        : c === "pelecehan"
          ? "Konten seksual"
          : c === "ancaman"
            ? "Mempromosikan terorisme / kekerasan"
            : c === "aman"
              ? genericReason(c)
              : "Pelecehan atau penindasan",
  isPostPage: (url) => /^\/(watch|shorts\/)/.test(url.pathname),
};

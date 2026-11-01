import { parseCount } from "../../core/links";
import { genericReason, textOf, type Adapter } from "./types";

/*
 * X punya dua DOM yang masih beredar:
 * - lama: atribut data-testid (tweet, tweetText, User-Name, caret, reply);
 * - baru (desain "xds", akhir 2026): <article> tanpa data-testid, teks di div.whitespace-pre-wrap,
 *   aksi di [data-engagement-action], dan quote tweet berupa <article> di dalam <article>.
 * Selektor lama dicoba dulu; elemen milik quote tweet tidak pernah dianggap milik komentar luarnya.
 */

/** Elemen di dalam postingan ini sendiri, bukan di quote tweet yang tersemat di dalamnya. */
function own<T extends Element>(el: HTMLElement, sel: string): T[] {
  return [...el.querySelectorAll<T>(sel)].filter((n) => n.closest("article") === el);
}

function textElOf(el: HTMLElement): HTMLElement | null {
  return own<HTMLElement>(el, '[data-testid="tweetText"]')[0] ?? own<HTMLElement>(el, 'div[class*="whitespace-pre-wrap"]')[0] ?? null;
}

function permalinkOf(el: HTMLElement): HTMLAnchorElement | null {
  return (
    own<HTMLAnchorElement>(el, 'a[href*="/status/"]').find((a) => a.querySelector("time")) ??
    own<HTMLAnchorElement>(el, 'a[data-base-ui-tooltip-trigger][href*="/status/"]').find((a) => !/\/(photo|video|analytics)\//.test(a.href)) ??
    null
  );
}

export const x: Adapter = {
  platform: "x",
  findComments: (root) => {
    const legacy = [...root.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')];
    if (legacy.length) return legacy;
    return [...root.querySelectorAll<HTMLElement>("article")].filter(
      (a) => !a.parentElement?.closest("article") && a.querySelector("[data-engagement-action]"),
    );
  },
  getTextEl: textElOf,
  getText: (el) => textOf(textElOf(el)),
  getAuthor: (el) => {
    const legacy = el.querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"]');
    const link = legacy ?? own<HTMLAnchorElement>(el, 'a[href^="/"]').find((a) => /^\/\w+$/.test(a.getAttribute("href") ?? ""));
    return (link?.getAttribute("href") ?? "").split("/")[1] ?? "";
  },
  getBadgeSlot: (el) => {
    /* Baris "Nama ✓": lama = blok pertama User-Name, baru = span flex yang berisi link nama (bukan @handle). */
    const legacy = el.querySelector<HTMLElement>('[data-testid="User-Name"] > div:first-child');
    const nameLink = own<HTMLAnchorElement>(el, 'a[href^="/"]').find((a) => /^\/\w+$/.test(a.getAttribute("href") ?? "") && textOf(a) && !textOf(a).startsWith("@"));
    const row = legacy ?? nameLink?.parentElement;
    if (row) return { node: row, where: "inline" };
    const t = textElOf(el);
    return t ? { node: t, where: "row" } : null;
  },
  getMenuButton: (el) =>
    el.querySelector<HTMLElement>('[data-testid="caret"]') ??
    own<HTMLElement>(el, 'button[aria-haspopup="menu"]').find((b) => !b.closest("[data-engagement-action]") && !b.hasAttribute("data-engagement-action")) ??
    null,
  getPermalink: (el) => permalinkOf(el)?.href ?? null,
  reportReason: (c) => (c === "judol" || c === "spam" ? "Spam" : genericReason(c)),
  isPostPage: (url) => /\/status\/\d+/.test(url.pathname),
  getCommentCount: (doc, url) => {
    const id = url.pathname.match(/\/status\/(\d+)/)?.[1];
    if (!id) return null;
    const main = x.findComments(doc).find((a) => permalinkOf(a)?.pathname.endsWith(`/status/${id}`));
    if (!main) return null;
    const reply =
      main.querySelector('[data-testid="reply"]') ??
      own(main, '[data-engagement-action="reply"] [aria-label]')[0] ??
      own(main, '[data-engagement-action="reply"]')[0];
    return parseCount(reply?.getAttribute("aria-label") ?? reply?.textContent);
  },
};

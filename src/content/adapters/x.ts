import { genericReason, textOf, type Adapter } from "./types";

export const x: Adapter = {
  platform: "x",
  findComments: (root) => [...root.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')],
  getTextEl: (el) => el.querySelector<HTMLElement>('[data-testid="tweetText"]'),
  getText: (el) => textOf(el.querySelector('[data-testid="tweetText"]')),
  getAuthor: (el) => {
    const href = el.querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"]')?.getAttribute("href") ?? "";
    return href.split("/")[1] ?? "";
  },
  getBadgeAnchor: (el) => el.querySelector<HTMLElement>('[data-testid="User-Name"]'),
  getMenuButton: (el) => el.querySelector<HTMLElement>('[data-testid="caret"]'),
  reportReason: (c) => (c === "judol" || c === "spam" ? "Spam" : genericReason(c)),
};

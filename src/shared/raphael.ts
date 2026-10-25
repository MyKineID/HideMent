export type Tone = "info" | "ok" | "err";

const TITLE: Record<Tone, string> = { info: "«Pemberitahuan»", ok: "«Jawaban»", err: "«Peringatan»" };

let typing: ReturnType<typeof setInterval> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function say(box: HTMLElement, text: string, tone: Tone = "info", autoHideMs = 0): void {
  const title = box.querySelector<HTMLElement>(".dlg-title")!;
  const body = box.querySelector<HTMLElement>(".dlg-text")!;
  box.hidden = false;
  box.dataset.tone = tone;
  title.textContent = TITLE[tone];
  clearInterval(typing);
  clearTimeout(hideTimer);
  body.textContent = "";
  let i = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) body.textContent = text;
  else
    typing = setInterval(() => {
      body.textContent = text.slice(0, (i += 2));
      if (i >= text.length) clearInterval(typing);
    }, 14);
  if (autoHideMs) hideTimer = setTimeout(() => (box.hidden = true), autoHideMs);
}

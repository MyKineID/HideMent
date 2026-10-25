export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector<T>(sel)!;

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

export function patchFromPath(path: string, value: unknown): Record<string, unknown> {
  return path
    .split(".")
    .reverse()
    .reduce<unknown>((acc, k) => ({ [k]: acc }), value) as Record<string, unknown>;
}

export function setStatus(el: HTMLElement, text: string, kind: "ok" | "err" | "" = ""): void {
  el.textContent = text;
  el.className = `status ${kind} ${el.classList.contains("grow") ? "grow" : ""}`.trim();
}

export function bindToggles(root: ParentNode, current: () => unknown, save: (patch: Record<string, unknown>) => void): void {
  root.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-key]").forEach((input) => {
    input.checked = Boolean(getPath(current(), input.dataset.key!));
    input.addEventListener("change", () => save(patchFromPath(input.dataset.key!, input.checked)));
  });
}

export function refreshToggles(root: ParentNode, current: unknown): void {
  root.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-key]").forEach((input) => {
    input.checked = Boolean(getPath(current, input.dataset.key!));
  });
}

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { CATEGORY_LABEL, type Verdict } from "../core/types";
import type { Adapter } from "./adapters/types";

const REPORT_ITEM_RE = /^(laporkan|report|laporkan komentar|report comment|lapor)\b/i;

function toast(html: string, ms = 9000): HTMLElement {
  document.querySelector(".rg-toast")?.remove();
  const t = document.createElement("div");
  t.className = "rg-toast";
  t.innerHTML = html;
  t.addEventListener("click", () => t.remove());
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

function highlightReportItem(): void {
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const items = document.querySelectorAll<HTMLElement>(
      'tp-yt-paper-item, ytd-menu-service-item-renderer, [role="menuitem"], [role="menu"] [role="button"], [role="dialog"] button, li',
    );
    for (const it of items) {
      const label = (it.textContent ?? "").trim();
      if (REPORT_ITEM_RE.test(label) && it.offsetParent !== null) {
        it.classList.add("rg-report-target");
        clearInterval(timer);
        return;
      }
    }
    if (tries > 20) clearInterval(timer);
  }, 150);
}

export function openReportHelper(el: HTMLElement, adapter: Adapter, v: Verdict): void {
  const reason = adapter.reportReason(v.category);
  const btn = adapter.getMenuButton(el);
  const t = toast("");
  t.innerHTML = `<b>🚩 Bantu laporkan</b><div class="rg-toast-body"></div><div class="rg-toast-reason"></div><small>Kamu tetap memilih &amp; mengirim laporan sendiri.</small>`;
  t.querySelector(".rg-toast-body")!.textContent = btn
    ? `Menu komentar sudah dibuka. Pilih "Laporkan", lalu alasan:`
    : `Buka menu ⋯ pada komentar ini, pilih "Laporkan", lalu alasan:`;
  t.querySelector(".rg-toast-reason")!.textContent = `${reason}  (${CATEGORY_LABEL[v.category]})`;

  if (btn) {
    el.scrollIntoView({ block: "center" });
    btn.click();
    highlightReportItem();
  }
  void navigator.clipboard?.writeText(`${CATEGORY_LABEL[v.category]}: ${v.reason}`).catch(() => undefined);
}

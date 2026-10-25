import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type DeepPartial, type Settings } from "../core/settings";
import type { Platform } from "../core/types";
import { send, type ScanProgress, type StatusInfo, type TabMsg } from "../shared/messages";
import { $, bindToggles, refreshToggles } from "../shared/dom";
import { hydrateIcons, type IconName } from "../shared/pixel-icons";
import { presetOf, presetPatch, type Preset } from "../shared/presets";
import { say } from "../shared/raphael";

const PLATFORM_HOSTS: [RegExp, Platform, string][] = [
  [/(^|\.)youtube\.com$/, "youtube", "YouTube"],
  [/(^|\.)instagram\.com$/, "instagram", "Instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok", "TikTok"],
  [/(^|\.)(x|twitter)\.com$/, "x", "X"],
];

let settings: Settings = DEFAULT_SETTINGS;
let lastLine = "";

function renderPresets(): void {
  const p = presetOf(settings);
  document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === p)));
}

async function init(): Promise<void> {
  settings = await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url?.startsWith("http") ? new URL(tab.url).hostname : "";
  const match = PLATFORM_HOSTS.find(([re]) => re.test(host));

  const site = $("#site");
  if (match) {
    site.innerHTML = `Memantau <b></b>`;
    site.querySelector("b")!.textContent = match[2];
    $("#siteRow").hidden = false;
    $("#siteName").textContent = match[2];
    $("#siteIcon").dataset.icon = match[1] as IconName;
    const t = $<HTMLInputElement>("#siteToggle");
    t.checked = settings.platforms[match[1]];
    t.addEventListener("change", () => saveSettings({ platforms: { [match[1]]: t.checked } }));
    $("#scanBlock").hidden = false;
  } else {
    site.textContent = "Buka YouTube, IG, TikTok, atau X";
  }
  hydrateIcons();

  bindToggles(document, () => settings, (p) => void saveSettings(p as DeepPartial<Settings>).then((s) => (settings = s)));
  renderPresets();
  document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) =>
    b.addEventListener("click", async () => {
      settings = await saveSettings(presetPatch(b.dataset.preset as Preset));
      renderPresets();
    }),
  );
  onSettingsChanged((s) => {
    settings = s;
    refreshToggles(document, s);
    renderPresets();
  });

  const dlg = $("#dlg");
  const refresh = async () => {
    const st = await send<StatusInfo>({ type: "getStatus", tabId: tab?.id }).catch(() => null);
    if (!st) return;
    $("#scanned").textContent = String(st.tabCounts.scanned);
    $("#high").textContent = String(st.tabCounts.high);
    $("#medium").textContent = String(st.tabCounts.medium);

    let line: [string, "ok" | "err" | "info"];
    if (!settings.enabled) line = ["Tempest sedang nonaktif. Nyalakan saklar di kanan atas.", "info"];
    else if (!st.configured) line = ["AI belum terhubung, baru deteksi judol lokal yang aktif. Atur lewat tombol pengaturan di bawah.", "err"];
    else if (st.lastError) line = [st.lastError, "err"];
    else if (st.tabCounts.high) line = [`${st.tabCounts.high} komentar berbahaya ditemukan di halaman ini.`, "ok"];
    else line = [`Siap. Model ${st.model}${st.lastTtftMs ? ` · hasil pertama ${(st.lastTtftMs / 1000).toFixed(1)} dtk` : ""}.`, "ok"];
    const key = line.join("|");
    if (key !== lastLine) {
      lastLine = key;
      say(dlg, line[0], line[1]);
    }
  };
  await refresh();
  setInterval(refresh, 1500);

  $("#openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#openPanel").addEventListener("click", async () => {
    if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  });
  const scanBtn = $<HTMLButtonElement>("#fastScan");
  const stopBtn = $<HTMLButtonElement>("#stopScan");
  scanBtn.addEventListener("click", async () => {
    if (tab?.id === undefined || scanBtn.disabled) return;
    if (!(await send<boolean>({ type: "ensureContent", tabId: tab.id }).catch(() => false))) {
      say(dlg, "Tempest belum tersambung ke tab ini. Refresh halamannya (F5), lalu coba lagi.", "err");
      return;
    }
    const r = (await chrome.tabs.sendMessage(tab.id, { type: "fastScan" } satisfies TabMsg).catch(() => null)) as { ok: boolean; note?: string } | null;
    if (!r?.ok) say(dlg, r?.note ?? "Halaman belum siap. Refresh tab lalu coba lagi.", "err");
  });
  stopBtn.addEventListener("click", () => {
    if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: "stopScan" } satisfies TabMsg).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((msg: ScanProgress, sender) => {
    if (msg.type !== "scanProgress" || sender.tab?.id !== tab?.id) return;
    const running = msg.state === "running";
    scanBtn.disabled = running;
    scanBtn.classList.toggle("busy", running);
    scanBtn.querySelector(".lbl")!.textContent = running ? "Memindai komentar…" : "Pindai semua komentar";
    stopBtn.hidden = !running;
    $("#scanProg").hidden = false;
    const text = $("#scanText");
    if (msg.state === "error") text.textContent = msg.note ?? "Gagal memindai";
    else text.innerHTML = `<b>${msg.loaded}</b> ${running ? "komentar dimuat" : msg.state === "stopped" ? "dipindai · dihentikan" : "komentar dipindai"}`;
    $("#scanFill").style.width = `${Math.min(100, (msg.loaded / msg.max) * 100)}%`;
  });

  $("#rescan").addEventListener("click", () => {
    if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: "rescan" } satisfies TabMsg).catch(() => undefined);
  });
}

void init();

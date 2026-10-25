import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type DeepPartial, type Settings } from "../core/settings";
import type { Platform } from "../core/types";
import { send, type StatusInfo, type TabMsg } from "../shared/messages";
import { $, bindToggles, refreshToggles, setStatus } from "../shared/dom";

const PLATFORM_HOSTS: [RegExp, Platform, string][] = [
  [/(^|\.)youtube\.com$/, "youtube", "YouTube"],
  [/(^|\.)instagram\.com$/, "instagram", "Instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok", "TikTok"],
  [/(^|\.)(x|twitter)\.com$/, "x", "X / Twitter"],
];

let settings: Settings = DEFAULT_SETTINGS;

async function init(): Promise<void> {
  settings = await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : "";
  const match = PLATFORM_HOSTS.find(([re]) => re.test(host));

  $("#site").textContent = match ? `${match[2]} · terpantau` : "Buka YouTube / IG / TikTok / X";
  if (match) {
    const row = $("#siteRow");
    row.hidden = false;
    const t = $<HTMLInputElement>("#siteToggle");
    t.checked = settings.platforms[match[1]];
    t.addEventListener("change", () => saveSettings({ platforms: { [match[1]]: t.checked } }));
  }

  bindToggles(document, () => settings, (p) => void saveSettings(p as DeepPartial<Settings>).then((s) => (settings = s)));
  onSettingsChanged((s) => {
    settings = s;
    refreshToggles(document, s);
  });

  const refresh = async () => {
    const st = await send<StatusInfo>({ type: "getStatus", tabId: tab?.id }).catch(() => null);
    if (!st) return;
    $("#scanned").textContent = String(st.tabCounts.scanned);
    $("#high").textContent = String(st.tabCounts.high);
    $("#medium").textContent = String(st.tabCounts.medium);
    const el = $("#apiState");
    if (!st.configured) setStatus(el, "⚠ 9router belum diatur: hanya aturan lokal (judol) yang aktif", "err");
    else if (st.lastError) setStatus(el, `✗ ${st.lastError}`, "err");
    else setStatus(el, `● ${st.model}${st.lastLatencyMs ? ` · ${st.lastLatencyMs} ms` : ""}`, "ok");
  };
  await refresh();
  setInterval(refresh, 1500);

  $("#openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#openPanel").addEventListener("click", async () => {
    if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  });
  $("#rescan").addEventListener("click", () => {
    if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: "rescan" } satisfies TabMsg).catch(() => undefined);
  });
}

void init();

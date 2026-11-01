import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type DeepPartial, type Settings } from "../core/settings";
import type { Platform } from "../core/types";
import { send, type FastScanReply, type PostInfo, type ScanProgress, type StatusInfo, type TabMsg } from "../shared/messages";
import { $, bindToggles, refreshToggles } from "../shared/dom";
import { hydrateIcons, type IconName } from "../shared/icons";
import { presetOf, presetPatch, type Preset } from "../shared/presets";
import { say } from "../shared/raphael";
import { enhanceAll } from "../shared/ui";

const PLATFORM_HOSTS: [RegExp, Platform, string][] = [
  [/(^|\.)youtube\.com$/, "youtube", "YouTube"],
  [/(^|\.)instagram\.com$/, "instagram", "Instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok", "TikTok"],
  [/(^|\.)(x|twitter)\.com$/, "x", "X"],
];

let settings: Settings = DEFAULT_SETTINGS;
let lastLine = "";
/** Selama Analyze berjalan, baris progres diisi pesan scanProgress, bukan ringkasan postingan. */
let scanBusy = false;

function renderModes(): void {
  const chip = $("#customChip");
  chip.hidden = !settings.custom.definition;
  $("#customName").textContent = settings.custom.name || "Kustom";
  const visible = [...document.querySelectorAll<HTMLInputElement>(".mchip:not([hidden]) input")];
  $("#modeCount").textContent = `${visible.filter((i) => i.checked).length} aktif`;
}

function renderPresets(): void {
  const p = presetOf(settings);
  document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.preset === p)));
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
  enhanceAll();

  bindToggles(document, () => settings, (p) =>
    void saveSettings(p as DeepPartial<Settings>).then((s) => {
      settings = s;
      renderModes();
    }),
  );
  renderPresets();
  renderModes();
  document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) =>
    b.addEventListener("click", async () => {
      settings = await saveSettings(presetPatch(b.dataset.preset as Preset));
      renderPresets();
    }),
  );
  onSettingsChanged((s) => {
    settings = s;
    refreshToggles(document, s);
    renderModes();
    renderPresets();
  });

  const dlg = $("#dlg");
  const refresh = async () => {
    const st = await send<StatusInfo>({ type: "getStatus", tabId: tab?.id }).catch(() => null);
    if (!st) return;
    /* Angka per postingan dari halaman itu sendiri: total komentar platform + sebaran label hasil analisis. */
    const info =
      match && tab?.id !== undefined
        ? ((await chrome.tabs.sendMessage(tab.id, { type: "postInfo" } satisfies TabMsg).catch(() => null)) as PostInfo | null)
        : null;
    const fmt = (n: number) => n.toLocaleString("id-ID");
    $("#total").textContent = info?.total != null ? fmt(info.total) : info ? fmt(info.seen) : "–";
    $("#totalLabel").textContent = info?.total != null ? "komentar" : "terlihat";
    $("#safe").textContent = fmt(info?.aman ?? 0);
    $("#medium").textContent = fmt(info?.sedang ?? st.tabCounts.medium);
    $("#high").textContent = fmt(info?.tinggi ?? st.tabCounts.high);
    if (info?.total != null && !scanBusy) {
      const labeled = info.aman + info.sedang + info.tinggi;
      $("#scanProg").hidden = false;
      $("#scanText").textContent = labeled
        ? `${fmt(labeled)} dari ${fmt(info.total)} komentar sudah dianalisis${labeled >= info.total ? " · lengkap" : ""}`
        : `Postingan ini punya ${fmt(info.total)} komentar. Tekan Analyze untuk memuat & menilai semuanya.`;
      $("#scanFill").style.width = `${Math.min(100, (labeled / Math.max(1, info.total)) * 100)}%`;
    } else if (info && !info.isPost && !scanBusy) {
      $("#scanProg").hidden = false;
      $("#scanText").textContent = "Buka satu postingan/video dulu untuk menganalisis komentarnya.";
    }

    let line: [string, "ok" | "err" | "info"];
    if (!settings.enabled) line = ["HideMent sedang nonaktif. Nyalakan saklar di kanan atas.", "info"];
    else if (!st.configured) line = ["Belum terhubung ke AI. Baru deteksi judol lokal yang jalan; hubungkan lewat tombol pengaturan di bawah.", "err"];
    else if (st.lastError) line = [st.lastError, "err"];
    else if (st.tabCounts.high) line = [`${st.tabCounts.high} komentar berbahaya ditemukan di halaman ini.`, "ok"];
    else line = ["Siap. Terhubung ke AI.", "ok"];
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
      say(dlg, "HideMent belum tersambung ke tab ini. Refresh halamannya (F5), lalu coba lagi.", "err");
      return;
    }
    const r = (await chrome.tabs.sendMessage(tab.id, { type: "fastScan" } satisfies TabMsg).catch(() => null)) as FastScanReply | null;
    if (!r?.ok) say(dlg, r?.note ?? "Halaman belum siap. Refresh tab lalu coba lagi.", "err");
    else if (r.total) say(dlg, `Postingan ini punya ${r.total.toLocaleString("id-ID")} komentar. Menganalisis…`);
  });
  stopBtn.addEventListener("click", () => {
    if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: "stopScan" } satisfies TabMsg).catch(() => undefined);
  });
  chrome.runtime.onMessage.addListener((msg: ScanProgress, sender) => {
    if (msg.type !== "scanProgress" || sender.tab?.id !== tab?.id) return;
    const running = msg.state === "running";
    scanBusy = running;
    scanBtn.disabled = running;
    scanBtn.classList.toggle("busy", running);
    scanBtn.querySelector(".lbl")!.textContent = running ? "Menganalisis komentar…" : "Analyze komentar postingan ini";
    stopBtn.hidden = !running;
    $("#scanProg").hidden = false;
    const text = $("#scanText");
    if (msg.state === "error") text.textContent = msg.note ?? "Gagal memindai";
    else {
      const of = msg.total ? ` dari ${msg.total.toLocaleString("id-ID")}` : "";
      text.innerHTML = `<b>${msg.loaded.toLocaleString("id-ID")}</b>`;
      text.append(`${of} ${running ? "komentar dianalisis" : msg.state === "stopped" ? "komentar dianalisis · dihentikan" : "komentar dianalisis"}`);
    }
    $("#scanFill").style.width = `${Math.min(100, (msg.loaded / Math.max(1, msg.max)) * 100)}%`;
  });

  $("#rescan").addEventListener("click", () => {
    if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: "rescan" } satisfies TabMsg).catch(() => undefined);
  });
}

void init();

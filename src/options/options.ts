import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type ActionKind, type DeepPartial, type Settings } from "../core/settings";
import { CATEGORY_LABEL, MODE_CATEGORIES, type Category } from "../core/types";
import type { ModelList } from "../background/api";
import { send } from "../shared/messages";
import { $, bindToggles, download, refreshToggles } from "../shared/dom";
import { hydrateIcons } from "../shared/pixel-icons";
import { say } from "../shared/raphael";
import { presetOf, presetPatch, type Preset } from "../shared/presets";

let settings: Settings = DEFAULT_SETTINGS;
let allModels: string[] = [];

const baseUrl = $<HTMLInputElement>("#baseUrl");
const apiKey = $<HTMLInputElement>("#apiKey");
const modelFilter = $<HTMLInputElement>("#modelFilter");
const modelList = $("#modelList");
const dlg = $("#dlg");

const tell = (text: string, tone: "info" | "ok" | "err" = "ok") => say(dlg, text, tone, tone === "err" ? 9000 : 4200);

async function save(patch: DeepPartial<Settings>, note = "Pengaturan disimpan."): Promise<void> {
  settings = await saveSettings(patch);
  tell(note);
}

/* ── koneksi ─────────────────────────────── */

function renderConnTag(state?: "ok" | "err"): void {
  const tag = $("#connTag");
  const configured = Boolean(settings.api.baseUrl && settings.api.model);
  if (state === "err") {
    tag.className = "tag tinggi";
    tag.textContent = "Gagal terhubung";
  } else if (configured) {
    tag.className = "tag ok";
    tag.textContent = "● Terhubung";
  } else {
    tag.className = "tag off";
    tag.textContent = "Belum terhubung";
  }
  $("#modelStep").classList.toggle("locked", allModels.length === 0 && !settings.api.model);
}

function renderModels(): void {
  const q = modelFilter.value.trim().toLowerCase();
  const source = allModels.length ? allModels : settings.api.model ? [settings.api.model] : [];
  const list = source.filter((m) => !q || m.toLowerCase().includes(q));
  modelList.replaceChildren(
    ...list.map((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "model";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(m === settings.api.model));
      const slash = m.indexOf("/");
      if (slash > 0) {
        const prov = document.createElement("span");
        prov.className = "prov";
        prov.textContent = m.slice(0, slash + 1);
        b.append(prov, m.slice(slash + 1));
      } else b.textContent = m;
      b.addEventListener("click", async () => {
        await save({ api: { model: m } }, `Model diganti ke ${m}.`);
        renderModels();
        renderConnTag();
      });
      return b;
    }),
  );
  if (q && !list.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.style.padding = "12px";
    empty.textContent = `Tidak ada model yang cocok dengan "${modelFilter.value}".`;
    modelList.append(empty);
  }
  $("#modelCount").textContent = allModels.length ? `${allModels.length} model` : "";
}

function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? `${u.protocol}//${u.hostname}/*` : null;
  } catch {
    return null;
  }
}

async function connect(): Promise<void> {
  const url = baseUrl.value.trim();
  const origin = originPattern(url);
  if (!origin) return tell("Base URL belum valid. Harus diawali http:// atau https://", "err");
  const btn = $<HTMLButtonElement>("#connect");
  btn.disabled = true;
  say(dlg, "Menghubungkan ke server…", "info");
  try {
    if (!(await chrome.permissions.request({ origins: [origin] }))) throw new Error("Izin akses ke server ditolak.");
    const res = await send<ModelList>({ type: "listModels", baseUrl: url, apiKey: apiKey.value.trim() });
    allModels = res.models;
    if (res.baseUrl !== url) baseUrl.value = res.baseUrl;
    const model = allModels.includes(settings.api.model) ? settings.api.model : (allModels[0] ?? "");
    settings = await saveSettings({ api: { baseUrl: res.baseUrl, apiKey: apiKey.value.trim(), model } });
    await chrome.storage.local.set({ modelCache: allModels });
    renderModels();
    renderConnTag();
    tell(`Terhubung. ${allModels.length} model ditemukan, "${model}" dipilih. Silakan ganti kalau perlu.`);
  } catch (e) {
    renderConnTag("err");
    tell((e as Error).message, "err");
  } finally {
    btn.disabled = false;
  }
}

async function testApi(): Promise<void> {
  const btn = $<HTMLButtonElement>("#testApi");
  const out = $("#testResult");
  if (!settings.api.model) return tell("Pilih model dulu di langkah 2.", "err");
  btn.disabled = true;
  out.textContent = "Menguji…";
  try {
    const r = await send<{ latencyMs: number }>({ type: "testConnection" });
    out.textContent = `✓ ${settings.api.model} · ${r.latencyMs} ms`;
    renderConnTag();
    tell(`Model merespons dalam ${r.latencyMs} ms. Siap menganalisis komentar.`);
  } catch (e) {
    out.textContent = "✗ gagal";
    renderConnTag("err");
    tell((e as Error).message, "err");
  } finally {
    btn.disabled = false;
  }
}

function clampNum(input: HTMLInputElement, min: number, max: number, fallback: number): number {
  const n = Number(input.value);
  const v = Number.isFinite(n) && input.value !== "" ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  input.value = String(v);
  return v;
}

/* ── tampilan ────────────────────────────── */

function renderPresets(): void {
  const current = presetOf(settings);
  document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.preset === current)));
}

function renderCategoryActions(): void {
  const host = $("#categoryActions");
  host.replaceChildren();
  const options: [string, string][] = [["", "Ikuti preset"], ["highlight", "Tandai saja"], ["blur", "Blur"], ["hide", "Sembunyikan"]];
  for (const mode of ["judol", "toxic"] as const) {
    for (const cat of MODE_CATEGORIES[mode]) {
      const name = document.createElement("span");
      name.className = `cat-name ${mode}`;
      name.textContent = CATEGORY_LABEL[cat];
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `Aksi untuk ${CATEGORY_LABEL[cat]}`);
      for (const [v, l] of options) sel.add(new Option(l, v, false, (settings.categoryAction[cat] ?? "") === v));
      sel.addEventListener("change", async () => {
        const next = { ...settings.categoryAction } as Partial<Record<Category, ActionKind>>;
        if (sel.value) next[cat] = sel.value as ActionKind;
        else delete next[cat];
        settings = { ...(await loadSettings()), categoryAction: next };
        await chrome.storage.local.set({ settings });
        tell(`${CATEGORY_LABEL[cat]}: ${sel.selectedOptions[0].text.toLowerCase()}.`);
      });
      host.append(name, sel);
    }
  }
}

/* ── ambang ──────────────────────────────── */

function renderMeter(high: number, medium: number): void {
  $(".m-low").style.flexBasis = `${medium}%`;
  $(".m-mid").style.flexBasis = `${high - medium}%`;
  $(".m-high").style.flexBasis = `${100 - high}%`;
  $("#mediumOut").textContent = String(medium);
  $("#highOut").textContent = String(high);
}

/* ── umum ────────────────────────────────── */

function lines(v: string): string[] {
  return [...new Set(v.split("\n").map((l) => l.trim()).filter(Boolean))];
}

function renderCounts(): void {
  $("#whitelistCount").textContent = settings.whitelist.length ? `${settings.whitelist.length}` : "";
  $("#customKeywordsCount").textContent = settings.customKeywords.length ? `${settings.customKeywords.length}` : "";
}

function renderPower(): void {
  $(".power").classList.toggle("off", !settings.enabled);
  $("#powerState").textContent = settings.enabled ? "AKTIF" : "NONAKTIF";
}

function fillForm(): void {
  baseUrl.value = settings.api.baseUrl;
  apiKey.value = settings.api.apiKey;
  $<HTMLInputElement>("#timeout").value = String(Math.round(settings.api.timeoutMs / 1000));
  $<HTMLInputElement>("#batchSize").value = String(settings.api.batchSize);
  $<HTMLInputElement>("#concurrency").value = String(settings.api.concurrency);
  $<HTMLInputElement>("#high").value = String(settings.thresholds.high);
  $<HTMLInputElement>("#medium").value = String(settings.thresholds.medium);
  renderMeter(settings.thresholds.high, settings.thresholds.medium);
  $<HTMLTextAreaElement>("#whitelist").value = settings.whitelist.join("\n");
  $<HTMLTextAreaElement>("#customKeywords").value = settings.customKeywords.join("\n");
  refreshToggles(document, settings);
  renderModels();
  renderConnTag();
  renderPresets();
  renderCategoryActions();
  renderCounts();
  renderPower();
}

async function refreshFeedbackCount(): Promise<void> {
  const fb = ((await chrome.storage.local.get("feedback")).feedback ?? []) as unknown[];
  $("#fbCount").textContent = fb.length ? `${fb.length} catatan salah deteksi tersimpan.` : "Belum ada catatan.";
}

function setupScrollSpy(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".nav a")];
  const sections = [...document.querySelectorAll<HTMLElement>("section.sec")];
  let frame = 0;
  const update = () => {
    frame = 0;
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    let current = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= 140) current = s;
    if (atBottom) current = sections[sections.length - 1];
    links.forEach((a) => a.classList.toggle("on", a.hash === `#${current.id}`));
  };
  addEventListener("scroll", () => (frame ||= requestAnimationFrame(update)), { passive: true });
  update();
}

async function init(): Promise<void> {
  hydrateIcons();
  $("#ver").textContent = chrome.runtime.getManifest?.().version ?? "";
  settings = await loadSettings();
  allModels = ((await chrome.storage.local.get("modelCache")).modelCache ?? []) as string[];
  fillForm();
  setupScrollSpy();
  void refreshFeedbackCount();

  bindToggles(document, () => settings, (p) => void save(p as DeepPartial<Settings>));

  $("#connect").addEventListener("click", connect);
  $("#testApi").addEventListener("click", testApi);
  baseUrl.addEventListener("keydown", (e) => e.key === "Enter" && void connect());
  apiKey.addEventListener("keydown", (e) => e.key === "Enter" && void connect());
  apiKey.addEventListener("change", () => save({ api: { apiKey: apiKey.value.trim() } }, "API key disimpan."));
  modelFilter.addEventListener("input", renderModels);
  $("#toggleKey").addEventListener("click", () => (apiKey.type = apiKey.type === "password" ? "text" : "password"));

  const advanced: [string, number, number, number, (v: number) => DeepPartial<Settings>][] = [
    ["#timeout", 5, 180, 30, (v) => ({ api: { timeoutMs: v * 1000 } })],
    ["#batchSize", 1, 50, 20, (v) => ({ api: { batchSize: v } })],
    ["#concurrency", 1, 6, 2, (v) => ({ api: { concurrency: v } })],
  ];
  for (const [sel, min, max, fb, patch] of advanced) {
    $<HTMLInputElement>(sel).addEventListener("change", (e) => save(patch(clampNum(e.target as HTMLInputElement, min, max, fb))));
  }

  document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) =>
    b.addEventListener("click", async () => {
      const p = b.dataset.preset as Preset;
      await save(presetPatch(p), { tandai: "Komentar berbahaya cukup ditandai.", blur: "Komentar berbahaya akan diblur.", sembunyi: "Komentar berbahaya akan disembunyikan." }[p]);
      renderPresets();
    }),
  );

  const high = $<HTMLInputElement>("#high");
  const medium = $<HTMLInputElement>("#medium");
  const syncRanges = (changed: "high" | "medium") => {
    let h = Number(high.value);
    let m = Number(medium.value);
    if (m > h - 5) changed === "high" ? (m = Math.max(10, h - 5)) : (h = Math.min(100, m + 5));
    high.value = String(h);
    medium.value = String(m);
    renderMeter(h, m);
    return { high: h, medium: m };
  };
  high.addEventListener("input", () => syncRanges("high"));
  medium.addEventListener("input", () => syncRanges("medium"));
  high.addEventListener("change", () => save({ thresholds: syncRanges("high") }, `Tinggi mulai ${high.value}, sedang mulai ${medium.value}.`));
  medium.addEventListener("change", () => save({ thresholds: syncRanges("medium") }, `Tinggi mulai ${high.value}, sedang mulai ${medium.value}.`));

  for (const id of ["whitelist", "customKeywords"] as const) {
    $(`#${id}`).addEventListener("change", async (e) => {
      const list = lines((e.target as HTMLTextAreaElement).value);
      await save({ [id]: list }, `${list.length} entri ${id === "whitelist" ? "akun tepercaya" : "kata kunci"} disimpan.`);
      renderCounts();
    });
  }

  $("#exportFeedback").addEventListener("click", async () => {
    const fb = ((await chrome.storage.local.get("feedback")).feedback ?? []) as unknown[];
    if (!fb.length) return tell("Belum ada feedback untuk diekspor.", "info");
    download(`tempest-feedback-${Date.now()}.json`, JSON.stringify(fb, null, 2), "application/json");
    tell(`${fb.length} feedback diekspor.`);
  });
  $("#clearCache").addEventListener("click", async () => {
    await send({ type: "clearCache" });
    tell("Cache dihapus. Komentar akan dianalisis ulang.");
  });
  $("#resetAll").addEventListener("click", async () => {
    if (!confirm("Reset semua pengaturan, termasuk Base URL dan API key?")) return;
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, modelCache: [] });
    settings = DEFAULT_SETTINGS;
    allModels = [];
    fillForm();
    tell("Semua pengaturan dikembalikan ke awal.", "info");
  });

  onSettingsChanged((s) => {
    settings = s;
    refreshToggles(document, s);
    renderPresets();
    renderPower();
  });

  if (!settings.api.baseUrl) say(dlg, "Halo! Mulai dengan menghubungkan server 9router kamu di bagian Koneksi.", "info", 8000);
}

void init();

import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type ActionKind, type DeepPartial, type Settings } from "../core/settings";
import { CATEGORY_LABEL, MODE_CATEGORIES, type Category } from "../core/types";
import type { ModelList } from "../background/api";
import { send } from "../shared/messages";
import { $, bindToggles, download, refreshToggles, setStatus } from "../shared/dom";

let settings: Settings = DEFAULT_SETTINGS;
let allModels: string[] = [];

const baseUrl = $<HTMLInputElement>("#baseUrl");
const apiKey = $<HTMLInputElement>("#apiKey");
const modelSel = $<HTMLSelectElement>("#model");
const modelFilter = $<HTMLInputElement>("#modelFilter");
const apiStatus = $("#apiStatus");
const dataStatus = $("#dataStatus");

const save = (patch: DeepPartial<Settings>) => saveSettings(patch).then((s) => (settings = s));

function renderModels(selected = settings.api.model): void {
  const q = modelFilter.value.trim().toLowerCase();
  const list = allModels.filter((m) => !q || m.toLowerCase().includes(q));
  if (selected && !allModels.includes(selected)) list.unshift(selected);
  modelSel.replaceChildren(
    ...(list.length ? list : [""]).map((m) => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m || "— Ambil daftar model dulu —";
      o.selected = m === selected;
      return o;
    }),
  );
  $("#modelCount").textContent = allModels.length ? `(${allModels.length} tersedia)` : "";
}

function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

async function ensurePermission(url: string): Promise<boolean> {
  const origin = originPattern(url);
  if (!origin) return false;
  return chrome.permissions.request({ origins: [origin] });
}

async function fetchModels(): Promise<void> {
  const url = baseUrl.value.trim();
  if (!originPattern(url)) return setStatus(apiStatus, "Base URL tidak valid (harus diawali http:// atau https://)", "err");
  const btn = $<HTMLButtonElement>("#fetchModels");
  btn.disabled = true;
  setStatus(apiStatus, "Meminta izin akses & mengambil model…");
  try {
    if (!(await ensurePermission(url))) throw new Error("Izin akses ke server ditolak");
    const res = await send<ModelList>({ type: "listModels", baseUrl: url, apiKey: apiKey.value.trim() });
    allModels = res.models;
    if (res.baseUrl !== url) baseUrl.value = res.baseUrl;
    const keep = allModels.includes(settings.api.model) ? settings.api.model : (allModels[0] ?? "");
    renderModels(keep);
    await save({ api: { baseUrl: res.baseUrl, apiKey: apiKey.value.trim(), model: keep } });
    await chrome.storage.local.set({ modelCache: allModels });
    setStatus(apiStatus, `✓ ${allModels.length} model ditemukan & koneksi tersimpan`, "ok");
  } catch (e) {
    setStatus(apiStatus, `✗ ${(e as Error).message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function clampNum(input: HTMLInputElement, min: number, max: number, fallback: number): number {
  const n = Number(input.value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

async function saveApi(): Promise<void> {
  const url = baseUrl.value.trim();
  if (url && !(await ensurePermission(url))) return setStatus(apiStatus, "✗ Izin akses ke server ditolak", "err");
  await save({
    api: {
      baseUrl: url,
      apiKey: apiKey.value.trim(),
      model: modelSel.value,
      timeoutMs: clampNum($("#timeout"), 5, 180, 30) * 1000,
      batchSize: clampNum($("#batchSize"), 1, 50, 20),
      concurrency: clampNum($("#concurrency"), 1, 6, 2),
    },
  });
  setStatus(apiStatus, "✓ Tersimpan", "ok");
}

async function testApi(): Promise<void> {
  const btn = $<HTMLButtonElement>("#testApi");
  btn.disabled = true;
  setStatus(apiStatus, "Menguji…");
  try {
    await saveApi();
    const r = await send<{ latencyMs: number }>({ type: "testConnection" });
    setStatus(apiStatus, `✓ Model "${settings.api.model}" merespons dalam ${r.latencyMs} ms`, "ok");
  } catch (e) {
    setStatus(apiStatus, `✗ ${(e as Error).message}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function renderCategoryActions(): void {
  const host = $("#categoryActions");
  host.replaceChildren();
  const options: [string, string][] = [["", "Ikut global"], ["highlight", "Highlight saja"], ["blur", "Blur"], ["hide", "Sembunyikan"]];
  for (const mode of ["judol", "toxic"] as const) {
    for (const cat of MODE_CATEGORIES[mode]) {
      const name = document.createElement("span");
      name.className = `cat-name ${mode}`;
      name.textContent = CATEGORY_LABEL[cat];
      const sel = document.createElement("select");
      for (const [v, l] of options) sel.add(new Option(l, v, false, (settings.categoryAction[cat] ?? "") === v));
      sel.addEventListener("change", async () => {
        const next = { ...settings.categoryAction } as Partial<Record<Category, ActionKind>>;
        if (sel.value) next[cat] = sel.value as ActionKind;
        else delete next[cat];
        const s = { ...(await loadSettings()), categoryAction: next };
        await chrome.storage.local.set({ settings: s });
        settings = s;
      });
      host.append(name, sel);
    }
  }
}

function fillForm(): void {
  baseUrl.value = settings.api.baseUrl;
  apiKey.value = settings.api.apiKey;
  $<HTMLInputElement>("#timeout").value = String(Math.round(settings.api.timeoutMs / 1000));
  $<HTMLInputElement>("#batchSize").value = String(settings.api.batchSize);
  $<HTMLInputElement>("#concurrency").value = String(settings.api.concurrency);
  for (const k of ["high", "medium"] as const) {
    $<HTMLInputElement>(`#${k}`).value = String(settings.thresholds[k]);
    $(`#${k}Out`).textContent = String(settings.thresholds[k]);
  }
  $<HTMLTextAreaElement>("#whitelist").value = settings.whitelist.join("\n");
  $<HTMLTextAreaElement>("#customKeywords").value = settings.customKeywords.join("\n");
  renderModels();
  renderCategoryActions();
  refreshToggles(document, settings);
}

function lines(v: string): string[] {
  return [...new Set(v.split("\n").map((l) => l.trim()).filter(Boolean))];
}

async function init(): Promise<void> {
  settings = await loadSettings();
  allModels = ((await chrome.storage.local.get("modelCache")).modelCache ?? []) as string[];
  fillForm();
  bindToggles(document, () => settings, (p) => void save(p as DeepPartial<Settings>));

  $("#fetchModels").addEventListener("click", fetchModels);
  $("#saveApi").addEventListener("click", saveApi);
  $("#testApi").addEventListener("click", testApi);
  modelFilter.addEventListener("input", () => renderModels(modelSel.value));
  modelSel.addEventListener("change", () => save({ api: { model: modelSel.value } }));
  $("#toggleKey").addEventListener("click", () => (apiKey.type = apiKey.type === "password" ? "text" : "password"));

  for (const k of ["high", "medium"] as const) {
    const input = $<HTMLInputElement>(`#${k}`);
    input.addEventListener("input", () => ($(`#${k}Out`).textContent = input.value));
    input.addEventListener("change", () => {
      let high = Number($<HTMLInputElement>("#high").value);
      let medium = Number($<HTMLInputElement>("#medium").value);
      if (medium >= high && k === "high") medium = high - 5;
      else if (medium >= high) high = Math.min(100, medium + 5);
      void save({ thresholds: { high, medium } }).then(fillForm);
    });
  }
  $("#whitelist").addEventListener("change", (e) => save({ whitelist: lines((e.target as HTMLTextAreaElement).value) }));
  $("#customKeywords").addEventListener("change", (e) => save({ customKeywords: lines((e.target as HTMLTextAreaElement).value) }));

  $("#exportFeedback").addEventListener("click", async () => {
    const fb = ((await chrome.storage.local.get("feedback")).feedback ?? []) as unknown[];
    if (!fb.length) return setStatus(dataStatus, "Belum ada feedback.", "");
    download(`raphael-guard-feedback-${Date.now()}.json`, JSON.stringify(fb, null, 2), "application/json");
    setStatus(dataStatus, `✓ ${fb.length} feedback diekspor`, "ok");
  });
  $("#clearCache").addEventListener("click", async () => {
    await send({ type: "clearCache" });
    setStatus(dataStatus, "✓ Cache dihapus", "ok");
  });
  $("#resetAll").addEventListener("click", async () => {
    if (!confirm("Reset semua pengaturan (termasuk Base URL & API key)?")) return;
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    settings = DEFAULT_SETTINGS;
    fillForm();
    setStatus(dataStatus, "✓ Pengaturan direset", "ok");
  });

  onSettingsChanged((s) => {
    settings = s;
    refreshToggles(document, s);
  });
}

void init();

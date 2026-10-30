import { DEFAULT_SETTINGS, LIMITS, loadSettings, onSettingsChanged, saveSettings, type ActionKind, type DeepPartial, type Settings } from "../core/settings";
import { CATEGORY_LABEL, MODE_CATEGORIES, MODE_LABEL, MODES, type Category } from "../core/types";
import { EXAMPLES_KEY, mergeExamples, parseExamples, type Example } from "../core/examples";
import type { ModelList } from "../background/api";
import { send } from "../shared/messages";
import { $, bindToggles, download, refreshToggles } from "../shared/dom";
import { hydrateIcons, icon } from "../shared/icons";
import { say } from "../shared/raphael";
import { presetOf, presetPatch, type Preset } from "../shared/presets";
import { confirmDialog, createCombobox, enhanceAll, enhanceSelect } from "../shared/ui";

let settings: Settings = DEFAULT_SETTINGS;
let allModels: string[] = [];

const baseUrl = $<HTMLInputElement>("#baseUrl");
const apiKey = $<HTMLInputElement>("#apiKey");
const dlg = $("#dlg");
const FAST_MODEL = /flash-lite|flash-low|lite-preview/i;

const modelPicker = createCombobox($("#modelPicker"), {
  label: "Model",
  empty: "Belum ada model",
  onSelect: async (m) => {
    await save({ api: { model: m } }, `Model diganti ke ${m}.`);
    renderConnTag();
  },
});

const tell = (text: string, tone: "info" | "ok" | "err" = "ok") => say(dlg, text, tone, tone === "err" ? 9000 : 4200);

async function save(patch: DeepPartial<Settings>, note = "Pengaturan disimpan."): Promise<void> {
  settings = await saveSettings(patch);
  tell(note);
}

/* ── koneksi ─────────────────────────────── */

function renderConnTag(state?: "ok" | "err"): void {
  const tag = $("#connTag");
  const text = tag.querySelector<HTMLElement>(".conn-text")!;
  const configured = Boolean(settings.api.baseUrl && settings.api.model);
  tag.dataset.state = state === "err" ? "err" : configured ? "ok" : "off";
  text.textContent = state === "err" ? "Gagal terhubung ke AI" : configured ? "Terhubung ke AI" : "Belum terhubung ke AI";
  $("#needsAi").hidden = configured;
  document.body.classList.toggle("no-ai", !configured);
  const ai = $("#heroAi");
  ai.textContent = state === "err" ? "Gagal" : configured ? "Terhubung" : "Belum";
  ai.className = configured && state !== "err" ? "ok" : "off";
}

function renderModels(): void {
  const source = allModels.length ? allModels : settings.api.model ? [settings.api.model] : [];
  modelPicker.set(
    source.map((m) => {
      const slash = m.indexOf("/");
      return { value: m, prefix: slash > 0 ? m.slice(0, slash + 1) : undefined, label: slash > 0 ? m.slice(slash + 1) : m, badge: FAST_MODEL.test(m) ? "Cepat" : undefined };
    }),
    settings.api.model,
  );
  const locked = source.length === 0;
  modelPicker.setDisabled(locked, "Hubungkan dulu");
  $("#modelStep").classList.toggle("step-locked", locked);
  $("#modelCount").textContent = allModels.length
    ? `${allModels.length} model di server ini. Yang bertanda Cepat paling responsif.`
    : locked
      ? "Hubungkan dulu untuk memuat daftar model."
      : "Hubungkan ulang untuk memuat daftar terbaru.";
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
  if (!settings.api.model) return tell("Hubungkan server dan pilih model dulu.", "err");
  btn.disabled = true;
  let waited = 0;
  out.textContent = "Menguji…";
  const ticker = setInterval(() => (out.textContent = `Menunggu jawaban model… ${++waited} dtk`), 1000);
  try {
    const r = await send<{ latencyMs: number }>({ type: "testConnection" });
    out.textContent = `Berhasil · ${settings.api.model} · ${r.latencyMs} ms`;
    renderConnTag();
    tell(`Model merespons dalam ${r.latencyMs} ms. Siap menganalisis komentar.`);
  } catch (e) {
    out.textContent = "Gagal";
    renderConnTag("err");
    tell((e as Error).message, "err");
  } finally {
    clearInterval(ticker);
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
  document.querySelectorAll<HTMLElement>("[data-scan]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.scan === settings.scan.method)));
}

const catLabel = (c: Category) => (c === "kustom" && settings.custom.name) || CATEGORY_LABEL[c];

function renderCategoryActions(): void {
  const host = $("#categoryActions");
  host.replaceChildren();
  const options: [string, string][] = [["", "Ikuti preset"], ["highlight", "Tandai saja"], ["blur", "Blur"], ["hide", "Sembunyikan"]];
  for (const mode of MODES) {
    for (const cat of MODE_CATEGORIES[mode]) {
      const name = document.createElement("span");
      name.className = `cat-name ${mode}`;
      name.textContent = catLabel(cat);
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `Aksi untuk ${catLabel(cat)}`);
      for (const [v, l] of options) sel.add(new Option(l, v, false, (settings.categoryAction[cat] ?? "") === v));
      sel.addEventListener("change", async () => {
        const next = { ...settings.categoryAction } as Partial<Record<Category, ActionKind>>;
        if (sel.value) next[cat] = sel.value as ActionKind;
        else delete next[cat];
        settings = { ...(await loadSettings()), categoryAction: next };
        await chrome.storage.local.set({ settings });
        tell(`${catLabel(cat)}: ${sel.selectedOptions[0].text.toLowerCase()}.`);
      });
      host.append(name, sel);
      enhanceSelect(sel);
    }
  }
}

/* ── ambang ──────────────────────────────── */

function renderMeter(high: number, medium: number): void {
  const range = $("#thresholds");
  range.style.setProperty("--m", String(medium));
  range.style.setProperty("--h", String(high));
  $("#lowOut").textContent = `0–${medium - 1}`;
  $("#mediumOut").textContent = String(medium);
  $("#highOut").textContent = String(high);
  $("#medium").setAttribute("aria-valuetext", `sedang mulai ${medium}`);
  $("#high").setAttribute("aria-valuetext", `tinggi mulai ${high}`);
}

/* ── umum ────────────────────────────────── */

function lines(v: string): string[] {
  return [...new Set(v.split("\n").map((l) => l.trim()).filter(Boolean))];
}

function renderCounts(): void {
  $("#whitelistCount").textContent = settings.whitelist.length ? `${settings.whitelist.length}` : "";
  $("#customKeywordsCount").textContent = settings.customKeywords.length ? `${settings.customKeywords.length}` : "";
}

function renderSummary(): void {
  const on = MODES.filter((m) => settings.modes[m]).length;
  const plats = Object.values(settings.platforms);
  $("#modeCount").innerHTML = `<b>${on}</b> dari ${MODES.length} aktif`;
  $("#heroModes").textContent = `${on}/${MODES.length}`;
  $("#heroPlat").textContent = `${plats.filter(Boolean).length}/${plats.length}`;
}

async function setAllModes(on: boolean): Promise<void> {
  await save({ modes: Object.fromEntries(MODES.map((m) => [m, on])) }, on ? "Semua mode deteksi aktif." : "Semua mode deteksi dimatikan. HideMent tidak menandai apa pun.");
  refreshToggles(document, settings);
  renderSummary();
}

/* ── mode kustom ─────────────────────────── */

function renderCustom(): void {
  const { name, definition } = settings.custom;
  $("#customPanel").hidden = !settings.modes.kustom;
  $("#customTitle").textContent = name || "Kustom";
  $("#customDesc").textContent = definition || "Tentukan sendiri jenis komentar yang mau ditandai, misalnya spoiler atau promosi akun tertentu.";
  const foot = $("#customFoot");
  const missing = settings.modes.kustom && !definition;
  foot.textContent = missing ? "Isi definisinya dulu di bawah" : "Butuh AI";
  foot.classList.toggle("warn", missing);
  $("#customDefCount").textContent = definition ? `${definition.length}/400` : "";
}

/* ── contoh belajar ──────────────────────── */

let examples: Example[] = [];
let feedbackCount = 0;
const SOURCE_LABEL: Record<Example["source"], string> = { manual: "ditambah manual", import: "dari file", feedback: "dari feedback" };

/** Komponen select dibangun sekali dari opsinya, jadi saat label berubah (nama mode kustom) select dibuat ulang. */
function fillLabelSelect(): void {
  const keep = document.querySelector<HTMLSelectElement>("#exLabel")?.value || "aman";
  const sel = document.createElement("select");
  sel.id = "exLabel";
  sel.setAttribute("aria-label", "Label contoh");
  sel.add(new Option("Aman (bukan berbahaya)", "aman"));
  for (const m of MODES) {
    for (const c of MODE_CATEGORIES[m]) {
      const text = m === "kustom" ? `Kustom · ${catLabel(c)}` : MODE_CATEGORIES[m].length > 1 ? `${MODE_LABEL[m]} · ${catLabel(c)}` : catLabel(c);
      sel.add(new Option(text, c));
    }
  }
  sel.value = keep;
  $("#exLabelHost").replaceChildren(sel);
  enhanceSelect(sel);
}

function renderExamples(): void {
  $("#exCount").textContent = String(examples.length);
  $("#exFeedback").textContent = String(feedbackCount);
  $("#exLabels").textContent = String(new Set(examples.map((e) => e.label)).size);
  const list = $("#exList");
  list.replaceChildren();
  for (const e of [...examples].reverse().slice(0, 50)) {
    const li = document.createElement("li");
    const text = Object.assign(document.createElement("span"), { className: "ex-text", textContent: e.text });
    const meta = Object.assign(document.createElement("span"), { className: "ex-meta" });
    const tag = Object.assign(document.createElement("span"), { className: `ex-tag ${e.label}`, textContent: catLabel(e.label) });
    meta.append(tag, Object.assign(document.createElement("span"), { className: "ex-src", textContent: SOURCE_LABEL[e.source] ?? "" }));
    const del = document.createElement("button");
    del.className = "btn quiet icon";
    del.type = "button";
    del.setAttribute("aria-label", "Hapus contoh ini");
    del.innerHTML = icon("trash", 15);
    del.addEventListener("click", () => saveExamples(examples.filter((x) => x !== e), "Contoh dihapus."));
    li.append(text, meta, del);
    list.append(li);
  }
  $("#exEmpty").hidden = examples.length > 0;
}

async function saveExamples(next: Example[], note: string): Promise<void> {
  examples = next;
  await chrome.storage.local.set({ [EXAMPLES_KEY]: examples });
  renderExamples();
  tell(note);
}

async function loadExamples(): Promise<void> {
  const raw = await chrome.storage.local.get([EXAMPLES_KEY, "feedback"]);
  examples = (raw[EXAMPLES_KEY] ?? []) as Example[];
  feedbackCount = ((raw.feedback ?? []) as unknown[]).length;
  renderExamples();
}

function setupExamples(): void {
  fillLabelSelect();
  $("#exAdd").addEventListener("click", async () => {
    const box = $<HTMLTextAreaElement>("#exText");
    const text = box.value.trim();
    if (!text) return tell("Tulis dulu komentar contohnya.", "info");
    const label = $<HTMLSelectElement>("#exLabel").value as Category;
    await saveExamples(mergeExamples(examples, [{ text: text.slice(0, 600), label, at: Date.now(), source: "manual" }]), `Contoh ditambahkan sebagai ${catLabel(label)}.`);
    box.value = "";
  });
  const file = $<HTMLInputElement>("#exFile");
  $("#exImport").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    const found = parseExamples(await f.text(), "import");
    if (!found.length) return tell(`Tidak ada contoh valid di ${f.name}. Pastikan ada kolom text dan label.`, "err");
    await saveExamples(mergeExamples(examples, found), `${found.length} contoh diimpor dari ${f.name}.`);
  });
  $("#exExport").addEventListener("click", () => {
    if (!examples.length) return tell("Belum ada contoh untuk diekspor.", "info");
    download(`hidement-contoh-${Date.now()}.jsonl`, examples.map((e) => JSON.stringify({ text: e.text, label: e.label })).join("\n"), "application/x-ndjson");
    tell(`${examples.length} contoh diekspor.`);
  });
  $("#exClear").addEventListener("click", async () => {
    if (!examples.length) return;
    const ok = await confirmDialog({ title: "Hapus semua contoh", message: `Hapus ${examples.length} contoh belajar? Catatan dari tombol "Bukan berbahaya" tidak ikut terhapus.`, confirmText: "Hapus", danger: true });
    if (ok) await saveExamples([], "Semua contoh dihapus.");
  });
}

function renderPower(): void {
  $(".power").classList.toggle("off", !settings.enabled);
  $("#powerState").textContent = settings.enabled ? "Aktif" : "Nonaktif";
}

function fillForm(): void {
  baseUrl.value = settings.api.baseUrl;
  apiKey.value = settings.api.apiKey;
  $<HTMLInputElement>("#timeout").value = String(Math.round(settings.api.timeoutMs / 1000));
  $<HTMLInputElement>("#batchSize").value = String(settings.api.batchSize);
  $<HTMLInputElement>("#concurrency").value = String(settings.api.concurrency);
  $<HTMLInputElement>("#scanMax").value = String(settings.scan.max);
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
  renderSummary();
  renderCustom();
  renderPower();
  $<HTMLInputElement>("#customName").value = settings.custom.name;
  $<HTMLTextAreaElement>("#customDefinition").value = settings.custom.definition;
}

async function refreshFeedbackCount(): Promise<void> {
  const fb = ((await chrome.storage.local.get("feedback")).feedback ?? []) as unknown[];
  $("#fbCount").textContent = fb.length ? `${fb.length} catatan salah deteksi tersimpan.` : "Belum ada catatan.";
}

function setupScrollSpy(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(".nav a")];
  const sections = [...document.querySelectorAll<HTMLElement>("section.sec")];
  let frame = 0;
  let last = "";
  const update = () => {
    frame = 0;
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    let current = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= 160) current = s;
    if (atBottom) current = sections[sections.length - 1];
    if (current.id === last) return;
    last = current.id;
    for (const a of links) {
      const on = a.hash === `#${current.id}`;
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
    /* Di layar sempit nav menjadi baris yang bisa digeser: jaga tautan aktif tetap terlihat. */
    const nav = links[0]?.parentElement;
    const active = links.find((a) => a.classList.contains("on"));
    if (nav && active && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: active.offsetLeft - 16, behavior: "smooth" });
  };
  addEventListener("scroll", () => (frame ||= requestAnimationFrame(update)), { passive: true });
  update();
}

async function init(): Promise<void> {
  hydrateIcons();
  enhanceAll();
  $("#ver").textContent = chrome.runtime.getManifest?.().version ?? "";
  settings = await loadSettings();
  allModels = ((await chrome.storage.local.get("modelCache")).modelCache ?? []) as string[];
  fillForm();
  setupScrollSpy();
  void refreshFeedbackCount();

  bindToggles(document, () => settings, (p) =>
    void save(p as DeepPartial<Settings>).then(() => {
      renderSummary();
      renderCustom();
    }),
  );
  $("#modesAll").addEventListener("click", () => setAllModes(true));
  setupExamples();
  void loadExamples();
  const saveCustom = async () => {
    const name = $<HTMLInputElement>("#customName").value.trim();
    const definition = $<HTMLTextAreaElement>("#customDefinition").value.trim();
    await save({ custom: { name, definition } }, definition ? `Mode kustom “${name || "Kustom"}” disimpan.` : "Definisi mode kustom masih kosong, jadi mode ini belum dipakai.");
    renderCustom();
    renderCategoryActions();
    fillLabelSelect();
  };
  $("#customName").addEventListener("change", saveCustom);
  $("#customDefinition").addEventListener("change", saveCustom);
  $("#customDefinition").addEventListener("input", (e) => {
    const n = (e.target as HTMLTextAreaElement).value.length;
    $("#customDefCount").textContent = n ? `${n}/400` : "";
  });
  $("#modesNone").addEventListener("click", () => setAllModes(false));

  $("#connect").addEventListener("click", connect);
  $("#testApi").addEventListener("click", testApi);
  baseUrl.addEventListener("keydown", (e) => e.key === "Enter" && void connect());
  apiKey.addEventListener("keydown", (e) => e.key === "Enter" && void connect());
  apiKey.addEventListener("change", () => save({ api: { apiKey: apiKey.value.trim() } }, "API key disimpan."));
  const toggleKey = $<HTMLButtonElement>("#toggleKey");
  toggleKey.addEventListener("click", () => {
    const show = apiKey.type === "password";
    apiKey.type = show ? "text" : "password";
    toggleKey.setAttribute("aria-pressed", String(show));
    toggleKey.setAttribute("aria-label", show ? "Sembunyikan API key" : "Tampilkan API key");
    toggleKey.innerHTML = icon(show ? "eyeOff" : "eye", 16);
  });

  const d = DEFAULT_SETTINGS;
  const advanced: [string, number, number, number, (v: number) => DeepPartial<Settings>][] = [
    ["#timeout", LIMITS.timeoutMs[0] / 1000, LIMITS.timeoutMs[1] / 1000, d.api.timeoutMs / 1000, (v) => ({ api: { timeoutMs: v * 1000 } })],
    ["#batchSize", ...LIMITS.batchSize, d.api.batchSize, (v) => ({ api: { batchSize: v } })],
    ["#concurrency", ...LIMITS.concurrency, d.api.concurrency, (v) => ({ api: { concurrency: v } })],
    ["#scanMax", ...LIMITS.scanMax, d.scan.max, (v) => ({ scan: { max: v } })],
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

  document.querySelectorAll<HTMLElement>("[data-scan]").forEach((b) =>
    b.addEventListener("click", async () => {
      const method = b.dataset.scan as Settings["scan"]["method"];
      await save({ scan: { method } }, method === "fast" ? "Pindai Cepat aktif. Komentar postingan akan dimuat otomatis." : "Kembali ke scroll biasa.");
      renderPresets();
    }),
  );

  const high = $<HTMLInputElement>("#high");
  const medium = $<HTMLInputElement>("#medium");
  /* Kedua slider berbagi skala 0–100 agar jempolnya sejajar di satu trek; batas sebenarnya dijaga di sini. */
  const syncRanges = (changed: "high" | "medium") => {
    let h = Math.max(LIMITS.threshold[0] + 10, Number(high.value));
    let m = Math.max(LIMITS.threshold[0], Math.min(90, Number(medium.value)));
    if (m > h - 5) changed === "high" ? (m = Math.max(LIMITS.threshold[0], h - 5)) : (h = Math.min(100, m + 5));
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
    download(`hidement-feedback-${Date.now()}.json`, JSON.stringify(fb, null, 2), "application/json");
    tell(`${fb.length} feedback diekspor.`);
  });
  $("#clearCache").addEventListener("click", async () => {
    await send({ type: "clearCache" });
    tell("Cache dihapus. Komentar akan dianalisis ulang.");
  });
  $("#resetAll").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Konfirmasi",
      message: "Reset semua pengaturan ke awal? Base URL, API key, dan pilihan model juga ikut terhapus.",
      confirmText: "Reset",
      danger: true,
    });
    if (!ok) return;
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
    renderSummary();
    renderCustom();
    renderPower();
  });

  if (!settings.api.baseUrl) say(dlg, "Halo, saya Raphael. Mulai dengan menghubungkan endpoint AI kamu di bagian Koneksi.", "info", 8000);
}

void init();

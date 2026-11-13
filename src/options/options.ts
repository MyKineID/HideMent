import { DEFAULT_SETTINGS, LIMITS, loadSettings, onSettingsChanged, priorityOf, saveSettings, type ActionKind, type DeepPartial, type Settings } from "../core/settings";
import { CATEGORY_LABEL, MODE_CATEGORIES, MODE_LABEL, MODES, verdictLabel, type Category, type Platform } from "../core/types";
import { EXAMPLES_KEY, mergeExamples, parseExamples, type Example } from "../core/examples";
import { extractPostLinks } from "../core/links";
import type { Decision } from "../core/engine";
import { send, type StatusInfo } from "../shared/messages";
import { $, bindToggles, download, refreshToggles } from "../shared/dom";
import { hydrateIcons, icon } from "../shared/icons";
import { say } from "../shared/raphael";
import { presetOf, presetPatch, type Preset } from "../shared/presets";
import { confirmDialog, enhanceAll, enhanceSelect } from "../shared/ui";

let settings: Settings = DEFAULT_SETTINGS;

const dlg = $("#dlg");

const tell = (text: string, tone: "info" | "ok" | "err" = "ok") => say(dlg, text, tone, tone === "err" ? 9000 : 4200);

async function save(patch: DeepPartial<Settings>, note = "Pengaturan disimpan."): Promise<void> {
  settings = await saveSettings(patch);
  tell(note);
}

/* ── mesin lokal ─────────────────────────── */

const fmtUs = (us: number) => (us < 1000 ? `${us} µs` : `${(us / 1000).toFixed(1)} ms`);

async function renderEngine(): Promise<void> {
  const st = await send<StatusInfo>({ type: "getStatus" }).catch(() => null);
  if (!st) return;
  const parts = [`database ${st.engine.seed.toLocaleString("id-ID")} contoh`, `contohmu ${st.engine.examples.toLocaleString("id-ID")}`];
  if (st.engine.avgUs) parts.push(`rata-rata ${fmtUs(st.engine.avgUs)}/komentar`);
  $("#engMeta").textContent = parts.join(" · ");
}

let tryTimer: ReturnType<typeof setTimeout> | undefined;
let tryToken = 0;

/** "Coba mesin": nilai kalimat yang diketik dan tampilkan keyakinan tiap kategori. */
async function tryEngine(): Promise<void> {
  const text = $<HTMLTextAreaElement>("#tryText").value.trim();
  const out = $("#tryOut");
  if (!text) return void (out.hidden = true);
  const token = ++tryToken;
  const d = await send<Decision>({ type: "tryEngine", text }).catch((e: Error) => (tell(e.message, "err"), null));
  if (!d || token !== tryToken) return;
  out.hidden = false;
  const v = d.verdict;
  const tag = $("#tryCat");
  tag.className = `ex-tag ${v.category}`;
  tag.textContent = v.category === "aman" ? "Aman" : verdictLabel(v);
  $("#tryScore").textContent = v.category === "aman" ? `skor ${v.score}` : `skor ${v.score} · prioritas ${priorityOf(v.score, settings.thresholds)}`;
  $("#tryTime").textContent = fmtUs(d.us);
  $("#tryReason").textContent = v.reason || "—";
  const bars = $("#tryBars");
  bars.replaceChildren();
  const rows = (Object.entries(d.probs) as [Category, number][]).sort((x, y) => y[1] - x[1]).slice(0, 6);
  for (const [cat, p] of rows) {
    const pct = Math.round(p * 100);
    const li = document.createElement("li");
    li.className = pct >= settings.thresholds.high ? "high" : pct >= settings.thresholds.medium ? "mid" : "";
    const name = Object.assign(document.createElement("span"), { className: "try-name", textContent: catLabel(cat) });
    const meter = Object.assign(document.createElement("span"), { className: "try-meter" });
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(1, pct)}%`;
    meter.append(fill);
    const num = Object.assign(document.createElement("b"), { className: "mono", textContent: String(pct) });
    li.append(name, meter, num);
    bars.append(li);
  }
  /* Bukti: contoh berlabel paling mirip dari database / contoh belajarmu. */
  const sim = $("#trySim");
  sim.replaceChildren();
  for (const x of d.similar) {
    const li = document.createElement("li");
    const tag = Object.assign(document.createElement("span"), { className: `ex-tag ${x.label}`, textContent: x.label === "aman" ? "Aman" : catLabel(x.label) });
    const text = Object.assign(document.createElement("span"), { className: "try-sim-text", textContent: x.text, title: x.text });
    const pct = Object.assign(document.createElement("b"), { className: "mono", textContent: `${Math.round(x.sim * 100)}%`, title: x.from === "contohmu" ? "dari contoh belajarmu" : "dari database bawaan" });
    li.append(tag, text, pct);
    sim.append(li);
  }
  $("#trySimWrap").hidden = d.similar.length === 0;
  void renderEngine();
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
  $("#customDesc").textContent = definition ? `Kata kunci: ${definition}` : "Tulis sendiri kata kunci komentar yang mau ditandai, misalnya spoiler.";
  const foot = $("#customFoot");
  const missing = settings.modes.kustom && !definition;
  foot.textContent = missing ? "Isi kata kunci dulu" : "Lokal";
  foot.classList.toggle("warn", missing);
  $("#customDefCount").textContent = definition ? `${definition.length}/400` : "";
}

/* ── contoh belajar ──────────────────────── */

let examples: Example[] = [];
let feedbackCount = 0;
const SOURCE_LABEL: Record<Example["source"], string> = { manual: "ditambah manual", import: "dari file", feedback: "dari feedback", review: "dicek di Antrian", link: "dari link postingan" };

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
    /* Satu komentar per baris: menempel daftar komentar sekaligus jadi banyak contoh dengan label yang sama. */
    const lines = [...new Set(box.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
    if (!lines.length) return tell("Tulis dulu komentar contohnya.", "info");
    const label = $<HTMLSelectElement>("#exLabel").value as Category;
    const now = Date.now();
    const added = lines.map((t) => ({ text: t.slice(0, 600), label, at: now, source: "manual" as const }));
    await saveExamples(mergeExamples(examples, added), `${added.length > 1 ? `${added.length} contoh` : "Contoh"} ditambahkan sebagai ${catLabel(label)}.`);
    box.value = "";
  });

  const linksBox = $<HTMLTextAreaElement>("#learnLinks");
  const linksBtn = $<HTMLButtonElement>("#learnLinksRun");
  let windowId: number | undefined;
  void chrome.windows.getCurrent().then((w) => (windowId = w.id));
  linksBox.addEventListener("input", () => {
    const n = extractPostLinks(linksBox.value).length;
    linksBtn.disabled = n === 0;
    linksBtn.querySelector(".lbl")!.textContent = n ? `Pelajari komentar dari ${n} link` : "Pelajari komentar dari link";
  });
  linksBtn.addEventListener("click", () => {
    const n = extractPostLinks(linksBox.value).length;
    if (!n) return tell("Tempel dulu link postingannya.", "info");
    /* Side panel yang menjalankan; dibuka langsung di klik ini karena sidePanel.open butuh gestur pengguna. */
    void chrome.storage.session.set({ learnLinks: linksBox.value });
    if (windowId !== undefined) void chrome.sidePanel.open({ windowId }).catch(() => undefined);
    tell(`${n} link dikirim ke side panel. Biarkan tab yang dibuka HideMent sampai selesai; contoh baru muncul di daftar di bawah.`);
  });

  $("#exClearLink").addEventListener("click", async () => {
    const n = examples.filter((e) => e.source === "link").length;
    if (!n) return tell("Belum ada contoh dari link.", "info");
    const ok = await confirmDialog({ title: "Hapus contoh dari link", message: `Hapus ${n} contoh yang dipelajari otomatis dari link? Contoh manual, impor, dan hasil cek tetap ada.`, confirmText: "Hapus", danger: true });
    if (ok) await saveExamples(examples.filter((e) => e.source !== "link"), `${n} contoh dari link dihapus.`);
  });

  /* Side panel menambah contoh (Benar/Salah, belajar dari link) sambil halaman ini terbuka. */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[EXAMPLES_KEY]) return;
    examples = (changes[EXAMPLES_KEY].newValue ?? []) as Example[];
    renderExamples();
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
  $<HTMLInputElement>("#limitPerPost").value = String(settings.scan.limit.perPost);
  $<HTMLInputElement>("#limitPerRun").value = String(settings.scan.limit.perRun);
  for (const platform of ["youtube", "instagram", "tiktok", "x", "reddit"] as const) {
    const override = settings.scan.limit.perPlatform[platform];
    $<HTMLInputElement>(`#limitPlat-${platform}`).value = override == null ? "" : String(override);
  }
  $<HTMLInputElement>("#high").value = String(settings.thresholds.high);
  $<HTMLInputElement>("#medium").value = String(settings.thresholds.medium);
  renderMeter(settings.thresholds.high, settings.thresholds.medium);
  $<HTMLTextAreaElement>("#whitelist").value = settings.whitelist.join("\n");
  $<HTMLTextAreaElement>("#customKeywords").value = settings.customKeywords.join("\n");
  refreshToggles(document, settings);
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
  fillForm();
  void renderEngine();
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

  $("#tryText").addEventListener("input", () => {
    clearTimeout(tryTimer);
    tryTimer = setTimeout(() => void tryEngine(), 120);
  });

  const d = DEFAULT_SETTINGS;
  const advanced: [string, number, number, number, (v: number) => DeepPartial<Settings>][] = [
    ["#limitPerPost", ...LIMITS.limitPerPost, d.scan.limit.perPost, (v) => ({ scan: { limit: { perPost: v } } })],
    ["#limitPerRun", ...LIMITS.limitPerRun, d.scan.limit.perRun, (v) => ({ scan: { limit: { perRun: v } } })],
  ];
  for (const [sel, min, max, fb, patch] of advanced) {
    $<HTMLInputElement>(sel).addEventListener("change", (e) => save(patch(clampNum(e.target as HTMLInputElement, min, max, fb))));
  }

  /* Override batas per platform: kosong berarti hapus override (kembali memakai batas per postingan). */
  const platforms: Platform[] = ["youtube", "instagram", "tiktok", "x", "reddit"];
  for (const platform of platforms) {
    const input = $<HTMLInputElement>(`#limitPlat-${platform}`);
    input.addEventListener("change", () => {
      if (!input.value.trim()) {
        input.value = "";
        void save({ scan: { limit: { perPlatform: { [platform]: undefined } } } }, `Batas khusus ${platform} dihapus; memakai batas per postingan.`);
        return;
      }
      const v = clampNum(input, ...LIMITS.limitPerPost, settings.scan.limit.perPost);
      void save({ scan: { limit: { perPlatform: { [platform]: v } } } }, "Pengaturan disimpan.");
    });
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
      await save(
        { scan: { method } },
        {
          manual: "Deteksi menunggu tombol Analyze di tiap postingan.",
          scroll: "Komentar yang terlihat langsung dianalisis saat scroll.",
          fast: "Pindai Cepat aktif. Komentar postingan akan dimuat otomatis.",
        }[method],
      );
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
  $("#resetAll").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Konfirmasi",
      message: "Reset semua pengaturan ke awal? Contoh belajar dan catatan salah deteksi tetap disimpan.",
      confirmText: "Reset",
      danger: true,
    });
    if (!ok) return;
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    settings = DEFAULT_SETTINGS;
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

  say(dlg, "Halo, saya Raphael. Semua penilaian berjalan di perangkatmu tanpa AI dan tanpa API key. Pilih mode deteksi, lalu coba mesinnya di bagian Mesin lokal.", "info", 8000);
}

void init();

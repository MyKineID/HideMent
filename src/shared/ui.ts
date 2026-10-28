/* Komponen UI vanilla pengganti elemen bawaan browser: switch, dropdown, combobox dengan pencarian,
   radiogroup, stepper angka, kolom cari, dan dialog konfirmasi. Semuanya bisa dipakai penuh dengan keyboard. */

import { icon } from "./icons";

let uid = 0;
const nextId = (p: string) => `${p}-${++uid}`;

/** Satu popover terbuka pada satu waktu; klik di luar atau jendela kehilangan fokus menutupnya. */
let closeOpen: (() => void) | null = null;

function closeOpenPopover(): void {
  closeOpen?.();
  closeOpen = null;
}

document.addEventListener("pointerdown", (e) => {
  if (!(e.target as HTMLElement).closest(".psel, .pcombo")) closeOpenPopover();
});
addEventListener("blur", closeOpenPopover);

/** Posisikan popover agar tidak keluar layar (kanan atau bawah). */
function place(pop: HTMLElement, anchor: HTMLElement): void {
  pop.classList.remove("align-right", "drop-up");
  const r = anchor.getBoundingClientRect();
  const p = pop.getBoundingClientRect();
  pop.classList.toggle("align-right", r.left + p.width > innerWidth - 8);
  pop.classList.toggle("drop-up", r.bottom + p.height > innerHeight - 8 && r.top > p.height + 8);
}

/* ── switch ─────────────────────────────────────── */

/** Checkbox `.switch` diumumkan sebagai saklar oleh pembaca layar. */
export function enhanceSwitch(input: HTMLInputElement): void {
  input.setAttribute("role", "switch");
}

/* ── radiogroup ─────────────────────────────────── */

/**
 * Grup tombol `[role=radiogroup]` dengan roving tabindex: Tab masuk ke pilihan aktif,
 * panah kiri/kanan/atas/bawah, Home dan End berpindah sekaligus memilih.
 */
export function enhanceRadioGroup(group: HTMLElement): void {
  if (group.dataset.enhanced) return;
  group.dataset.enhanced = "1";
  const radios = () => [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
  const sync = () => {
    const all = radios();
    const checked = all.find((r) => r.getAttribute("aria-checked") === "true") ?? all[0];
    all.forEach((r) => (r.tabIndex = r === checked ? 0 : -1));
  };
  group.addEventListener("keydown", (e) => {
    const all = radios();
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next = -1;
    if (delta) next = (i + delta + all.length) % all.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = all.length - 1;
    if (next < 0) return;
    e.preventDefault();
    all[next].focus();
    all[next].click();
  });
  new MutationObserver(sync).observe(group, { subtree: true, attributes: true, attributeFilter: ["aria-checked"] });
  sync();
}

/* ── select ─────────────────────────────────────── */

/**
 * Ubah <select> bawaan jadi dropdown bergaya HideMent. <select> aslinya tetap ada (tersembunyi)
 * sebagai sumber nilai & event "change". Mendukung panah, Home/End, Enter, Esc, dan ketik-untuk-mencari.
 */
export function enhanceSelect(sel: HTMLSelectElement): void {
  if (sel.dataset.enhanced) return;
  sel.dataset.enhanced = "1";

  const wrap = document.createElement("div");
  wrap.className = `psel ${sel.className}`.trim();
  sel.className = "psel-native";
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");
  sel.before(wrap);
  wrap.append(sel);

  const listId = nextId("psel");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "psel-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", listId);
  const label = sel.getAttribute("aria-label") ?? (sel.id ? document.querySelector(`label[for="${sel.id}"]`)?.textContent : null);
  const text = document.createElement("span");
  text.className = "psel-text";
  const caret = document.createElement("span");
  caret.className = "psel-caret";
  caret.setAttribute("aria-hidden", "true");
  btn.append(text, caret);

  const list = document.createElement("div");
  list.className = "psel-list";
  list.id = listId;
  list.setAttribute("role", "listbox");
  if (label) list.setAttribute("aria-label", label.trim());
  list.tabIndex = -1;
  list.hidden = true;
  wrap.append(btn, list);

  let active = 0;
  let typed = "";
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  const items = () => [...list.querySelectorAll<HTMLElement>(".psel-opt")];
  const sync = () => {
    const selected = sel.selectedOptions[0]?.text ?? "";
    text.textContent = selected;
    btn.setAttribute("aria-label", label ? `${label.trim()}: ${selected}` : selected);
    items().forEach((it, i) => it.setAttribute("aria-selected", String(i === sel.selectedIndex)));
  };
  const highlight = (i: number) => {
    const all = items();
    active = Math.max(0, Math.min(all.length - 1, i));
    all.forEach((it, j) => it.classList.toggle("active", j === active));
    list.setAttribute("aria-activedescendant", all[active]?.id ?? "");
    all[active]?.scrollIntoView({ block: "nearest" });
  };
  const close = (refocus = false) => {
    if (list.hidden) return;
    list.hidden = true;
    wrap.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  };
  const open = () => {
    closeOpenPopover();
    list.hidden = false;
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    place(list, btn);
    highlight(sel.selectedIndex);
    list.focus();
    closeOpen = () => close();
  };
  const choose = (i: number) => {
    if (i !== sel.selectedIndex) {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sync();
    close(true);
  };

  [...sel.options].forEach((o, i) => {
    const it = document.createElement("div");
    it.className = "psel-opt";
    it.id = `${listId}-${i}`;
    it.setAttribute("role", "option");
    it.textContent = o.text;
    it.addEventListener("pointerenter", () => highlight(i));
    it.addEventListener("click", () => choose(i));
    list.append(it);
  });

  btn.addEventListener("click", () => (list.hidden ? open() : close(true)));
  btn.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener("keydown", (e) => {
    const n = items().length;
    switch (e.key) {
      case "ArrowDown": highlight(active + 1); break;
      case "ArrowUp": highlight(active - 1); break;
      case "Home": highlight(0); break;
      case "End": highlight(n - 1); break;
      case "Enter":
      case " ": choose(active); break;
      case "Escape": close(true); break;
      case "Tab": close(); return;
      default: {
        if (e.key.length !== 1) return;
        clearTimeout(typedTimer);
        typed += e.key.toLowerCase();
        typedTimer = setTimeout(() => (typed = ""), 600);
        const hit = items().findIndex((it) => it.textContent!.toLowerCase().startsWith(typed));
        if (hit >= 0) highlight(hit);
      }
    }
    e.preventDefault();
  });
  sel.addEventListener("change", sync);
  sync();
}

/* ── combobox dengan pencarian ──────────────────── */

export interface ComboOption {
  value: string;
  /** Bagian redup di depan label, mis. "openai/". */
  prefix?: string;
  label: string;
  badge?: string;
}

export interface Combobox {
  set(options: ComboOption[], value: string): void;
  setDisabled(disabled: boolean, placeholder?: string): void;
}

/**
 * Tombol pemilih yang membuka panel berisi kolom cari + daftar. Cocok untuk daftar panjang (model AI).
 * Ketik untuk menyaring, panah untuk berpindah, Enter memilih, Esc menutup.
 */
export function createCombobox(host: HTMLElement, opts: { label: string; empty: string; onSelect(value: string): void }): Combobox {
  host.classList.add("pcombo");
  const listId = nextId("pcombo");
  host.innerHTML = `
    <button type="button" class="pcombo-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}"><span class="pcombo-text"></span><span class="pcombo-caret" aria-hidden="true"></span></button>
    <div class="pcombo-pop" hidden>
      <div class="pcombo-search">${icon("search", 14)}<input type="search" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${listId}" autocomplete="off" spellcheck="false"></div>
      <ul class="pcombo-list" id="${listId}" role="listbox"></ul>
      <div class="pcombo-count" aria-live="polite"></div>
    </div>`;
  const btn = host.querySelector<HTMLButtonElement>(".pcombo-btn")!;
  const btnText = host.querySelector<HTMLElement>(".pcombo-text")!;
  const pop = host.querySelector<HTMLElement>(".pcombo-pop")!;
  const input = host.querySelector<HTMLInputElement>("input")!;
  const list = host.querySelector<HTMLElement>(".pcombo-list")!;
  const count = host.querySelector<HTMLElement>(".pcombo-count")!;
  input.placeholder = "Cari…";
  input.setAttribute("aria-label", `Cari ${opts.label.toLowerCase()}`);
  list.setAttribute("aria-label", opts.label);

  let options: ComboOption[] = [];
  let value = "";
  let shown: ComboOption[] = [];
  let active = 0;

  const label = (o?: ComboOption) => (o ? `${o.prefix ?? ""}${o.label}` : "");
  const renderButton = () => {
    const cur = options.find((o) => o.value === value);
    btnText.textContent = cur ? label(cur) : value || opts.empty;
    btn.setAttribute("aria-label", `${opts.label}: ${btnText.textContent}`);
  };
  const highlight = (i: number) => {
    const els = [...list.children] as HTMLElement[];
    active = Math.max(0, Math.min(els.length - 1, i));
    els.forEach((el, j) => el.classList.toggle("active", j === active));
    input.setAttribute("aria-activedescendant", els[active]?.id ?? "");
    els[active]?.scrollIntoView({ block: "nearest" });
  };
  const renderList = () => {
    const q = input.value.trim().toLowerCase();
    shown = options.filter((o) => !q || label(o).toLowerCase().includes(q));
    list.replaceChildren(
      ...shown.map((o, i) => {
        const li = document.createElement("li");
        li.className = "pcombo-opt";
        li.id = `${listId}-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(o.value === value));
        const name = Object.assign(document.createElement("span"), { className: "pcombo-label" });
        if (o.prefix) name.append(Object.assign(document.createElement("span"), { className: "prov", textContent: o.prefix }));
        name.append(o.label);
        li.append(name);
        if (o.badge) li.append(Object.assign(document.createElement("span"), { className: "fast-tag", textContent: o.badge }));
        li.addEventListener("pointerenter", () => highlight(i));
        li.addEventListener("click", () => choose(i));
        return li;
      }),
    );
    if (!shown.length) list.append(Object.assign(document.createElement("li"), { className: "pcombo-empty", textContent: `Tidak ada yang cocok dengan "${input.value}".` }));
    count.textContent = q ? `${shown.length} dari ${options.length}` : `${options.length} tersedia`;
    highlight(Math.max(0, shown.findIndex((o) => o.value === value)));
  };
  const close = (refocus = false) => {
    if (pop.hidden) return;
    pop.hidden = true;
    host.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  };
  const open = () => {
    closeOpenPopover();
    input.value = "";
    pop.hidden = false;
    host.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    renderList();
    place(pop, btn);
    input.focus();
    closeOpen = () => close();
  };
  const choose = (i: number) => {
    const o = shown[i];
    if (!o) return;
    if (o.value !== value) {
      value = o.value;
      opts.onSelect(o.value);
    }
    renderButton();
    close(true);
  };

  btn.addEventListener("click", () => (pop.hidden ? open() : close(true)));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open();
    }
  });
  input.addEventListener("input", renderList);
  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown": highlight(active + 1); break;
      case "ArrowUp": highlight(active - 1); break;
      case "Enter": choose(active); break;
      case "Escape": close(true); break;
      case "Tab": close(); return;
      default: return;
    }
    e.preventDefault();
  });

  return {
    set(next, v) {
      options = next;
      value = v;
      renderButton();
      if (!pop.hidden) renderList();
    },
    setDisabled(disabled, placeholder) {
      btn.disabled = disabled;
      if (disabled) {
        close();
        btnText.textContent = placeholder ?? opts.empty;
      } else renderButton();
    },
  };
}

/* ── dialog konfirmasi ──────────────────────────── */

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

/** Pengganti confirm(): dialog modal dengan suara sistem Raphael. Fokus kembali ke pemicu setelah ditutup. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const opener = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "pdlg";
    const titleId = nextId("pdlg");
    dlg.setAttribute("aria-labelledby", titleId);
    dlg.innerHTML = `
      <div class="dlg pdlg-box" data-tone="${opts.danger ? "err" : "info"}">
        <div class="dlg-head"><span class="dlg-name">Raphael</span><span class="dlg-title" id="${titleId}"></span></div>
        <span class="dlg-text"></span>
        <div class="pdlg-actions">
          <button type="button" class="btn ghost sm" data-r="0"></button>
          <button type="button" class="btn sm ${opts.danger ? "danger" : ""}" data-r="1"></button>
        </div>
      </div>`;
    dlg.querySelector(".dlg-title")!.textContent = `«${opts.title}»`;
    dlg.querySelector(".dlg-text")!.textContent = opts.message;
    dlg.querySelector('[data-r="0"]')!.textContent = opts.cancelText ?? "Batal";
    dlg.querySelector('[data-r="1"]')!.textContent = opts.confirmText ?? "Ya, lanjutkan";

    let result = false;
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (b) {
        result = b.dataset.r === "1";
        dlg.close();
      } else if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      opener?.focus();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector<HTMLElement>('[data-r="0"]')!.focus();
  });
}

/* ── stepper angka ──────────────────────────────── */

/** Pengganti spinner bawaan input angka: tombol − / +. Panah atas/bawah di input tetap berfungsi. */
export function enhanceNumber(input: HTMLInputElement): void {
  if (input.dataset.enhanced) return;
  input.dataset.enhanced = "1";
  const wrap = document.createElement("div");
  wrap.className = "pnum";
  input.before(wrap);
  const mk = (txt: string, dir: 1 | -1) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pnum-btn";
    b.textContent = txt;
    b.tabIndex = -1;
    b.setAttribute("aria-label", dir > 0 ? "Tambah" : "Kurangi");
    b.addEventListener("click", () => {
      const min = Number(input.min || -Infinity);
      const max = Number(input.max || Infinity);
      const step = Number(input.step || 1);
      const next = Math.max(min, Math.min(max, (Number(input.value) || 0) + dir * step));
      if (String(next) === input.value) return;
      input.value = String(next);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return b;
  };
  input.inputMode = "numeric";
  wrap.append(mk("−", -1), input, mk("+", 1));
}

/* ── kolom cari ─────────────────────────────────── */

/** Kolom cari dengan tombol hapus kustom (pengganti ✕ bawaan). Esc mengosongkan. */
export function enhanceSearch(input: HTMLInputElement): void {
  if (input.dataset.enhanced) return;
  input.dataset.enhanced = "1";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "psearch-clear";
  clear.textContent = "×";
  clear.setAttribute("aria-label", "Hapus pencarian");
  clear.hidden = !input.value;
  input.after(clear);
  const update = () => (clear.hidden = !input.value);
  input.addEventListener("input", update);
  clear.addEventListener("click", () => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      e.preventDefault();
      clear.click();
    }
  });
}

export function enhanceAll(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement>("input.switch").forEach(enhanceSwitch);
  root.querySelectorAll<HTMLElement>('[role="radiogroup"]').forEach(enhanceRadioGroup);
  root.querySelectorAll<HTMLSelectElement>("select").forEach(enhanceSelect);
  root.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(enhanceNumber);
  root.querySelectorAll<HTMLInputElement>('input[type="search"]:not([role="combobox"])').forEach(enhanceSearch);
}

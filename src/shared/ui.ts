/* Komponen UI pixel pengganti elemen bawaan browser: dropdown, dialog konfirmasi, stepper angka, kolom cari. */

let openSelect: (() => void) | null = null;

function closeOpenSelect(): void {
  openSelect?.();
  openSelect = null;
}

document.addEventListener("pointerdown", (e) => {
  if (!(e.target as HTMLElement).closest(".psel")) closeOpenSelect();
});
addEventListener("blur", closeOpenSelect);

/** Ubah <select> bawaan jadi dropdown pixel. <select> aslinya tetap ada (tersembunyi) sebagai sumber nilai & event "change". */
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

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "psel-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const label = sel.getAttribute("aria-label") ?? (sel.id ? document.querySelector(`label[for="${sel.id}"]`)?.textContent : null);
  if (label) btn.setAttribute("aria-label", label.trim());
  const text = document.createElement("span");
  text.className = "psel-text";
  const caret = document.createElement("span");
  caret.className = "psel-caret";
  caret.setAttribute("aria-hidden", "true");
  btn.append(text, caret);

  const list = document.createElement("div");
  list.className = "psel-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(btn, list);

  let active = 0;

  const items = () => [...list.querySelectorAll<HTMLElement>(".psel-opt")];
  const sync = () => {
    text.textContent = sel.selectedOptions[0]?.text ?? "";
    items().forEach((it, i) => it.setAttribute("aria-selected", String(i === sel.selectedIndex)));
  };
  const highlight = (i: number) => {
    const all = items();
    active = Math.max(0, Math.min(all.length - 1, i));
    all.forEach((it, j) => it.classList.toggle("active", j === active));
    all[active]?.scrollIntoView({ block: "nearest" });
  };
  const close = () => {
    list.hidden = true;
    wrap.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    closeOpenSelect();
    list.hidden = false;
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    list.classList.toggle("align-right", r.left + list.offsetWidth > innerWidth - 8);
    list.classList.toggle("drop-up", r.bottom + list.offsetHeight > innerHeight - 8 && r.top > list.offsetHeight);
    highlight(sel.selectedIndex);
    openSelect = close;
  };
  const choose = (i: number) => {
    if (i !== sel.selectedIndex) {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sync();
    close();
    btn.focus();
  };

  [...sel.options].forEach((o, i) => {
    const it = document.createElement("div");
    it.className = "psel-opt";
    it.setAttribute("role", "option");
    it.textContent = o.text;
    it.addEventListener("pointerenter", () => highlight(i));
    it.addEventListener("click", () => choose(i));
    list.append(it);
  });

  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  btn.addEventListener("keydown", (e) => {
    const isOpen = !list.hidden;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        if (!isOpen) open();
        else highlight(active + (e.key === "ArrowDown" ? 1 : -1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (isOpen) choose(active);
        else open();
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  });
  sel.addEventListener("change", sync);
  sync();
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

/** Pengganti confirm(): dialog modal bergaya kotak dialog Raphael. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "pdlg";
    dlg.innerHTML = `
      <div class="dlg pdlg-box" data-tone="${opts.danger ? "err" : "info"}">
        <span class="dlg-name">RAPHAEL</span>
        <div class="grow">
          <span class="dlg-title"></span>
          <span class="dlg-text"></span>
          <div class="pdlg-actions">
            <button type="button" class="btn ghost sm" data-r="0"></button>
            <button type="button" class="btn sm ${opts.danger ? "danger" : ""}" data-r="1"></button>
          </div>
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
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector<HTMLElement>('[data-r="0"]')!.focus();
  });
}

/** Pengganti spinner bawaan input angka: tombol − / + pixel. */
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

/** Kolom cari dengan tombol hapus pixel (pengganti ✕ bawaan). */
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
  root.querySelectorAll<HTMLSelectElement>("select").forEach(enhanceSelect);
  root.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(enhanceNumber);
  root.querySelectorAll<HTMLInputElement>('input[type="search"]').forEach(enhanceSearch);
}

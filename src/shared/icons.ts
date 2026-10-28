/* Ikon garis 24×24 (stroke 1.8). Path digambar sendiri untuk HideMent, tanpa pustaka ikon pihak ketiga. */
const ICONS = {
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  power: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
  seven: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6Z"/><path d="m9 12 2 2 4-4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.3C3.9 8.9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-4.5"/><circle cx="12" cy="13" r="1.3" fill="currentColor"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1" fill="currentColor"/><circle cx="4.8" cy="12" r="1" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1" fill="currentColor"/>',
  disk: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10.2 9.3 4.6 2.7-4.6 2.7Z" fill="currentColor"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17" cy="7" r=".9" fill="currentColor"/>',
  tiktok: '<path d="M14 3.5v11.2a3.7 3.7 0 1 1-3.7-3.7"/><path d="M14 3.5a5 5 0 0 0 5 5"/>',
  x: '<path d="m4 4 16 16M20 4 4 20"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5h11l-2 4 2 4H5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.2"/><circle cx="12" cy="16.9" r=".6" fill="currentColor"/>',
  queue: '<path d="M4 6.5h16M4 12h11M4 17.5h7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.4A7.6 7.6 0 0 0 7 6.4l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.4.9 2-3.4Z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12Z"/>',
  play: '<path d="M7 4.5v15l12-7.5Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  dot: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): string {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}

/** Isi semua elemen `[data-icon]` dan `[data-logo]` di dalam `root`. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon as IconName, Number(el.dataset.size ?? 16));
  });
  root.querySelectorAll<HTMLElement>("[data-logo]").forEach((el) => {
    el.innerHTML = logoMark(Number(el.dataset.logo || 28));
  });
}

/**
 * Logo HideMent: gelembung komentar berbentuk lembut (sedikit seperti slime) dengan mata yang tertutup garis.
 * Geometri yang sama dipakai scripts/make-icons.mjs untuk ikon PNG ekstensi.
 */
export function logoMark(size = 28): string {
  return `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 3.5c7.2 0 12.5 4.6 12.5 10.6S23.2 24.7 16 24.7c-1.3 0-2.6-.2-3.8-.5L6.4 27.6l1.4-5.4C5 20.3 3.5 17.4 3.5 14.1 3.5 8.1 8.8 3.5 16 3.5Z" fill="#6cb4ee"/>
    <path d="M9.5 14.1s2.4-3.6 6.5-3.6 6.5 3.6 6.5 3.6-2.4 3.6-6.5 3.6-6.5-3.6-6.5-3.6Z" fill="none" stroke="#0f1012" stroke-width="1.9" stroke-linejoin="round"/>
    <path d="m10.6 19.2 10.8-10.2" stroke="#0f1012" stroke-width="2.1" stroke-linecap="round"/>
  </svg>`;
}

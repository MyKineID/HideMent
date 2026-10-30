import type { Category, Platform } from "../../core/types";

export interface BadgeSlot {
  node: HTMLElement;
  /** "inline" = disisipkan di akhir baris nama, "row" = baris sendiri tepat di atas teks komentar. */
  where: "inline" | "row";
}

export interface Adapter {
  platform: Platform;
  findComments(root: ParentNode): HTMLElement[];
  getText(el: HTMLElement): string;
  getAuthor(el: HTMLElement): string;
  getTextEl(el: HTMLElement): HTMLElement | null;
  getBadgeSlot(el: HTMLElement): BadgeSlot | null;
  getMenuButton(el: HTMLElement): HTMLElement | null;
  /** Link langsung ke komentar (biasanya dari tautan timestamp). null kalau tidak ada. */
  getPermalink(el: HTMLElement): string | null;
  reportReason(category: Category): string;
  /** Halaman satu postingan/video (tempat Pindai Cepat dijalankan otomatis). */
  isPostPage(url: URL): boolean;
}

export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function genericReason(category: Category): string {
  switch (category) {
    case "judol":
    case "spam":
      return "Spam / konten menyesatkan";
    case "phishing":
    case "scam":
      return "Penipuan / scam";
    case "hinaan":
    case "perundungan":
    case "sarkasme":
      return "Pelecehan atau perundungan";
    case "sara":
    case "penistaan":
      return "Ujaran kebencian";
    case "ancaman":
      return "Kekerasan / ancaman";
    case "pelecehan":
      return "Konten seksual / pelecehan";
    default:
      return "Lainnya";
  }
}


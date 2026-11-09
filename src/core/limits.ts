import type { Settings } from "./settings";
import type { Platform } from "./types";

/**
 * Batas yang berlaku untuk sebuah platform: override per platform kalau diisi,
 * kalau tidak batas per postingan yang berlaku umum.
 */
export function limitFor(settings: Settings, platform: Platform): number {
  return settings.scan.limit.perPlatform[platform] ?? settings.scan.limit.perPost;
}

/**
 * Kuota komentar untuk satu postingan.
 *
 * Komentar dihitung memakai fingerprint teks (sama dengan `data-rg-fp` yang dipakai
 * `verdictByFp`), bukan elemen DOM: platform seperti X membuang komentar dari DOM saat
 * digulir lalu menggambarnya ulang, jadi menghitung elemen selalu salah. Fingerprint yang
 * sama hanya dihitung sekali, dan kuota hanya berkurang untuk komentar yang benar-benar
 * baru dianalisis.
 *
 * Satu instansi dipakai per postingan; `reset()` dipanggil saat pindah postingan
 * (pakai `postKey()`), bukan saat DOM berubah.
 */
export class CommentBudget {
  private seen = new Set<string>();
  private usedCount = 0;
  private limitValue: number;

  constructor(limit: number) {
    this.limitValue = Math.max(0, Math.round(limit) || 0);
  }

  /** Batas kuota saat ini (bisa bertambah lewat `extend`). */
  get limit(): number {
    return this.limitValue;
  }

  /** Jumlah komentar unik yang sudah memakan kuota. */
  get used(): number {
    return this.usedCount;
  }

  /** Sisa kuota sebelum batas tercapai. */
  get remaining(): number {
    return Math.max(0, this.limitValue - this.usedCount);
  }

  /** True kalau kuota sudah habis; pemindaian boleh berhenti. */
  get exhausted(): boolean {
    return this.usedCount >= this.limitValue;
  }

  /**
   * True kalau komentar baru (fingerprint belum pernah dihitung) dan kuota masih ada;
   * komentar itu langsung memakan kuota. Fingerprint yang sama selalu false supaya
   * komentar yang digambar ulang tidak dihitung dua kali, dan fingerprint kosong ditolak.
   */
  allow(fingerprint: string): boolean {
    if (!fingerprint || this.seen.has(fingerprint)) return false;
    if (this.exhausted) return false;
    this.seen.add(fingerprint);
    this.usedCount += 1;
    return true;
  }

  /** Tambah kuota postingan ini saja (tombol "Baca N lagi"); tidak mengubah pengaturan. */
  extend(n: number): void {
    const add = Math.floor(n);
    if (!Number.isFinite(n) || add <= 0) return;
    this.limitValue += add;
  }

  /** Kosongkan kuota untuk postingan lain; panggil saat postingan berganti, bukan saat DOM berubah. */
  reset(): void {
    this.seen.clear();
    this.usedCount = 0;
  }
}

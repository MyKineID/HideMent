import { hashText } from "./normalize";
import type { Decision } from "./engine";
import { verdictCacheKey, type ProviderId } from "./providers";

/**
 * Cache verdict di memori service worker.
 *
 * Komentar yang sama (setelah normalisasi: huruf hias, leetspeak, spasi, dan
 * huruf tiruan dilipat) tidak dinilai dua kali. Untuk Gemini ini yang
 * menghemat biaya: komentar berulang di satu postingan hanya ditagih sekali.
 * Cache hidup di memori saja, hilang saat service worker dimatikan, dan tidak
 * pernah ditulis ke storage.
 */
export class VerdictCache {
  private map = new Map<string, Decision>();

  constructor(private max = 500) {}

  get size(): number {
    return this.map.size;
  }

  key(provider: ProviderId, model: string, text: string, modes: Record<string, boolean>): string {
    return hashText(verdictCacheKey(provider, model, text, modes));
  }

  get(key: string): Decision | undefined {
    return this.map.get(key);
  }

  set(key: string, decision: Decision): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, decision);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

import { buildSystemPrompt, buildUserPrompt, parseAiResponse, type AiItem } from "../core/prompt";
import type { Settings } from "../core/settings";
import type { Mode, Verdict } from "../core/types";
import { ApiError, chat } from "./api";

interface Pending {
  item: AiItem;
  resolve: (v: Verdict | null) => void;
}

const FLUSH_DELAY_MS = 350;
const MAX_RETRIES = 2;

export interface BatchStats {
  requests: number;
  failures: number;
  lastLatencyMs: number;
  lastError: string;
}

export class Batcher {
  private pending: Pending[] = [];
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly stats: BatchStats = { requests: 0, failures: 0, lastLatencyMs: 0, lastError: "" };

  constructor(private getSettings: () => Settings) {}

  classify(item: AiItem): Promise<Verdict | null> {
    return new Promise((resolve) => {
      this.pending.push({ item, resolve });
      const { batchSize } = this.getSettings().api;
      if (this.pending.length >= batchSize) this.pump();
      else {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.pump(), FLUSH_DELAY_MS);
      }
    });
  }

  private pump(): void {
    clearTimeout(this.timer);
    const { api } = this.getSettings();
    while (this.pending.length && this.active < Math.max(1, api.concurrency)) {
      const batch = this.pending.splice(0, Math.max(1, api.batchSize));
      this.active++;
      void this.run(batch).finally(() => {
        this.active--;
        if (this.pending.length) this.pump();
      });
    }
  }

  private async run(batch: Pending[]): Promise<void> {
    const settings = this.getSettings();
    const modes: Record<Mode, boolean> = settings.modes;
    const shortIds = batch.map((_, i) => String(i + 1));
    const items: AiItem[] = batch.map((p, i) => ({ ...p.item, input: { ...p.item.input, id: shortIds[i] } }));
    const system = buildSystemPrompt(modes);
    const user = buildUserPrompt(items);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.stats.requests++;
        const res = await chat(settings.api, system, user);
        this.stats.lastLatencyMs = res.latencyMs;
        const verdicts = new Map(parseAiResponse(res.content, shortIds, modes).map((v) => [v.id, v]));
        batch.forEach((p, i) => {
          const v = verdicts.get(shortIds[i]);
          p.resolve(v ? { ...v, id: p.item.input.id } : null);
        });
        this.stats.lastError = "";
        return;
      } catch (e) {
        this.stats.failures++;
        this.stats.lastError = (e as Error).message;
        const status = e instanceof ApiError ? e.status : undefined;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt === MAX_RETRIES) break;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 300));
      }
    }
    batch.forEach((p) => p.resolve(null));
  }
}

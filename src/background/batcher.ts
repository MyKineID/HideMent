import type { ExampleIndex } from "../core/examples";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse, parseJsonLines, parseVerdictRow, type AiItem } from "../core/prompt";
import { activeModes, type Settings } from "../core/settings";
import { MODE_CATEGORIES, MODES, type Category, type Verdict } from "../core/types";
import { ApiError, chatStream } from "./api";

interface Pending {
  item: AiItem;
  resolve: (v: Verdict | null) => void;
}

const FLUSH_DELAY_MS = 150;
const MAX_RETRIES = 2;

export interface BatchStats {
  requests: number;
  failures: number;
  lastLatencyMs: number;
  lastTtftMs: number;
  lastError: string;
}

export class Batcher {
  private pending: Pending[] = [];
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly stats: BatchStats = { requests: 0, failures: 0, lastLatencyMs: 0, lastTtftMs: 0, lastError: "" };

  constructor(
    private getSettings: () => Settings,
    private getExamples: () => ExampleIndex | null = () => null,
  ) {}

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
    const modes = activeModes(settings);
    const customName = settings.custom.name;
    const shortIds = batch.map((_, i) => String(i + 1));
    const items: AiItem[] = batch.map((p, i) => ({ ...p.item, input: { ...p.item.input, id: shortIds[i] } }));
    const system = buildSystemPrompt(modes, settings.custom);
    const index = settings.learn.enabled ? this.getExamples() : null;
    const allowed = new Set<Category>(["aman", ...MODES.filter((m) => modes[m]).flatMap((m) => MODE_CATEGORIES[m])]);
    const examples = index?.size ? index.pick(items.map((it) => it.input.text), { allowed }) : [];
    const user = buildUserPrompt(items, examples);

    const settled = new Set<number>();
    const settle = (idx: number, v: Verdict | null) => {
      if (settled.has(idx)) return;
      settled.add(idx);
      batch[idx].resolve(v ? { ...v, id: batch[idx].item.input.id } : null);
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let pending = "";
      try {
        this.stats.requests++;
        const res = await chatStream(settings.api, system, user, (chunk) => {
          pending += chunk;
          const nl = pending.lastIndexOf("\n");
          if (nl < 0) return;
          const complete = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          for (const row of parseJsonLines(complete)) {
            const v = parseVerdictRow(row, modes, customName);
            const idx = v ? shortIds.indexOf(v.id) : -1;
            if (v && idx >= 0) settle(idx, v);
          }
        });
        this.stats.lastLatencyMs = res.latencyMs;
        this.stats.lastTtftMs = res.ttftMs;
        const rest = new Map(
          parseAiResponse(res.content, shortIds.filter((_, i) => !settled.has(i)), modes, customName).map((v) => [v.id, v]),
        );
        batch.forEach((_, i) => settle(i, rest.get(shortIds[i]) ?? null));
        this.stats.lastError = "";
        return;
      } catch (e) {
        this.stats.failures++;
        this.stats.lastError = (e as Error).message;
        if (settled.size === batch.length) return;
        const status = e instanceof ApiError ? e.status : undefined;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt === MAX_RETRIES) break;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 300));
      }
    }
    batch.forEach((_, i) => settle(i, null));
  }
}

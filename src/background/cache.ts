import { hashText } from "../core/normalize";
import { MODES, type Mode, type Verdict } from "../core/types";

const STORE_KEY = "verdictCache";
const MAX_ENTRIES = 3000;

type Entry = Omit<Verdict, "id">;

const memory = new Map<string, Entry>();
let loaded: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function ensureLoaded(): Promise<void> {
  loaded ??= chrome.storage.session.get(STORE_KEY).then((raw) => {
    const rows = (raw[STORE_KEY] ?? []) as [string, Entry][];
    for (const [k, v] of rows) memory.set(k, v);
  });
  return loaded;
}

function schedulePersist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void chrome.storage.session.set({ [STORE_KEY]: [...memory.entries()] }).catch(() => undefined);
  }, 1500);
}

/** `extra` ikut menentukan hasil (mis. definisi mode kustom), jadi perubahan di sana tidak memakai hasil lama. */
export function cacheKey(text: string, modes: Record<Mode, boolean>, model: string, extra = ""): string {
  return hashText(`${MODES.map((m) => (modes[m] ? 1 : 0)).join("")}|${model}|${extra}|${text.trim()}`);
}

export async function getCached(key: string): Promise<Entry | undefined> {
  await ensureLoaded();
  const hit = memory.get(key);
  if (hit) {
    memory.delete(key);
    memory.set(key, hit);
  }
  return hit;
}

export async function setCached(key: string, v: Verdict): Promise<void> {
  await ensureLoaded();
  const { id: _id, ...entry } = v;
  memory.set(key, entry);
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
  schedulePersist();
}

export async function clearCache(): Promise<void> {
  memory.clear();
  await chrome.storage.session.remove(STORE_KEY);
}

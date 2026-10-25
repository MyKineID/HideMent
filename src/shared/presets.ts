import type { DeepPartial, Settings } from "../core/settings";

export type Preset = "tandai" | "blur" | "sembunyi";

export function presetOf(s: Settings): Preset {
  if (s.display.hide) return "sembunyi";
  if (s.display.blur) return "blur";
  return "tandai";
}

export function presetPatch(p: Preset): DeepPartial<Settings> {
  return { display: { blur: p !== "tandai", hide: p === "sembunyi" } };
}

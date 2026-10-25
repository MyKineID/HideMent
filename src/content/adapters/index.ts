import { instagram } from "./instagram";
import { tiktok } from "./tiktok";
import type { Adapter } from "./types";
import { x } from "./x";
import { youtube } from "./youtube";

export function detectAdapter(host: string): Adapter | null {
  if (/(^|\.)youtube\.com$/.test(host)) return youtube;
  if (/(^|\.)instagram\.com$/.test(host)) return instagram;
  if (/(^|\.)tiktok\.com$/.test(host)) return tiktok;
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return x;
  return null;
}

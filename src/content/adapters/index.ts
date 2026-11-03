import { instagram } from "./instagram";
import { reddit } from "./reddit";
import { tiktok } from "./tiktok";
import type { Adapter } from "./types";
import { x } from "./x";
import { youtube } from "./youtube";

export function detectAdapter(host: string): Adapter | null {
  if (/(^|\.)youtube\.com$/.test(host)) return youtube;
  if (/(^|\.)instagram\.com$/.test(host)) return instagram;
  if (/(^|\.)tiktok\.com$/.test(host)) return tiktok;
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return x;
  /* Mencakup www., old., sh., dan subdomain lain; redd.it hanya redirect, tak pernah jadi halaman konten. */
  if (/(^|\.)reddit\.com$/.test(host)) return reddit;
  return null;
}

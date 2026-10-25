import type { Category, CommentInput, Mode, Verdict } from "./types";
import { MODE_CATEGORIES } from "./types";

export interface AiItem {
  input: CommentInput;
  hint?: string;
}

const CATEGORY_DEFS: Record<Exclude<Category, "aman">, string> = {
  judol: "promosi judi online/slot/togel, termasuk yang disamarkan (huruf hias, nama situs merek+angka, 'cek bio', testimoni menang/WD)",
  phishing: "link/ajakan menuju situs palsu, pencurian akun/OTP, meniru bank/e-wallet/platform",
  scam: "penipuan: hadiah/giveaway palsu, investasi bodong, pinjol ilegal, minta transfer/hubungi admin WA",
  spam: "promosi berulang/tidak relevan non-judi (jualan, follow-for-follow, bot)",
  hinaan: "menghina fisik, kecerdasan, atau martabat seseorang secara langsung (kata kasar ditujukan ke orang)",
  perundungan: "merundung/mengeroyok, mempermalukan, menyuruh bunuh diri, body shaming berulang",
  sara: "ujaran kebencian berbasis suku, agama, ras, antargolongan, gender, orientasi, disabilitas",
  ancaman: "ancaman kekerasan, doxing, menyebar data pribadi, intimidasi",
  pelecehan: "pelecehan seksual, komentar cabul ditujukan ke seseorang",
  sarkasme: "sindiran/ejekan terselubung yang tujuannya merendahkan orang (bukan kritik isi), mis. pujian palsu bernada mengejek",
};

export function buildSystemPrompt(modes: Record<Mode, boolean>): string {
  const cats = (Object.keys(modes) as Mode[])
    .filter((m) => modes[m])
    .flatMap((m) => MODE_CATEGORIES[m]) as Exclude<Category, "aman">[];
  const list = cats.map((c) => `- "${c}": ${CATEGORY_DEFS[c]}`).join("\n");

  return `Kamu adalah moderator konten ahli untuk komentar media sosial berbahasa Indonesia (termasuk bahasa gaul, singkatan, campuran Inggris/daerah, dan tulisan yang disamarkan).

Tugas: klasifikasikan setiap komentar ke SATU kategori paling tepat dan beri skor bahaya 0-100.

Kategori:
${list}
- "aman": komentar wajar, termasuk KRITIK yang keras atau negatif terhadap isi/karya/kebijakan, candaan antar teman tanpa merendahkan, kata kasar sebagai ekspresi (bukan ditujukan untuk menghina orang).

Prinsip penting:
- Tujuan kita mengurangi komentar yang benar-benar merugikan, BUKAN menghapus semua komentar negatif. Kritik terhadap konten ("videonya kurang informatif", "editingnya jelek", "argumennya lemah") = aman.
- Sarkasme dinilai berbahaya hanya jika menyerang pribadi/kelompok, bukan sekadar menyindir isi.
- Waspadai penyamaran: huruf Unicode hias, angka pengganti huruf (g4c0r), spasi di antara huruf, "titik com", emoji sebagai pengganti kata.
- "petunjuk" (jika ada) berasal dari aturan lokal; gunakan sebagai pertimbangan, bukan kepastian.
- Skor: 0-29 aman/ringan, 30-59 meragukan, 60-79 berbahaya, 80-100 sangat berbahaya/jelas.
- "alasan" maksimal 12 kata, bahasa Indonesia.

Format jawaban: JSON Lines. SATU baris JSON per komentar, urut sesuai input, tanpa pembungkus, tanpa markdown, tanpa teks lain:
{"i":"<id>","k":"<kategori>","s":<skor>,"a":"<alasan>"}`;
}

export function buildUserPrompt(items: AiItem[]): string {
  const payload = items.map((it) => {
    const o: Record<string, string> = { i: it.input.id, t: it.input.text.slice(0, 600) };
    if (it.hint) o.petunjuk = it.hint.slice(0, 200);
    return o;
  });
  return `Klasifikasikan komentar berikut:\n${JSON.stringify(payload)}`;
}

const ALL_CATEGORIES = new Set<string>([...MODE_CATEGORIES.judol, ...MODE_CATEGORIES.toxic, "aman"]);

function modeOf(cat: Category): Mode {
  return (MODE_CATEGORIES.judol as Category[]).includes(cat) ? "judol" : "toxic";
}

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Respons AI bukan JSON valid");
  }
}

export function parseVerdictRow(row: Record<string, unknown>, modes: Record<Mode, boolean>): Verdict | null {
  const id = String(row.i ?? row.id ?? "");
  if (!id) return null;
  let category = String(row.k ?? row.category ?? row.kategori ?? "aman").toLowerCase() as Category;
  if (!ALL_CATEGORIES.has(category)) category = "aman";
  const mode = modeOf(category);
  if (category !== "aman" && !modes[mode]) category = "aman";
  const rawScore = Number(row.s ?? row.score ?? row.skor ?? 0);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
  return {
    id,
    mode: category === "aman" ? (modes.toxic ? "toxic" : "judol") : mode,
    category,
    score: category === "aman" ? Math.min(score, 29) : score,
    reason: String(row.a ?? row.reason ?? row.alasan ?? "").slice(0, 160),
    source: "ai",
  };
}

/** Ambil semua baris objek JSON (format JSON Lines). Baris yang bukan JSON diabaikan. */
export function parseJsonLines(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const o = JSON.parse(line);
      if (o && typeof o === "object" && !Array.isArray(o)) rows.push(o);
    } catch {
      /* baris belum lengkap / bukan JSON */
    }
  }
  return rows;
}

function rowsFrom(text: string): Record<string, unknown>[] {
  const lines = parseJsonLines(text).filter((r) => "i" in r || "id" in r);
  if (lines.length) return lines;
  const data = extractJson(text) as Record<string, unknown> | unknown[];
  return (Array.isArray(data) ? data : ((data.r ?? data.results ?? data.hasil ?? [data]) as unknown[])) as Record<string, unknown>[];
}

export function parseAiResponse(text: string, ids: string[], modes: Record<Mode, boolean>): Verdict[] {
  const wanted = new Set(ids);
  const out: Verdict[] = [];
  for (const row of rowsFrom(text)) {
    const v = parseVerdictRow(row, modes);
    if (!v || !wanted.has(v.id)) continue;
    out.push(v);
    wanted.delete(v.id);
  }
  return out;
}

import type { Category, CommentInput, Mode, Verdict } from "./types";
import { MODE_CATEGORIES, MODES, modeOf } from "./types";

export interface AiItem {
  input: CommentInput;
  hint?: string;
}

/** Contoh berlabel dari pengguna yang dikirim bersama komentar sebagai acuan. */
export interface PromptExample {
  text: string;
  label: Category;
}

export interface CustomMode {
  name: string;
  definition: string;
}

const CATEGORY_DEFS: Record<Exclude<Category, "aman" | "kustom">, string> = {
  judol: "promosi judi online/slot/togel, termasuk yang disamarkan (huruf hias, nama situs merek+angka, 'cek bio', testimoni menang/WD)",
  phishing: "link/ajakan menuju situs palsu, pencurian akun/OTP, meniru bank/e-wallet/platform",
  scam: "penipuan: hadiah/giveaway palsu, investasi bodong, pinjol ilegal, minta transfer/hubungi admin WA",
  spam: "promosi berulang/tidak relevan non-judi (jualan, follow-for-follow, bot)",
  hinaan: "menghina fisik, kecerdasan, atau martabat seseorang secara langsung (kata kasar ditujukan ke orang), termasuk merendahkan karena gender, orientasi, atau disabilitas",
  perundungan: "merundung/mengeroyok, mempermalukan, menyuruh bunuh diri, body shaming berulang",
  ancaman: "ancaman kekerasan, doxing, menyebar data pribadi, intimidasi",
  sarkasme: "sindiran/ejekan terselubung yang tujuannya merendahkan orang (bukan kritik isi), mis. pujian palsu bernada mengejek",
  pelecehan: "pelecehan seksual: komentar cabul/mesum ditujukan ke seseorang, objektifikasi tubuh, ajakan seksual, ancaman atau candaan pemerkosaan",
  penistaan: "menghina, menistakan, atau mengolok-olok ajaran, kitab suci, nabi/tokoh suci, simbol, tempat, atau ibadah suatu agama",
  sara: "kebencian, hasutan, atau stereotip merendahkan terhadap KELOMPOK orang berdasarkan suku, ras, etnis, penganut agama tertentu, atau antargolongan",
};

function categoryDef(c: Exclude<Category, "aman">, custom?: CustomMode): string {
  if (c !== "kustom") return CATEGORY_DEFS[c];
  const name = custom?.name ? `(${custom.name}) ` : "";
  return `${name}kategori buatan pengguna: ${custom?.definition ?? ""}`;
}

export function buildSystemPrompt(modes: Record<Mode, boolean>, custom?: CustomMode): string {
  const cats = MODES.filter((m) => modes[m] && (m !== "kustom" || custom?.definition))
    .flatMap((m) => MODE_CATEGORIES[m]) as Exclude<Category, "aman">[];
  const list = cats.map((c) => `- "${c}": ${categoryDef(c, custom)}`).join("\n");

  return `Kamu adalah moderator konten ahli untuk komentar media sosial berbahasa Indonesia (termasuk bahasa gaul, singkatan, campuran Inggris/daerah, dan tulisan yang disamarkan).

Tugas: klasifikasikan setiap komentar ke SATU kategori paling tepat dan beri skor bahaya 0-100.

Kategori:
${list}
- "aman": komentar wajar, termasuk KRITIK yang keras atau negatif terhadap isi/karya/kebijakan, candaan antar teman tanpa merendahkan, kata kasar sebagai ekspresi (bukan ditujukan untuk menghina orang).

Prinsip penting:
- Tujuan kita mengurangi komentar yang benar-benar merugikan, BUKAN menghapus semua komentar negatif. Kritik terhadap konten ("videonya kurang informatif", "editingnya jelek", "argumennya lemah") = aman.
- Sarkasme dinilai berbahaya hanya jika menyerang pribadi/kelompok, bukan sekadar menyindir isi.
${modes.agama || modes.sara ? `- "penistaan" = yang diserang ajaran/simbol/tokoh agamanya; "sara" = yang diserang kelompok orangnya. Diskusi, pertanyaan, atau perbedaan pendapat soal agama/suku yang sopan = aman.\n` : ""}- Jika satu komentar cocok ke beberapa kategori, pilih yang paling berat dampaknya.
- Waspadai penyamaran: huruf Unicode hias, angka pengganti huruf (g4c0r), spasi di antara huruf, "titik com", emoji sebagai pengganti kata.
- "petunjuk" (jika ada) berasal dari aturan lokal; gunakan sebagai pertimbangan, bukan kepastian.
- "contoh" (jika ada) adalah komentar yang sudah dilabeli pengguna. Untuk komentar yang mirip, ikuti cara pelabelan contoh tersebut.
- Skor: 0-29 aman/ringan, 30-59 meragukan, 60-79 berbahaya, 80-100 sangat berbahaya/jelas.
- "alasan" maksimal 12 kata, bahasa Indonesia.

Format jawaban: JSON Lines. SATU baris JSON per komentar, urut sesuai input, tanpa pembungkus, tanpa markdown, tanpa teks lain:
{"i":"<id>","k":"<kategori>","s":<skor>,"a":"<alasan>"}`;
}

export function buildUserPrompt(items: AiItem[], examples: PromptExample[] = []): string {
  const payload = items.map((it) => {
    const o: Record<string, string> = { i: it.input.id, t: it.input.text.slice(0, 600) };
    if (it.hint) o.petunjuk = it.hint.slice(0, 200);
    return o;
  });
  const ref = examples.length
    ? `contoh (label dari pengguna):\n${JSON.stringify(examples.map((e) => ({ t: e.text.slice(0, 300), k: e.label })))}\n\n`
    : "";
  return `${ref}Klasifikasikan komentar berikut:\n${JSON.stringify(payload)}`;
}

const ALL_CATEGORIES = new Set<string>([...MODES.flatMap((m) => MODE_CATEGORIES[m]), "aman"]);

/** Mode untuk verdict "aman": mode AI pertama yang aktif, karena "aman" memang hanya bisa diputuskan model. */
export function safeMode(modes: Record<Mode, boolean>): Mode {
  return MODES.find((m) => m !== "judol" && modes[m]) ?? "judol";
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

export function parseVerdictRow(row: Record<string, unknown>, modes: Record<Mode, boolean>, customName = ""): Verdict | null {
  const id = String(row.i ?? row.id ?? "");
  if (!id) return null;
  let category = String(row.k ?? row.category ?? row.kategori ?? "aman").toLowerCase() as Category;
  if (!ALL_CATEGORIES.has(category)) category = "aman";
  const mode = modeOf(category);
  if (mode && !modes[mode]) category = "aman";
  const rawScore = Number(row.s ?? row.score ?? row.skor ?? 0);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
  return {
    id,
    mode: category === "aman" ? safeMode(modes) : mode!,
    category,
    score: category === "aman" ? Math.min(score, 29) : score,
    reason: String(row.a ?? row.reason ?? row.alasan ?? "").slice(0, 160),
    source: "ai",
    ...(category === "kustom" && customName ? { label: customName } : {}),
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

export function parseAiResponse(text: string, ids: string[], modes: Record<Mode, boolean>, customName = ""): Verdict[] {
  const wanted = new Set(ids);
  const out: Verdict[] = [];
  for (const row of rowsFrom(text)) {
    const v = parseVerdictRow(row, modes, customName);
    if (!v || !wanted.has(v.id)) continue;
    out.push(v);
    wanted.delete(v.id);
  }
  return out;
}

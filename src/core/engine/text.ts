import { normalize, type NormalizedText } from "../normalize";

/**
 * Bentuk teks yang dipakai mesin keputusan. Semua dihitung sekali per komentar:
 * - `spaced`: huruf hias, leetspeak, huruf berulang sudah dirapikan, tanda baca jadi satu spasi, diapit spasi.
 * - `tokens`: kata-kata dari `spaced`.
 * - `spacedLetters`: ada huruf yang sengaja dipisah spasi ("g o b l o k"), jadi `compact` ikut dicocokkan.
 */
export interface Doc {
  n: NormalizedText;
  spaced: string;
  tokens: string[];
  /** Kata dasar kandidat tiap token (token + versi tanpa akhiran), dihitung sekali. */
  stems: string[][];
  compact: string;
  spacedLetters: boolean;
  /** Teks asli (untuk emoji & huruf kapital). */
  raw: string;
}

const SPACED_LETTERS_RE = /(?:^|\s)(?:\p{L}\s){3,}\p{L}(?:\s|$)/u;

/** Singkatan chat → bentuk baku yang dipakai kamus ("yg" → "yang", "gk"/"ga"/"nggak" → "gak"). */
const SLANG: Record<string, string> = {
  yg: "yang", bgt: "banget", bngt: "banget", bget: "banget", dgn: "dengan", sm: "sama", jd: "jadi", jdi: "jadi", krn: "karena",
  karna: "karena", utk: "untuk", tp: "tapi", tpi: "tapi", sdh: "sudah", udh: "udah", blm: "belum", gk: "gak", ga: "gak", nggak: "gak",
  ngga: "gak", enggak: "gak", engga: "gak", kagak: "gak", gaak: "gak", tdk: "tidak", aj: "aja", lg: "lagi", org: "orang", orng: "orang",
  klo: "kalau", kalo: "kalau", kl: "kalau", emg: "emang", emng: "emang", bkn: "bukan", aq: "aku", kmu: "kamu", dr: "dari", jgn: "jangan",
  knp: "kenapa", trs: "terus", msh: "masih", cm: "cuma", cuman: "cuma", pgn: "pengen", pingin: "pengen", pengin: "pengen", skrg: "sekarang",
  gausah: "gak usah", gaush: "gak usah", gabisa: "gak bisa", gaada: "gak ada", gada: "gak ada", gamau: "gak mau", gatau: "gak tau",
  gaboleh: "gak boleh", gapunya: "gak punya", dmn: "dimana", gmn: "gimana", bener2: "bener bener", bnyk: "banyak", sblm: "sebelum",
};

/** "rame2" → "rame rame", "ujung2nya" → "ujung ujungnya", "malu2in" → "malu maluin" (kata ulang ditulis dengan angka 2). */
const REDUP_RE = /(?<![\p{L}\p{N}])(\p{L}{2,})2(\p{L}*)(?![\p{L}\p{N}])/gu;

export function toDoc(text: string, pre?: NormalizedText): Doc {
  const n = pre ?? normalize(text);
  const plain = n.deleet.replace(REDUP_RE, "$1 $1$2").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const tokens = plain ? plain.split(" ").flatMap((w) => (SLANG[w] ?? w).split(" ")) : [];
  const body = tokens.join(" ");
  return {
    n,
    spaced: ` ${body} `,
    tokens,
    stems: tokens.map(stems),
    compact: n.compact,
    spacedLetters: SPACED_LETTERS_RE.test(n.folded),
    raw: text,
  };
}

/** Akhiran yang sering menempel di kata gaul Indonesia: goblokNYA, bodohIN, anjingLU. */
const SUFFIXES = ["nya", "ny", "kan", "an", "in", "mu", "ku", "lah", "kah", "lu", "lo", "i"];

/** Kata dasar kandidat dari satu token: dirinya sendiri + versi tanpa akhiran (minimal 3 huruf tersisa). */
export function stems(token: string): string[] {
  const out = [token];
  for (const s of SUFFIXES) {
    if (token.length - s.length >= 3 && token.endsWith(s)) out.push(token.slice(0, -s.length));
  }
  return out;
}

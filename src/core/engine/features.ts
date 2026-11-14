import type { RuleResult } from "../judol-rules";
import type { Category } from "../types";
import * as L from "./lexicon";
import { decayedSum, MultiMatcher, type Hit, type Matcher } from "./matcher";
import type { Doc } from "./text";

/**
 * Bukti berbasis aturan untuk tiap kategori, dalam bentuk log-odds (z). Keyakinan akhir = sigmoid(z).
 * Semua kategori mulai dari BIAS (≈2%); istilah, target orang, dan konteks menggeser z naik atau turun.
 */
export const BIAS = -4;

export interface Evidence {
  z: number;
  why: string[];
}

const LEX = new MultiMatcher({
  you: L.TARGET_YOU,
  them: L.TARGET_THEM,
  body: L.BODY,
  vocative: L.VOCATIVE,
  self: L.SELF,
  address: L.ADDRESS,
  content: L.CONTENT,
  praise: L.PRAISE,
  insultStrong: L.INSULT_STRONG,
  insultMild: L.INSULT_MILD,
  bully: L.BULLY,
  threat: L.THREAT,
  mock: L.MOCK,
  mockNeg: L.MOCK_NEG,
  sexual: L.SEXUAL,
  religion: L.RELIGION,
  relInsult: L.RELIGION_INSULT,
  group: L.GROUP,
  groupNeg: L.GROUP_NEG,
  generalizer: L.GENERALIZER,
  judolSoft: L.JUDOL_SOFT,
  scam: L.SCAM,
  scamMoney: L.SCAM_MONEY,
  spam: L.SPAM,
  sexualInnocent: L.SEXUAL_INNOCENT,
});

/* ── negasi: "kamu tidak bodoh", "jangan sampai sesat" ──────────────── */

const NEG_RE_CACHE = new Map<string, RegExp>();
const NEGATORS = "(?:tidak|tdk|gak|ga|gk|nggak|ngga|enggak|engga|bukan|bkn|jangan|jgn|tak|ndak|kurang)";
const NEG_MID = "(?: (?:terlalu|begitu|sampai|sampe|se|sih|juga|pernah|lagi|bilang|nyebut|mau|perlu))?";

function negated(doc: Doc, term: string): boolean {
  let re = NEG_RE_CACHE.get(term);
  if (!re) {
    const needle = term.replace(/\*$/, "").replace(/(\p{L})\1+/gu, "$1").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(` ${NEGATORS}${NEG_MID} ${needle}`, "u");
    NEG_RE_CACHE.set(term, re);
  }
  return re.test(doc.spaced);
}

const affirmed = (doc: Doc, hits: Hit[]) => hits.filter((h) => !negated(doc, h.t));

/* ── posisi kata, untuk mengecek dua hal saling berdekatan ──────────── */

function positions(doc: Doc, hits: Hit[]): number[] {
  const out: number[] = [];
  for (const h of hits) {
    const first = h.t.split(" ")[0].replace(/(\p{L})\1+/gu, "$1");
    const prefix = first.endsWith("*");
    const w = prefix ? first.slice(0, -1) : first;
    doc.tokens.forEach((tok, i) => {
      if (prefix ? tok.startsWith(w) : doc.stems[i].includes(w)) out.push(i);
    });
  }
  return out;
}

function near(a: number[], b: number[], window: number): boolean {
  return a.some((i) => b.some((j) => Math.abs(i - j) <= window));
}

const names = (hits: Hit[], n = 3) => hits.slice(0, n).map((h) => `"${h.t}"`).join(", ");

const logit = (p: number) => Math.log(p / (1 - p));

const PHONE_RE = /(?:\+?62|\b0)8[\dx][\dx\s.-]{6,13}/i;
const MONEY_PER_DAY_RE = /\d+\s?(?:rb|ribu|k|jt|juta)\b.{0,12}\b(?:per ?hari|sehari|tiap hari|\/ ?hari|hari)\b/i;
const FIQH_RE = / (?:haram|halal|hukum|hukumnya|dalil|wudhu|wudu|fiqih|fikih|mazhab|makruh|wajib|sunah|sunnah|boleh|najis mughalazah) /u;
/** Nama situs ditulis kapital penuh (ALEXIS17, JPMANIA, 𝐇𝐎𝐊𝐈𝟗𝟗 setelah NFKC) atau mengandung akar kata judol. */
const BRAND_TOKEN_RE = /\b(?=[A-Z0-9]*[A-Z])[A-Z][A-Z0-9]{3,}\b/g;
const JUDOL_STEM_RE = /(?:slot|gacor|hoki|jp|toto|togel|maxwin|zeus|mania|bet|win|cuan|poker|sultan|4d|88|77|99|138|168|303|777)/i;
/** "cek bio", "intip aja bio aku", "kunjungi profil": ajakan ke profil tempat link judol disimpan. "lihat profil kamu" bukan: itu pola phising "cek siapa yang stalking kamu". */
const BIO_CTA_RE = / (?:cek|intip|lihat|liat|klik|mampir|kunjungi|buka|cari|tengok|meluncur) (?:\p{L}+ ){0,3}(?:bio|profil|profile|pp|beranda)(?! (?:kamu|anda|kalian|mu\b)) /u;
const WD_AMOUNT_RE = /\b(?:wd|withdraw|jp|jepe|cair)\s?\d+\s?(?:jt|juta|rb|ribu|k)\b/i;
const TESTIMONY_RE = / (?:dulu|dulunya|awalnya|tadinya|kemarin) .*(?:sekarang|skrg|eh|langsung|jadi) /u;
/** "ketik aja di google", "cari di mbah google": ajakan mencari nama situs. */
const GOOGLE_CTA_RE = / (?:ketik|cari|search|searching|cek|googling)(?: \p{L}+){0,2} (?:di )?(?:google|gugel|gogle|mbah google) /u;
/** Nama situs huruf+angka yang ditulis berspasi ("R A J A W I N 5 5") atau huruf kecil ("naga999"). */
const BRAND_NUM_RE = /(?:^|[^a-z])([a-z]{3,12}\d{2,4})(?!\d)/;
/** Kode OTP/verifikasi yang diminta dikirim: modus pencurian akun. */
const OTP_RE = / (?:otp|kode verifikasi|kode \d digit|kode sms|kode yang masuk|kode masuk|kode nyasar|kodenya) /u;
const ASK_RE = / (?:kirim|kirimin|kasih|kasih tau|sebutin|bagi|minta|tolong|share|forward|fotoin|screenshot) /u;
/** "modal 2jt jadi 18jt": janji uang berlipat. */
const MONEY_GROWTH_RE = /modal\s?\d+\s?(?:rb|ribu|k|jt|juta)?\s?(?:jadi|jd|menjadi|bisa jadi)\s?\d+/i;
/**
 * Komentar yang MEMPERINGATKAN soal judol/penipuan ("hati2, yang komen cek bio itu judol", "aku kena tipu modus
 * transfer dulu") memuat kata yang sama dengan promosinya, tapi niatnya kebalikan.
 */
const WARNING_RE = / (?:hati hati|waspada|awas penipuan|jangan diklik|jangan klik|jangan percaya|jangan tergiur|jangan mau|itu judol|itu judi|itu penipuan|itu phising|itu phishing|itu scam|itu bohong|pasti bohong|bodong|dokumenter|modus|kena tipu|ketipu|tertipu|korban penipuan|jadi korban|report aja|laporin aja|tolong report|tolong hapus|jangan sampai|semoga gak ada|jauhi|abaikan|abaikan aja|gak pernah minta|tidak pernah meminta|jangan kasih|jangan pernah|jangan dikasih|ngaku ngaku|ngaku dari) /u;

/** Huruf yang ditulis berspasi digabung lagi: "R A J A W I N 5 5" → "rajawin55". */
function spacedRuns(doc: Doc): string[] {
  if (!doc.spacedLetters) return [];
  return (doc.n.folded.match(/(?:(?<=^|\s)[\p{L}\p{N}] ){3,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu) ?? []).map((r) => r.replace(/ /g, ""));
}

/** Dipakai juga oleh mesin: peringatan tidak boleh langsung ditandai judol oleh aturan. */
export function isWarning(doc: Doc): boolean {
  return WARNING_RE.test(doc.spaced);
}

/** Kutipan: 'mati aja', "cewek gak usah sekolah", “…”. */
const QUOTE_RE = /['"“”‘’`][^'"“”‘’`]{3,}['"“”‘’`]/u;
/** Membicarakan komentar/ucapan orang lain, bukan menyerang langsung. */
const META_RE = / (?:komen|komennya|komentar|komentarnya|yang bilang|yang nyuruh|nyuruh|ada yang komen|yang ngomong|kata kata|stereotip|stereotipe|pola pikir|rasis|miris|basi|sadar gak|kasihan korbannya|jangan ditiru|gak pantes ngomong|tolong report|report aja|dilaporin) /u;

/**
 * Mengutip lalu mengecam ("miris baca komen yang nyuruh dia 'mati aja'", "yang bilang 'orang X pasti pelit'
 * itu stereotip basi"): kata-katanya sama dengan ujaran kebencian, tapi niatnya menolak.
 */
export function isCondemnation(doc: Doc): boolean {
  /* "bukan rasis ya, cuma fakta": sanggahan di awal, bukan kecaman. */
  if (/bukan (?:mau |bermaksud )?rasis/u.test(doc.spaced)) return false;
  return META_RE.test(doc.spaced) && (QUOTE_RE.test(doc.raw) || WARNING_RE.test(doc.spaced) || / (?:stereotip|stereotipe|pola pikir|rasis|miris|basi) /u.test(doc.spaced));
}

/** Pujian tulus atas keberhasilan setelah gagal ("setelah 3x gagal akhirnya lolos") bukan pujian palsu. */
const SUCCESS_RE = / (?:setelah|akhirnya|sesudah) .*(?:lolos|berhasil|lulus|sukses|menang|juara|diterima|tembus|keterima|sembuh) /u;
const MOCK_EMOJI_RE = /🙄|🤡|🗿|😂|🤣|😹|💅|👏.*👏/u;
/** Desahan yang ditulis ("ahh", "uhhh", "ahh ahh"): huruf h diulang, jadi dicek di teks asli sebelum huruf berulang dirapikan. */
const MOAN_RE = /(?:^|[^\p{L}])(?:a+h{2,}|u+h{2,}|a+h+n+|e+h{2,}m+)(?:[^\p{L}]|$)/iu;

export interface Context {
  /** Kategori yang sedang aktif (mode yang dinyalakan pengguna). */
  active: Set<Category>;
  rules: RuleResult;
  custom: Matcher | null;
}

export function ruleEvidence(doc: Doc, ctx: Context): Map<Category, Evidence> {
  const out = new Map<Category, Evidence>();
  const H = LEX.find(doc);
  const want = (c: Category) => ctx.active.has(c);
  const put = (c: Category, z: number, why: string[]) => out.set(c, { z, why });

  /* target orang */
  const you = H.you;
  const them = H.them;
  const body = H.body;
  const vocative = H.vocative;
  const address = H.address;
  /* Tubuh/otak yang disebut bersama "aku/gw" milik penulisnya sendiri ("otak gw lemot"), bukan sasaran. */
  const other = you.length + them.length + vocative.length > 0;
  const personal = other || (body.length > 0 && !H.self.length);
  const target = you.length ? 1 : them.length || body.length || vocative.length ? 0.8 : address.length ? 0.5 : 0;
  const targetName = (you[0] ?? them[0] ?? body[0] ?? vocative[0] ?? address[0])?.t;
  const content = H.content.length > 0;
  /* "aku goblok banget": kata kasar ke diri sendiri. */
  const selfOnly = H.self.length > 0 && !other;
  /* "sok pintar" bukan pujian: "pintar" di situ bagian dari makian, bukan pujian yang dibatalkan. */
  const praise = /sok (?:pintar|pinter)/.test(doc.spaced) ? H.praise.filter((h) => h.t !== "pintar" && h.t !== "pinter") : H.praise;

  /* ── Ujaran kebencian ── */
  if (want("hinaan") || want("perundungan") || want("sarkasme")) {
    const strong = affirmed(doc, H.insultStrong);
    const mild = affirmed(doc, H.insultMild);
    const compare = L.COMPARE_RE.exec(doc.spaced);

    if (want("hinaan")) {
      const why: string[] = [];
      /* Makian kuat tanpa sasaran yang disebut biasanya tetap ditujukan ke orang di video/thread; kecuali ke diri sendiri atau ke konten. */
      const strongFactor = personal ? 1 : selfOnly ? 0.6 : content ? 0.5 : 0.9;
      let s = decayedSum(strong) * strongFactor + decayedSum(mild) * (personal ? 1 : selfOnly || content ? 0.2 : 0.45);
      /* "kayak aspal" ke orang = hinaan; ke kopi/benda biasa saja, jadi tanpa sasaran orang bobotnya lebih kecil. */
      if (compare) s += personal ? 2.6 : content ? 0.8 : 1.6;
      /* "kulitnya kayak aspal", "ini orang apa kecap? item amat": body shaming warna kulit (harus menyasar orang/kulit). */
      const skinMatch = L.SKIN_RE.exec(doc.spaced);
      const skin = Boolean(skinMatch && (personal || /kulit/.test(skinMatch[0])));
      if (skin) s += 2;
      const any = strong.length + mild.length > 0 || compare || skin;
      if (any && personal) s += 1;
      if (any && vocative.length) s += 1;
      if (any && body.length && you.length) s += 0.6;
      /* "suara kamu jelek", "muka gendut": hinaan langsung menempel ke fisik/diri seseorang. */
      const onBody = (strong.length || mild.length) && body.length > 0 && near(positions(doc, body), positions(doc, [...strong, ...mild]), 3);
      if (onBody) s += 1.2;
      /* Pujian meredam: "kamu kayak selai coklat, manis banget 🥰" (sayang), "makhluk apa ini, imut banget" (video hewan). */
      if (praise.length && !strong.length && !compare) s -= 1;
      else if (praise.length && !mild.length && (!personal || (compare && !strong.length))) s -= 2;
      if (strong.length || mild.length) why.push(`kata hinaan ${names([...strong, ...mild])}`);
      if (onBody) why.push("menyerang fisik/diri");
      if (skin) why.push("menghina warna kulit");
      if (compare) why.push(personal ? `menyamakan orang dengan "${compare[0].trim()}"` : `perbandingan merendahkan "${compare[0].trim()}"`);
      if (any && targetName && personal) why.push(`ditujukan ke orang ("${targetName}")`);
      if (any && content && !personal) why.push("menyasar konten, bukan orang");
      put("hinaan", BIAS + s, why);
    }

    if (want("perundungan")) {
      const b = affirmed(doc, H.bully);
      /* "k i l l y o u r s e l f" ditulis berspasi: kamus tidak bisa mencocokkan huruf satu-satu, jadi dicek dari teks yang digabung. */
      if (doc.spacedLetters && doc.compact.includes("killyourself")) b.push({ t: "kill yourself", w: 4.2 });
      let s = decayedSum(b);
      if (b.length) s += target * 0.8 + (strong.length || mild.length ? 0.5 : 0);
      put("perundungan", BIAS + s, b.length ? [`ajakan/ucapan merundung ${names(b)}`] : []);
    }

    if (want("sarkasme")) {
      const mock = H.mock;
      let emo = 0;
      for (const [re, w] of L.MOCK_EMOJI) if (re.test(doc.raw)) emo += w;
      /* Pujian yang dibatalkan: "keren ya, fals aja pede" (pujian + kegagalan) atau "cakep kok, kalau…" + tawa. */
      const fail = praise.length ? H.mockNeg : [];
      const sincereSuccess = SUCCESS_RE.test(doc.spaced) && !MOCK_EMOJI_RE.test(doc.raw) && !mock.some((h) => h.w >= 2);
      const incongruent = praise.length > 0 && (fail.length > 0 || strong.length > 0) && !sincereSuccess;
      /* "Selamat ya bang, setelah 3x gagal akhirnya lolos" itu pujian tulus, bukan pujian bersyarat yang mengejek. */
      const conditional = praise.length > 0 && (emo > 0 || fail.length > 0) && !sincereSuccess && L.CONDITIONAL_PRAISE_RE.test(doc.spaced);
      const contrast = incongruent && L.CONTRAST_RE.test(doc.spaced);
      const strongCue = mock.some((h) => h.w >= 2) || incongruent || conditional;
      const cues = mock.length + (emo > 0 ? 1 : 0) + (incongruent ? 1 : 0) + (conditional ? 1 : 0);
      let s = decayedSum(mock) + emo + (praise.length && cues ? 1 : 0) + (incongruent ? 2 : 0) + (conditional ? 2 : 0) + (contrast ? 1.5 : 0);
      if (cues && (personal || address.length)) s += target * 0.8;
      if (cues >= 2) s += 0.8;
      /* Tanpa penanda ejekan yang jelas, pujian + tawa biasa ("lucu banget 😂") tidak boleh dianggap sarkasme. */
      if (!strongCue && !(praise.length && emo >= 1.4)) s = Math.min(s, 1.5);
      /* Sarkasme = pujian palsu. Tanpa pujian (atau emoji ejekan) yang tersisa hanya sindiran biasa: biar kategori lain yang menilai. */
      if (!praise.length && emo < 1.4) s = Math.min(s, 1.5);
      const why: string[] = [];
      if (incongruent) why.push(`pujian ${names(praise, 1)} dipasangkan dengan ${names(fail.length ? fail : strong, 2)}`);
      if (conditional) why.push("pujian bersyarat yang mengejek");
      if (mock.length || (emo && !why.length)) why.push(`penanda ejekan ${names(mock) || "(emoji)"}`);
      put("sarkasme", BIAS + s, why);
    }
  }

  if (want("ancaman")) {
    const th = affirmed(doc, H.threat);
    let s = decayedSum(th);
    if (th.length) s += target;
    if (th.length && PHONE_RE.test(doc.n.folded)) s += 1;
    const why = th.length ? [`kalimat ancaman ${names(th)}`] : [];
    if (th.length && target) why.push(`ditujukan ke orang ("${targetName}")`);
    put("ancaman", BIAS + s, why);
  }

  /* ── Pelecehan seksual ── */
  if (want("pelecehan")) {
    const sx = affirmed(doc, H.sexual);
    /* Pola yang tidak bisa ditulis sebagai kata: desahan ("ahh", "uhh"), "keluar 3x", "durasi 3 menit" (video bocor). */
    if (MOAN_RE.test(doc.raw)) sx.push({ t: "desahan", w: 1.6 });
    if (/ keluar \d+ ?x /u.test(doc.spaced)) sx.push({ t: "keluar berkali-kali", w: 3 });
    if (/ durasi \d+ (?:menit|detik) /u.test(doc.spaced)) sx.push({ t: "durasi video", w: 1.6 });
    sx.sort((a, b) => b.w - a.w);
    const emoji = L.SEX_EMOJI_RE.test(doc.raw) ? 1.6 : 0;
    const strongSx = sx.some((h) => h.w >= 3);
    let s = decayedSum(sx) + (sx.length ? emoji : emoji / 2);
    /* "Sewa lapangan sejam berapa?", "mules, balik ke wc lagi": konteks wajar menurunkan kata yang mirip pelecehan. */
    const innocent = H.sexualInnocent.length > 0 || /😭|🥺|😢|🥲/u.test(doc.raw);
    if (sx.length && innocent) s -= sx[0].w >= 4 ? 1.5 : 2.5;
    if (sx.length && target) s += target * 0.8;
    /* Emoji ngiler 🤤 ke seseorang ("kak … 🤤🤤") tetap tanda kuat walau kata-katanya disamarkan. */
    if (emoji && target && !sx.length) s += 1;
    if (sx.length >= 2 && (strongSx || emoji)) s += 0.8;
    /* Kata tubuh/pujian biasa ("body", "mantap", "kirim foto produk") tanpa muatan seksual yang jelas bukan pelecehan. */
    if (!strongSx && !emoji) s = Math.min(s, content ? 1 : 2);
    put("pelecehan", BIAS + s, sx.length ? [`muatan seksual ${names(sx)}`] : []);
  }

  /* ── Penistaan agama ── */
  if (want("penistaan")) {
    const rel = H.religion;
    const ins = rel.length ? affirmed(doc, H.relInsult) : [];
    let s = 0;
    const why: string[] = [];
    if (rel.length && ins.length) {
      const close = near(positions(doc, rel), positions(doc, ins), 5);
      s = 1.8 + decayedSum(ins) + (close ? 0.8 : -1);
      if (L.COMPARE_RE.test(doc.spaced)) s += 1;
      if (FIQH_RE.test(doc.spaced)) s -= 2;
      if (you.length) s += 0.6;
      if (praise.length && !ins.some((h) => h.w >= 3)) s -= 1;
      why.push(`merendahkan ${names(rel, 2)} dengan ${names(ins, 2)}`);
    }
    put("penistaan", BIAS + s, why);
  }

  /* ── SARA ── */
  if (want("sara")) {
    const grp = H.group;
    const neg = grp.length ? affirmed(doc, H.groupNeg) : [];
    let s = 0;
    const why: string[] = [];
    if (grp.length && neg.length) {
      const gen = H.generalizer;
      const close = near(positions(doc, grp), positions(doc, neg), 7);
      s = 1.5 * grp[0].w + decayedSum(neg) + (gen.length ? 1 : 0) + (close ? 0.5 : -0.5);
      /* "orang X kayak monyet": menyamakan satu kelompok dengan binatang = dehumanisasi. */
      if (L.COMPARE_RE.test(doc.spaced)) s += 1.5;
      /* "Bahasa [suku X] punya tingkatan halus-kasar": bahas bahasa, bukan menyerang orangnya. */
      if (positions(doc, grp).some((i) => doc.tokens.slice(Math.max(0, i - 2), i).includes("bahasa"))) s -= 2.5;
      why.push(`stereotip/kebencian ke kelompok ${names(grp, 2)}: ${names(neg, 2)}`);
      if (gen.length) why.push(`digeneralisasi ("${gen[0].t}")`);
    }
    put("sara", BIAS + s, why);
  }

  /* ── Judol, phising, penipuan, spam ── */
  const { judolScore, judolCategory, reasons } = ctx.rules;
  const ruleZ = judolScore > 0 ? logit(Math.min(0.98, Math.max(0.02, judolScore / 100))) : BIAS;
  const warning = isWarning(doc);
  /* Peringatan ("hati2, itu judol", "aku kena tipu modus transfer dulu") menurunkan judol/phising/penipuan. */
  const WARN = warning ? 2.5 : 0;
  const soft = H.judolSoft;
  const bioCta = BIO_CTA_RE.test(doc.spaced) || (doc.spacedLetters && /(?:cek|intip|lihat|klik|situs)(?:di)?(?:bio|profil)(?!kamu|anda)/.test(doc.compact));
  const googleCta = GOOGLE_CTA_RE.test(doc.spaced);
  const wdAmount = WD_AMOUNT_RE.test(doc.n.deleet) || /(?:wd|jp)\d+(?:jt|rb|k)/.test(doc.compact);
  const judolLure = soft.length > 0 || bioCta || googleCta || wdAmount;
  if (want("judol")) {
    const brands = doc.raw.normalize("NFKC").match(BRAND_TOKEN_RE) ?? [];
    const brand = brands.find((b) => JUDOL_STEM_RE.test(b)) ?? brands[0] ?? spacedRuns(doc).find((r) => BRAND_NUM_RE.test(r)) ?? (judolLure ? BRAND_NUM_RE.exec(doc.n.folded)?.[1] : undefined);
    const brandJudol = Boolean(brand && JUDOL_STEM_RE.test(brand));
    /* "ketik di google X" baru mencurigakan kalau X berupa nama situs, bukan "cara bikin rendang". */
    const googleW = googleCta ? (brand || judolScore > 0 ? 2.8 : 0.4) : 0;
    let s = (judolCategory === "judol" ? ruleZ : BIAS) + decayedSum(soft) * 0.8 + (bioCta ? 2 : 0) + googleW + (wdAmount ? 2 : 0);
    /* Link yang dinilai aturan sebagai phising tapi isinya promosi judol ("saldo nambah, mampir ke naga999 titik xyz"). */
    if (judolCategory === "phishing" && judolLure) s = Math.max(s, ruleZ + decayedSum(soft) * 0.8 + 0.5);
    if (brandJudol) s += 2.5;
    else if (brand && judolLure) s += 1.2;
    if ((brandJudol || judolLure) && TESTIMONY_RE.test(doc.spaced)) s += 1;
    s -= WARN;
    const why = judolCategory === "judol" && judolScore > 0 ? [...reasons] : [];
    if (bioCta) why.push("mengajak buka bio/profil");
    if (googleW > 1) why.push("menyuruh mencari nama situs di Google");
    if (wdAmount) why.push("pamer WD/JP dengan nominal");
    if (soft.length) why.push(`pola promosi terselubung ${names(soft)}`);
    if (brand && (brandJudol || judolLure)) why.push(`nama situs "${brand}"`);
    put("judol", s, why);
  }
  if (want("phishing")) {
    const otp = OTP_RE.test(doc.spaced);
    /* "jangan dibagikan ke siapa pun, kecuali ke admin kami": mintanya terselubung, tapi tetap minta kode. */
    const ask = otp && !warning && (ASK_RE.test(doc.spaced) || /kecuali (?:ke )?admin/.test(doc.spaced));
    let s = judolCategory === "phishing" ? ruleZ : BIAS;
    /* Minta kode OTP dikirim/disebutkan = modus pengambilalihan akun, walau tanpa link. */
    if (ask) s = Math.max(s, BIAS) + 4.8 + (H.address.length || you.length ? 0.5 : 0);
    const why = judolCategory === "phishing" ? [...reasons] : [];
    if (ask) why.push("meminta kode OTP/verifikasi");
    put("phishing", s - WARN, why);
  }
  if (want("scam")) {
    const sc = affirmed(doc, H.scam);
    const money = H.scamMoney;
    const perDay = MONEY_PER_DAY_RE.test(doc.n.folded);
    const growth = MONEY_GROWTH_RE.test(doc.n.folded);
    /* Tanpa iming-iming, menyebut transfer/rekening saja tidak boleh jadi tuduhan penipuan. */
    let s = decayedSum([...sc, ...money].sort((a, b) => b.w - a.w));
    if (!sc.length && !perDay && !growth) s = Math.min(s, 1.5);
    if (perDay) s += 2;
    if (growth) s += 3;
    if (sc.length && PHONE_RE.test(doc.n.folded)) s += 1;
    const why = sc.length ? [`ciri penipuan ${names(sc)}`] : [];
    if (perDay) why.push("janji uang per hari");
    if (growth) why.push("janji modal berlipat");
    put("scam", BIAS + s - WARN, why);
  }
  if (want("spam")) {
    const sp = H.spam;
    /* "PROMO PROMO PROMO": kata yang sama diulang beruntun. */
    const repeated = doc.tokens.some((w, i) => w.length >= 3 && w === doc.tokens[i + 1] && w === doc.tokens[i + 2]);
    const s = decayedSum(sp) + (repeated && sp.length ? 1.5 : 0);
    const why = sp.length ? [`promosi/spam ${names(sp)}`] : [];
    if (repeated && sp.length) why.push("kata diulang-ulang");
    put("spam", BIAS + s, why);
  }

  /* ── Kustom ── */
  if (want("kustom") && ctx.custom) {
    const hits = ctx.custom.find(doc);
    put("kustom", BIAS + decayedSum(hits), hits.length ? [`cocok dengan definisi kustom ${names(hits)}`] : []);
  }

  /* Mengutip untuk mengecam: turunkan kategori serangan (judol/penipuan sudah diturunkan lewat peringatan). */
  if (isCondemnation(doc)) {
    for (const c of ["hinaan", "perundungan", "ancaman", "sarkasme", "pelecehan", "penistaan", "sara"] as Category[]) {
      const e = out.get(c);
      if (e) e.z -= 5;
    }
  }
  return out;
}

/**
 * Definisi mode kustom → kamus. Frasa pendek (dipisah koma/titik koma/baris/"atau") jadi kata kunci kuat;
 * kalimat panjang dipecah jadi kata-kata isi yang lemah (butuh beberapa yang cocok sekaligus).
 */
const STOP = new Set(
  "yang dan atau di ke dari untuk dengan pada ini itu ada akan juga sudah belum tidak bukan saja aja lagi sedang dalam oleh karena agar supaya seperti misal mis komentar orang soal tentang bahas membahas".split(" "),
);

export function customTerms(definition: string): { t: string; w: number }[] {
  const out: { t: string; w: number }[] = [];
  const text = definition.toLowerCase();
  const clean = (s: string) => s.replace(/[^\p{L}\p{N}* ]+/gu, " ").replace(/\s+/g, " ").trim();
  /* Satu kalimat panjang tanpa pemisah ("membocorkan akhir cerita film atau series") = deskripsi, bukan daftar. */
  const isList = /[,;\n/]/.test(text) || clean(text).split(" ").length <= 5;
  if (!isList) {
    for (const w of new Set(clean(text).split(" "))) if (w.length >= 4 && !STOP.has(w)) out.push({ t: w, w: 1.6 });
    return out;
  }
  for (const raw of text.split(/[,;\n/]|\batau\b/)) {
    const phrase = clean(raw);
    if (!phrase) continue;
    const words = phrase.split(" ");
    if (words.length <= 4) out.push({ t: phrase, w: 4.5 });
    else for (const w of words) if (w.length >= 4 && !STOP.has(w)) out.push({ t: w, w: 1.6 });
  }
  return out;
}

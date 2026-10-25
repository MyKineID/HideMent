const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿­]/g;

const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", с: "c", е: "e", һ: "h", і: "i", ј: "j", к: "k", м: "m", н: "h", о: "o",
  р: "p", ѕ: "s", т: "t", у: "y", х: "x", ԁ: "d", ɡ: "g", ӏ: "l",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k",
  ʟ: "l", ᴍ: "m", ɴ: "n", ᴏ: "o", ᴘ: "p", ǫ: "q", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v",
  ᴡ: "w", ʏ: "y", ᴢ: "z",
};

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
  "@": "a", $: "s", "!": "i", "|": "l", "€": "e",
};

const REGIONAL_INDICATOR_A = 0x1f1e6;

export interface NormalizedText {
  original: string;
  folded: string;
  deleet: string;
  compact: string;
  hasFancyUnicode: boolean;
}

function foldChar(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp >= REGIONAL_INDICATOR_A && cp <= REGIONAL_INDICATOR_A + 25) {
    return String.fromCharCode(97 + cp - REGIONAL_INDICATOR_A);
  }
  return CONFUSABLES[ch] ?? ch;
}

export function foldUnicode(text: string): string {
  const nfkc = text.normalize("NFKC").replace(ZERO_WIDTH, "");
  let out = "";
  for (const ch of nfkc) out += foldChar(ch);
  return out
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

export function squeezeRepeats(text: string): string {
  return text.replace(/(\p{L})\1+/gu, "$1");
}

export function deleet(text: string): string {
  return text.replace(/(?<=\p{L})[0134578@$!|€9]|[0134578@$!|€9](?=\p{L})/gu, (c) => LEET[c] ?? c);
}

export function hasFancyUnicode(text: string): boolean {
  return /[\u{1D400}-\u{1D7FF}\u{1F130}-\u{1F189}\u{1F1E6}-\u{1F1FF}Ⓐ-ⓩＡ-ｚᴀ-ᴢꜰ-ꟿ]/u.test(
    text,
  );
}

export function normalize(text: string): NormalizedText {
  const folded = foldUnicode(text).replace(/\s+/g, " ").trim();
  const dl = squeezeRepeats(deleet(folded));
  return {
    original: text,
    folded,
    deleet: dl,
    compact: dl.replace(/[^\p{L}\p{N}]+/gu, ""),
    hasFancyUnicode: hasFancyUnicode(text),
  };
}

export function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

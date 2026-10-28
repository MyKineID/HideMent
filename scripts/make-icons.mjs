/**
 * Ikon HideMent (16/32/48/128 px) → static/assets/icon-*.png.
 * Geometri sama dengan logoMark() di src/shared/icons.ts: gelembung komentar lembut berwarna biru Tempest,
 * mata di tengah, dan garis miring "hide". Dirender dengan supersampling, tanpa dependensi selain Node.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZES = [16, 32, 48, 128];
const VIEW = 32;
const DARK = [15, 16, 18];
const FILL = [108, 180, 238];

const ellipse = Array.from({ length: 160 }, (_, i) => {
  const a = (i / 160) * Math.PI * 2;
  return [16 + 12.5 * Math.cos(a), 14.1 + 10.6 * Math.sin(a)];
});
const tail = [[9.2, 20.6], [6.4, 27.6], [13.6, 24.1]];

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inAlmond(x, y, halfW, halfH) {
  const u = (x - 16) / halfW;
  return Math.abs(u) <= 1 && Math.abs(y - 14.1) <= halfH * (1 - u * u);
}

function nearSegment(x, y, [ax, ay], [bx, by], r) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= r;
}

/** Warna satu titik dalam koordinat viewBox 32×32, atau null kalau transparan. */
function sample(x, y, size) {
  if (!inPolygon(x, y, ellipse) && !inPolygon(x, y, tail)) return null;
  const small = size <= 16;
  const slashR = small ? 1.9 : 1.1;
  if (nearSegment(x, y, [10.6, 19.2], [21.4, 9.0], slashR)) return DARK;
  if (!small) {
    const w = size <= 32 ? 1.25 : 0.95;
    if (inAlmond(x, y, 6.5 + w, 3.6 + w) && !inAlmond(x, y, 6.5 - w * 0.6, 3.6 - w)) return DARK;
  }
  return FILL;
}

function render(size) {
  const ss = size <= 32 ? 8 : 5;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((pxl + (sx + 0.5) / ss) / size) * VIEW, ((py + (sy + 0.5) / ss) / size) * VIEW, size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = (py * size + pxl) * 4;
      if (a) {
        px[o] = Math.round(r / a);
        px[o + 1] = Math.round(g / a);
        px[o + 2] = Math.round(b / a);
        px[o + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const png = render(size);
  writeFileSync(`static/assets/icon-${size}.png`, png);
  console.log(`✓ static/assets/icon-${size}.png (${png.length} B)`);
}

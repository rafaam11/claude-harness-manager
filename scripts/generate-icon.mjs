// Generates build/icon.ico (multi-size) and build/icon.png (512) from code, with
// zero image dependencies — only Node's built-in zlib. The artwork is a terminal
// prompt motif (chevron ">" + cursor underscore) drawn via signed-distance fields
// for clean anti-aliasing at every size — fitting a CLI-harness manager.
// Run: `npm run icon`.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "build");
mkdirSync(outDir, { recursive: true });

// --- palette: Claude charcoal background with a clay-orange prompt mark ---
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG_TOP = hex("#2b2a28");
const BG_BOT = hex("#1a1a19");
const MOTIF = hex("#d97757");

// --- signed-distance helpers (pixel space; interior is negative) ---
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function distSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const denom = bax * bax + bay * bay || 1;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / denom));
  return Math.hypot(pax - bax * h, pay - bay * h);
}
// 1px anti-aliased coverage from a signed distance
const cov = (d) => Math.min(1, Math.max(0, 0.5 - d));
const lerp = (a, b, t) => a + (b - a) * t;

function render(S) {
  const buf = Buffer.alloc(S * S * 4);

  // background rounded square
  const margin = S * 0.055;
  const half = S / 2 - margin;
  const rr = S * 0.225;

  // motif mapped from a 24-unit viewBox into a centred box
  const L = S * 0.5;
  const ox = (S - L) / 2;
  const oy = (S - L) / 2;
  const sc = L / 24;
  const M = (x, y) => [ox + x * sc, oy + y * sc];
  const lineW = 2.7 * sc;

  // chevron ">" (two strokes meeting at the apex) + cursor underscore
  const [c1x, c1y] = M(7.5, 6.5);
  const [c2x, c2y] = M(13.5, 12);
  const [c3x, c3y] = M(7.5, 17.5);
  const [u1x, u1y] = M(13.5, 17.5);
  const [u2x, u2y] = M(18.5, 17.5);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      const bgCov = cov(sdRoundRect(px, py, S / 2, S / 2, half, half, rr));
      const i = (y * S + x) * 4;
      if (bgCov <= 0) continue; // transparent outside the rounded square

      // vertical gradient background
      const t = py / S;
      const r = lerp(BG_TOP[0], BG_BOT[0], t);
      const g = lerp(BG_TOP[1], BG_BOT[1], t);
      const b = lerp(BG_TOP[2], BG_BOT[2], t);

      // prompt motif (union of chevron strokes + underscore)
      let m = cov(distSegment(px, py, c1x, c1y, c2x, c2y) - lineW / 2);
      m = Math.max(m, cov(distSegment(px, py, c2x, c2y, c3x, c3y) - lineW / 2));
      m = Math.max(m, cov(distSegment(px, py, u1x, u1y, u2x, u2y) - lineW / 2));
      m *= bgCov; // keep the motif inside the rounded square

      buf[i] = Math.round(lerp(r, MOTIF[0], m));
      buf[i + 1] = Math.round(lerp(g, MOTIF[1], m));
      buf[i + 2] = Math.round(lerp(b, MOTIF[2], m));
      buf[i + 3] = Math.round(bgCov * 255);
    }
  }
  return buf;
}

// --- minimal PNG (RGBA, no filtering) ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(S, rgba) {
  const stride = S * 4;
  const raw = Buffer.alloc((stride + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// --- ICO container holding PNG-encoded images (Vista+) ---
function encodeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, i) => {
    const e = 16 * i;
    dir[e] = img.size >= 256 ? 0 : img.size;
    dir[e + 1] = img.size >= 256 ? 0 : img.size;
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(img.png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const icoSizes = [256, 128, 64, 48, 32, 16];
const images = icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) }));
writeFileSync(resolve(outDir, "icon.ico"), encodeIco(images));
writeFileSync(resolve(outDir, "icon.png"), encodePng(512, render(512)));

console.log("wrote build/icon.ico (" + icoSizes.join(",") + ") and build/icon.png (512)");

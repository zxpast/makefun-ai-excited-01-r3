// The Whale Came for the Moon.
//
// A humpback whale the size of a mountain breaches out of a night sea,
// diagonally, straight at a huge golden moon — with one tiny sailboat
// below to give the scale away. The whale's dark back catches a gold rim
// of moonlight; its pale belly glows against the dark water. Spray bursts
// where the tail leaves the sea, and the moon's reflection shimmers down
// to the little boat. One diagonal of motion, one bright focal point,
// one joke of scale.
//
// The whole scene is drawn in code by a small software renderer: an RGB
// framebuffer, a scanline polygon filler, antialiased discs, soft radial
// glows, a cubic-bezier whale spine with a width profile, and a 5x7
// bitmap font for the caption. A hand-rolled PNG writer (filter-0
// scanlines, zlib deflate level 9, CRC32) writes the finished image.
//
// Fully deterministic: one fixed-seed generator, no clock, no
// Math.random, no network, no image assets. The same bytes every run.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// The picture lives here: three bytes per pixel, row by row.
const px = new Uint8Array(W * H * 3);

// ---- fixed-seed generator (mulberry32) ----
// One seed drives every random-looking decision (stars, spray, shimmer),
// so the picture is identical on every run and every machine.
let seed = 0x9e3779b9;
function nextRand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function between(lo: number, hi: number): number {
  return lo + (hi - lo) * nextRand();
}

// ---- small numeric helpers ----
type RGB = [number, number, number];
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function blendColor(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- drawing primitives ----
// Blend one pixel toward a colour.
function plot(x: number, y: number, c: RGB, alpha: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 3;
  const a = clampNum(alpha, 0, 1);
  px[i] = Math.round(px[i] * (1 - a) + c[0] * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + c[1] * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + c[2] * a);
}
// Fill a rectangle solid.
function box(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
      const i = (y * W + x) * 3;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
  }
}
// A filled disc with a soft half-pixel edge.
function softDisc(cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  if (r <= 0) return;
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      const cov = clampNum(r + 0.5 - d, 0, 1);
      if (cov > 0) plot(x, y, c, alpha * cov);
    }
  }
}
// A radial glow whose strength falls off quadratically to radius R.
function halo(cx: number, cy: number, R: number, c: RGB, strength: number): void {
  const x0 = Math.max(0, Math.floor(cx - R));
  const x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R));
  const y1 = Math.min(H - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / R;
      if (d >= 1) continue;
      const a = strength * (1 - d) * (1 - d);
      plot(x, y, c, a);
    }
  }
}
// Fill a polygon by scanning each row for edge crossings.
function fillPoly(pts: Array<[number, number]>, c: RGB, alpha: number): void {
  let minY = H;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, Math.floor(p[1]));
    maxY = Math.max(maxY, Math.ceil(p[1]));
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) {
        plot(x, y, c, alpha);
      }
    }
  }
}
// A thick line drawn as a chain of discs.
function stroke(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB, alpha: number): void {
  const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  const steps = Math.max(1, Math.ceil(len / Math.max(1, r)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    softDisc(lerp(x0, x1, t), lerp(y0, y1, t), r, c, alpha);
  }
}

// ---- palette ----
const PAL: { [k: string]: RGB } = {
  skyTop: [8, 14, 46],
  skyHorizon: [22, 30, 70],
  seaTop: [10, 28, 58],
  seaDeep: [5, 15, 34],
  moonGold: [247, 201, 72],
  moonPale: [255, 233, 168],
  moonDeep: [232, 184, 74],
  whale: [34, 56, 110],
  whaleDark: [24, 40, 84],
  belly: [220, 230, 242],
  rim: [255, 201, 77],
  white: [255, 255, 255],
  spray: [235, 244, 255],
};

// ---- the sky, then the sea ----
for (let y = 0; y < H; y++) {
  let c: RGB;
  if (y < 648) {
    c = blendColor(PAL.skyTop, PAL.skyHorizon, y / 648);
  } else {
    c = blendColor(PAL.seaTop, PAL.seaDeep, (y - 648) / (H - 648));
  }
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  }
}
// A faint shimmer where sky meets water.
for (let x = 0; x < W; x++) {
  plot(x, 648, [70, 95, 140], 0.35);
  plot(x, 649, [50, 75, 120], 0.3);
}

// ---- the moon and the stars around it ----
const moon = { x: 775, y: 215, r: 148 };
for (let i = 0; i < 260; i++) {
  const sx = between(0, W);
  const sy = between(0, 600);
  const dm = Math.sqrt((sx - moon.x) * (sx - moon.x) + (sy - moon.y) * (sy - moon.y));
  if (dm < moon.r + 28) continue; // keep the sky clear right around the moon
  const bright = between(0.35, 1);
  const big = nextRand() < 0.12;
  softDisc(sx, sy, big ? 1.8 : 1.1, [255, 250, 230], bright);
  if (nextRand() < 0.08) {
    // A tiny cross sparkle on a few of them.
    plot(sx + 3, sy, PAL.white, bright * 0.6);
    plot(sx - 3, sy, PAL.white, bright * 0.6);
    plot(sx, sy + 3, PAL.white, bright * 0.6);
    plot(sx, sy - 3, PAL.white, bright * 0.6);
  }
}

// Moon: wide halo, pale disc, warm shading, craters, and a bright rim
// on the lower-left edge, the side facing the whale.
halo(moon.x, moon.y, 330, PAL.moonGold, 0.34);
halo(moon.x, moon.y, 215, PAL.moonPale, 0.5);
softDisc(moon.x, moon.y, moon.r, PAL.moonGold, 1);
softDisc(moon.x - 14, moon.y - 16, moon.r - 16, PAL.moonPale, 0.85);
softDisc(moon.x + 34, moon.y + 42, moon.r - 52, PAL.moonGold, 0.35);
const craters: Array<[number, number, number]> = [
  [725, 170, 17], [800, 150, 12], [835, 235, 20], [745, 265, 13],
  [795, 285, 9], [860, 180, 10], [700, 225, 8],
];
for (const [cx, cy, cr] of craters) softDisc(cx, cy, cr, PAL.moonDeep, 0.5);
for (let a = Math.PI * 0.55; a <= Math.PI * 1.05; a += 0.02) {
  softDisc(moon.x + Math.cos(a) * (moon.r - 2), moon.y + Math.sin(a) * (moon.r - 2), 3, PAL.moonPale, 0.9);
}

// ---- the moon's reflection: a shimmering gold column on the water ----
halo(775, 820, 190, PAL.moonGold, 0.16);
for (let i = 0; i < 150; i++) {
  const ry = between(660, 1000);
  const depth = (ry - 660) / 340; // 0 at the horizon, 1 at the bottom
  const halfW = lerp(28, 95, depth) * between(0.5, 1.3);
  const cx = 775 + between(-halfW, halfW);
  const len = between(8, 46) * (0.6 + depth);
  const a = lerp(0.9, 0.28, depth) * between(0.5, 1);
  stroke(cx - len / 2, ry, cx + len / 2, ry, between(1.2, 2.6), PAL.moonGold, a);
}
// A few dark strokes so the sea is not a flat gradient.
for (let i = 0; i < 60; i++) {
  const ry = between(670, 990);
  const cx = between(0, W);
  const len = between(20, 80);
  stroke(cx, ry, cx + len, ry, 1.4, [4, 12, 28], between(0.2, 0.45));
}

// ---- the whale: a cubic-bezier spine with a width profile ----
// The spine runs from the tail, bottom-left, to the head, top-right,
// the head overlapping the moon's lower edge.
const S0: [number, number] = [95, 905];
const S1: [number, number] = [215, 755];
const S2: [number, number] = [440, 555];
const S3: [number, number] = [705, 330];
function spinePoint(t: number): [number, number] {
  const u = 1 - t;
  const x = u * u * u * S0[0] + 3 * u * u * t * S1[0] + 3 * u * t * t * S2[0] + t * t * t * S3[0];
  const y = u * u * u * S0[1] + 3 * u * u * t * S1[1] + 3 * u * t * t * S2[1] + t * t * t * S3[1];
  return [x, y];
}
function spineDir(t: number): [number, number] {
  const u = 1 - t;
  const x = 3 * u * u * (S1[0] - S0[0]) + 6 * u * t * (S2[0] - S1[0]) + 3 * t * t * (S3[0] - S2[0]);
  const y = 3 * u * u * (S1[1] - S0[1]) + 6 * u * t * (S2[1] - S1[1]) + 3 * t * t * (S3[1] - S2[1]);
  const len = Math.sqrt(x * x + y * y) || 1;
  return [x / len, y / len];
}
// Width knots: how wide the body is at each point along the spine.
const BODY_WIDTH: Array<[number, number]> = [
  [0, 16], [0.12, 52], [0.3, 108], [0.5, 146], [0.68, 138], [0.85, 116], [1, 82],
];
function bodyWidth(t: number): number {
  for (let i = 0; i + 1 < BODY_WIDTH.length; i++) {
    const a = BODY_WIDTH[i];
    const b = BODY_WIDTH[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      const s = f * f * (3 - 2 * f); // smoothstep between knots
      return lerp(a[1], b[1], s);
    }
  }
  return BODY_WIDTH[BODY_WIDTH.length - 1][1];
}
// Tail flukes first, behind the body: two lobes fanning from the tail tip.
fillPoly([[108, 888], [58, 832], [16, 806], [72, 884]], PAL.whaleDark, 1);
fillPoly([[108, 892], [62, 948], [24, 966], [80, 908]], PAL.whaleDark, 1);
softDisc(16, 806, 7, PAL.whaleDark, 1);
softDisc(24, 966, 7, PAL.whaleDark, 1);
// Body: overlapping discs along the spine, dark indigo back.
for (let t = 0; t <= 1.0001; t += 0.002) {
  const [x, y] = spinePoint(t);
  softDisc(x, y, bodyWidth(t) / 2, PAL.whale, 1);
}
// Darker shading along the spine centre, for depth on the back.
for (let t = 0.05; t <= 0.98; t += 0.004) {
  const [x, y] = spinePoint(t);
  const [tx, ty] = spineDir(t);
  const nx = -ty;
  const ny = tx;
  softDisc(x - nx * bodyWidth(t) * 0.18, y - ny * bodyWidth(t) * 0.18, bodyWidth(t) * 0.22, PAL.whaleDark, 0.55);
}
// Pale belly: discs offset toward the south-east normal, the belly side.
for (let t = 0.06; t <= 0.99; t += 0.003) {
  const [x, y] = spinePoint(t);
  const [tx, ty] = spineDir(t);
  const nx = -ty;
  const ny = tx;
  const w = bodyWidth(t);
  softDisc(x + nx * w * 0.32, y + ny * w * 0.32, w * 0.30, PAL.belly, 0.96);
}
// Gold rim of moonlight along the moon-facing (north-west) edge.
for (let t = 0.02; t <= 1.0; t += 0.002) {
  const [x, y] = spinePoint(t);
  const [tx, ty] = spineDir(t);
  const nx = -ty;
  const ny = tx;
  const w = bodyWidth(t);
  softDisc(x - nx * w * 0.47, y - ny * w * 0.47, 3.2, PAL.rim, 0.95);
}
// A pectoral fin sweeping down from the mid-body.
{
  const [bx, by] = spinePoint(0.58);
  const [tx, ty] = spineDir(0.58);
  const nx = -ty;
  const ny = tx;
  const w = bodyWidth(0.58);
  const baseX = bx + nx * w * 0.30;
  const baseY = by + ny * w * 0.30;
  fillPoly(
    [[baseX - tx * 34, baseY - ty * 34], [baseX + tx * 30, baseY + ty * 30],
     [baseX + tx * 78 + nx * 92, baseY + ty * 78 + ny * 92],
     [baseX + tx * 30 + nx * 108, baseY + ty * 30 + ny * 108]],
    PAL.whaleDark, 1,
  );
  softDisc(baseX + tx * 78 + nx * 92, baseY + ty * 78 + ny * 92, 6, PAL.whaleDark, 1);
}
// Head: the body discs already round it off. Add a pale jaw patch so the
// head reads against the moon, and keep the gold rim crossing in front.
{
  const [hx, hy] = spinePoint(0.985);
  softDisc(hx + 14, hy + 22, 26, PAL.belly, 0.9);
  softDisc(hx, hy, 10, PAL.whale, 0.9);
}

// ---- spray where the tail leaves the water ----
for (let i = 0; i < 110; i++) {
  const a = between(-Math.PI * 0.95, -Math.PI * 0.05);
  const r = between(6, 150) * (nextRand() < 0.5 ? 1 : 0.55);
  const sx = 100 + Math.cos(a) * r * 1.15;
  const sy = 892 + Math.sin(a) * r * 0.75;
  softDisc(sx, sy, between(1.5, 5.5), PAL.spray, between(0.5, 0.95));
}
// A few arcing spray streaks.
for (let i = 0; i < 14; i++) {
  const a0 = between(Math.PI * 1.05, Math.PI * 1.55);
  const r0 = between(40, 120);
  const x0 = 100 + Math.cos(a0) * r0;
  const y0 = 892 + Math.sin(a0) * r0 * 0.7;
  stroke(x0, y0, x0 + between(-30, 30), y0 - between(14, 42), 2.2, PAL.spray, 0.8);
}
// A white splash ring on the water around the tail.
for (let a = 0; a < Math.PI * 2; a += 0.05) {
  const ex = 105 + Math.cos(a) * 118;
  const ey = 898 + Math.sin(a) * 20;
  if (ey > 660) softDisc(ex, ey, 2.6, PAL.white, 0.75);
}

// ---- a tiny sailboat, bottom-right: the scale joke ----
{
  const bx = 845;
  const by = 818; // waterline
  // Mast and sails.
  stroke(bx, by, bx, 758, 2.2, [20, 26, 44], 1);
  fillPoly([[bx + 3, 762], [bx + 3, 812], [bx + 52, 812]], [242, 245, 250], 1);
  fillPoly([[bx - 3, 776], [bx - 3, 812], [bx - 30, 812]], [201, 214, 232], 1);
  softDisc(bx, 756, 3.5, PAL.moonGold, 1);
  // Hull.
  fillPoly([[bx - 46, by], [bx + 48, by], [bx + 34, by + 22], [bx - 32, by + 22]], [14, 21, 38], 1);
  stroke(bx - 46, by, bx + 48, by, 1.6, PAL.rim, 0.9);
  // A little reflection under the hull.
  stroke(bx - 30, by + 30, bx + 28, by + 30, 1.6, [120, 140, 175], 0.5);
  stroke(bx - 18, by + 40, bx + 16, by + 40, 1.4, [120, 140, 175], 0.35);
}

// ---- the caption: a hand-made 5x7 font, drawn at 3x scale ----
// Each glyph is 7 rows of 5 bits, stored as numbers, top row first.
// Bit 4 is the leftmost column, bit 0 the rightmost.
const GLYPHS: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  "A": [14, 17, 17, 31, 17, 17, 17],
  "C": [15, 16, 16, 16, 16, 16, 15],
  "D": [30, 17, 17, 17, 17, 17, 30],
  "E": [31, 16, 16, 30, 16, 16, 31],
  "F": [31, 16, 16, 30, 16, 16, 16],
  "G": [15, 16, 16, 23, 17, 17, 14],
  "H": [17, 17, 17, 31, 17, 17, 17],
  "J": [7, 2, 2, 2, 2, 18, 12],
  "M": [17, 27, 21, 21, 17, 17, 17],
  "N": [17, 25, 21, 19, 17, 17, 17],
  "O": [14, 17, 17, 17, 17, 17, 14],
  "R": [30, 17, 17, 30, 20, 18, 17],
  "T": [31, 4, 4, 4, 4, 4, 4],
  "U": [17, 17, 17, 17, 17, 17, 14],
  "Y": [17, 17, 10, 4, 4, 4, 4],
};
function drawText(text: string, x0: number, y0: number, scale: number, c: RGB): void {
  let cx = x0;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if ((g[row] >> (4 - col)) & 1) {
          box(cx + col * scale, y0 + row * scale, cx + (col + 1) * scale, y0 + (row + 1) * scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}
const CAPTION = "HEY JUDGE - HE CAME FOR THE MOON.";
drawText(CAPTION, 34, 38, 3, [10, 16, 40]);
drawText(CAPTION, 32, 36, 3, PAL.moonPale);

// ---- PNG writer: filter-0 scanlines, zlib level 9, CRC32 ----
const CRC32_TABLE: Uint32Array = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC32_TABLE[n] = c >>> 0;
}
function crc32Of(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Of(td), 0);
  return Buffer.concat([len, td, crc]);
}
function buildPng(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outDir + "/entry.png", buildPng());

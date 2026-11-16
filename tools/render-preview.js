// Render presets to PNG files for visual verification (no browser needed).
// Usage: node tools/render-preview.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const P = require("../js/params.js");
const R = require("../js/render.js");

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(img) {
  const { width, height, data } = img;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(data.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function save(img, file) {
  fs.writeFileSync(file, encodePng(img));
  console.log("wrote", file, `${img.width}x${img.height}`);
}

const outDir = path.join(__dirname, "..", "artifacts");
fs.mkdirSync(outDir, { recursive: true });

const empty = R.buildBrushFields([], R.BRUSH_FIELD_SIZE);

// Default & extreme presets at 512.
save(R.renderTile(P.PRESETS.default, empty, P.DEFAULT_LAYERS, 512, 512), path.join(outDir, "preset-default-512.png"));
save(R.renderTile(P.PRESETS.extreme, empty, P.DEFAULT_LAYERS, 512, 512), path.join(outDir, "preset-extreme-512.png"));

// 2x2 tiling check: render one 256 tile, stamp it 4 times.
const tile = R.renderTile(P.PRESETS.default, empty, P.DEFAULT_LAYERS, 256, 256);
const grid = { width: 512, height: 512, data: new Uint8ClampedArray(512 * 512 * 4) };
for (let y = 0; y < 512; y++) {
  for (let x = 0; x < 512; x++) {
    const si = ((y % 256) * 256 + (x % 256)) * 4;
    const di = (y * 512 + x) * 4;
    for (let k = 0; k < 4; k++) grid.data[di + k] = tile.data[si + k];
  }
}
save(grid, path.join(outDir, "tiling-check-2x2.png"));

// Brush wrap check: a pit stroke along the left edge must mirror to the right.
const dabs = [];
for (let i = 0; i < 10; i++) {
  dabs.push({ u: 0.02, v: 0.3 + i * 0.04, r: 0.06, s: 1, mode: "pit" });
}
const fields = R.buildBrushFields(dabs, R.BRUSH_FIELD_SIZE);
save(R.renderTile({ ...P.DEFAULTS, wetness: 0.1 }, fields, P.DEFAULT_LAYERS, 512, 512), path.join(outDir, "brush-wrap-check.png"));

'use strict';

/**
 * Generates the PWA icon files (192, 512, apple-touch-icon 180, favicon 32)
 * as flat, dependency-free PNGs — a tiny nonogram-grid glyph on a solid
 * background. No image libraries required; this hand-writes valid PNG
 * bytes (IHDR/IDAT/IEND chunks) using only Node's built-in zlib for the
 * DEFLATE step.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, getPixel) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Brand colors
const BG = [79, 70, 229, 255]; // indigo-600
const CELL_LIGHT = [199, 210, 254, 255]; // indigo-200
const CELL_DARK = [30, 27, 75, 255]; // indigo-950

// A little 5x5 nonogram-glyph pattern (1 = dark filled cell, 0 = light cell)
const GLYPH = [
  [0, 1, 1, 0, 0],
  [0, 1, 0, 0, 1],
  [1, 1, 0, 1, 1],
  [0, 0, 1, 1, 0],
  [1, 0, 0, 1, 0],
];

function makeIcon(size) {
  const margin = Math.round(size * 0.12);
  const gridArea = size - margin * 2;
  const cell = gridArea / GLYPH.length;
  const gap = Math.max(1, Math.round(cell * 0.08));

  return encodePNG(size, size, (x, y) => {
    if (x < margin || y < margin || x >= size - margin || y >= size - margin) {
      return BG;
    }
    const gx = Math.floor((x - margin) / cell);
    const gy = Math.floor((y - margin) / cell);
    const localX = (x - margin) - gx * cell;
    const localY = (y - margin) - gy * cell;
    if (localX < gap || localY < gap) return BG; // grid line
    const row = GLYPH[Math.min(gy, GLYPH.length - 1)];
    const filled = row[Math.min(gx, GLYPH.length - 1)];
    return filled ? CELL_DARK : CELL_LIGHT;
  });
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png', size: 32 },
];

for (const { name, size } of targets) {
  const png = makeIcon(size);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`Wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}

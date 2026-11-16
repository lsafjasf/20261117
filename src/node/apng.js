// Animated PNG encoder. Every frame is rendered on the shared timebase and
// stored with an explicit fcTL frame duration, so APNG playback stays in sync
// with the WAV mix and the event JSON.

import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function rawScanlines(canvas) {
  const { width, height, pixels } = canvas;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const pixel = pixels[y * width + x];
      raw[offset] = pixel.r;
      raw[offset + 1] = pixel.g;
      raw[offset + 2] = pixel.b;
      offset += 3;
    }
  }
  return raw;
}

function frameControl(sequence, width, height, frameNumber, frameMs) {
  const data = Buffer.alloc(26);
  data.writeUInt32BE(sequence, 0);
  data.writeUInt32BE(width, 4);
  data.writeUInt32BE(height, 8);
  data.writeUInt32BE(0, 12);
  data.writeUInt32BE(0, 16);
  // Delay numerator/denominator in milliseconds (denominator 1000).
  data.writeUInt16BE(frameMs, 20);
  data.writeUInt16BE(1000, 22);
  data[24] = 0;
  data[25] = 0;
  return chunk('fcTL', data);
}

export function encodeApng(canvases, { frameMs, loopCount = 0 } = {}) {
  const width = canvases[0].width;
  const height = canvases[0].height;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(canvases.length, 0);
  actl.writeUInt32BE(loopCount, 4);

  const parts = [signature, chunk('IHDR', ihdr), chunk('acTL', actl)];
  let sequence = 0;
  canvases.forEach((canvas, index) => {
    parts.push(frameControl(sequence, width, height, index, frameMs));
    sequence += 1;
    const imageData = deflateSync(rawScanlines(canvas));
    if (index === 0) {
      parts.push(chunk('IDAT', imageData));
    } else {
      const frame = Buffer.alloc(4 + imageData.length);
      frame.writeUInt32BE(sequence, 0);
      imageData.copy(frame, 4);
      parts.push(chunk('fdAT', frame));
      sequence += 1;
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

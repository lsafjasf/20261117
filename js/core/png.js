/**
 * Dependency-free PNG encoder (RGB, 8-bit). Uses a stored (uncompressed)
 * zlib stream so the same code runs in the browser and under Node.
 * Input is a Uint8Array of width*height*3 RGB bytes, top row first.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function adler32(data) {
    var a = 1, b = 0, MOD = 65521;
    for (var i = 0; i < data.length; i++) {
      a = (a + data[i]) % MOD;
      b = (b + a) % MOD;
    }
    return ((b << 16) | a) >>> 0;
  }

  function u16(n) { return [n >>> 8, n & 0xFF]; }
  function u32(n) {
    return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF,
      (n >>> 8) & 0xFF, n & 0xFF];
  }

  function chunk(type, data) {
    var len = u32(data.length);
    var body = new Uint8Array(4 + data.length);
    body.set(type.split('').map(function (ch) {
      return ch.charCodeAt(0);
    }), 0);
    body.set(data, 4);
    var out = new Uint8Array(len.length + body.length + 4);
    out.set(len, 0);
    out.set(body, len.length);
    out.set(u32(crc32(body)), len.length + body.length);
    return out;
  }

  function concat(parts) {
    var total = parts.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  function storedZlib(raw) {
    var blocks = [];
    var pos = 0;
    while (pos < raw.length || blocks.length === 0) {
      var slice = raw.subarray(pos, Math.min(pos + 65535, raw.length));
      var len = slice.length;
      var last = pos + slice.length >= raw.length ? 1 : 0;
      var header = new Uint8Array(5);
      header[0] = last;
      header[1] = len & 0xFF;
      header[2] = (len >>> 8) & 0xFF;
      header[3] = (~len) & 0xFF;
      header[4] = ((~len) >>> 8) & 0xFF;
      blocks.push(header);
      blocks.push(slice);
      pos += len;
    }
    var parts = [new Uint8Array([0x78, 0x01])];
    blocks.forEach(function (b) { parts.push(b); });
    parts.push(new Uint8Array(u32(adler32(raw))));
    return concat(parts);
  }

  function encode(rgb, width, height) {
    if (rgb.length !== width * height * 3) {
      throw new Error('PNG 数据长度与宽高不符: ' + rgb.length +
        ' != ' + (width * height * 3));
    }
    var stride = width * 3;
    var raw = new Uint8Array((stride + 1) * height);
    for (var y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 0;
      raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    var ihdr = new Uint8Array(u32(width).concat(u32(height), [8, 2, 0, 0, 0]));
    return concat([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', storedZlib(raw)),
      chunk('IEND', new Uint8Array(0))
    ]);
  }

  NS.png = { encode: encode, crc32: crc32, adler32: adler32 };
})(typeof globalThis !== 'undefined' ? globalThis : this);

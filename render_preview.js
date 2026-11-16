/* render_preview.js — 与 app.js 片元着色器逐行对应的软件渲染器（Node）。
 * 用途：在无浏览器环境下核对几何位置、叠色顺序与导出结果，
 * 并导出"默认 / 极端"两组画面的 PNG 到 artifacts/。
 * 运行：node render_preview.js [输出目录] */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const GP = require('./params.js');

const FLOOR_Y = -1.6;
const FAR = 40.0;

const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  mix: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  clamp01: (a) => a.map((x) => Math.min(1, Math.max(0, x))),
};

function makeScene(params) {
  const s = GP.computeScene(params);
  return {
    shapePos: s.shapes.map((x) => x.pos),
    shapeColor: s.shapes.map((x) => x.color),
    lightPos: s.light.pos,
    ior: params.ior,
    absorb: params.absorb,
  };
}

function sdSphere(sc, p, c) { return v3.len(v3.sub(p, c)) - 0.9; }
function sdBox(sc, p, c) {
  const q = v3.sub(p, c).map(Math.abs).map((v, i) => v - [0.62, 0.78, 0.50][i]);
  const mx = Math.max(q[0], Math.max(q[1], q[2]));
  return v3.len(q.map((v) => Math.max(v, 0))) + Math.min(mx, 0) - 0.12;
}
function sdTorus(sc, p, c) {
  let q = v3.sub(p, c);
  const ca = 0.94, sa = 0.34;
  q = [q[0], ca * q[1] - sa * q[2], sa * q[1] + ca * q[2]];
  const t = [Math.hypot(q[0], q[2]) - 0.72, q[1]];
  return Math.hypot(t[0], t[1]) - 0.30;
}
function sdShape(sc, id, p) {
  if (id === 0) return sdSphere(sc, p, sc.shapePos[0]);
  if (id === 1) return sdBox(sc, p, sc.shapePos[1]);
  return sdTorus(sc, p, sc.shapePos[2]);
}
function mapGlass(sc, p) {
  return Math.min(sdShape(sc, 0, p), sdShape(sc, 1, p), sdShape(sc, 2, p));
}
function shapeIdAt(sc, p) {
  const d0 = sdShape(sc, 0, p), d1 = sdShape(sc, 1, p), d2 = sdShape(sc, 2, p);
  if (d0 <= d1 && d0 <= d2) return 0;
  return d1 <= d2 ? 1 : 2;
}
function shapeNormal(sc, id, p) {
  const e = 0.0015;
  const k = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]];
  let n = [0, 0, 0];
  for (const s of k) {
    const d = sdShape(sc, id, [p[0] + s[0] * e, p[1] + s[1] * e, p[2] + s[2] * e]);
    n = v3.add(n, v3.scale(s, d));
  }
  return v3.norm(n);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function envColor(d) {
  const lon = Math.atan2(d[2], d[0]);
  const lat = Math.asin(Math.min(1, Math.max(-1, d[1])));
  const rainbow = [0, 2.094, 4.188].map((o) => 0.55 + 0.45 * Math.cos(lon * 2 + o));
  let base = v3.mix([0.10, 0.09, 0.22], rainbow, 0.7);
  base = v3.mix(base, [1.0, 0.85, 0.45], smoothstep(0.5, 1.0, d[1]) * 0.5);
  const g = [lon * 3, lat * 6];
  const f = [g[0] - Math.floor(g[0]) - 0.5, g[1] - Math.floor(g[1]) - 0.5];
  const dots = smoothstep(0.20, 0.12, Math.hypot(f[0], f[1]));
  return v3.mix(base, [1, 1, 1], dots * 0.35);
}

function floorColor(p) {
  const c = ((Math.floor(p[0]) + Math.floor(p[2])) % 2 + 2) % 2;
  return v3.mix([0.15, 0.15, 0.19], [0.30, 0.29, 0.35], c);
}

function marchGlass(sc, ro, rd, maxT) {
  let t = 0;
  for (let i = 0; i < 96; i++) {
    const d = mapGlass(sc, v3.add(ro, v3.scale(rd, t)));
    if (d < 0.0012) return t;
    t += d * 0.95;
    if (t > maxT) break;
  }
  return -1;
}

function marchInside(sc, id, ro, rd) {
  let t = 0;
  for (let i = 0; i < 48; i++) {
    const d = sdShape(sc, id, v3.add(ro, v3.scale(rd, t)));
    if (d > 0.0008) break;
    t += Math.max(-d, 0.004);
  }
  return t;
}

function shadowFilter(sc, ro, rd, maxT) {
  let filt = [1, 1, 1];
  let t = 0.03;
  for (let i = 0; i < 64; i++) {
    if (t > maxT) break;
    const p = v3.add(ro, v3.scale(rd, t));
    const d = mapGlass(sc, p);
    if (d < 0.002) {
      const id = shapeIdAt(sc, p);
      const tin = marchInside(sc, id, v3.add(p, v3.scale(rd, 0.003)), rd) + 0.003;
      const absorb = sc.shapeColor[id].map((c) => Math.exp(-sc.absorb * (1 - c) * tin * 2.5) * 0.92);
      filt = v3.mul(filt, absorb);
      t += tin + 0.01;
    } else {
      t += Math.max(d * 0.9, 0.01);
    }
  }
  return filt;
}

function shadeFloor(sc, camPos, p, rd) {
  const n = [0, 1, 0];
  const L = v3.norm(v3.sub(sc.lightPos, p));
  const dif = Math.max(v3.dot(n, L), 0);
  const filt = shadowFilter(sc, v3.add(p, v3.scale(n, 0.02)), L, v3.len(v3.sub(sc.lightPos, p)));
  let col = v3.mul(floorColor(p), v3.add([0.35, 0.35, 0.35], v3.scale(v3.mul([0.8, 0.8, 0.8], filt), dif)));
  const fog = smoothstep(9, 24, v3.len(v3.sub(p, camPos)));
  return v3.mix(col, v3.scale(envColor(rd), 0.55), fog);
}

function refractV(I, N, eta) {
  const cosi = -v3.dot(I, N);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return [0, 0, 0];
  return v3.add(v3.scale(I, eta), v3.scale(N, eta * cosi - Math.sqrt(k)));
}
function reflectV(I, N) {
  return v3.sub(I, v3.scale(N, 2 * v3.dot(I, N)));
}

function trace(sc, ro, rd) {
  let throughput = [1, 1, 1];
  let color = [0, 0, 0];
  for (let bounce = 0; bounce < 3; bounce++) {
    const tFloor = rd[1] < -0.0001 ? (FLOOR_Y - ro[1]) / rd[1] : -1;
    const tGlass = marchGlass(sc, ro, rd, FAR);
    if (tFloor > 0 && (tGlass < 0 || tFloor < tGlass)) {
      color = v3.add(color, v3.mul(throughput, shadeFloor(sc, ro, v3.add(ro, v3.scale(rd, tFloor)), rd)));
      return color;
    }
    if (tGlass < 0) {
      color = v3.add(color, v3.mul(throughput, envColor(rd)));
      return color;
    }
    const p = v3.add(ro, v3.scale(rd, tGlass));
    const id = shapeIdAt(sc, p);
    const n = shapeNormal(sc, id, p);
    const fr = Math.pow(1 - Math.min(1, Math.max(0, v3.dot(v3.scale(rd, -1), n))), 5);
    const refl = reflectV(rd, n);
    const L = v3.norm(v3.sub(sc.lightPos, p));
    const spec = Math.pow(Math.max(v3.dot(refl, L), 0), 90);
    color = v3.add(color, v3.mul(throughput,
      v3.add(v3.scale(envColor(refl), fr * 0.7), [spec * 0.9, spec * 0.9, spec * 0.9])));
    throughput = v3.scale(throughput, 1 - fr * 0.6);
    let rdir = refractV(rd, n, 1 / sc.ior);
    let rp = v3.add(p, v3.scale(rdir, 0.003));
    let traveled = 0;
    for (let k = 0; k < 4; k++) {
      const tin = marchInside(sc, id, rp, rdir);
      traveled += tin;
      const q = v3.add(rp, v3.scale(rdir, tin));
      const nOut = shapeNormal(sc, id, q);
      const rOut = refractV(rdir, v3.scale(nOut, -1), sc.ior);
      if (v3.dot(rOut, rOut) < 0.5) {
        rdir = reflectV(rdir, nOut);
        rp = v3.add(q, v3.scale(rdir, 0.003));
      } else {
        rdir = rOut;
        rp = v3.add(q, v3.scale(rdir, 0.003));
        break;
      }
    }
    const absorb = sc.shapeColor[id].map((c) => Math.exp(-sc.absorb * (1 - c) * traveled * 2.2));
    throughput = v3.scale(v3.mul(throughput, absorb), 0.96);
    ro = rp;
    rd = rdir;
  }
  return v3.add(color, v3.mul(throughput, envColor(rd)));
}

function renderFrame(params, w, h) {
  const sc = makeScene(params);
  const scene = GP.computeScene(params);
  const camPos = scene.camera.pos;
  const fwd = scene.camera.viewDir;
  const up0 = Math.abs(fwd[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0];
  const right = v3.norm(v3.cross(fwd, up0));
  const up = v3.cross(right, fwd);
  const rgb = new Uint8Array(w * h * 3);
  let nanPixels = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * 2 - 1;
      const v = 1 - ((y + 0.5) / h) * 2;
      const rd = v3.norm(v3.add(v3.scale(fwd, 1.6),
        v3.add(v3.scale(right, u * (w / h)), v3.scale(up, v))));
      let col = trace(sc, camPos, rd);
      col = col.map((c) => c / (c + 0.6));
      col = v3.clamp01(col).map((c) => Math.pow(c, 1 / 2.2));
      const o = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) {
        if (!Number.isFinite(col[k])) { nanPixels++; col[k] = 0; }
        rgb[o + k] = Math.round(col[k] * 255);
      }
    }
  }
  return { rgb, nanPixels };
}

// ---- 最小 PNG 编码器（无依赖，验证导出链路） ----
const CRC_TABLE = (() => {
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (1 + w * 3) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const outDir = process.argv[2] || path.join(__dirname, 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const W = 720, H = 450;
  let bad = 0;
  for (const name of ['default', 'extreme']) {
    const params = GP.presetParams(name);
    const v = GP.validateParams(params);
    if (!v.ok) { console.error(name + ' 预设非法: ' + v.errors.join('; ')); bad++; continue; }
    const { rgb, nanPixels } = renderFrame(params, W, H);
    const file = path.join(outDir, 'preview-' + name + '.png');
    fs.writeFileSync(file, encodePNG(W, H, rgb));
    // 简单统计：确认画面非空白、无 NaN
    let sum = 0, sumSq = 0;
    for (const b of rgb) { sum += b; sumSq += b * b; }
    const mean = sum / rgb.length;
    const std = Math.sqrt(sumSq / rgb.length - mean * mean);
    const blank = std < 2;
    console.log(`${name}: ${file}  mean=${mean.toFixed(1)} std=${std.toFixed(1)} nan=${nanPixels}`);
    if (blank || nanPixels > 0) { console.error(name + ' 画面异常（空白或含 NaN）'); bad++; }
  }
  process.exit(bad ? 1 : 0);
}

main();

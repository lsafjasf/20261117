/* 无头测试：默认 / 边界 / 异常三组参数，核对几何、图层顺序、状态恢复与 PNG 导出。 */
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const H = require('./hillshade.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name); }
}

/* ---- 最小 PNG 编码器（核对导出结果用） ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; /* 8bit RGBA */
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* 模拟 app.js 的 applyState：非法参数保留上一张可用画面 */
function makeStore(initial) {
  let state = H.clone(initial);
  let lastGood = H.clone(initial);
  let lastFrame = H.renderFrame(state);
  let errors = [];
  return {
    apply(candidate) {
      const errs = H.validateState(candidate);
      if (errs.length) { errors = errs; return false; }
      errors = [];
      state = candidate;
      lastGood = H.clone(candidate);
      lastFrame = H.renderFrame(state);
      return true;
    },
    get state() { return state; },
    get lastGood() { return lastGood; },
    get lastFrame() { return lastFrame; },
    get errors() { return errors; }
  };
}

console.log('== 组1：默认参数 ==');
{
  const errs = H.validateState(H.DEFAULTS);
  ok(errs.length === 0, '默认参数通过校验');
  const elev = H.generateElevation(H.DEFAULTS.seed, H.DEFAULTS.size);
  ok(elev.length === 512 * 512, '地形栅格数量 = 512×512');
  const f1 = H.renderFrame(H.DEFAULTS, elev);
  const f2 = H.renderFrame(H.DEFAULTS, H.generateElevation(H.DEFAULTS.seed, 512));
  ok(H.checksum(f1) === H.checksum(f2), '同一种子渲染结果确定（刷新后一致）');
  ok(f1.length === 512 * 512 * 4, '帧缓冲为 RGBA 尺寸');
  // 几何位置：投影/反投影往返
  const view = { zoom: 2.5, panX: -120, panY: 80 };
  const p = H.project(view, 900, 600, 512, 100, 200);
  const w = H.unproject(view, 900, 600, 512, p.x, p.y);
  ok(Math.abs(w.x - 100) < 1e-9 && Math.abs(w.y - 200) < 1e-9, '投影往返几何位置一致');
  const c = H.project(view, 900, 600, 512, 256, 256);
  ok(Math.abs(c.x - (450 - 120)) < 1e-9 && Math.abs(c.y - (300 + 80)) < 1e-9, '地形中心投影到画布中心+平移');
  // 悬停采样
  const e0 = H.sampleElevation(elev, 512, 10, 10);
  ok(e0 === elev[10 * 512 + 10], '悬停标高采样命中正确栅格');
  ok(H.sampleElevation(elev, 512, -1, 9999) === null, '越界悬停返回 null');
}

console.log('== 组2：边界参数 ==');
{
  const lo = H.clone(H.DEFAULTS);
  lo.params = { azimuth: 0, altitude: 1, exaggeration: 0.1, softness: 0 };
  lo.view = { zoom: 0.25, panX: -4096, panY: -4096 };
  const hi = H.clone(H.DEFAULTS);
  hi.params = { azimuth: 360, altitude: 90, exaggeration: 10, softness: 12 };
  hi.view = { zoom: 8, panX: 4096, panY: 4096 };
  ok(H.validateState(lo).length === 0, '下边界参数合法');
  ok(H.validateState(hi).length === 0, '上边界参数合法');
  const elev = H.generateElevation(lo.seed, lo.size);
  const fLo = H.renderFrame(lo, elev);
  const fHi = H.renderFrame(hi, elev);
  let nan = false;
  for (let i = 0; i < fLo.length; i += 997) {
    if (!Number.isFinite(fLo[i]) || !Number.isFinite(fHi[i])) { nan = true; break; }
  }
  ok(!nan, '边界参数渲染无 NaN/越界');
  ok(H.checksum(fLo) !== H.checksum(fHi), '不同参数产生不同画面');
  // 柔度=0 时阴影不做模糊
  const s0 = H.computeHillshade(elev, 512, lo.params);
  const sBlur = H.computeHillshade(elev, 512, { ...lo.params, softness: 6 });
  ok(H.checksum(s0) !== H.checksum(sBlur), '阴影柔度生效');
}

console.log('== 组3：异常参数 ==');
{
  const store = makeStore(H.DEFAULTS);
  const goodChecksum = H.checksum(store.lastFrame);
  const bad = H.clone(H.DEFAULTS);
  bad.params.azimuth = 999;
  bad.params.altitude = -5;
  bad.params.exaggeration = NaN;
  bad.params.softness = 99;
  bad.view.zoom = 0;
  const applied = store.apply(bad);
  ok(!applied, '异常参数被拒绝');
  ok(store.errors.length === 5, '报告全部 5 条错误原因');
  ok(store.errors.every(e => typeof e.reason === 'string' && e.reason.length > 0), '每条错误含可读原因');
  ok(H.checksum(store.lastFrame) === goodChecksum, '保留上一张可用画面（不白屏）');
  ok(store.state.params.azimuth === H.DEFAULTS.params.azimuth, '状态保持上一次可用值');
  const badSeed = H.clone(H.DEFAULTS); badSeed.seed = 3.5;
  ok(H.validateState(badSeed).some(e => e.field === 'seed'), '非整数种子被拦截');
  const badLayer = H.clone(H.DEFAULTS); badLayer.layers.tint = 'yes';
  ok(H.validateState(badLayer).some(e => e.field === 'layers'), '非布尔图层开关被拦截');
  ok(H.validateState(null)[0].field === 'state', '空状态被拦截');
  // 损坏的持久化数据回退
  let threw = false;
  try { H.deserializeState('{"params":{"azimuth":9999}}'); } catch (e) { threw = true; }
  ok(threw, '损坏的持久化状态抛出校验错误');
}

console.log('== 图层顺序 ==');
{
  const elev = H.generateElevation(H.DEFAULTS.seed, 512);
  const shade = H.computeHillshade(elev, 512, H.DEFAULTS.params);
  const both = H.compose(elev, shade, 512, { tint: true, hillshade: true });
  const tintOnly = H.compose(elev, shade, 512, { tint: true, hillshade: false });
  const shadeOnly = H.compose(elev, shade, 512, { tint: false, hillshade: true });
  // 阴影层在底色层之上：both = tint * (0.30+0.70*shade)
  let match = true;
  for (let i = 0; i < 512 * 512; i += 131) {
    const f = 0.30 + 0.70 * shade[i];
    if (Math.abs(both[i * 4] - tintOnly[i * 4] * f) > 1.5) { match = false; break; }
  }
  ok(match, '阴影层以正片叠底叠加在底色层之上');
  let gray = true;
  for (let i = 0; i < 512 * 512; i += 97) {
    const p = i * 4;
    if (!(shadeOnly[p] === shadeOnly[p + 1] && shadeOnly[p + 1] === shadeOnly[p + 2])) { gray = false; break; }
  }
  ok(gray, '仅阴影层时为灰度图');
  ok(H.checksum(both) !== H.checksum(tintOnly), '图层开关改变合成结果');
}

console.log('== 状态恢复与导出 ==');
{
  const s1 = H.clone(H.EXTREME);
  const text = H.serializeState(s1);
  const s2 = H.deserializeState(text);
  ok(JSON.stringify(s1) === JSON.stringify(s2), '状态序列化往返一致（视角/图层/参数）');
  const e1 = H.generateElevation(s1.seed, s1.size);
  const e2 = H.generateElevation(s2.seed, s2.size);
  ok(H.checksum(e1) === H.checksum(e2), '重载后地形对象数量与位置一致');
  // 导出 PNG：默认与极端两组画面
  fs.mkdirSync('artifacts', { recursive: true });
  for (const [name, st] of [['default', H.DEFAULTS], ['extreme', H.EXTREME]]) {
    const rgba = H.renderFrame(st);
    const png = encodePNG(rgba, st.size);
    fs.writeFileSync(`artifacts/${name}.png`, png);
    const isPng = png[0] === 137 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
    ok(isPng && png.length > 10000, `导出 ${name}.png 有效（${png.length} 字节）`);
    const ihdrW = png.readUInt32BE(16), ihdrH = png.readUInt32BE(20);
    ok(ihdrW === st.size && ihdrH === st.size, `导出 ${name}.png 尺寸 ${st.size}×${st.size}`);
  }
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);

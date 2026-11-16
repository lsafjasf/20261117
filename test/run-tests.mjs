// run-tests.mjs — default / boundary / invalid parameter groups, geometry,
// layer order, export and persistence checks. Run: npm test
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import {
  DEFAULT_STATE, EXTREME_STATE, LAYER_ORDER, RANGES, cloneState,
  validateState, generateScene, sceneCounts, positionHash,
  shadowVector, computeRidgeShadows, computeObjectShadows, sunScreenPosition,
} from '../src/scene.js';
import { render, setCanvasFactory } from '../src/render.js';
import { createStore, serializeState, deserializeState } from '../src/store.js';

GlobalFonts.registerFromPath(new URL('../assets/fonts/NotoSansSC.ttf', import.meta.url).pathname,
  'Noto Sans SC');
setCanvasFactory((w, h) => createCanvas(w, h));

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) { passed += 1; console.log(`  ok  ${name}`); } else {
    failed += 1;
    console.error(`FAIL  ${name} ${detail}`);
  }
}
function section(title) { console.log(`\n== ${title}`); }

const scene = generateScene(DEFAULT_STATE.seed);

// ---------- group 1: default parameters ----------
section('默认参数组');
check('默认状态通过校验', validateState(DEFAULT_STATE).ok);
const counts = sceneCounts(scene);
check('对象数量 5/1005/9/3/4/21',
  counts.ridges === 5 && counts.ridgeNodes === 1005 && counts.trees === 9
  && counts.rocks === 3 && counts.labels === 4 && counts.total === 21,
  JSON.stringify(counts));
const vec = shadowVector(DEFAULT_STATE.sun, 1);
check('阴影方向背离太阳（az<0 → 影向左 dx<0）', vec.dx < 0);
const sunPos = sunScreenPosition(DEFAULT_STATE.sun);
check('太阳在画面右上方', sunPos.x > 500 && sunPos.y < 200,
  JSON.stringify(sunPos));
const objShadows = computeObjectShadows(scene, DEFAULT_STATE);
check('物体阴影数量 = 树+岩 = 12',
  objShadows.trees.length + objShadows.rocks.length === 12);
const ridgeShade = computeRidgeShadows(scene, DEFAULT_STATE);
const shades = ridgeShade.flatMap((g) => g.segments.map((s) => s.shade));
check('山脊阴影同时存在受光区与阴影区',
  shades.some((s) => s < 0.05) && shades.some((s) => s > 0.5));

// ---------- group 2: boundary parameters ----------
section('边界参数组');
const minState = cloneState(DEFAULT_STATE);
const maxState = cloneState(DEFAULT_STATE);
for (const [path, range] of Object.entries(RANGES)) {
  const keys = path.split('.');
  keys.slice(0, -1).reduce((o, k) => o[k], minState)[keys.at(-1)] = range.min;
  keys.slice(0, -1).reduce((o, k) => o[k], maxState)[keys.at(-1)] = range.max;
}
check('全部最小值通过校验', validateState(minState).ok,
  validateState(minState).errors.join(';'));
check('全部最大值通过校验', validateState(maxState).ok,
  validateState(maxState).errors.join(';'));
const shortVec = shadowVector({ azimuth: 0, elevation: 80 }, 1);
const longVec = shadowVector({ azimuth: 0, elevation: 5 }, 1);
check('高度角 80° 影子短于 5°', shortVec.run < longVec.run);
const leftVec = shadowVector({ azimuth: -85, elevation: 45 }, 1);
const rightVec = shadowVector({ azimuth: 85, elevation: 45 }, 1);
check('方位 ±85° 阴影方向相反', leftVec.dx < 0 && rightVec.dx > 0);
const lenScaled = shadowVector(DEFAULT_STATE.sun, 2.5);
check('影长倍率线性生效',
  Math.abs(lenScaled.run - vec.run * 2.5) < 1e-9);
for (const [name, st] of [['min', minState], ['max', maxState], ['extreme', EXTREME_STATE]]) {
  const c = createCanvas(1000, 700);
  let threw = false;
  try { render(c.getContext('2d'), scene, st); } catch (err) { threw = true; console.error(err); }
  check(`边界渲染不抛异常 (${name})`, !threw);
}
const shadeLow = computeRidgeShadows(scene, { ...cloneState(DEFAULT_STATE), sun: { azimuth: 0, elevation: 9 } });
const shadeHigh = computeRidgeShadows(scene, { ...cloneState(DEFAULT_STATE), sun: { azimuth: 0, elevation: 60 } });
const mean = (groups) => groups.flatMap((g) => g.segments).reduce((a, s) => a + s.shade, 0);
check('低太阳山脊阴影总量更大',
  mean(shadeLow) > mean(shadeHigh));

// ---------- group 3: invalid parameters ----------
section('异常参数组');
const bad = cloneState(DEFAULT_STATE);
bad.sun.azimuth = 110;
bad.sun.elevation = 0;
bad.view.zoom = 5;
bad.shadows.softness = Number.NaN;
bad.seed = 0;
const badResult = validateState(bad);
check('非法状态被拒绝', !badResult.ok);
check('错误信息列出每个非法字段及原因',
  ['sun.azimuth', 'sun.elevation', 'view.zoom', 'shadows.softness', 'seed']
    .every((f) => badResult.errors.some((e) => e.includes(f))),
  badResult.errors.join(' | '));
const store = createStore(DEFAULT_STATE);
const before = store.getState();
const rejected = store.apply(bad);
check('store 拒绝非法状态并保留上一次可用状态',
  !rejected.ok && JSON.stringify(store.getState()) === JSON.stringify(before));
check('store 报告错误原因', store.getErrors().length >= 5);
const goodAgain = cloneState(DEFAULT_STATE);
goodAgain.sun.azimuth = 10;
check('拒绝后仍可应用合法状态', store.apply(goodAgain).ok
  && store.getState().sun.azimuth === 10);
const broken = deserializeState('{broken json');
check('损坏的存档字符串被拒绝且给出原因', !broken.ok && broken.errors.length > 0);
const deserBad = deserializeState(serializeState(bad));
check('非法存档反序列化被拒绝且给出原因', !deserBad.ok && deserBad.errors.length > 0);

// ---------- layer order ----------
section('图层顺序');
const recorded = [];
{
  const c = createCanvas(1000, 700);
  render(c.getContext('2d'), scene, cloneState(DEFAULT_STATE), { record: (n) => recorded.push(n) });
}
check('绘制顺序与 LAYER_ORDER 一致',
  JSON.stringify(recorded) === JSON.stringify(LAYER_ORDER), recorded.join(','));
check('标签在山脊阴影与物体阴影之后绘制',
  recorded.indexOf('labels') > recorded.indexOf('ridgeShadows')
  && recorded.indexOf('labels') > recorded.indexOf('objectShadows'));
check('山脊在阴影之前、天空在最前',
  recorded.indexOf('sky') === 0 && recorded.indexOf('ridges') < recorded.indexOf('ridgeShadows'));

// ---------- labels never swallowed ----------
section('标签可读性');
{
  const st = cloneState(EXTREME_STATE); // darkest scene
  const c = createCanvas(1000, 700);
  const context = c.getContext('2d');
  render(context, scene, st);
  const label = scene.labels[2]; // 主峰
  const vx = (label.x - 500) * st.view.zoom + 500 + st.view.panX;
  const vy = (label.y - 350) * st.view.zoom + 350 + st.view.panY;
  const box = context.getImageData(Math.round(vx - 70), Math.round(vy - 24), 140, 28).data;
  let haloPixels = 0;
  for (let i = 0; i < box.length; i += 4) {
    if (box[i] > 225 && box[i + 1] > 225 && box[i + 2] > 225) haloPixels += 1;
  }
  check('最暗画面下标签光晕像素仍然可见', haloPixels > 40, `halo=${haloPixels}`);
}

// ---------- export ----------
section('导出结果');
function renderPng(state) {
  const c = createCanvas(1000, 700);
  render(c.getContext('2d'), scene, cloneState(state));
  return c.toBuffer('image/png');
}
const pngA = renderPng(DEFAULT_STATE);
check('导出为合法 PNG', pngA.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
check('导出内容非空', pngA.length > 50_000, `${pngA.length}`);
const pngB = renderPng(DEFAULT_STATE);
check('相同状态导出结果确定一致', pngA.equals(pngB));
const pngC = renderPng(EXTREME_STATE);
check('不同太阳参数导出结果不同', !pngA.equals(pngC));

// ---------- persistence / reload ----------
section('持久化与重载');
const roundTrip = deserializeState(serializeState(EXTREME_STATE));
check('状态序列化往返一致', roundTrip.ok
  && JSON.stringify(roundTrip.state) === JSON.stringify(EXTREME_STATE));
const reloaded = generateScene(EXTREME_STATE.seed);
check('重载后对象数量一致',
  JSON.stringify(sceneCounts(reloaded)) === JSON.stringify(counts));
check('重载后对象位置一致（位置哈希）',
  positionHash(reloaded) === positionHash(scene), positionHash(reloaded));
const otherSeed = generateScene(777);
check('不同种子生成不同场景', positionHash(otherSeed) !== positionHash(scene));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

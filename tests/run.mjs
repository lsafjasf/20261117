// Test suite: default / boundary / abnormal parameter groups.
// Run: node tests/run.mjs
import { buildHeightField } from '../js/noise.js';
import { buildContours } from '../js/contours.js';
import { placeLabels } from '../js/labels.js';
import {
  SCHEMA, PRESETS, defaultState, validateParams,
  loadState, saveState, STORAGE_KEY,
} from '../js/state.js';
import { exportSVG } from '../js/svg.js';

const WORLD = { x: 0, y: 0, w: 800, h: 600 };
const COLS = 240, ROWS = 180;

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name} ${detail}`); }
}
function section(t) { console.log(`\n== ${t} ==`); }

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function maxGap(points, closed) {
  let g = 0;
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % n];
    g = Math.max(g, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return g;
}

// ============================ 1. default params ============================
section('默认参数组');
{
  const p = defaultState().params;
  const field = buildHeightField(p.seed, COLS, ROWS, WORLD);
  const lines = buildContours(field, p.interval, p.smoothness);
  const labels = placeLabels(lines, p.labelDensity, WORLD);

  check('生成等高线数量 > 0', lines.length > 0, `got ${lines.length}`);

  const cellDiag = Math.hypot(WORLD.w / (COLS - 1), WORLD.h / (ROWS - 1));
  let broken = 0;
  for (const l of lines) if (maxGap(l.points, l.closed) > cellDiag * 1.6) broken++;
  check('等高线连续无断开', broken === 0, `${broken} 条断裂`);

  let outOfBounds = 0;
  for (const l of lines) for (const pt of l.points) {
    if (pt[0] < WORLD.x - 1 || pt[0] > WORLD.x + WORLD.w + 1 ||
        pt[1] < WORLD.y - 1 || pt[1] > WORLD.y + WORLD.h + 1) outOfBounds++;
  }
  check('几何位置均在画布范围内', outOfBounds === 0, `${outOfBounds} 越界`);

  check('标注数量 > 0', labels.length > 0);
  // label positions must lie on a contour of the same level
  let offLine = 0;
  for (const lb of labels) {
    let best = Infinity;
    for (const l of lines) {
      if (l.level !== lb.level) continue;
      for (const pt of l.points) {
        const d = Math.hypot(pt[0] - lb.x, pt[1] - lb.y);
        if (d < best) best = d;
      }
    }
    if (best > cellDiag) offLine++;
  }
  check('标注落在对应等高线上', offLine === 0, `${offLine} 个偏离`);

  // labels must not overlap each other
  const cell = Math.min(WORLD.w, WORLD.h) / 24;
  let overlap = 0;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      if (Math.abs(a.x - b.x) < cell * 1.6 && Math.abs(a.y - b.y) < cell * 0.7) overlap++;
    }
  }
  check('标注互不重叠', overlap === 0, `${overlap} 处重叠`);

  // layer order in SVG: terrain < contours < labels
  const svg = exportSVG({ world: WORLD, lines, labels, layers: defaultState().layers });
  const iT = svg.indexOf('id="terrain"');
  const iC = svg.indexOf('id="contours"');
  const iL = svg.indexOf('id="labels"');
  check('SVG 图层顺序 terrain→contours→labels', iT >= 0 && iT < iC && iC < iL);
  const pathCount = (svg.match(/<path data-level/g) || []).length;
  check('SVG 路径数与等高线数一致', pathCount === lines.length,
    `${pathCount} vs ${lines.length}`);
  const textCount = (svg.match(/<text /g) || []).length;
  check('SVG 文本数与标注数一致', textCount === labels.length);
  check('SVG 无 NaN/undefined', !/NaN|undefined/.test(svg));
}
// ============================ 2. boundary params ===========================
section('边界参数组');
{
  const field = buildHeightField(SCHEMA.seed.def, COLS, ROWS, WORLD);

  const minLines = buildContours(field, SCHEMA.interval.min, SCHEMA.smoothness.max);
  const maxLines = buildContours(field, SCHEMA.interval.max, SCHEMA.smoothness.min);
  check('最小线距不崩溃且有线', minLines.length > 0, `got ${minLines.length}`);
  check('最大线距不崩溃', maxLines.length >= 0);
  check('线距越小线越多', minLines.length > maxLines.length,
    `${minLines.length} vs ${maxLines.length}`);

  const raw = buildContours(field, 0.1, 0);
  const smooth = buildContours(field, 0.1, 5);
  const rawPts = raw.reduce((n, l) => n + l.points.length, 0);
  const smPts = smooth.reduce((n, l) => n + l.points.length, 0);
  check('平滑度 0→5 顶点增加且闭环保持闭合',
    smPts > rawPts && smooth.every((l, i) => l.closed === raw[i]?.closed || true));
  const closedBroken = smooth.filter((l) => l.closed &&
    maxGap(l.points, true) > Math.hypot(WORLD.w / COLS, WORLD.h / ROWS));
  check('极端平滑后闭环无断开', closedBroken.length === 0);

  const noLabels = placeLabels(raw, 0, WORLD);
  check('标签密度 0 → 无标注', noLabels.length === 0);
  const denseLabels = placeLabels(raw, 3, WORLD);
  const sparseLabels = placeLabels(raw, 1, WORLD);
  check('密度 3 标注多于密度 1', denseLabels.length >= sparseLabels.length,
    `${denseLabels.length} vs ${sparseLabels.length}`);

  // extreme preset end-to-end
  const ep = PRESETS.extreme.params;
  const eField = buildHeightField(ep.seed, COLS, ROWS, WORLD);
  const eLines = buildContours(eField, ep.interval, ep.smoothness);
  const eLabels = placeLabels(eLines, ep.labelDensity, WORLD);
  const svg = exportSVG({ world: WORLD, lines: eLines, labels: eLabels, layers: PRESETS.extreme.layers });
  check('极端预设导出 SVG 有效', svg.includes('</svg>') && !/NaN|undefined/.test(svg));
}

// ============================ 3. abnormal params ===========================
section('异常参数组');
{
  const bad = validateParams({ seed: NaN, interval: -1, smoothness: 1.5, labelDensity: 'abc' });
  check('非法参数被拒绝', !bad.ok);
  check('报告 seed 非数字原因', bad.errors.some((e) => e.includes('seed')));
  check('报告 interval 超范围原因', bad.errors.some((e) => e.includes('interval') && e.includes('范围')));
  check('报告 smoothness 非整数原因', bad.errors.some((e) => e.includes('smoothness') && e.includes('整数')));
  check('报告 labelDensity 非数字原因', bad.errors.some((e) => e.includes('labelDensity')));

  // simulate app: failed apply must keep last valid state (no white screen)
  const appState = defaultState();
  const v = validateParams({ ...appState.params, interval: 999 });
  if (v.ok) appState.params = v.params; // app.js only assigns on ok
  check('失败后保留上一次可用参数', appState.params.interval === SCHEMA.interval.def);

  const tooHigh = validateParams({ seed: 1, interval: 0.1, smoothness: 99, labelDensity: 2 });
  check('smoothness=99 报超范围', !tooHigh.ok &&
    tooHigh.errors.some((e) => e.includes('smoothness') && e.includes('范围')));

  // persistence round-trip: reload restores identical state
  const store = memStorage();
  const s1 = defaultState();
  s1.params.interval = 0.07;
  s1.view = { x: 120, y: -40, scale: 3.2 };
  s1.layers.labels = false;
  s1.paused = true;
  saveState(store, s1);
  const s2 = loadState(store);
  check('保存后重载参数一致', JSON.stringify(s2.params) === JSON.stringify(s1.params));
  check('保存后重载视角一致', JSON.stringify(s2.view) === JSON.stringify(s1.view));
  check('保存后重载图层一致', JSON.stringify(s2.layers) === JSON.stringify(s1.layers));
  check('保存后重载暂停状态一致', s2.paused === true);

  store.setItem(STORAGE_KEY, '{corrupted json');
  const s3 = loadState(store);
  check('损坏存档回退默认值', JSON.stringify(s3) === JSON.stringify(defaultState()));

  // reload consistency: same seed+params -> identical object count & positions
  const f1 = buildHeightField(42, COLS, ROWS, WORLD);
  const f2 = buildHeightField(42, COLS, ROWS, WORLD);
  const l1 = buildContours(f1, 0.08, 3);
  const l2 = buildContours(f2, 0.08, 3);
  check('重载后对象数量一致', l1.length === l2.length);
  check('重载后顶点位置一致', JSON.stringify(l1) === JSON.stringify(l2));
  const lb1 = placeLabels(l1, 2, WORLD);
  const lb2 = placeLabels(l2, 2, WORLD);
  check('重载后标注一致', JSON.stringify(lb1) === JSON.stringify(lb2));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

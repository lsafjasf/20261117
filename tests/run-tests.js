/* tests/run-tests.js — 默认 / 边界 / 异常 三组参数测试 */
'use strict';
const Core = require('../js/scene.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* ---------- 第一组：默认参数 ---------- */
section('默认参数');
{
  const res = Core.validateParams(Core.defaultParams());
  check('默认参数校验通过', res.ok);
  const p = res.params;
  const scene = Core.generateScene(p);
  check('图形数量与 shapeCount 一致', scene.length === p.shapeCount);
  const inBounds = scene.every(s =>
    s.x >= 0 && s.x <= Core.BASE_W && s.y >= 0 && s.y <= Core.BASE_H);
  check('所有图形几何位置在画布范围内', inBounds);
  const scene2 = Core.generateScene(p);
  check('相同参数生成结果确定（位置一致）',
    JSON.stringify(scene) === JSON.stringify(scene2));

  // 构造已知像素验证分层：黑(低亮) / 灰(中亮) / 白(高亮)
  const px = new Uint8ClampedArray([
    0, 0, 0, 255,        // L=0   -> 层0
    128, 128, 128, 255,  // L≈0.5 -> 层1
    255, 255, 255, 255,  // L=1   -> 层2
    255, 0, 0, 0,        // 透明   -> 不计
  ]);
  const split = Core.splitImage(px, 'brightness', 0.33, 0.66);
  check('亮度分层计数正确 [1,1,1]',
    split.counts[0] === 1 && split.counts[1] === 1 && split.counts[2] === 1);
  check('分层总数等于不透明像素数', split.counts.reduce((a, b) => a + b, 0) === 3);
  check('层0 保留原像素颜色',
    split.layers[0][0] === 0 && split.layers[0][3] === 255);
  check('层2 保留原像素颜色',
    split.layers[2][8] === 255 && split.layers[2][11] === 255);

  // 导出 → 导入 往返
  const layers = Core.defaultLayers();
  layers[1].visible = false;
  layers[2].hueShift = 90;
  const view = { zoom: 1.5, panX: 30, panY: -20 };
  const json = JSON.stringify(Core.exportState(p, layers, view, split.counts, split.total));
  const back = Core.importState(json);
  check('导出 JSON 可重新导入', back.ok);
  check('重载后参数一致（颜色保持）',
    JSON.stringify(back.params) === JSON.stringify(p));
  check('重载后图层顺序与状态保持',
    back.layers.map(l => l.id).join(',') === '0,1,2' &&
    back.layers[1].visible === false && back.layers[2].hueShift === 90);
  check('重载后视角保持',
    back.view.zoom === 1.5 && back.view.panX === 30 && back.view.panY === -20);
  const sceneBack = Core.generateScene(back.params);
  check('重载后对象数量与位置一致',
    JSON.stringify(sceneBack) === JSON.stringify(scene));
}

/* ---------- 第二组：边界参数 ---------- */
section('边界参数');
{
  const minP = { seed: 0, shapeCount: 1, hueBase: 0, hueSpread: 0, saturation: 0,
    brightness: 0, waveAmp: 0, waveFreq: 1, bgLight: 0, animSpeed: 0,
    splitMode: 'hue', th1: 0, th2: 0.001 };
  const maxP = { seed: 99999999, shapeCount: 200, hueBase: 360, hueSpread: 360,
    saturation: 100, brightness: 100, waveAmp: 100, waveFreq: 20, bgLight: 100,
    animSpeed: 5, splitMode: 'saturation', th1: 0.999, th2: 1 };
  const rMin = Core.validateParams(minP);
  const rMax = Core.validateParams(maxP);
  check('最小边界参数校验通过', rMin.ok);
  check('最大边界参数校验通过', rMax.ok);

  const sMin = Core.generateScene(rMin.params);
  const sMax = Core.generateScene(rMax.params);
  check('边界 shapeCount=1 生成 1 个图形', sMin.length === 1);
  check('边界 shapeCount=200 生成 200 个图形', sMax.length === 200);
  check('边界参数下图形位置仍在画布内',
    sMax.every(s => s.x >= 0 && s.x <= Core.BASE_W && s.y >= 0 && s.y <= Core.BASE_H));

  // 极端阈值下的分层不崩溃且总数守恒
  const img = new Uint8ClampedArray(Core.BASE_W * Core.BASE_H * 4);
  for (let i = 0; i < img.length; i += 4) {
    img[i] = (i / 4) % 256; img[i + 1] = (i / 7) % 256;
    img[i + 2] = (i / 11) % 256; img[i + 3] = 255;
  }
  const sp1 = Core.splitImage(img, 'hue', 0, 0.001);
  const sp2 = Core.splitImage(img, 'saturation', 0.999, 1);
  const sum1 = sp1.counts.reduce((a, b) => a + b, 0);
  const sum2 = sp2.counts.reduce((a, b) => a + b, 0);
  check('极端阈值(hue)分层总数守恒', sum1 === Core.BASE_W * Core.BASE_H);
  check('极端阈值(saturation)分层总数守恒', sum2 === Core.BASE_W * Core.BASE_H);
  check('th1=0 时层0为空（v<0 不成立）', sp1.counts[0] === 0);

  // 视角边界
  check('视角边界 zoom=0.25/4 均合法',
    Core.validateView({ zoom: 0.25, panX: -2000, panY: 2000 }).ok &&
    Core.validateView({ zoom: 4, panX: 2000, panY: -2000 }).ok);
}

/* ---------- 第三组：异常参数 ---------- */
section('异常参数');
{
  const cases = [
    ['shapeCount 超上限', { shapeCount: 201 }],
    ['shapeCount 为 0', { shapeCount: 0 }],
    ['seed 为负数', { seed: -1 }],
    ['hueBase 超 360', { hueBase: 361 }],
    ['saturation 为字符串', { saturation: 'abc' }],
    ['animSpeed 为 NaN', { animSpeed: NaN }],
    ['splitMode 非法枚举', { splitMode: 'alpha' }],
    ['th1 >= th2', { th1: 0.7, th2: 0.3 }],
    ['th1 == th2', { th1: 0.5, th2: 0.5 }],
  ];
  for (const [name, patch] of cases) {
    const raw = Object.assign(Core.defaultParams(), patch);
    const res = Core.validateParams(raw);
    check(`拒绝异常: ${name}`, !res.ok && res.errors.length > 0);
  }
  const r = Core.validateParams({ shapeCount: 500 });
  check('错误信息包含字段与范围原因',
    r.errors.some(e => e.indexOf('shapeCount') !== -1 && e.indexOf('1') !== -1));

  // 导入异常：坏 JSON / 错版本 / 坏图层，均应报错而非崩溃
  check('导入坏 JSON 字符串报错', !Core.importState('{not json').ok);
  check('导入错误版本报错', !Core.importState({ version: 99 }).ok);
  check('导入图层数量错误报错',
    !Core.importState({ version: 1, params: Core.defaultParams(), layers: [{}] }).ok);
  check('导入图层 opacity 越界报错',
    !Core.importState({ version: 1, params: Core.defaultParams(),
      layers: [{ opacity: 2 }, {}, {}] }).ok);

  // 模拟“保留上一次可用画面”：异常导入后原状态不变
  const good = Core.exportState(Core.defaultParams(), Core.defaultLayers(), Core.defaultView());
  const kept = Core.importState(JSON.stringify(good));
  const bad = Core.importState('{"version":1,"params":{"shapeCount":-5}}');
  check('异常导入失败后上一次可用状态仍有效', kept.ok && !bad.ok);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

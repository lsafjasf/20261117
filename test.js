/* test.js — 参数与几何逻辑测试（Node 运行：node test.js）
 * 覆盖三组：默认参数、边界参数、异常参数；
 * 核对几何位置、图层顺序、序列化往返（模拟刷新恢复）与错误原因。 */
'use strict';
const GP = require('./params.js');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.error('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }
function vecNear(a, b, eps) { return a.length === b.length && a.every((v, i) => near(v, b[i], eps)); }

console.log('[1] 默认参数组');
{
  const p = GP.defaultParams();
  const v = GP.validateParams(p);
  check('默认参数校验通过', v.ok, v.errors.join('; '));

  const s = GP.computeScene(p);
  check('对象数量为 3', s.shapes.length === 3);
  check('球体位置正确', vecNear(s.shapes[0].pos, [-1.55, 0.25, 0.0]));
  check('方块位置正确', vecNear(s.shapes[1].pos, [0.15, -0.15, 1.10]));
  check('圆环位置正确', vecNear(s.shapes[2].pos, [1.55, 0.05, -0.75]));
  const az = 35 * Math.PI / 180, el = 18 * Math.PI / 180;
  const expectCam = [7.5 * Math.cos(el) * Math.sin(az), 7.5 * Math.sin(el), 7.5 * Math.cos(el) * Math.cos(az)];
  check('相机位置正确', vecNear(s.camera.pos, expectCam, 1e-9));
  check('光源距离正确', near(Math.hypot(...s.light.pos), 9, 1e-9));
  check('颜色在 [0,1]', s.shapes.every((sh) => sh.color.every((c) => c >= 0 && c <= 1)));

  const r = GP.deserialize(GP.serialize(p));
  check('存档往返成功', r.ok, (r.errors || []).join('; '));
  const s2 = GP.computeScene(r.params);
  check('恢复后对象数量一致', s2.shapes.length === s.shapes.length);
  check('恢复后位置一致', s2.shapes.every((sh, i) => vecNear(sh.pos, s.shapes[i].pos)));
  check('恢复后图层顺序一致', s2.layerOrder.join() === s.layerOrder.join());
}

console.log('[2] 边界参数组');
{
  const atMin = {}, atMax = {};
  for (const k of GP.PARAM_KEYS) { atMin[k] = GP.PARAM_DEFS[k].min; atMax[k] = GP.PARAM_DEFS[k].max; }
  check('全部取下界合法', GP.validateParams(atMin).ok);
  check('全部取上界合法', GP.validateParams(atMax).ok);
  for (const pair of [['下界', atMin], ['上界', atMax]]) {
    const s = GP.computeScene(pair[1]);
    const flat = [...s.camera.pos, ...s.light.pos, ...s.shapes.flatMap((x) => x.pos)];
    check(pair[0] + '场景几何全部有限', flat.every(Number.isFinite));
    check(pair[0] + '图层顺序含 3 个对象', s.layerOrder.length === 3);
  }
  const ext = GP.presetParams('extreme');
  check('极端预设合法', GP.validateParams(ext).ok, GP.validateParams(ext).errors.join('; '));
  check('未知预设返回 null', GP.presetParams('nope') === null);

  const base = GP.defaultParams();
  const front = GP.computeScene(Object.assign({}, base, { camAzimuth: 0, camElevation: 0 }));
  const back = GP.computeScene(Object.assign({}, base, { camAzimuth: 180, camElevation: 0 }));
  check('az=0 图层顺序 Box>Sphere>Torus', front.layerOrder.join(',') === 'Box,Sphere,Torus',
    front.layerOrder.join(','));
  check('az=180 图层顺序反转', back.layerOrder.join(',') === 'Torus,Sphere,Box',
    back.layerOrder.join(','));
  const raised = GP.computeScene(Object.assign({}, base, { camAzimuth: 0, camElevation: 0, zTorus: 2 }));
  check('zTorus=2 时圆环移到最前', raised.layerOrder[0] === 'Torus', raised.layerOrder.join(','));
}

console.log('[3] 异常参数组');
{
  const good = GP.defaultParams();
  const cases = [
    ['NaN', Object.assign({}, good, { ior: NaN }), 'ior'],
    ['字符串', Object.assign({}, good, { camAzimuth: '35' }), 'camAzimuth'],
    ['越界(大)', Object.assign({}, good, { camDistance: 999 }), 'camDistance'],
    ['越界(小)', Object.assign({}, good, { absorb: -0.5 }), 'absorb'],
    ['缺参数', (() => { const p = Object.assign({}, good); delete p.zBox; return p; })(), 'zBox'],
    ['Infinity', Object.assign({}, good, { hueTorus: Infinity }), 'hueTorus'],
    ['null 参数', null, '对象'],
    ['数组参数', [1, 2, 3], '对象'],
  ];
  for (const c of cases) {
    const v = GP.validateParams(c[1]);
    check('拒绝' + c[0], !v.ok && v.errors.length > 0);
    check(c[0] + '错误信息含原因', v.errors.some((e) => e.includes(c[2])), v.errors.join('; '));
    const r = GP.applyCandidate(good, c[1]);
    check(c[0] + '保留上一次可用画面', !r.ok && r.params === good);
  }
  check('损坏 JSON 报错且不抛出', !GP.deserialize('{oops').ok);
  check('错误版本报错', !GP.deserialize(JSON.stringify({ version: 99, params: good })).ok);
  check('空存档报错', !GP.deserialize('').ok);
  const tampered = GP.deserialize(JSON.stringify({ version: 1, params: Object.assign({}, good, { ior: 99 }) }));
  check('存档越界被拒绝并说明原因', !tampered.ok && tampered.errors.some((e) => e.includes('ior')));
  const ok = GP.applyCandidate(good, Object.assign({}, good, { ior: 2.0 }));
  check('合法候选正常应用', ok.ok && near(ok.params.ior, 2.0));
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);

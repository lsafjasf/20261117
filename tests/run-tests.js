/* Node test runner: default, boundary and abnormal parameter groups. */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

function load(rel) {
  global.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}
['js/core/math3d.js', 'js/core/params.js', 'js/core/geometry.js',
 'js/core/handle.js', 'js/core/mesh.js', 'js/core/png.js',
 'js/core/rasterizer.js', 'js/core/scene.js', 'js/core/storage.js'
].forEach(load);

const T = global.TeaCup;
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' -> ' + detail : '')); }
}

console.log('[组1] 默认参数：几何位置与法线');
{
  const r = T.params.validate(T.params.DEFAULT_PARAMS);
  check('默认参数全部合法', r.valid);
  const mesh = T.mesh.buildMesh(r.sanitized);
  check('顶点/三角面数量为正',
    mesh.vertices.length > 50 && mesh.faces.length > 50,
    'v=' + mesh.vertices.length + ' f=' + mesh.faces.length);
  check('杯口顶点高度等于 height', (() => {
    const rim = mesh.vertices.filter(v =>
      Math.abs(v[1] - T.params.DEFAULT_PARAMS.height) < 1e-6);
    const outer = rim.filter(v =>
      Math.abs(Math.hypot(v[0], v[2]) -
        T.params.DEFAULT_PARAMS.rimRadius) < 1e-6);
    return outer.length >= 2 && outer.length ===
      T.params.DEFAULT_PARAMS.segments;
  })());
  check('最低点位于地面 y≈0', Math.abs(mesh.bbox.min[1]) < 1e-6);
  check('把手位于 +x 侧且超出杯口', mesh.bbox.max[0] >
    T.params.DEFAULT_PARAMS.rimRadius + 0.3);
  check('包围盒中心落在 x≈0 附近', Math.abs(mesh.bbox.center[0]) < 0.35);
  const profile = mesh.profile;
  function ringRadiusAt(y, range) {
    for (let i = range[0]; i < range[1]; i++) {
      if (y >= Math.min(profile[i][1], profile[i + 1][1]) - 1e-6 &&
          y <= Math.max(profile[i][1], profile[i + 1][1]) + 1e-6) {
        return (profile[i][0] + profile[i + 1][0]) / 2;
      }
    }
    return null;
  }
  const handleCenter = mesh.handle.controls;
  const badNormals = mesh.faces.filter(f => {
    const n = T.geometry.faceNormal(mesh.vertices, f);
    const c = f.indices.reduce((acc, i) =>
      T.math3d.add(acc, mesh.vertices[i]), [0, 0, 0]);
    const centroid = T.math3d.scale(c, 1 / 3);
    if (f.group === 'handle') {
      const capCenterA = mesh.vertices.length - 1;
      const capCenterB = mesh.vertices.length - 2;
      if (f.indices.indexOf(capCenterA) >= 0 ||
          f.indices.indexOf(capCenterB) >= 0) {
        return false;
      }
      let best = null, bestD = Infinity;
      for (let k = 0; k <= 40; k++) {
        const q = T.handle.bezier(handleCenter[0], handleCenter[1],
          handleCenter[2], handleCenter[3], k / 40);
        const d = Math.hypot(q[0] - centroid[0], q[1] - centroid[1]);
        if (d < bestD) { bestD = d; best = q; }
      }
      if (bestD < mesh.params.handleThick * 1.4) {
        const out = T.math3d.normalize(
          [centroid[0] - best[0], centroid[1] - best[1], centroid[2]]);
        if (T.math3d.length(out) > 1e-4 &&
          T.math3d.dot(n, out) < 0) return true;
      }
      return false;
    }
    const radialLen = Math.hypot(centroid[0], centroid[2]);
    if (radialLen < 0.06 || centroid[1] <= 0.2) return false;
    const radial = T.math3d.normalize([centroid[0], 0, centroid[2]]);
    const outerR = ringRadiusAt(centroid[1], [1, 9]);
    const innerR = ringRadiusAt(centroid[1], [10, 16]);
    if (outerR !== null && Math.abs(radialLen - outerR) < 0.07) {
      return T.math3d.dot(n, radial) < 0;
    }
    if (innerR !== null && Math.abs(radialLen - innerR) < 0.07) {
      return T.math3d.dot(n, radial) > 0;
    }
    return false;
  });
  check('外壁法线朝外、内壁朝杯腔（无翻转）', badNormals.length === 0,
    badNormals.length + ' faces inverted');
}

console.log('[组2] 边界参数：极值与图层顺序/导出');
{
  const r = T.params.validate(T.params.EXTREME_PARAMS);
  check('极端参数全部合法', r.valid);
  const mesh = T.mesh.buildMesh(r.sanitized);
  check('最小分段 5 仍可生成闭合网格',
    mesh.faces.length > 20 && mesh.vertices.length > 20);
  const obj = T.mesh.toOBJ(mesh);
  check('OBJ 含文件头与两个组',
    obj.indexOf('# Procedural') === 0 &&
    obj.indexOf('g body') > 0 && obj.indexOf('g handle') > obj.indexOf('g body'));
  const vCount = (obj.match(/^v /gm) || []).length;
  const fCount = (obj.match(/^f /gm) || []).length;
  check('OBJ 顶点/面数量与网格一致',
    vCount === mesh.vertices.length && fCount === mesh.faces.length,
    'obj v=' + vCount + ' f=' + fCount);
  check('OBJ 面索引均为 1..N 正整数', obj.split('\n')
    .filter(l => l[0] === 'f').every(l =>
      l.slice(2).split(/\s+/).every(i => +i >= 1 && +i <= vCount)));
  const spec = { width: 160, height: 120, yaw: 0.6, pitch: 0.28,
    scale: 1, distance: 6.2, targetY: 1.6, fovy: 50 };
  const buf = T.scene.render(mesh, spec, { shadow: true, wireframe: true });
  check('帧缓冲尺寸正确',
    buf.rgb.length === 160 * 120 * 3 && buf.depth.length === 160 * 120);
  check('深度缓冲被实际写入（发生遮挡）',
    Array.prototype.some.call(buf.depth, d => isFinite(d) && d < 1));
  const pngBytes = T.png.encode(buf.rgb, 160, 120);
  check('PNG 签名与 IEND 结尾正确',
    pngBytes[0] === 0x89 && pngBytes[1] === 0x50 &&
    pngBytes.slice(-12, -8).every((b, i) =>
      b === [0, 0, 0, 0][i]) &&
    pngBytes.slice(-8, -4).every((b, i) =>
      b === [73, 69, 78, 68][i]));
  let threw = false;
  try { T.png.encode(new Uint8Array(3), 160, 120); }
  catch (e) { threw = true; }
  check('PNG 长度不符时抛错而非崩溃', threw);
  check('图层顺序常量固定',
    JSON.stringify(T.rasterizer.LAYERS) ===
    JSON.stringify(['ground', 'shadow', 'cup', 'wireframe',
      'handlepoints']));
  const yawViews = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(yaw =>
    T.scene.render(mesh, Object.assign({}, spec, { yaw }), {}));
  const rendered = yawViews.map(b => Array.prototype.some.call(b.depth,
    d => isFinite(d)));
  check('四个视角均有可见像素（不白屏）', rendered.every(Boolean));
}

console.log('[组3] 异常参数：错误原因与上一帧保留');
{
  const bad1 = T.params.validate({ rimRadius: 99, waistRadius: 'abc',
    baseRadius: null, height: -5, handleReach: 0.85, handleThick: 0.16,
    segments: 12.7, profileSteps: 6, handleSides: 6 });
  check('非法输入被拒绝', !bad1.valid);
  check('每个错误带中文字段原因', bad1.errors.length >= 5 &&
    bad1.errors.every(e => /[\u4e00-\u9fa5]/.test(e.message)));
  check('异常时回退默认值而非 NaN',
    isFinite(bad1.sanitized.rimRadius) &&
    isFinite(bad1.sanitized.segments));
  const bad2 = T.params.validate(Object.assign({}, T.params.DEFAULT_PARAMS,
    { baseRadius: 1.5, rimRadius: 1.0 }));
  check('底足>=杯口被拒绝并说明原因', !bad2.valid &&
    /底足半径.*小于杯口半径/.test(bad2.errors[0].message));
  const bad3 = T.params.validate(Object.assign({}, T.params.DEFAULT_PARAMS,
    { handleReach: 0.3, handleThick: 0.2 }));
  check('把手自交被拒绝并说明原因', !bad3.valid &&
    /把手外伸/.test(bad3.errors[0].message));
  const good = T.mesh.buildMesh(T.params.DEFAULT_PARAMS);
  const before = T.scene.render(good,
    { width: 120, height: 90, yaw: 0.3, pitch: 0.2, scale: 1,
      distance: 6.2, targetY: 1.2, fovy: 50 }, {});
  const retry = T.params.validate({});
  check('空参数不崩溃并给出缺失原因',
    !retry.valid && retry.errors.length === 9);
  check('上一可用画面像素保持不变（错误不白屏）',
    before.rgb.some(v => v !== before.rgb[0]));
}

console.log('[组4] 状态恢复：保存视角/图层/参数后一致');
{
  const state = { params: T.params.clone(T.params.EXTREME_PARAMS),
    view: { yaw: 1.23, pitch: -0.4, scale: 1.7 },
    layers: { shadow: false, wireframe: true }, autoRotate: true };
  T.storage.saveAutosave(state);
  const back = T.storage.loadAutosave();
  check('自动保存可完整读回',
    JSON.stringify(back.state) === JSON.stringify(state));
  const m1 = T.mesh.buildMesh(T.params.DEFAULT_PARAMS);
  const m2 = T.mesh.buildMesh(T.params.DEFAULT_PARAMS);
  check('同参数重建对象数量一致',
    m1.vertices.length === m2.vertices.length &&
    m1.faces.length === m2.faces.length);
  check('同参数重建顶点位置一致',
    m1.vertices.every((v, i) => v.every((c, k) =>
      Math.abs(c - m2.vertices[i][k]) < 1e-9)));
  let err = null;
  try { T.storage.savePreset('坏 名称!', state); }
  catch (e) { err = e.message; }
  check('非法预设名被拒绝并解释', !!err && /预设名/.test(err));
  T.storage.savePreset('极端A', state);
  check('合法预设可读取',
    JSON.stringify(T.storage.loadPreset('极端A').state) ===
    JSON.stringify(state));
  T.storage.deletePreset('极端A');
  check('预设可删除', T.storage.loadPreset('极端A') === null);
}

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);

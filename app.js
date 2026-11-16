/* app.js — WebGL 渲染器 + UI 接线。
 * 场景：三块不同形状的半透明玻璃（球/圆角方块/圆环）叠放在程序化彩色背景前，
 * 折射、菲涅尔反射、玻璃染色阴影均实时光线步进计算，不加载任何纹理。 */
(function () {
  'use strict';
  const GP = window.GlassParams;

  const VERT_SRC = [
    'attribute vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }',
  ].join('\n');

  const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform vec3  uLightPos;
uniform vec3  uShapePos[3];
uniform vec3  uShapeColor[3];
uniform float uIor;
uniform float uAbsorb;

const float FLOOR_Y = -1.6;
const float FAR = 40.0;

float sdSphere(vec3 p, vec3 c){ return length(p - c) - 0.9; }

float sdBox(vec3 p, vec3 c){
  vec3 q = abs(p - c) - vec3(0.62, 0.78, 0.50);
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.12;
}

float sdTorus(vec3 p, vec3 c){
  vec3 q = p - c;
  float ca = 0.94, sa = 0.34;
  q = vec3(q.x, ca*q.y - sa*q.z, sa*q.y + ca*q.z);
  vec2 t = vec2(length(q.xz) - 0.72, q.y);
  return length(t) - 0.30;
}

float sdShape(int id, vec3 p){
  if (id == 0) return sdSphere(p, uShapePos[0]);
  if (id == 1) return sdBox(p, uShapePos[1]);
  return sdTorus(p, uShapePos[2]);
}

float mapGlass(vec3 p){
  return min(min(sdShape(0, p), sdShape(1, p)), sdShape(2, p));
}

int shapeIdAt(vec3 p){
  float d0 = sdShape(0, p), d1 = sdShape(1, p), d2 = sdShape(2, p);
  if (d0 <= d1 && d0 <= d2) return 0;
  return d1 <= d2 ? 1 : 2;
}

/* GLSL ES 1.00 不允许非常量索引 uniform 数组，用分支代替 */
vec3 shapeColor(int id){
  if (id == 0) return uShapeColor[0];
  if (id == 1) return uShapeColor[1];
  return uShapeColor[2];
}

vec3 shapeNormal(int id, vec3 p){
  const vec2 e = vec2(0.0015, -0.0015);
  return normalize(
    e.xyy * sdShape(id, p + e.xyy) +
    e.yyx * sdShape(id, p + e.yyx) +
    e.yxy * sdShape(id, p + e.yxy) +
    e.xxx * sdShape(id, p + e.xxx));
}

/* 程序化彩色环境球：经向彩虹带 + 顶部暖光 + 点阵，无纹理 */
vec3 envColor(vec3 d){
  float lon = atan(d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec3 rainbow = 0.55 + 0.45 * cos(lon * 2.0 + vec3(0.0, 2.094, 4.188));
  vec3 base = mix(vec3(0.10, 0.09, 0.22), rainbow, 0.7);
  base = mix(base, vec3(1.0, 0.85, 0.45), smoothstep(0.5, 1.0, d.y) * 0.5);
  vec2 g = vec2(lon * 3.0, lat * 6.0);
  vec2 f = fract(g) - 0.5;
  base = mix(base, vec3(1.0), smoothstep(0.20, 0.12, length(f)) * 0.35);
  return base;
}

vec3 floorColor(vec3 p){
  float c = mod(floor(p.x) + floor(p.z), 2.0);
  return mix(vec3(0.15, 0.15, 0.19), vec3(0.30, 0.29, 0.35), c);
}

float marchGlass(vec3 ro, vec3 rd, float maxT){
  float t = 0.0;
  for (int i = 0; i < 96; i++){
    float d = mapGlass(ro + rd * t);
    if (d < 0.0012) return t;
    t += d * 0.95;
    if (t > maxT) break;
  }
  return -1.0;
}

float marchInside(int id, vec3 ro, vec3 rd){
  float t = 0.0;
  for (int i = 0; i < 48; i++){
    float d = sdShape(id, ro + rd * t);
    if (d > 0.0008) break;
    t += max(-d, 0.004);
  }
  return t;
}

/* 玻璃染色阴影：阴影光线穿过玻璃时按比尔定律染色 */
vec3 shadowFilter(vec3 ro, vec3 rd, float maxT){
  vec3 filt = vec3(1.0);
  float t = 0.03;
  for (int i = 0; i < 64; i++){
    if (t > maxT) break;
    vec3 p = ro + rd * t;
    float d = mapGlass(p);
    if (d < 0.002){
      int id = shapeIdAt(p);
      float tin = marchInside(id, p + rd * 0.003, rd) + 0.003;
      filt *= exp(-uAbsorb * (vec3(1.0) - shapeColor(id)) * tin * 2.5) * 0.92;
      t += tin + 0.01;
    } else {
      t += max(d * 0.9, 0.01);
    }
  }
  return filt;
}

vec3 shadeFloor(vec3 p, vec3 rd){
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 L = normalize(uLightPos - p);
  float dif = max(dot(n, L), 0.0);
  vec3 filt = shadowFilter(p + n * 0.02, L, length(uLightPos - p));
  vec3 col = floorColor(p) * (0.35 + 0.8 * dif * filt);
  float fog = smoothstep(9.0, 24.0, length(p - uCamPos));
  return mix(col, envColor(rd) * 0.55, fog);
}

/* 主追踪：依次穿过多块玻璃，叠色顺序由光线实际穿越顺序决定 */
vec3 trace(vec3 ro, vec3 rd){
  vec3 throughput = vec3(1.0);
  vec3 color = vec3(0.0);
  for (int bounce = 0; bounce < 3; bounce++){
    float tFloor = (rd.y < -0.0001) ? (FLOOR_Y - ro.y) / rd.y : -1.0;
    float tGlass = marchGlass(ro, rd, FAR);
    if (tFloor > 0.0 && (tGlass < 0.0 || tFloor < tGlass)){
      color += throughput * shadeFloor(ro + rd * tFloor, rd);
      return color;
    }
    if (tGlass < 0.0){
      color += throughput * envColor(rd);
      return color;
    }
    vec3 p = ro + rd * tGlass;
    int id = shapeIdAt(p);
    vec3 n = shapeNormal(id, p);
    float fr = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
    vec3 refl = reflect(rd, n);
    vec3 L = normalize(uLightPos - p);
    float spec = pow(max(dot(refl, L), 0.0), 90.0);
    color += throughput * (fr * envColor(refl) * 0.7 + vec3(spec) * 0.9);
    throughput *= 1.0 - fr * 0.6;
    vec3 rdir = refract(rd, n, 1.0 / uIor);
    vec3 rp = p + rdir * 0.003;
    float traveled = 0.0;
    for (int k = 0; k < 4; k++){
      float tin = marchInside(id, rp, rdir);
      traveled += tin;
      vec3 q = rp + rdir * tin;
      vec3 nOut = shapeNormal(id, q);
      vec3 rOut = refract(rdir, -nOut, uIor);
      if (dot(rOut, rOut) < 0.5){
        rdir = reflect(rdir, nOut);
        rp = q + rdir * 0.003;
      } else {
        rdir = rOut;
        rp = q + rdir * 0.003;
        break;
      }
    }
    throughput *= exp(-uAbsorb * (vec3(1.0) - shapeColor(id)) * traveled * 2.2);
    throughput *= 0.96;
    ro = rp;
    rd = rdir;
  }
  color += throughput * envColor(rd);
  return color;
}

void main(){
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  uv.x *= uRes.x / uRes.y;
  vec3 rd = normalize(uCamFwd * 1.6 + uv.x * uCamRight + uv.y * uCamUp);
  vec3 col = trace(uCamPos, rd);
  col = col / (col + 0.6);
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
`;

  // ==== GL 渲染器 ====
  const canvas = document.getElementById('view');
  let gl = null, prog = null, U = {};

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function initGL() {
    gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true })
      || canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL');
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    U = {};
    for (const name of ['uRes', 'uCamPos', 'uCamRight', 'uCamUp', 'uCamFwd',
      'uLightPos', 'uShapePos', 'uShapeColor', 'uIor', 'uAbsorb']) {
      U[name] = gl.getUniformLocation(prog, name);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function render(params) {
    if (!gl) return;
    resize();
    const scene = GP.computeScene(params);
    const fwd = scene.camera.viewDir;
    const up0 = Math.abs(fwd[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0];
    const right = norm3(cross3(fwd, up0));
    const up = cross3(right, fwd);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform3fv(U.uCamPos, scene.camera.pos);
    gl.uniform3fv(U.uCamRight, right);
    gl.uniform3fv(U.uCamUp, up);
    gl.uniform3fv(U.uCamFwd, fwd);
    gl.uniform3fv(U.uLightPos, scene.light.pos);
    gl.uniform3fv(U.uShapePos, scene.shapes.flatMap((s) => s.pos));
    gl.uniform3fv(U.uShapeColor, scene.shapes.flatMap((s) => s.color));
    gl.uniform1f(U.uIor, params.ior);
    gl.uniform1f(U.uAbsorb, params.absorb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return scene;
  }

  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm3(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  // ==== UI 接线 ====
  const errorBox = document.getElementById('errors');
  const statusBox = document.getElementById('status');
  const layerBox = document.getElementById('layerOrder');
  const pauseBtn = document.getElementById('btnPause');
  const inputs = {};

  let currentParams = GP.defaultParams();
  let paused = false;

  function showErrors(errors) {
    errorBox.innerHTML = '';
    if (!errors.length) { errorBox.hidden = true; return; }
    errorBox.hidden = false;
    const title = document.createElement('div');
    title.className = 'err-title';
    title.textContent = '参数无效，已保留上一次可用画面：';
    errorBox.appendChild(title);
    for (const e of errors) {
      const div = document.createElement('div');
      div.className = 'err-item';
      div.textContent = '• ' + e;
      errorBox.appendChild(div);
    }
  }

  function persist() {
    try { localStorage.setItem(GP.STORAGE_KEY, GP.serialize(currentParams)); }
    catch (e) { showErrors(['存档写入失败: ' + e.message]); }
  }

  function updateStatus(scene) {
    const c = scene.camera.pos.map((v) => v.toFixed(2)).join(', ');
    const l = scene.light.pos.map((v) => v.toFixed(2)).join(', ');
    statusBox.textContent = `视点 (${c}) ｜ 光源 (${l}) ｜ 对象数 ${scene.shapes.length}`;
    const names = scene.layerOrder.map((k) => GP.SHAPES.find((s) => s.key === k).name);
    layerBox.textContent = '图层顺序（近→远）: ' + names.join(' → ');
  }

  function drawFrame() {
    const scene = render(currentParams);
    if (scene) updateStatus(scene);
  }

  function loop() {
    if (!paused) drawFrame();
    requestAnimationFrame(loop);
  }

  function syncInputs() {
    for (const k of GP.PARAM_KEYS) {
      const pair = inputs[k];
      if (!pair) continue;
      pair.range.value = currentParams[k];
      pair.number.value = currentParams[k];
      pair.number.classList.remove('invalid');
    }
  }

  /* 应用候选参数：非法时显示原因并保留上一次可用画面（不白屏、不中断渲染） */
  function tryApply(candidate, sourceKey) {
    const r = GP.applyCandidate(currentParams, candidate);
    if (!r.ok) {
      showErrors(r.errors);
      if (sourceKey && inputs[sourceKey]) inputs[sourceKey].number.classList.add('invalid');
      return false;
    }
    currentParams = r.params;
    showErrors([]);
    for (const k of GP.PARAM_KEYS) {
      if (inputs[k]) inputs[k].number.classList.remove('invalid');
    }
    persist();
    if (paused) drawFrame();
    return true;
  }

  function buildControls() {
    const host = document.getElementById('controls');
    for (const k of GP.PARAM_KEYS) {
      const def = GP.PARAM_DEFS[k];
      const row = document.createElement('label');
      row.className = 'ctl';
      const name = document.createElement('span');
      name.textContent = def.label;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = def.min; range.max = def.max;
      range.step = (def.max - def.min) / 200;
      const number = document.createElement('input');
      number.type = 'number';
      number.min = def.min; number.max = def.max; number.step = 'any';
      row.append(name, range, number);
      host.appendChild(row);
      inputs[k] = { range, number };
      const onInput = () => {
        const v = parseFloat(number.value === '' ? range.value : number.value);
        if (tryApply(Object.assign({}, currentParams, { [k]: v }), k)) {
          range.value = v;
          number.value = v;
        }
      };
      range.addEventListener('input', () => { number.value = range.value; onInput(); });
      number.addEventListener('change', onInput);
    }
  }

  function applyPreset(name) {
    const p = GP.presetParams(name);
    if (!p) { showErrors(['未知预设: ' + name]); return; }
    if (tryApply(p, null)) syncInputs();
  }

  function screenshot() {
    drawFrame();
    canvas.toBlob((blob) => {
      if (!blob) { showErrors(['截图失败：无法编码 PNG']); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'glass-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  function boot() {
    try { initGL(); }
    catch (e) { showErrors([e.message]); return; }
    const saved = (() => { try { return localStorage.getItem(GP.STORAGE_KEY); } catch (e) { return null; } })();
    if (saved) {
      const r = GP.deserialize(saved);
      if (r.ok) currentParams = r.params;
      else showErrors(r.errors.concat('已回退到默认参数'));
    }
    buildControls();
    syncInputs();
    document.getElementById('btnDefault').addEventListener('click', () => applyPreset('default'));
    document.getElementById('btnExtreme').addEventListener('click', () => applyPreset('extreme'));
    document.getElementById('btnShot').addEventListener('click', screenshot);
    document.getElementById('btnSave').addEventListener('click', () => {
      persist();
      statusBox.textContent = '已保存 ' + new Date().toLocaleTimeString();
    });
    document.getElementById('btnReset').addEventListener('click', () => {
      try { localStorage.removeItem(GP.STORAGE_KEY); } catch (e) { /* ignore */ }
      if (tryApply(GP.defaultParams(), null)) syncInputs();
    });
    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? '继续' : '暂停';
      if (!paused) drawFrame();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      showErrors(['WebGL 上下文丢失，最后一帧已保留，等待恢复…']);
    });
    canvas.addEventListener('webglcontextrestored', () => { initGL(); showErrors([]); });
    window.addEventListener('resize', () => { if (!paused) drawFrame(); });
    loop();
  }

  boot();
})();

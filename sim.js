'use strict';
/*
 * 弹簧轨道门物理核心 —— 纯函数、固定步长、可确定性复现。
 * 不依赖 DOM，可在 Node 中直接测试。
 */
const SIM = {
  dt: 1 / 240,          // 固定物理步长 (s)
  g: 9.81,
  mass: 0.5,            // 小球质量 (kg)
  rampLength: 3.0,      // 轨道门长度 (m)
  springTravel: 1.0,    // 弹簧压缩行程 (m)
  ballRadius: 0.12,
  pivot: { x: 1.0, y: 2.0 },  // 轨道门铰接点（世界坐标, m）
  worldWidth: 30,       // 安全边界 (m)
  ambient: 25,          // 环境温度 (°C)
  heatFactor: 3.0,      // 阻尼耗散 -> 温升系数 (°C/J)
  cooling: 0.15,        // 自然冷却速率 (1/s)
  impactTime: 0.02,     // 着陆接触时间 (s)
  contactArea: 0.01,    // 着陆接触面积 (m^2)
  limits: {
    speed: 19,          // 速度上限 (m/s)
    load: 220,          // 弹簧负载上限 (N)，超过则轨道连接断开
    temp: 120,          // 温度上限 (°C)
    pressure: 36000,    // 着陆压力上限 (Pa)
  },
  zones: [
    { x0: 8,    x1: 10,   label: '收集区 A' },
    { x0: 15.5, x1: 17.5, label: '收集区 B' },
    { x0: 22.5, x1: 24.5, label: '收集区 C' },
  ],
  paramRanges: {
    k:     { min: 20, max: 300, def: 90,  label: '弹力 k (N/m)' },
    c:     { min: 0,  max: 6,   def: 0.5, label: '阻尼 c (N·s/m)' },
    angle: { min: 15, max: 65,  def: 45,  label: '门角度 (°)' },
  },
};

const FAULT_LABELS = {
  load: '弹簧连接过载断开',
  speed: '速度越限',
  temp: '温度越限',
  pressure: '着陆压力越限',
  oob: '越出安全边界',
  stuck: '球停在轨道上（阻尼过大/弹力不足）',
  miss: '未落入目标收集区',
};

function createRun(params, targetZone) {
  return {
    params: { k: params.k, c: params.c, angle: params.angle },
    targetZone,
    t: 0,
    phase: 'ramp',        // ramp -> flight -> done
    s: 0, v: 0,           // 沿轨道位置 / 速度
    x: 0, y: 0, vx: 0, vy: 0,
    springF: 0, dampF: 0,
    temp: SIM.ambient, pressure: 0,
    stuckTime: 0,
    fault: null,          // { type, label, t, x, y }
    result: null,         // 'zone' | 'miss' | 'fault'
    done: false,
    peaks: { speed: 0, load: 0, temp: SIM.ambient, pressure: 0 },
    frames: [],           // 每步记录，用于回放与轨迹绘制
  };
}

function ballPos(run) {
  if (run.phase === 'ramp') {
    const th = (run.params.angle * Math.PI) / 180;
    return {
      x: SIM.pivot.x + run.s * Math.cos(th),
      y: SIM.pivot.y + run.s * Math.sin(th),
    };
  }
  return { x: run.x, y: run.y };
}

function setFault(run, type) {
  const p = ballPos(run);
  run.fault = { type, label: FAULT_LABELS[type], t: run.t, x: p.x, y: p.y };
  run.result = 'fault';
  run.done = true;
}

function recordFrame(run) {
  const p = ballPos(run);
  const speed = run.phase === 'flight' ? Math.hypot(run.vx, run.vy) : run.v;
  run.frames.push({
    t: run.t, x: p.x, y: p.y,
    speed,
    load: run.springF,
    damp: run.dampF,
    temp: run.temp,
    pressure: run.pressure,
    phase: run.phase,
  });
  run.peaks.speed = Math.max(run.peaks.speed, speed);
  run.peaks.load = Math.max(run.peaks.load, run.springF);
  run.peaks.temp = Math.max(run.peaks.temp, run.temp);
  run.peaks.pressure = Math.max(run.peaks.pressure, run.pressure);
}

function stepRamp(run) {
  const dt = SIM.dt;
  const th = (run.params.angle * Math.PI) / 180;
  run.springF = run.s < SIM.springTravel
    ? run.params.k * (SIM.springTravel - run.s)
    : 0;
  run.dampF = run.params.c * run.v;
  const a = (run.springF - run.dampF) / SIM.mass - SIM.g * Math.sin(th);

  run.v += a * dt;
  if (run.v < 0) run.v = 0;
  run.s += run.v * dt;

  // 阻尼耗散 -> 温度；自然冷却
  run.temp += run.params.c * run.v * run.v * dt * SIM.heatFactor;
  run.temp += (SIM.ambient - run.temp) * SIM.cooling * dt;

  // 停住检测：速度为零且合力无法再推动
  if (run.v === 0 && run.s < SIM.rampLength && a <= 0) {
    run.stuckTime += dt;
  } else {
    run.stuckTime = 0;
  }

  // 限值检查（记录首个触发点）
  if (run.springF > SIM.limits.load) return setFault(run, 'load');
  if (run.v > SIM.limits.speed) return setFault(run, 'speed');
  if (run.temp > SIM.limits.temp) return setFault(run, 'temp');
  if (run.stuckTime > 0.5) return setFault(run, 'stuck');

  if (run.s >= SIM.rampLength) {
    const top = ballPos(run);
    run.phase = 'flight';
    run.x = top.x; run.y = top.y;
    run.vx = run.v * Math.cos(th);
    run.vy = run.v * Math.sin(th);
  }
}

function stepFlight(run) {
  const dt = SIM.dt;
  run.springF = 0;
  run.dampF = 0;
  run.vy -= SIM.g * dt;
  run.x += run.vx * dt;
  run.y += run.vy * dt;
  run.temp += (SIM.ambient - run.temp) * SIM.cooling * dt;

  const speed = Math.hypot(run.vx, run.vy);
  if (speed > SIM.limits.speed) return setFault(run, 'speed');
  if (run.x > SIM.worldWidth) return setFault(run, 'oob');

  if (run.y <= SIM.ballRadius) {
    run.y = SIM.ballRadius;
    run.pressure = (SIM.mass * Math.abs(run.vy)) / (SIM.impactTime * SIM.contactArea);
    if (run.pressure > SIM.limits.pressure) return setFault(run, 'pressure');
    const zi = SIM.zones.findIndex((z) => run.x >= z.x0 && run.x <= z.x1);
    run.landedX = run.x;
    run.landedZone = zi;
    run.result = zi === run.targetZone ? 'zone' : 'miss';
    if (run.result === 'miss') {
      const p = ballPos(run);
      run.fault = { type: 'miss', label: FAULT_LABELS.miss, t: run.t, x: p.x, y: p.y };
    }
    run.done = true;
  }
}

function stepRun(run) {
  if (run.done) return;
  run.t += SIM.dt;
  if (run.phase === 'ramp') stepRamp(run);
  else if (run.phase === 'flight') stepFlight(run);
  recordFrame(run);
}

// 便捷：直接跑到结束（用于测试与确定性校验）
function runToEnd(params, targetZone, maxSteps = 240 * 60) {
  const run = createRun(params, targetZone);
  let n = 0;
  while (!run.done && n < maxSteps) { stepRun(run); n += 1; }
  return run;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIM, FAULT_LABELS, createRun, stepRun, runToEnd, ballPos };
}

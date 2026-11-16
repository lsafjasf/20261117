/* 固定 seed 的世界生成：地形、温室舱、陨坑、岩石、检查点、风向表 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./prng.js'));
  } else root.LunarWorld = factory(root.LunarPRNG);
})(typeof self !== 'undefined' ? self : this, function (PRNG) {
  'use strict';

  const WORLD = {
    w: 2400, h: 1600,
    lander: { x: 180, y: 800, radius: 52 },
    podPositions: [
      { x: 760, y: 360 }, { x: 1480, y: 1180 }, { x: 2120, y: 480 }
    ],
    podRadius: 46,
    roverRadius: 16,
    roverDryMass: 40,
    cargoMass: 36,
    thrust: 14000,
    brakeForce: 26000,
    maxSpeed: 260,
    crashSpeed: 170,
    rimSlideSpeed: 140,
    batteryMax: 220,
  };

  const WAYPOINTS = [
    { x: 180, y: 800 }, { x: 520, y: 560 }, { x: 760, y: 360 },
    { x: 1120, y: 760 }, { x: 1480, y: 1180 }, { x: 1820, y: 820 },
    { x: 2120, y: 480 }, { x: 180, y: 800 }
  ];

  const CHECKPOINTS = [
    { id: 'cp0', x: 180, y: 800, label: '着陆器' },
    { id: 'cp1', x: 520, y: 560, label: '一号中继点' },
    { id: 'cp2', x: 1120, y: 760, label: '二号中继点' },
    { id: 'cp3', x: 1820, y: 820, label: '三号中继点' },
    { id: 'cp4', x: 180, y: 800, label: '返航着陆器' }
  ];

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  function nearRoute(x, y, margin) {
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      const a = WAYPOINTS[i], b = WAYPOINTS[i + 1];
      if (distToSegment(x, y, a.x, a.y, b.x, b.y) < margin) return true;
    }
    return false;
  }

  function nearPoint(x, y, pts, margin) {
    return pts.some(p => Math.hypot(p.x - x, p.y - y) < margin);
  }

  function buildWorld(seed) {
    const rng = PRNG.mulberry32(seed);
    const obstacles = [];
    const important = [WORLD.lander, ...WORLD.podPositions, ...CHECKPOINTS];

    const craters = [];
    let guard = 0;
    while (craters.length < 5 && guard++ < 400) {
      const c = {
        id: 'crater' + craters.length,
        order: obstacles.length,
        kind: 'crater',
        x: rng.range(160, WORLD.w - 160),
        y: rng.range(140, WORLD.h - 140),
        radius: rng.range(70, 120)
      };
      if (nearRoute(c.x, c.y, c.radius + 70)) continue;
      if (nearPoint(c.x, c.y, important, c.radius + 90)) continue;
      if (craters.some(o => Math.hypot(o.x - c.x, o.y - c.y) < o.radius + c.radius + 60)) continue;
      craters.push(c);
      obstacles.push(c);
    }

    const rocks = [];
    guard = 0;
    while (rocks.length < 12 && guard++ < 500) {
      const r = {
        id: 'rock' + rocks.length,
        order: obstacles.length,
        kind: 'rock',
        x: rng.range(120, WORLD.w - 120),
        y: rng.range(120, WORLD.h - 120),
        radius: rng.range(12, 26)
      };
      if (nearRoute(r.x, r.y, r.radius + 46)) continue;
      if (nearPoint(r.x, r.y, important, r.radius + 60)) continue;
      if (craters.some(c => Math.hypot(c.x - r.x, c.y - r.y) < c.radius + r.radius + 30)) continue;
      if (rocks.some(o => Math.hypot(o.x - r.x, o.y - r.y) < o.radius + r.radius + 40)) continue;
      rocks.push(r);
      obstacles.push(r);
    }

    // 确定性风向表：每 6~10 秒切换一次，角度与强度均由 PRNG 决定
    const windSchedule = [];
    let t = 0;
    while (t < 1800) {
      const dur = rng.range(6, 10);
      windSchedule.push({
        t0: t, t1: t + dur,
        angle: rng.range(0, Math.PI * 2),
        strength: rng.range(4, 22)
      });
      t += dur;
    }

    // 月尘底色纹理点（仅视觉，渲染层另用独立 PRNG，不参与模拟存档）
    const dustPatches = [];
    for (let i = 0; i < 26; i++) {
      dustPatches.push({
        x: rng.range(0, WORLD.w), y: rng.range(0, WORLD.h),
        r: rng.range(30, 90), shade: rng.range(-10, 10)
      });
    }

    return {
      seed: typeof seed === 'string' ? seed : String(seed),
      rngState: rng.getState(),
      config: WORLD,
      waypoints: WAYPOINTS,
      checkpoints: CHECKPOINTS.map(c => ({ ...c, visited: false })),
      pods: WORLD.podPositions.map((p, i) => ({
        id: 'pod' + i, x: p.x, y: p.y, radius: WORLD.podRadius,
        delivered: false
      })),
      lander: { ...WORLD.lander },
      craters, rocks, obstacles,
      windSchedule, dustPatches
    };
  }

  function windAt(world, time) {
    const sched = world.windSchedule;
    for (let i = 0; i < sched.length; i++) {
      if (time >= sched[i].t0 && time < sched[i].t1) return sched[i];
    }
    return sched[sched.length - 1];
  }

  return { buildWorld, windAt, WORLD, WAYPOINTS, CHECKPOINTS };
});

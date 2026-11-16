/*
 * engine.js - 风塔轨道检修吊篮：确定性模拟引擎（UMD，浏览器/Node 通用）
 * 所有随机量只在开局由 seed 生成，运行期不再使用随机数，保证同 seed 完全可复现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WindmillEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var DT = 1 / 30;
  var TOWER_H = 100;
  var BASE_KITS = 3;
  var KIT_KG = 20;
  var GONDOLA_KG = 40;
  var MAX_KITS = 3;

  var MOTOR_ACCEL = 7.0;
  var MAX_SPEED = 4.2;
  var BRAKE_DECEL = 9.0;
  var SAIL_DRAG = 0.24;
  var CENTER_SPRING = 1.6;
  var ICE_SPRING = 0.5;
  var SWAY_DAMP = 1.4;
  var ICE_DELAY = 2.4;
  var COLLISION_X = 1.1;
  var PIN_X = 1.8;
  var INSPECT_X = 0.55;
  var INSPECT_TOL = 1.0;
  var BLADE_HAZARD = 3.5;
  var INSPECT_TIME = 1.6;
  var INSPECT_BATTERY = 4.0;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var FAILURE = {
    COLLISION: 'collision',
    STRANDED: 'stranded',
    BATTERY: 'battery',
    FELL: 'fell'
  };

  var FAILURE_TEXT = {
    collision: '吊篮摆动过大，与叶片根部发生碰撞',
    stranded: '轨道结冰锁死制动，强风将吊篮推离轨道搁浅',
    battery: '电量耗尽，吊篮悬停无法动作',
    fell: '制动失效，吊篮冲顶失控'
  };

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  /* 地图仅依赖 seed：叶片检查点、结冰区间、阵风时间表全部确定生成 */
  function generateMap(seed) {
    var rng = mulberry32(seed);
    var blades = [28 + rng() * 6, 54 + rng() * 6, 80 + rng() * 6].map(round3);

    var zones = [];
    var count = 2 + Math.floor(rng() * 2);
    var guard = 0;
    while (zones.length < count && guard++ < 40) {
      var lo = 8 + rng() * 82;
      var hi = Math.min(TOWER_H - 1, lo + 3 + rng() * 4);
      var overlapsBlade = blades.some(function (b) {
        return b > lo - 3 && b < hi + 3;
      });
      var overlapsZone = zones.some(function (z) {
        return lo < z.hi + 1.5 && hi > z.lo - 1.5;
      });
      if (!overlapsBlade && !overlapsZone) zones.push({ lo: round3(lo), hi: round3(hi) });
    }
    zones.sort(function (a, b) { return a.lo - b.lo; });

    var gusts = [];
    for (var i = 0; i < 5; i++) {
      gusts.push({
        t: round3(4 + i * 9 + rng() * 3),
        dur: round3(2.4 + rng() * 1.4),
        dir: rng() > 0.5 ? 1 : -1,
        amp: round3(2.8 + rng() * 2.0)
      });
    }

    return { seed: seed >>> 0, blades: blades, iceZones: zones, gusts: gusts };
  }

  /* 调试/测试用：追加一段由场景 key 派生的确定性阵风，不影响普通地图复现 */
  function addScriptedGust(map, t, dur, dir, amp) {
    map.gusts.push({ t: round3(t), dur: round3(dur), dir: dir, amp: round3(amp), scripted: true });
    map.gusts.sort(function (a, b) { return a.t - b.t; });
    return map;
  }

  function windAt(map, t, y) {
    var base = 0.3 + 0.011 * y;
    var gust = 0;
    for (var i = 0; i < map.gusts.length; i++) {
      var g = map.gusts[i];
      if (t >= g.t && t <= g.t + g.dur) {
        var phase = ((t - g.t) / g.dur) * Math.PI;
        gust = Math.sin(phase) * g.amp * g.dir;
      }
    }
    return base + gust;
  }

  function inIce(map, y) {
    return map.iceZones.some(function (z) {
      return y >= z.lo && y <= z.hi;
    });
  }

  function nearestBladeIndex(map, y) {
    var best = -1;
    var bestD = Infinity;
    map.blades.forEach(function (b, i) {
      var d = Math.abs(b - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= INSPECT_TOL ? best : -1;
  }

  function createGame(seed) {
    seed = (seed === undefined ? 1 : seed) >>> 0;
    var map = generateMap(seed);
    return {
      v: VERSION,
      seed: seed,
      map: map,
      t: 0,
      y: 0,
      vy: 0,
      x: 0,
      vx: 0,
      battery: 100,
      brake: 100,
      kits: MAX_KITS,
      spareKits: BASE_KITS - MAX_KITS,
      inspected: [false, false, false],
      inspectTimer: 0,
      inspecting: false,
      iceTimer: 0,
      iceLocked: false,
      iceCooldown: -1,
      status: 'running',
      failure: null,
      lastFailure: null,
      paused: false,
      checkpoint: null,
      ticks: 0
    };
  }

  /*
   * 一局可重复的调试场景（固定 seed + 确定性脚本阵风）：
   * normal 走完整路线；collision 在第一叶片根部安排强阵风；
   * strand 在第一段结冰区安排持续横风，静止启动必搁浅。
   */
  function createDebugGame(seed, scenario) {
    var s = createGame(seed);
    s.scenario = scenario || 'normal';
    if (scenario === 'collision') {
      var b = s.map.blades[0];
      var travel = b / MAX_SPEED;
      addScriptedGust(s.map, round3(travel - 1.5), 8.0, 1, 10.0);
    } else if (scenario === 'strand') {
      var z = s.map.iceZones[0];
      addScriptedGust(s.map, round3(z.lo / MAX_SPEED + 0.6),
        ICE_DELAY + 5.0, 1, 7.0);
    }
    return s;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function loadFactor(s) {
    return (GONDOLA_KG + s.kits * KIT_KG) / GONDOLA_KG;
  }

  function fail(s, reason) {
    s.status = 'failed';
    s.failure = reason;
    s.lastFailure = reason;
    s.inspecting = false;
    return s;
  }

  function step(s, input) {
    if (s.status !== 'running' || s.paused) return s;
    input = input || {};
    var throttle = input.throttle || 0;
    var braking = !!input.brake;
    var lf = loadFactor(s);
    s.ticks++;
    s.t = round3(s.t + DT);

    if (input.loadKit && s.y < 2 && s.kits < MAX_KITS && s.spareKits > 0) {
      s.kits++;
      s.spareKits--;
    }
    if (input.unloadKit && s.y < 2 && s.kits > 0) {
      s.kits--;
      s.spareKits++;
    }

    var icyZone = -1;
    s.map.iceZones.forEach(function (z, i) {
      if (s.y >= z.lo && s.y <= z.hi) icyZone = i;
    });
    var icy = icyZone >= 0;
    if (!icy) s.iceCooldown = -1;
    if (icy && !s.iceLocked && s.iceCooldown !== icyZone &&
        Math.abs(s.vy) < 0.15 && throttle !== 0) {
      s.iceLocked = true;
      s.iceTimer = ICE_DELAY;
      s.iceCooldown = icyZone;
    }
    if (s.iceLocked) {
      s.iceTimer = round3(s.iceTimer - DT);
      if (s.iceTimer <= 0) {
        s.iceLocked = false;
        s.iceTimer = 0;
      }
    }

    var ay = 0;
    if (!s.iceLocked) {
      if (throttle > 0) ay += (MOTOR_ACCEL * throttle) / lf;
      if (throttle < 0) ay += (MOTOR_ACCEL * throttle) / lf;
      if (braking) {
        var brakeForce = BRAKE_DECEL / lf;
        if (Math.abs(s.vy) <= brakeForce * DT) {
          s.vy = 0;
        } else {
          ay += -Math.sign(s.vy) * brakeForce;
        }
        if (Math.abs(s.vy) > 2) s.brake = Math.max(0, s.brake - 2.5 * DT);
      }
    }
    s.vy += ay * DT;
    if (!braking && !s.iceLocked) s.vy *= 0.995;
    s.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, s.vy));
    if (s.iceLocked) s.vy = 0;
    s.y = round3(Math.max(0, Math.min(TOWER_H, s.y + s.vy * DT)));
    if ((s.y === 0 && s.vy < 0) || (s.y >= TOWER_H && s.vy > 0)) s.vy = 0;

    var wind = windAt(s.map, s.t, s.y);
    var spring = s.iceLocked ? ICE_SPRING : CENTER_SPRING;
    var ax = wind * SAIL_DRAG - spring * s.x - SWAY_DAMP * s.vx;
    s.vx += ax * DT;
    s.x = round3(s.x + s.vx * DT);

    s.battery = Math.max(0, s.battery -
      (throttle !== 0 ? 0.8 : 0.03) * DT);

    var near = nearestBladeIndex(s.map, s.y);
    var hazardBlade = -1;
    for (var bi = 0; bi < s.map.blades.length; bi++) {
      if (!s.inspected[bi] &&
          Math.abs(s.y - s.map.blades[bi]) < BLADE_HAZARD) {
        hazardBlade = bi;
        break;
      }
    }
    if (hazardBlade >= 0 && Math.abs(s.x) >= COLLISION_X) {
      return fail(s, FAILURE.COLLISION);
    }
    if (s.iceLocked && Math.abs(s.x) >= PIN_X) {
      return fail(s, FAILURE.STRANDED);
    }
    if (s.battery <= 0) {
      return fail(s, FAILURE.BATTERY);
    }
    if (s.brake <= 0 && s.y >= TOWER_H - 1 && s.vy >= 0) {
      return fail(s, FAILURE.FELL);
    }

    s.inspecting = false;
    if (input.inspect && near >= 0 && !s.inspected[near] &&
        Math.abs(s.x) <= INSPECT_X && Math.abs(s.vy) < 0.4 && s.kits > 0) {
      s.inspecting = true;
      s.inspectTimer += DT;
      if (s.inspectTimer >= INSPECT_TIME) {
        s.inspected[near] = true;
        s.inspectTimer = 0;
        s.inspecting = false;
        s.battery = Math.max(0, s.battery - INSPECT_BATTERY);
        s.checkpoint = snapshot(s);
      }
    } else if (!s.inspecting) {
      s.inspectTimer = 0;
    }

    if (s.inspected.every(Boolean) && s.y < 2) {
      s.status = 'won';
    }
    return s;
  }

  function snapshot(s) {
    var c = clone(s);
    c.checkpoint = null;
    return c;
  }

  function resumeFromCheckpoint(s) {
    if (!s.checkpoint) return null;
    var restored = clone(s.checkpoint);
    restored.checkpoint = clone(s.checkpoint);
    restored.lastFailure = s.lastFailure || s.failure;
    restored.failure = null;
    restored.status = 'running';
    return restored;
  }

  function serialize(s) {
    return JSON.stringify(s);
  }

  function deserialize(text) {
    var s = typeof text === 'string' ? JSON.parse(text) : clone(text);
    if (s.v !== VERSION || !s.map || !Array.isArray(s.inspected)) {
      throw new Error('存档版本或结构不兼容');
    }
    return s;
  }

  return {
    VERSION: VERSION,
    DT: DT,
    TOWER_H: TOWER_H,
    FAILURE: FAILURE,
    FAILURE_TEXT: FAILURE_TEXT,
    mulberry32: mulberry32,
    generateMap: generateMap,
    addScriptedGust: addScriptedGust,
    windAt: windAt,
    inIce: inIce,
    nearestBladeIndex: nearestBladeIndex,
    createGame: createGame,
    createDebugGame: createDebugGame,
    step: step,
    snapshot: snapshot,
    resumeFromCheckpoint: resumeFromCheckpoint,
    serialize: serialize,
    deserialize: deserialize,
    loadFactor: loadFactor,
    constants: {
      BASE_KITS: BASE_KITS,
      KIT_KG: KIT_KG,
      GONDOLA_KG: GONDOLA_KG,
      MAX_KITS: MAX_KITS,
      ICE_DELAY: ICE_DELAY,
      COLLISION_X: COLLISION_X,
      PIN_X: PIN_X
    }
  };
});

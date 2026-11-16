/* 月球运输车模拟引擎：纯逻辑、固定步长、可序列化，浏览器与 Node 共用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./world.js'));
  } else root.LunarEngine = factory(root.LunarWorld);
})(typeof self !== 'undefined' ? self : this, function (LunarWorld) {
  'use strict';

  const { buildWorld, windAt, WORLD } = LunarWorld;
  const FIXED_DT = 1 / 60;
  const SAVE_VERSION = 1;

  function createGame(seed) {
    const world = buildWorld(seed);
    const game = {
      version: SAVE_VERSION,
      seed: world.seed,
      world,
      time: 0,
      status: 'playing', // playing | won | failed
      paused: false,
      lastFailure: null,
      rover: {
        x: world.lander.x, y: world.lander.y,
        vx: 0, vy: 0, heading: -Math.PI / 2,
        air: 0, deepCraterTime: 0, throttle: 0, brake: 0
      },
      battery: WORLD.batteryMax,
      cargo: { water: 3, seeds: 3, capacity: 3 },
      delivered: { water: 0, seeds: 0 },
      log: [{ t: 0, msg: '任务开始：向三个温室舱运送水箱与种子' }],
      checkpoints: world.checkpoints.map(c => ({ ...c })),
      checkpointSnapshots: [],
      lastCheckpointId: 'cp0',
      stats: { distance: 0, bounces: 0, deliveries: 0 }
    };
    game.checkpoints[0].visited = true;
    game.checkpointSnapshots.push(snapshot(game, 'cp0'));
    return game;
  }

  function roverMass(s) {
    return WORLD.roverDryMass + (s.cargo.water + s.cargo.seeds) * 6;
  }

  function brakingDistance(s, speed) {
    const mass = roverMass(s);
    const decel = WORLD.brakeForce / mass;
    return (speed * speed) / (2 * decel);
  }

  function speed(s) {
    return Math.hypot(s.rover.vx, s.rover.vy);
  }

  function fail(s, reason, detail) {
    if (s.status !== 'playing') return;
    s.status = 'failed';
    s.lastFailure = { reason, detail: detail || reason, t: s.time };
    s.log.push({ t: s.time, msg: '失败：' + reason });
  }

  function snapshot(s, cpId) {
    return JSON.parse(JSON.stringify({
      cpId, time: s.time, rover: s.rover, battery: s.battery,
      cargo: s.cargo, delivered: s.delivered, status: s.status,
      lastFailure: s.lastFailure, stats: s.stats,
      pods: s.world.pods, checkpoints: s.checkpoints,
      log: s.log
    }));
  }

  function applySnapshot(s, snap) {
    s.time = snap.time;
    s.rover = JSON.parse(JSON.stringify(snap.rover));
    s.battery = snap.battery;
    s.cargo = JSON.parse(JSON.stringify(snap.cargo));
    s.delivered = JSON.parse(JSON.stringify(snap.delivered));
    s.status = snap.status;
    s.lastFailure = snap.lastFailure ? { ...snap.lastFailure } : null;
    s.stats = JSON.parse(JSON.stringify(snap.stats));
    s.world.pods = JSON.parse(JSON.stringify(snap.pods));
    s.checkpoints = JSON.parse(JSON.stringify(snap.checkpoints));
    s.log = JSON.parse(JSON.stringify(snap.log));
    s.paused = false;
  }

  function continueFromCheckpoint(s) {
    const snap = s.checkpointSnapshots.find(x => x.cpId === s.lastCheckpointId);
    if (!snap) return false;
    applySnapshot(s, snap);
    s.log.push({ t: s.time, msg: '从检查点「' + snap.cpId + '」恢复' });
    return true;
  }

  function restart(s) {
    const fresh = createGame(s.seed);
    Object.keys(s).forEach(k => delete s[k]);
    Object.assign(s, fresh);
    return s;
  }

  function saveState(s) {
    return JSON.stringify({ saveVersion: SAVE_VERSION, state: s });
  }

  function loadState(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data.saveVersion !== SAVE_VERSION) throw new Error('存档版本不兼容');
    return JSON.parse(JSON.stringify(data.state));
  }

  return {
    createGame, stepFixed, step, restart, continueFromCheckpoint,
    saveState, loadState, roverMass, brakingDistance, speed,
    autopilotInput, FIXED_DT, SAVE_VERSION
  };

  function step(s, dt, input) {
    if (s.paused || s.status !== 'playing') return s;
    const h = FIXED_DT;
    let acc = Math.min(dt, 0.1);
    while (acc > 0) {
      const d = Math.min(h, acc);
      stepFixed(s, d, input);
      acc -= d;
      if (s.status !== 'playing') break;
    }
    return s;
  }

  function stepFixed(s, dt, input) {
    if (s.paused || s.status !== 'playing') return s;
    const r = s.rover, cfg = WORLD;
    input = input || {};
    s.time += dt;
    const mass = roverMass(s);
    const wind = windAt(s.world, s.time);

    let throttle = Math.max(0, Math.min(1, input.throttle || 0));
    const brake = input.brake ? 1 : 0;
    const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    r.throttle = throttle; r.brake = brake;

    // 低重力下转向偏慢，跳跃中转向进一步衰减
    r.heading += turn * 2.2 * dt * (r.air > 0 ? 0.35 : 1);

    const accel = (cfg.thrust * throttle) / mass;
    r.vx += Math.cos(r.heading) * accel * dt;
    r.vy += Math.sin(r.heading) * accel * dt;

    if (brake) {
      const decel = (cfg.brakeForce / mass) * dt;
      const v = speed(s);
      if (v > 0) {
        const k = Math.max(0, 1 - decel / v);
        r.vx *= k; r.vy *= k;
      }
    }

    // 风扰与月尘滚动阻力
    r.vx += Math.cos(wind.angle) * wind.strength * 0.32 * dt;
    r.vy += Math.sin(wind.angle) * wind.strength * 0.32 * dt;
    const drag = Math.exp(-0.32 * dt);
    r.vx *= drag; r.vy *= drag;

    const v = speed(s);
    if (v > cfg.maxSpeed) {
      r.vx *= cfg.maxSpeed / v; r.vy *= cfg.maxSpeed / v;
    }

    const px = r.x, py = r.y;
    r.x += r.vx * dt; r.y += r.vy * dt;
    r.x = Math.max(12, Math.min(cfg.w - 12, r.x));
    r.y = Math.max(12, Math.min(cfg.h - 12, r.y));
    s.stats.distance += Math.hypot(r.x - px, r.y - py);

    handleCraters(s);
    if (s.status !== 'playing') return s;
    handleRocks(s);
    if (s.status !== 'playing') return s;

    if (r.air > 0) r.air = Math.max(0, r.air - dt);

    // 电量：行驶/制动/怠速消耗，回到着陆器可充电
    const atLander = Math.hypot(r.x - s.world.lander.x, r.y - s.world.lander.y)
      < s.world.lander.radius;
    if (atLander) {
      s.battery = Math.min(cfg.batteryMax, s.battery + 12 * dt);
    } else {
      s.battery -= (0.55 + 1.1 * throttle + 0.4 * brake) * dt;
    }
    if (s.battery <= 0) {
      s.battery = 0;
      fail(s, '电量耗尽，无法返回着陆器');
      return s;
    }

    handleDelivery(s);
    handleCheckpoints(s);
    handleWin(s);
    return s;
  }

  function handleCraters(s) {
    const r = s.rover;
    let insideDeep = false;
    for (const c of s.world.craters) {
      const d = Math.hypot(r.x - c.x, r.y - c.y);
      const v = speed(s);
      if (d > c.radius + WORLD.roverRadius) {
        continue;
      }
      if (d > c.radius - 14) {
        // 陨坑边缘：高速经过触发滑坡
        if (v > WORLD.rimSlideSpeed) {
          fail(s, '陨坑边缘滑坡（' + c.id + '）',
            '以 ' + v.toFixed(0) + ' u/s 高速越过坑缘，触发滑坡');
          return;
        }
        r.air = Math.max(r.air, 0.45);
        s.stats.bounces++;
      } else {
        // 坑内：低重力陷坑，长时停留即搁浅
        insideDeep = true;
        r.deepCraterTime += FIXED_DT;
        r.vx *= 0.985; r.vy *= 0.985;
        if (r.deepCraterTime > 4) {
          fail(s, '陷入陨坑松软月尘而搁浅（' + c.id + '）');
          return;
        }
      }
    }
    if (!insideDeep) r.deepCraterTime = 0;
  }

  function handleRocks(s) {
    const r = s.rover;
    for (const rock of s.world.rocks) {
      const dx = r.x - rock.x, dy = r.y - rock.y;
      const minD = rock.radius + WORLD.roverRadius;
      const d = Math.hypot(dx, dy);
      if (d >= minD) continue;
      const nx = d > 0 ? dx / d : 1, ny = d > 0 ? dy / d : 0;
      r.x = rock.x + nx * minD; r.y = rock.y + ny * minD;
      const vn = r.vx * nx + r.vy * ny;
      const impact = Math.abs(vn);
      if (vn < 0) {
        r.vx -= (1 + 0.55) * vn * nx; // 低重力弹性反弹
        r.vy -= (1 + 0.55) * vn * ny;
        r.air = Math.max(r.air, 0.35);
        s.stats.bounces++;
      }
      if (impact > WORLD.crashSpeed) {
        fail(s, '与岩石 ' + rock.id + ' 高速碰撞',
          '撞击速度 ' + impact.toFixed(0) + ' u/s，超过结构阈值 '
          + WORLD.crashSpeed + ' u/s');
        return;
      }
    }
  }

  function handleDelivery(s) {
    const r = s.rover;
    for (const pod of s.world.pods) {
      if (pod.delivered) continue;
      if (Math.hypot(r.x - pod.x, r.y - pod.y) > pod.radius + WORLD.roverRadius) continue;
      if (s.cargo.water > 0 && s.cargo.seeds > 0) {
        s.cargo.water--; s.cargo.seeds--;
        s.delivered.water++; s.delivered.seeds++;
        pod.delivered = true;
        s.stats.deliveries++;
        s.log.push({ t: s.time, msg: pod.id + ' 已收到水箱与种子' });
      } else {
        s.log.push({ t: s.time, msg: pod.id + ' 缺货：剩余水箱/种子不足' });
      }
    }
  }

  function handleCheckpoints(s) {
    const r = s.rover;
    for (const cp of s.checkpoints) {
      if (Math.hypot(r.x - cp.x, r.y - cp.y) > 56) continue;
      if (!cp.visited) {
        cp.visited = true;
        s.lastCheckpointId = cp.id;
        const snap = snapshot(s, cp.id);
        s.checkpointSnapshots = s.checkpointSnapshots.filter(x => x.cpId !== cp.id);
        s.checkpointSnapshots.push(snap);
        s.log.push({ t: s.time, msg: '抵达检查点：' + cp.label });
      }
    }
  }

  function handleWin(s) {
    const allDelivered = s.world.pods.every(p => p.delivered);
    if (!allDelivered) return;
    const r = s.rover;
    const atLander = Math.hypot(r.x - s.world.lander.x, r.y - s.world.lander.y)
      < s.world.lander.radius;
    if (atLander) {
      s.status = 'won';
      s.log.push({ t: s.time, msg: '全部舱室补给完成，已安全返回着陆器' });
    }
  }

  // 脚本化驾驶：沿规划航点行驶，可指定目标航点与速度上限
  function autopilotInput(s, targetIndex, maxThrottle) {
    const wp = s.world.waypoints[targetIndex];
    const r = s.rover;
    let tx = wp.x, ty = wp.y, d = Math.hypot(tx - r.x, ty - r.y);
    let desired = Math.atan2(ty - r.y, tx - r.x);

    // 陨坑绕行：靠近坑缘时取切线方向，并强制减速防止滑坡/搁浅
    let hazard = null;
    for (const c of s.world.craters) {
      const cd = Math.hypot(r.x - c.x, r.y - c.y);
      if (cd < c.radius + 90) {
        if (!hazard || cd < Math.hypot(r.x - hazard.x, r.y - hazard.y)) hazard = c;
      }
    }
    let avoiding = false;
    if (hazard) {
      const hd = Math.hypot(r.x - hazard.x, r.y - hazard.y);
      const ang = Math.atan2(r.y - hazard.y, r.x - hazard.x);
      desired = ang + (Math.cos(ang) * (wp.x - hazard.x)
        + Math.sin(ang) * (wp.y - hazard.y) >= 0 ? 1 : -1) * Math.PI / 2;
      avoiding = hd < hazard.radius + 70;
      d = 100;
    }

    let diff = desired - r.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const v = speed(s);
    const stopDist = brakingDistance(s, v);
    const cap = maxThrottle || 1;
    const slowForTurn = avoiding ? 0.2
      : Math.abs(diff) > 0.5 ? 0.25 : Math.abs(diff) > 0.2 ? 0.55 : cap;
    const throttle = d > stopDist + 24 ? Math.min(cap, slowForTurn) : 0;
    return {
      throttle,
      brake: (!avoiding && d <= stopDist + 24 && v > 8) || (avoiding && v > 120) ? 1 : 0,
      left: diff > 0.08 ? 1 : 0,
      right: diff < -0.08 ? 1 : 0
    };
  }
});

/* Buoy cable repair game: deterministic core simulation (UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BuoyGame = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const WORLD = { W: 1000, H: 700 };
  const CONFIG = {
    DT: 1 / 30,
    BOAT: { r: 12, maxForce: 62, drag: 0.95, maxSpeed: 96, turnRate: 2.8 },
    MARKER_WEIGHT: 0.16,
    MAX_MARKERS: 5,
    FUEL_MAX: 160,
    FUEL_RATE: 0.8,
    SHALLOW_MAX_THRUST: 0.35,
    SHALLOW_DEPTH: 5,
    DRAFT: 2.2,
    BUOY_RANGE: 48,
    DOCK_RANGE: 40,
    WIND_LEEWAY: 0.14,
    CURRENT_PUSH: 0.55,
    MAX_CHECKPOINTS: 20,
    MAX_EVENTS: 120
  };

  function Rng(seed) {
    this.state = seed >>> 0;
  }
  Rng.prototype.next = function () {
    let a = this.state;
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.state = a >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.range = function (lo, hi) {
    return lo + this.next() * (hi - lo);
  };

  const TAU = Math.PI * 2;

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function clearOfObjectives(x, y, r, world) {
    const d = world.dock;
    if (dist(x, y, d.x, d.y) < d.r + r + 55) return false;
    for (const cable of world.cables) {
      if (dist(x, y, cable.buoy.x, cable.buoy.y) < r + 52) return false;
      if (dist(x, y, cable.x, cable.y) < r + cable.len / 2 + 18) return false;
    }
    for (const rock of world.rocks) {
      if (dist(x, y, rock.x, rock.y) < r + rock.r + 14) return false;
    }
    return true;
  }

  function generateWorld(seed) {
    const rng = new Rng((seed >>> 0) || 1);
    const world = {
      version: VERSION,
      seed: seed >>> 0,
      W: WORLD.W,
      H: WORLD.H,
      dock: { x: 58, y: WORLD.H / 2, r: 26 },
      cables: [],
      rocks: [],
      shallows: [],
      currents: [],
      obstacles: [],
      baseCurrent: null,
      wind: null
    };
    const bands = [130, 350, 570];
    for (let i = 0; i < 3; i++) {
      const x = 440 + rng.next() * 240;
      const y = bands[i] + rng.range(-36, 36);
      const angle = rng.next() * Math.PI;
      const len = 130 + rng.next() * 50;
      const buoy = { x: x - 95, y: y + rng.range(-28, 28), r: 10 };
      world.cables.push({
        id: i, x, y, angle, len, buoy,
        marked: false, markerId: null
      });
    }
    for (let i = 0; i < 6; i++) {
      let placed = null;
      for (let t = 0; t < 24; t++) {
        const x = 170 + rng.next() * 770;
        const y = 60 + rng.next() * 580;
        const r = 12 + rng.next() * 10;
        if (clearOfObjectives(x, y, r, world)) {
          placed = { x, y, r };
          break;
        }
      }
      if (placed) {
        placed.id = world.rocks.length;
        placed.kind = 'rock';
        placed.order = world.obstacles.length;
        world.rocks.push(placed);
        world.obstacles.push(placed);
      }
    }
    for (let i = 0; i < 3; i++) {
      let placed = null;
      for (let t = 0; t < 60; t++) {
        const fallback = t >= 36;
        const x = 250 + rng.next() * 650;
        const y = 90 + rng.next() * 520;
        const r = fallback ? 46 + rng.next() * 26 : 70 + rng.next() * 42;
        const strength = fallback
          ? rng.range(6.5, 8.2)
          : rng.range(8.5, 11.5);
        let ok = dist(x, y, world.dock.x, world.dock.y) > r + 70;
        for (const cable of world.cables) {
          if (dist(x, y, cable.buoy.x, cable.buoy.y) < r + 62) ok = false;
          if (dist(x, y, cable.x, cable.y) < r + cable.len / 2 + 30) ok = false;
        }
        if (ok) {
          placed = { x, y, r, strength };
          break;
        }
      }
      if (placed) {
        placed.id = world.shallows.length;
        placed.kind = 'shallow';
        placed.order = world.obstacles.length;
        world.shallows.push(placed);
        world.obstacles.push(placed);
      }
    }
    for (let i = 0; i < 3; i++) {
      world.currents.push({
        x: 200 + rng.next() * 650,
        y: 80 + rng.next() * 540,
        r: 90 + rng.next() * 70,
        angle: rng.next() * TAU,
        strength: 14 + rng.next() * 16
      });
    }
    world.baseCurrent = {
      angle: rng.next() * TAU,
      strength: 7 + rng.next() * 8
    };
    world.wind = {
      baseAngle: rng.next() * TAU,
      strength: 9 + rng.next() * 10,
      swing: 0.5 + rng.next() * 0.9,
      period: 18 + rng.next() * 14
    };
    return world;
  }

  function depthAt(world, x, y) {
    let depth = 10;
    for (const s of world.shallows) {
      const dx = x - s.x;
      const dy = y - s.y;
      const sigma = s.r * 0.6;
      depth -= s.strength * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
    return depth;
  }

  function pointAtDepth(world, minDepth, maxDepth) {
    for (const s of world.shallows) {
      for (let rad = 0; rad <= s.r; rad += 4) {
        const x = s.x + rad;
        const y = s.y;
        const d = depthAt(world, x, y);
        if (d >= minDepth && d <= maxDepth) return { x, y, depth: d };
      }
    }
    return null;
  }

  function currentAt(world, x, y) {
    let fx = Math.cos(world.baseCurrent.angle) * world.baseCurrent.strength;
    let fy = Math.sin(world.baseCurrent.angle) * world.baseCurrent.strength;
    for (const z of world.currents) {
      const d = dist(x, y, z.x, z.y);
      const falloff = Math.max(0, 1 - d / z.r);
      const f = z.strength * falloff;
      fx += Math.cos(z.angle) * f;
      fy += Math.sin(z.angle) * f;
    }
    return { fx, fy };
  }

  function windAt(world, t) {
    const angle = world.wind.baseAngle +
      Math.sin((TAU * t) / world.wind.period) * world.wind.swing;
    return {
      angle,
      fx: Math.cos(angle) * world.wind.strength,
      fy: Math.sin(angle) * world.wind.strength
    };
  }

  class Game {
    constructor(seed) {
      this.reset(seed === undefined ? 1 : seed);
    }

    reset(seed) {
      const s = (seed === undefined ? (this.world ? this.world.seed : 1) : seed) >>> 0;
      this.world = generateWorld(s);
      this.rng = new Rng((s ^ 0x9e3779b9) >>> 0);
      this.boat = {
        x: this.world.dock.x,
        y: this.world.dock.y,
        heading: 0,
        vx: 0,
        vy: 0,
        thrust: 0
      };
      this.time = 0;
      this.fuel = CONFIG.FUEL_MAX;
      this.markersLeft = CONFIG.MAX_MARKERS;
      this.status = 'running';
      this.lastFailure = null;
      this.failures = [];
      this.events = [];
      this.checkpoints = [];
      this.lastCheckpointId = -1;
      this.recoveryCount = 0;
      this.nearestBuoyId = null;
      this.inShallow = false;
      this.depth = depthAt(this.world, this.boat.x, this.boat.y);
      this._snapshot('init', '初始检查点（码头）');
      this._log('info', '任务开始：跟随浮标定位 3 处光缆');
      return this;
    }

    get markersPlaced() {
      return CONFIG.MAX_MARKERS - this.markersLeft;
    }

    get cablesMarked() {
      return this.world.cables.reduce((n, c) => n + (c.marked ? 1 : 0), 0);
    }

    get loadFactor() {
      return this.markersLeft * CONFIG.MARKER_WEIGHT;
    }

    get wind() {
      return windAt(this.world, this.time);
    }

    get current() {
      return currentAt(this.world, this.boat.x, this.boat.y);
    }

    steerToward(tx, ty) {
      const want = Math.atan2(ty - this.boat.y, tx - this.boat.x);
      let diff = want - this.boat.heading;
      while (diff > Math.PI) diff -= TAU;
      while (diff < -Math.PI) diff += TAU;
      const step = clamp(diff, -CONFIG.BOAT.turnRate * CONFIG.DT,
        CONFIG.BOAT.turnRate * CONFIG.DT);
      this.boat.heading += step;
      return Math.abs(diff);
    }

    step(thrust) {
      if (this.status !== 'running') return this.status;
      const b = this.boat;
      const depth = depthAt(this.world, b.x, b.y);
      this.depth = depth;
      this.inShallow = depth < CONFIG.SHALLOW_DEPTH;

      let t = clamp(thrust, 0, 1);
      if (this.inShallow && t > CONFIG.SHALLOW_MAX_THRUST) {
        t = CONFIG.SHALLOW_MAX_THRUST;
        if (thrust > CONFIG.SHALLOW_MAX_THRUST + 0.001) {
          this._log('warn', '浅水区：大推力被限制为 35%');
        }
      }
      b.thrust = t;

      if (depth <= CONFIG.DRAFT) {
        return this._fail('grounded',
          `搁浅：水深 ${depth.toFixed(1)}m 小于吃水 ${CONFIG.DRAFT}m`);
      }
      for (const rock of this.world.rocks) {
        if (dist(b.x, b.y, rock.x, rock.y) < rock.r + CONFIG.BOAT.r) {
          return this._fail('collision', `碰撞暗礁 #${rock.id + 1}（障碍顺序 ${rock.order + 1}）`);
        }
      }

      const cur = currentAt(this.world, b.x, b.y);
      const wind = windAt(this.world, this.time);
      const mass = 1 + this.loadFactor;
      const drive = CONFIG.BOAT.maxForce * t / mass;
      const accX = Math.cos(b.heading) * drive +
        cur.fx * CONFIG.CURRENT_PUSH / mass +
        wind.fx * CONFIG.WIND_LEEWAY / mass;
      const accY = Math.sin(b.heading) * drive +
        cur.fy * CONFIG.CURRENT_PUSH / mass +
        wind.fy * CONFIG.WIND_LEEWAY / mass;

      b.vx = (b.vx + accX * CONFIG.DT) * CONFIG.BOAT.drag;
      b.vy = (b.vy + accY * CONFIG.DT) * CONFIG.BOAT.drag;
      const speed = Math.hypot(b.vx, b.vy);
      const cap = CONFIG.BOAT.maxSpeed * (1 - 0.25 * this.loadFactor);
      if (speed > cap) {
        b.vx = (b.vx / speed) * cap;
        b.vy = (b.vy / speed) * cap;
      }
      b.x = clamp(b.x + b.vx * CONFIG.DT, CONFIG.BOAT.r, this.world.W - CONFIG.BOAT.r);
      b.y = clamp(b.y + b.vy * CONFIG.DT, CONFIG.BOAT.r, this.world.H - CONFIG.BOAT.r);

      this.fuel -= CONFIG.FUEL_RATE * (0.12 + t) * (1 + this.loadFactor * 0.5) * CONFIG.DT;
      if (this.fuel <= 0) {
        this.fuel = 0;
        return this._fail('fuel', '燃料耗尽，小艇失去动力');
      }

      this.time += CONFIG.DT;
      this._updateBuoyState();
      this._checkDock();
      return this.status;
    }

    _updateBuoyState() {
      let nearest = null;
      let best = Infinity;
      this.world.cables.forEach((cable) => {
        const d = dist(this.boat.x, this.boat.y, cable.buoy.x, cable.buoy.y);
        if (d < best) {
          best = d;
          nearest = cable.id;
        }
      });
      this.nearestBuoyId = nearest;
      if (best <= CONFIG.BUOY_RANGE) {
        const cable = this.world.cables[nearest];
        if (!cable.buoyVisited && depthAt(this.world, this.boat.x, this.boat.y) >
            CONFIG.DRAFT + 1.2) {
          cable.buoyVisited = true;
          this._snapshot('buoy', `抵达浮标 ${nearest + 1}`);
          this._log('info', `抵达浮标 ${nearest + 1}，检查点已记录`);
        }
      }
    }

    _checkDock() {
      const d = dist(this.boat.x, this.boat.y, this.world.dock.x, this.world.dock.y);
      if (d <= CONFIG.DOCK_RANGE && this.cablesMarked === this.world.cables.length) {
        this.status = 'won';
        this._log('success', '全部光缆完成标记并返回码头：任务成功');
      }
    }

    dropMarker() {
      if (this.status !== 'running') return { ok: false, reason: this.status };
      if (this.markersLeft <= 0) {
        this._fail('no-marker', '检修标记已全部用完，任务失败');
        return { ok: false, reason: this.lastFailure.reason };
      }
      let target = null;
      let best = Infinity;
      for (const cable of this.world.cables) {
        const d = dist(this.boat.x, this.boat.y, cable.buoy.x, cable.buoy.y);
        if (d < best) {
          best = d;
          target = cable;
        }
      }
      this.markersLeft -= 1;
      if (best > CONFIG.BUOY_RANGE || target.marked) {
        const why = best > CONFIG.BUOY_RANGE
          ? `位置偏离浮标 ${best.toFixed(0)}m，标记投空`
          : `光缆 ${target.id + 1} 已有标记，重复投放`;
        this.lastFailure = { code: 'wrong-marker', reason: why, time: this.time,
          recovered: true };
        this.failures.push(this.lastFailure);
        this._log('fail', `错误标记：${why}（剩余 ${this.markersLeft} 枚）`);
        return { ok: false, reason: why };
      }
      target.marked = true;
      target.markerId = this.markersPlaced;
      target.markerAt = { x: this.boat.x, y: this.boat.y };
      this._snapshot('marker', `光缆 ${target.id + 1} 标记完成`);
      this._log('success', `光缆 ${target.id + 1} 标记成功（剩余 ${this.markersLeft} 枚）`);
      this._checkDock();
      return { ok: true, cable: target.id };
    }

    _fail(code, reason) {
      this.status = 'failed';
      this.lastFailure = { code, reason, time: this.time, recovered: false };
      this.failures.push(this.lastFailure);
      this._log('fail', reason);
      return this.status;
    }

    _snapshot(kind, label) {
      const snap = {
        id: this.checkpoints.length,
        kind,
        label,
        time: this.time,
        boat: { ...this.boat },
        fuel: this.fuel,
        markersLeft: this.markersLeft,
        cableStates: this.world.cables.map((c) => ({
          marked: c.marked, markerId: c.markerId,
          markerAt: c.markerAt ? { ...c.markerAt } : null,
          buoyVisited: !!c.buoyVisited
        })),
        rngState: this.rng.state
      };
      this.checkpoints.push(snap);
      if (this.checkpoints.length > CONFIG.MAX_CHECKPOINTS) this.checkpoints.shift();
      this.lastCheckpointId = snap.id;
      return snap;
    }

    recover() {
      if (this.status !== 'failed') {
        return { ok: false, reason: '仅失败后可从检查点恢复' };
      }
      const snap = this.checkpoints[this.checkpoints.length - 1];
      if (!snap) return { ok: false, reason: '无可用检查点' };
      const failed = this.failures[this.failures.length - 1];
      if (failed) failed.recovered = true;
      Object.assign(this.boat, snap.boat);
      this.boat.vx = 0;
      this.boat.vy = 0;
      this.boat.thrust = 0;
      this.fuel = snap.fuel;
      this.markersLeft = snap.markersLeft;
      this.world.cables.forEach((c, i) => {
        const st = snap.cableStates[i];
        c.marked = st.marked;
        c.markerId = st.markerId;
        c.markerAt = st.markerAt ? { ...st.markerAt } : null;
        c.buoyVisited = st.buoyVisited;
      });
      this.rng.state = snap.rngState;
      this.time = snap.time;
      this.status = 'running';
      this.recoveryCount += 1;
      this.lastCheckpointId = snap.id;
      this.depth = depthAt(this.world, this.boat.x, this.boat.y);
      this._log('warn', `从检查点「${snap.label}」恢复（第 ${this.recoveryCount} 次）`);
      return { ok: true, checkpoint: snap };
    }

    _log(level, message) {
      this.events.push({ t: this.time, level, message });
      if (this.events.length > CONFIG.MAX_EVENTS) this.events.shift();
    }

    serialize() {
      return JSON.stringify({
        version: VERSION,
        world: this.world,
        rngState: this.rng.state,
        boat: this.boat,
        time: this.time,
        fuel: this.fuel,
        markersLeft: this.markersLeft,
        status: this.status,
        lastFailure: this.lastFailure,
        failures: this.failures,
        events: this.events,
        checkpoints: this.checkpoints,
        lastCheckpointId: this.lastCheckpointId,
        recoveryCount: this.recoveryCount,
        nearestBuoyId: this.nearestBuoyId,
        inShallow: this.inShallow,
        depth: this.depth
      });
    }

    static deserialize(text) {
      const data = typeof text === 'string' ? JSON.parse(text) : text;
      if (data.version !== VERSION) {
        throw new Error(`存档版本不兼容：${data.version}`);
      }
      const g = new Game(data.world.seed);
      g.world = data.world;
      g.rng = new Rng(1);
      g.rng.state = data.rngState;
      g.boat = data.boat;
      g.time = data.time;
      g.fuel = data.fuel;
      g.markersLeft = data.markersLeft;
      g.status = data.status;
      g.lastFailure = data.lastFailure;
      g.failures = data.failures || [];
      g.events = data.events || [];
      g.checkpoints = data.checkpoints || [];
      g.lastCheckpointId = data.lastCheckpointId;
      g.recoveryCount = data.recoveryCount || 0;
      g.nearestBuoyId = data.nearestBuoyId;
      g.inShallow = data.inShallow;
      g.depth = data.depth;
      return g;
    }
  }

  return { Game, Rng, generateWorld, depthAt, pointAtDepth, currentAt, windAt, dist, clamp,
    CONFIG, WORLD, VERSION };
});

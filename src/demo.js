/* Deterministic autopilot used by the in-page debug demo and node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./game.js'), require('./nav.js'));
  } else {
    root.BuoyDemo = factory(root.BuoyGame, root.BuoyNav);
  }
})(typeof self !== 'undefined' ? self : this, function (BG, NAV) {
  'use strict';

  const { CONFIG, dist, depthAt, pointAtDepth } = BG;
  const TAU = Math.PI * 2;

  function normAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  class DemoRunner {
    constructor(game) {
      this.game = game;
      this.phases = [
        ...game.world.cables.map((c, i) => ({ kind: 'buoy', id: i, done: false })),
        { kind: 'crash', done: false },
        { kind: 'home', done: false }
      ];
      this.phaseIndex = 0;
      this.actions = [];
      this.maxSteps = 9000;
      this.paths = [];
      this.pathIndex = 0;
      this.crashRock = null;
      this._planCurrent();
    }

    get phase() {
      return this.phases[this.phaseIndex];
    }

    phaseLabel() {
      const p = this.phase;
      if (!p) return '完成';
      if (p.kind === 'buoy') return `驶向浮标 ${p.id + 1}`;
      if (p.kind === 'crash') return '调试：主动碰撞暗礁';
      if (p.kind === 'home') return '标记完成，返回码头';
      return p.kind;
    }

    _targetOf(phase) {
      const g = this.game;
      if (phase.kind === 'buoy') return g.world.cables[phase.id].buoy;
      if (phase.kind === 'home') return g.world.dock;
      return null;
    }

    _planCurrent() {
      const phase = this.phase;
      if (!phase || phase.kind === 'crash') {
        this.paths = [];
        this.pathIndex = 0;
        return;
      }
      const target = this._targetOf(phase);
      this.paths = NAV.planPath(this.game.world, this.game.boat, target);
      this.pathIndex = this.paths.length > 1 ? 1 : 0;
      if (this.paths.length === 0) {
        throw new Error(`无法为阶段 ${phase.kind} 规划安全航线`);
      }
    }

    _followPath(thrust) {
      const g = this.game;
      const b = g.boat;
      let wp = this.paths[this.pathIndex];
      while (wp && dist(b.x, b.y, wp.x, wp.y) < 16 &&
             this.pathIndex < this.paths.length - 1) {
        this.pathIndex += 1;
        wp = this.paths[this.pathIndex];
      }
      const off = dist(b.x, b.y, wp.x, wp.y);
      if (off > 48) {
        this._planCurrent();
        wp = this.paths[this.pathIndex];
      }
      const ahead = depthAt(
        g.world,
        b.x + Math.cos(b.heading) * 34,
        b.y + Math.sin(b.heading) * 34
      );
      let t = this.consecutiveRecover > 1 ? thrust * 0.6 : thrust;
      if (ahead <= CONFIG.DRAFT + 1.6) t = Math.min(t, 0.35);
      let evading = false;
      g.steerToward(wp.x, wp.y);
      if (ahead <= CONFIG.DRAFT + 2.0) {
        const left = depthAt(g.world,
          b.x + Math.cos(b.heading - 0.6) * 40,
          b.y + Math.sin(b.heading - 0.6) * 40);
        const right = depthAt(g.world,
          b.x + Math.cos(b.heading + 0.6) * 40,
          b.y + Math.sin(b.heading + 0.6) * 40);
        b.heading += (left >= right ? -1 : 1) * 0.11;
        evading = true;
      }
      for (const rock of g.world.rocks) {
        const d = dist(b.x, b.y, rock.x, rock.y);
        if (d < rock.r + 46) {
          const diff = normAngle(
            Math.atan2(rock.y - b.y, rock.x - b.x) - b.heading);
          if (Math.abs(diff) < 0.85) {
            b.heading += (diff >= 0 ? -1 : 1) * 0.12;
            t = Math.min(t, 0.4);
            evading = true;
          }
        }
      }
      const headingErr = Math.abs(normAngle(
        Math.atan2(wp.y - b.y, wp.x - b.x) - b.heading));
      g.step(headingErr > 0.9 ? t * 0.3 : t);
    }

    _pickCrashRock() {
      const g = this.game;
      const b = g.boat;
      let best = null;
      let bd = Infinity;
      for (const rock of g.world.rocks) {
        const d = dist(b.x, b.y, rock.x, rock.y);
        const steps = Math.max(1, Math.floor(d / 26));
        let safe = true;
        for (let k = 1; k <= steps; k++) {
          const px = b.x + (rock.x - b.x) * (k / steps);
          const py = b.y + (rock.y - b.y) * (k / steps);
          if (depthAt(g.world, px, py) <= CONFIG.DRAFT + 0.5) {
            safe = false;
            break;
          }
        }
        if (safe && d < bd) {
          bd = d;
          best = rock;
        }
      }
      if (!best) {
        for (const rock of g.world.rocks) {
          const d = dist(b.x, b.y, rock.x, rock.y);
          if (d < bd) {
            bd = d;
            best = rock;
          }
        }
      }
      return best;
    }

    step() {
      const g = this.game;
      if (g.status === 'failed') {
        const r = g.recover();
        this.actions.push({ step: g.time, type: 'recover', ok: r.ok });
        if (this.phase && this.phase.kind === 'crash') {
          this.phase.done = true;
          this.phaseIndex += 1;
        }
        this._planCurrent();
        this.consecutiveRecover = (this.consecutiveRecover || 0) + 1;
        return { type: 'recover', ok: r.ok };
      }
      this.consecutiveRecover = 0;
      if (g.status !== 'running') return { type: g.status };
      const p = this.phase;
      if (!p) return { type: 'idle' };
      const b = g.boat;

      if (p.kind === 'buoy') {
        const cable = g.world.cables[p.id];
        if (dist(b.x, b.y, cable.buoy.x, cable.buoy.y) <= CONFIG.BUOY_RANGE - 4) {
          const r = g.dropMarker();
          this.actions.push({ step: g.time, type: 'drop', ok: r.ok, cable: p.id });
          p.done = true;
          this.phaseIndex += 1;
          this._planCurrent();
          return { type: 'drop', ok: r.ok };
        }
        this._followPath(0.8);
        return { type: 'sail' };
      }

      if (p.kind === 'crash') {
        if (!this.crashRock) this.crashRock = this._pickCrashRock();
        g.steerToward(this.crashRock.x, this.crashRock.y);
        const ahead = depthAt(
          g.world,
          b.x + Math.cos(b.heading) * 40,
          b.y + Math.sin(b.heading) * 40
        );
        if (ahead <= CONFIG.DRAFT + 0.6) b.heading += 0.22;
        g.step(1);
        return { type: 'crash-approach' };
      }

      if (p.kind === 'home') {
        this._followPath(0.8);
        if (g.status === 'won') {
          p.done = true;
          return { type: 'won' };
        }
        return { type: 'sail' };
      }
      return { type: 'idle' };
    }

    run() {
      let n = 0;
      while (this.game.status === 'running' || this.game.status === 'failed') {
        this.step();
        n += 1;
        if (n > this.maxSteps) {
          throw new Error('演示超时：自动路线未在限定步数内收敛');
        }
        if (this.game.status === 'won') break;
      }
      return this.game.status;
    }
  }

  function runGroundingDemo(game) {
    const target = pointAtDepth(game.world, -99, CONFIG.DRAFT) ||
      game.world.shallows[0];
    let n = 0;
    while (game.status === 'running' && n < 4000) {
      game.steerToward(target.x, target.y);
      game.step(1);
      n += 1;
    }
    return game.status === 'failed' && game.lastFailure.code === 'grounded';
  }

  class GroundingRunner {
    constructor(game) {
      this.game = game;
      this.target = pointAtDepth(game.world, -99, CONFIG.DRAFT) ||
        game.world.shallows[0];
      this.steps = 0;
      this.maxSteps = 4000;
    }

    phaseLabel() {
      return '搁浅调试：驶向浅水核心';
    }

    step() {
      const g = this.game;
      if (g.status !== 'running') return { type: g.status };
      g.steerToward(this.target.x, this.target.y);
      g.step(1);
      this.steps += 1;
      if (this.steps > this.maxSteps) throw new Error('搁浅调试超时');
      return { type: 'sail' };
    }
  }

  return { DemoRunner, GroundingRunner, runGroundingDemo, normAngle };
});

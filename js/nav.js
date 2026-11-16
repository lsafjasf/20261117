/* 港区网格寻路与确定性自动测试驾驶员。 */
(function (G) {
  'use strict';
  const { CFG } = G.TowConfig;
  const CELL = 30;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const norm = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  function rectBlocked(world, x, y, pad) {
    const a = world.alley;
    if (x > a.left - 10 - pad && x < a.left + pad && y > a.top - pad && y < a.bottom + pad) return true;
    if (x > a.right - pad && x < a.right + 10 + pad && y > a.top - pad && y < a.bottom + pad) return true;
    if (x > a.left - 10 - pad && x < a.right + 10 + pad && y > a.top - 10 - pad && y < a.top + pad) return true;
    if (x < 40 + pad || x > world.width - 40 - pad) return true;
    if (y < world.waterY + pad || y > world.height - 40 - pad) return true;
    for (const o of world.obstacles) {
      if (o.type === 'stack') {
        if (x > o.x - o.w / 2 - pad && x < o.x + o.w / 2 + pad &&
            y > o.y - o.h / 2 - pad && y < o.y + o.h / 2 + pad) return true;
      } else if (Math.hypot(x - o.x, y - o.y) < (o.radius || 9) + pad) {
        return true;
      }
    }
    return false;
  }

  function nearestFree(grid, gx, gy) {
    const key = (x, y) => y * grid.cols + x;
    if (!grid.blocked[key(gx, gy)]) return { x: gx, y: gy };
    for (let r = 1; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) continue;
          if (!grid.blocked[key(x, y)]) return { x, y };
        }
      }
    }
    return null;
  }

  function buildGrid(world, radius) {
    const cols = Math.ceil(world.width / CELL);
    const rows = Math.ceil(world.height / CELL);
    const blocked = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        blocked[y * cols + x] = rectBlocked(
          world, x * CELL + CELL / 2, y * CELL + CELL / 2, (radius || 14) + 4
        ) ? 1 : 0;
      }
    }
    return { cols, rows, blocked };
  }

  function toCell(point) {
    return {
      x: clamp(Math.floor(point.x / CELL), 0, 999),
      y: clamp(Math.floor(point.y / CELL), 0, 999)
    };
  }

  function cellCenter(c) {
    return { x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2 };
  }

  function findPath(world, from, to, radius) {
    const grid = buildGrid(world, radius || CFG.TRUCK_RADIUS);
    const startCell = nearestFree(grid, ...Object.values(toCell(from)));
    const goalCell = nearestFree(grid, ...Object.values(toCell(to)));
    if (!startCell || !goalCell) return [];
    const start = startCell.y * grid.cols + startCell.x;
    const goal = goalCell.y * grid.cols + goalCell.x;
    const open = [start];
    const inOpen = new Set(open);
    const came = new Map();
    const g = new Map([[start, 0]]);
    const f = new Map([[start, Math.hypot(startCell.x - goalCell.x, startCell.y - goalCell.y)]]);
    const dirs = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]
    ];
    let guard = 0;
    while (open.length && guard++ < 10000) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i++) {
        if ((f.get(open[i]) || Infinity) < (f.get(open[bestIndex]) || Infinity)) bestIndex = i;
      }
      const current = open.splice(bestIndex, 1)[0];
      inOpen.delete(current);
      if (current === goal) {
        const cells = [];
        let cur = current;
        while (cur !== start) {
          cells.push({ x: cur % grid.cols, y: Math.floor(cur / grid.cols) });
          cur = came.get(cur);
        }
        cells.push(startCell);
        return smooth(world, cells.reverse(), radius || CFG.TRUCK_RADIUS);
      }
      const cx = current % grid.cols;
      const cy = Math.floor(current / grid.cols);
      for (const [dx, dy, cost] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
        if (grid.blocked[ny * grid.cols + nx]) continue;
        if (dx && dy) {
          if (grid.blocked[cy * grid.cols + nx] || grid.blocked[ny * grid.cols + cx]) continue;
        }
        const next = ny * grid.cols + nx;
        const tentative = (g.get(current) || 0) + cost;
        if (tentative >= (g.get(next) || Infinity)) continue;
        came.set(next, current);
        g.set(next, tentative);
        const h = Math.hypot(nx - goalCell.x, ny - goalCell.y);
        f.set(next, tentative + h);
        if (!inOpen.has(next)) { open.push(next); inOpen.add(next); }
      }
    }
    return [];
  }

  function smooth(world, cells, radius) {
    const points = cells.map(cellCenter);
    if (points.length <= 2) return points;
    const out = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = anchor + 1;
      for (let probe = points.length - 1; probe > anchor; probe--) {
        if (clearSegment(world, points[anchor], points[probe], radius)) {
          next = probe;
          break;
        }
      }
      out.push(points[next]);
      anchor = next;
    }
    return out;
  }

  function clearSegment(world, a, b, radius) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(d / 7));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (rectBlocked(world, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius + 3)) return false;
    }
    return true;
  }

  function reverseToward(sim, target, maxSeconds) {
    let elapsed = 0;
    let brakeSteps = 0;
    while (sim.phase === 'playing' && elapsed < maxSeconds) {
      const dx = target.x - sim.truck.x;
      const dy = target.y - sim.truck.y;
      const dGoal = Math.hypot(dx, dy);
      const speed = Math.abs(sim.truck.speed);
      if (dGoal < 30 && speed < 10) {
        G.TowSim.setInput(sim, { throttle: 0, steer: 0, brake: true });
        G.TowSim.step(sim, CFG.DT);
        if (++brakeSteps > 35) break;
      } else {
        const desired = Math.atan2(dy, dx) + Math.PI;
        const error = norm(desired - sim.truck.heading);
        const closing = (dGoal < 62 && speed > 7) || speed > Math.max(12, dGoal * 0.9);
        G.TowSim.setInput(sim, {
          throttle: closing ? 0 : -0.34,
          steer: clamp(-error * 0.48, -0.42, 0.42),
          brake: closing
        });
        G.TowSim.step(sim, CFG.DT);
        brakeSteps = 0;
      }
      elapsed += CFG.DT;
    }
    return { ok: sim.phase === 'playing', elapsed };
  }

  function driveTo(sim, target, maxSeconds, options) {
    const opts = options || {};
    const pathRadius = sim.attachedId ? 27 : 25;
    let elapsed = 0;
    let path = findPath(sim.world, sim.truck, target, pathRadius);
    let index = 1;
    let repathIn = 0;
    let stuck = 0;
    let lastProgress = Infinity;
    while (sim.phase === 'playing' && elapsed < maxSeconds) {
      const dGoal = Math.hypot(sim.truck.x - target.x, sim.truck.y - target.y);
      if (dGoal < (opts.arrive || 27) && Math.abs(sim.truck.speed) < (opts.stopSpeed || 18)) {
        G.TowSim.setInput(sim, { throttle: 0, steer: 0, brake: true });
        for (let i = 0; i < 8; i++) G.TowSim.step(sim, CFG.DT);
        return { ok: true, elapsed, path };
      }
      if (dGoal < lastProgress - 2) { lastProgress = dGoal; stuck = 0; }
      else stuck += CFG.DT;
      if (stuck > 3.5) {
        path = findPath(sim.world, sim.truck, target, pathRadius);
        index = 1;
        lastProgress = dGoal;
        stuck = 0;
      }
      repathIn -= CFG.DT;
      if (!path.length || repathIn <= 0) {
        path = findPath(sim.world, sim.truck, target, pathRadius);
        index = 1;
        repathIn = 1.2;
      }
      while (index < path.length && Math.hypot(path[index].x - sim.truck.x, path[index].y - sim.truck.y) < 34) {
        index++;
      }
      const wp = path[Math.min(index, path.length - 1)] || target;
      const desired = Math.atan2(wp.y - sim.truck.y, wp.x - sim.truck.x);
      const error = norm(desired - sim.truck.heading);
      const absError = Math.abs(error);
      const speed = Math.abs(sim.truck.speed);
      const desiredSpeed = Math.min(76, 14 + dGoal * 1.05);
      const reverseMode = absError > 1.9 && dGoal < 260;
      let throttle = 0.62;
      let brake = false;
      if (absError > 1.15 && speed > 24) { throttle = 0; brake = true; }
      else if (absError > 0.7) throttle = 0.24;
      else if (speed > desiredSpeed + 9) { throttle = 0; brake = true; }
      else if (dGoal < 34 && speed > 16) { throttle = 0; brake = true; }
      if (speed < 4 && absError > 0.9) throttle = 0.52;
      if (reverseMode) {
        const reverseError = norm(desired + Math.PI - sim.truck.heading);
        throttle = speed > desiredSpeed + 8 ? 0 : -0.54;
        brake = speed > desiredSpeed + 12;
        G.TowSim.setInput(sim, {
          throttle,
          steer: clamp(-reverseError * 2.0, -1, 1),
          brake
        });
        G.TowSim.step(sim, CFG.DT);
        elapsed += CFG.DT;
        continue;
      }
      G.TowSim.setInput(sim, {
        throttle,
        steer: clamp(error * 2.15, -1, 1),
        brake
      });
      G.TowSim.step(sim, CFG.DT);
      elapsed += CFG.DT;
    }
    return { ok: false, elapsed, path, reason: sim.lastFailureReason || '超时' };
  }

  G.TowNav = { CELL, buildGrid, findPath, driveTo, reverseToward, clearSegment, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.TowNav;
})(typeof globalThis !== 'undefined' ? globalThis : this);

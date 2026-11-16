/* Deterministic grid A* over static depth/rock safety. Pure functions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./game.js'));
  } else {
    root.BuoyNav = factory(root.BuoyGame);
  }
})(typeof self !== 'undefined' ? self : this, function (BG) {
  'use strict';

  const { depthAt, dist, CONFIG } = BG;
  const CELL = 22;
  const MARGIN = CONFIG.BOAT.r + 10;

  function cellKey(cx, cy) {
    return cx + ',' + cy;
  }

  function cellCenter(cx, cy) {
    return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
  }

  function isSafe(world, x, y) {
    if (x < MARGIN || y < MARGIN || x > world.W - MARGIN || y > world.H - MARGIN) {
      return false;
    }
    if (depthAt(world, x, y) <= CONFIG.DRAFT + 2.4) return false;
    for (const rock of world.rocks) {
      if (dist(x, y, rock.x, rock.y) < rock.r + MARGIN + 22) return false;
    }
    for (const shallow of world.shallows) {
      if (dist(x, y, shallow.x, shallow.y) < shallow.r * 0.42) return false;
    }
    return true;
  }

  function nearestSafeCell(world, x, y) {
    const sx = Math.floor(x / CELL);
    const sy = Math.floor(y / CELL);
    for (let radius = 0; radius < 12; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const cx = sx + dx;
          const cy = sy + dy;
          const p = cellCenter(cx, cy);
          if (isSafe(world, p.x, p.y)) return { cx, cy, ...p };
        }
      }
    }
    return null;
  }

  function planPath(world, start, goal) {
    const s = nearestSafeCell(world, start.x, start.y);
    const e = nearestSafeCell(world, goal.x, goal.y);
    if (!s || !e) return [];
    const open = [{ cx: s.cx, cy: s.cy, f: 0, g: 0, parent: null }];
    const index = new Map([[cellKey(s.cx, s.cy), open[0]]]);
    const closed = new Set();
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    let guard = 0;
    while (open.length && guard < 12000) {
      guard += 1;
      let bi = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bi].f) bi = i;
      }
      const cur = open.splice(bi, 1)[0];
      const key = cellKey(cur.cx, cur.cy);
      index.delete(key);
      closed.add(key);
      if (cur.cx === e.cx && cur.cy === e.cy) {
        const cells = [];
        let node = cur;
        while (node) {
          cells.push(cellCenter(node.cx, node.cy));
          node = node.parent;
        }
        cells.reverse();
        cells.push({ x: goal.x, y: goal.y });
        return simplify(world, start, cells);
      }
      for (const [dx, dy] of dirs) {
        const nx = cur.cx + dx;
        const ny = cur.cy + dy;
        const nkey = cellKey(nx, ny);
        if (closed.has(nkey)) continue;
        const center = cellCenter(nx, ny);
        if (!isSafe(world, center.x, center.y)) continue;
        if (dx !== 0 && dy !== 0) {
          const sideA = cellCenter(cur.cx + dx, cur.cy);
          const sideB = cellCenter(cur.cx, cur.cy + dy);
          if (!isSafe(world, sideA.x, sideA.y) || !isSafe(world, sideB.x, sideB.y)) {
            continue;
          }
        }
        const step = dx !== 0 && dy !== 0 ? 1.4142 : 1;
        const g = cur.g + step;
        const existing = index.get(nkey);
        if (existing && g >= existing.g) continue;
        const h = dist(center.x, center.y, e.x, e.y) / CELL;
        const node = { cx: nx, cy: ny, g, f: g + h, parent: cur };
        if (existing) {
          const pos = open.indexOf(existing);
          if (pos >= 0) open.splice(pos, 1);
        }
        open.push(node);
        index.set(nkey, node);
      }
    }
    return [];
  }

  function segmentClear(world, a, b) {
    const len = dist(a.x, a.y, b.x, b.y);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.35)));
    for (let i = 1; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * (i / steps);
      const y = a.y + (b.y - a.y) * (i / steps);
      if (!isSafe(world, x, y)) return false;
    }
    return true;
  }

  function simplify(world, start, cells) {
    const pts = [{ x: start.x, y: start.y }, ...cells];
    const out = [pts[0]];
    let anchor = 0;
    while (anchor < pts.length - 1) {
      let furthest = anchor + 1;
      for (let j = pts.length - 1; j > anchor + 1; j--) {
        const span = dist(pts[anchor].x, pts[anchor].y, pts[j].x, pts[j].y);
        if (span <= CELL * 4 && segmentClear(world, pts[anchor], pts[j])) {
          furthest = j;
          break;
        }
      }
      out.push(pts[furthest]);
      anchor = furthest;
    }
    return out.slice(1);
  }

  return { planPath, isSafe, nearestSafeCell, segmentClear, CELL };
});

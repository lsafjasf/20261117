// Contour label placement: walk along polylines, skip dense regions,
// avoid overlap with already-placed labels. Pure module.

function polylineLength(pts, closed) {
  let len = 0;
  const n = pts.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

// Point + tangent angle at arc distance d along the polyline.
function pointAt(pts, closed, d) {
  const n = pts.length;
  const count = closed ? n : n - 1;
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + seg >= d) {
      const t = seg === 0 ? 0 : (d - acc) / seg;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      };
    }
    acc += seg;
  }
  const a = pts[pts.length - 1];
  return { x: a[0], y: a[1], angle: 0 };
}

// Build a coarse grid mapping cells -> set of distinct contour line ids,
// so "density" means how many different lines crowd the neighbourhood
// (independent of vertex count / smoothing level).
function buildDensityGrid(lines, cell) {
  const grid = new Map();
  lines.forEach((line, id) => {
    for (const p of line.points) {
      const k = Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell);
      let set = grid.get(k);
      if (!set) { set = new Set(); grid.set(k, set); }
      set.add(id);
    }
  });
  return grid;
}

function densityAt(grid, cell, x, y) {
  const union = new Set();
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const set = grid.get((cx + dx) + ',' + (cy + dy));
      if (set) for (const id of set) union.add(id);
    }
  }
  return union.size;
}

function boxesOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h
  );
}

function formatLevel(level) {
  return String(Number(level.toFixed(3)));
}

function normalizeAngle(a) {
  while (a > Math.PI / 2) a -= Math.PI;
  while (a < -Math.PI / 2) a += Math.PI;
  return a;
}

// density: 0 = no labels, 1 = sparse, 2 = normal, 3 = dense.
// Returns [{ x, y, angle, text, level }]
export function placeLabels(lines, density, world) {
  if (!density || density <= 0) return [];
  const spacingFactor = [Infinity, 3.0, 1.8, 1.0][Math.min(3, Math.floor(density))];
  const baseSpacing = Math.min(world.w, world.h) * 0.25;
  const spacing = baseSpacing * spacingFactor;
  const cell = Math.min(world.w, world.h) / 24;
  const grid = buildDensityGrid(lines, cell);
  const labelW = cell * 1.6;
  const labelH = cell * 0.7;

  // Collect candidates with their local crowd density.
  const candidates = [];
  for (const line of lines) {
    const pts = line.points;
    if (pts.length < 2) continue;
    const total = polylineLength(pts, line.closed);
    if (total < spacing * 0.6) continue; // too short to label
    const count = Math.max(1, Math.floor(total / spacing));
    for (let i = 0; i < count; i++) {
      const d = ((i + 0.5) / count) * total;
      const p = pointAt(pts, line.closed, d);
      candidates.push({
        x: p.x, y: p.y,
        angle: normalizeAngle(p.angle),
        text: formatLevel(line.level),
        level: line.level,
        crowd: densityAt(grid, cell, p.x, p.y),
      });
    }
  }
  if (!candidates.length) return [];

  // Relative threshold: reject the densest ~35% of spots so labels never
  // sit on crowded regions, while still appearing in extreme parameter sets.
  const crowds = candidates.map((c) => c.crowd).sort((a, b) => a - b);
  const limit = crowds[Math.floor(crowds.length * 0.65)];

  // Prefer quiet spots first.
  candidates.sort((a, b) => a.crowd - b.crowd);
  const placed = [];
  const out = [];
  for (const c of candidates) {
    if (c.crowd > limit) continue;
    const box = { x: c.x, y: c.y, w: labelW, h: labelH };
    let hit = false;
    for (const b of placed) {
      if (boxesOverlap(box, b)) { hit = true; break; }
    }
    if (hit) continue;
    placed.push(box);
    out.push(c);
  }
  return out;
}

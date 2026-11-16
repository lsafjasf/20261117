// Marching squares -> joined continuous polylines -> Chaikin smoothing.
// Pure module (browser + node). Coordinates are in world units.

function interp(p1, p2, v1, v2, level) {
  const t = (level - v1) / (v2 - v1);
  return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
}

// Extract raw segments for one level.
function levelSegments(field, level) {
  const { data, cols, rows, world } = field;
  const segs = [];
  const dx = world.w / (cols - 1);
  const dy = world.h / (rows - 1);
  const pt = (c, r) => [world.x + c * dx, world.y + r * dy];
  const val = (c, r) => data[r * cols + c];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = val(c, r);
      const tr = val(c + 1, r);
      const br = val(c + 1, r + 1);
      const bl = val(c, r + 1);
      let idx = 0;
      if (tl > level) idx |= 8;
      if (tr > level) idx |= 4;
      if (br > level) idx |= 2;
      if (bl > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const ptl = pt(c, r);
      const ptr = pt(c + 1, r);
      const pbr = pt(c + 1, r + 1);
      const pbl = pt(c, r + 1);
      // edge midpoints (interpolated)
      const top = interp(ptl, ptr, tl, tr, level);
      const right = interp(ptr, pbr, tr, br, level);
      const bottom = interp(pbl, pbr, bl, br, level);
      const left = interp(ptl, pbl, tl, bl, level);
      switch (idx) {
        case 1: case 14: segs.push([left, bottom]); break;
        case 2: case 13: segs.push([bottom, right]); break;
        case 3: case 12: segs.push([left, right]); break;
        case 4: case 11: segs.push([top, right]); break;
        case 6: case 9: segs.push([top, bottom]); break;
        case 7: case 8: segs.push([left, top]); break;
        case 5: // saddle: tl,br above
          segs.push([left, top]);
          segs.push([bottom, right]);
          break;
        case 10: // saddle: tr,bl above
          segs.push([top, right]);
          segs.push([left, bottom]);
          break;
      }
    }
  }
  return segs;
}
const KEY_PREC = 1e6;
function keyOf(p) {
  return Math.round(p[0] * KEY_PREC) + ',' + Math.round(p[1] * KEY_PREC);
}

// Join raw segments into continuous polylines so lines never break.
// Returns [{ level, points: [[x,y]...], closed: bool }]
function joinSegments(segs, level) {
  const adj = new Map(); // key -> array of {segIdx, end(0|1)}
  segs.forEach((s, i) => {
    for (let e = 0; e < 2; e++) {
      const k = keyOf(s[e]);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push({ seg: i, end: e });
    }
  });
  const used = new Array(segs.length).fill(false);
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts = [segs[i][0], segs[i][1]];
    // extend tail then head
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir === 1 ? pts[pts.length - 1] : pts[0];
        const list = adj.get(keyOf(tip)) || [];
        let next = null;
        for (const ref of list) {
          if (!used[ref.seg]) { next = ref; break; }
        }
        if (!next) break;
        used[next.seg] = true;
        const other = segs[next.seg][next.end === 0 ? 1 : 0];
        if (dir === 1) pts.push(other);
        else pts.unshift(other);
      }
    }
    const closed = pts.length > 2 && keyOf(pts[0]) === keyOf(pts[pts.length - 1]);
    if (closed) pts.pop(); // store closed loops without duplicated endpoint
    lines.push({ level, points: pts, closed });
  }
  return lines;
}

// Chaikin corner cutting; keeps closed loops closed (no breaks).
export function chaikin(points, closed, iterations) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const out = [];
    const n = pts.length;
    const count = closed ? n : n - 1;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

// Full pipeline: levels derived from interval, joined, smoothed.
export function buildContours(field, interval, smoothIterations) {
  const { min, max } = field;
  const lines = [];
  if (!(interval > 0)) return lines;
  const start = Math.ceil(min / interval) * interval;
  for (let level = start; level <= max; level += interval) {
    const segs = levelSegments(field, level);
    for (const line of joinSegments(segs, level)) {
      line.points = chaikin(line.points, line.closed, smoothIterations);
      lines.push(line);
    }
  }
  return lines;
}

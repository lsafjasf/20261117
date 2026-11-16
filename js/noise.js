// Tileable noise / crystal field primitives. Pure JS, runs in browser and Node.
// All sampling is done in unit-tile coordinates u,v in [0,1) and is periodic
// with period 1, so f(u, v) === f(u + 1, v) === f(u, v + 1). That is what
// guarantees four-edge continuity when the texture is tiled.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SaltNoise = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministic 2D lattice hash -> [0,1). Wrapped by `period`.
  function hash2(ix, iy, seed) {
    let h = (seed >>> 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (ix | 0), 0x85ebca6b);
    h = Math.imul(h ^ (iy | 0), 0xc2b2ae35);
    h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  // Periodic value noise. `period` is the integer lattice period in tile units.
  function valueNoise(u, v, period, seed) {
    u -= Math.floor(u); v -= Math.floor(v); // exact periodicity
    const x = u * period, y = v * period;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const w = (i) => ((i % period) + period) % period;
    const x0w = w(x0), x1w = w(x0 + 1), y0w = w(y0), y1w = w(y0 + 1);
    const n00 = hash2(x0w, y0w, seed);
    const n10 = hash2(x1w, y0w, seed);
    const n01 = hash2(x0w, y1w, seed);
    const n11 = hash2(x1w, y1w, seed);
    const nx0 = n00 + (n10 - n00) * fx;
    const nx1 = n01 + (n11 - n01) * fx;
    return nx0 + (nx1 - nx0) * fy;
  }

  // Periodic fBm. Each octave keeps an integer period so the sum stays tileable.
  function fbm(u, v, basePeriod, octaves, seed) {
    let sum = 0, amp = 0.5, total = 0, period = basePeriod;
    for (let o = 0; o < octaves; o++) {
      sum += amp * valueNoise(u, v, period, seed + o * 1013);
      total += amp;
      amp *= 0.5;
      period *= 2;
    }
    return total > 0 ? sum / total : 0;
  }

  // Wrapped Voronoi on a `cells` x `cells` jittered grid.
  // Returns { f1, f2, id, hx, hy } with distances in cell units.
  function voronoi(u, v, cells, seed) {
    u -= Math.floor(u); v -= Math.floor(v); // exact periodicity
    const x = u * cells, y = v * cells;
    const xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 1e9, f2 = 1e9, id = 0, hx = 0, hy = 0, rx = 0, ry = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy;
        const wx = ((cx % cells) + cells) % cells;
        const wy = ((cy % cells) + cells) % cells;
        const jx = hash2(wx, wy, seed);
        const jy = hash2(wx, wy, seed + 7919);
        const px = cx + 0.15 + 0.7 * jx;
        const py = cy + 0.15 + 0.7 * jy;
        const ddx = px - x, ddy = py - y;
        // Blend Chebyshev (square, halite-like cells) with Euclidean
        // to soften the pyramid-edge creases.
        const cheb = Math.max(Math.abs(ddx), Math.abs(ddy));
        const euc = Math.sqrt(ddx * ddx + ddy * ddy);
        const d = 0.65 * cheb + 0.35 * euc;
        if (d < f1) {
          f2 = f1; f1 = d;
          id = wx + wy * cells; hx = jx; hy = jy;
          rx = x - px; ry = y - py;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return { f1, f2, id, hx, hy, rx, ry };
  }

  return { mulberry32, hash2, valueNoise, fbm, voronoi, smooth };
});

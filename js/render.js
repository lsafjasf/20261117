// Per-pixel tileable rock-salt renderer. Pure JS (no DOM), shared by the
// browser app and the Node tests. Deterministic: output depends only on
// (params, dabs, layers, size, lightAngle), so reloads reproduce exactly.

(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const noise = isNode ? require("./noise.js") : root.SaltNoise;
  const paramsApi = isNode ? require("./params.js") : root.SaltParams;
  const api = factory(noise, paramsApi);
  if (isNode) module.exports = api;
  else root.SaltRender = api;
})(typeof self !== "undefined" ? self : globalThis, function (N, P) {
  "use strict";

  const BRUSH_FIELD_SIZE = 256;

  function wrap1(t) { return ((t % 1) + 1) % 1; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // Rasterize brush dabs into wrapped wet/pit fields (Float32Array, size^2).
  function buildBrushFields(dabs, size) {
    size = size || BRUSH_FIELD_SIZE;
    const wet = new Float32Array(size * size);
    const pit = new Float32Array(size * size);
    for (const dab of dabs || []) {
      const cx = dab.u * size, cy = dab.v * size;
      const rad = Math.max(1.5, dab.r * size);
      const reach = Math.ceil(rad);
      const target = dab.mode === "pit" ? pit : dab.mode === "wet" ? wet : null;
      for (let oy = -reach; oy <= reach; oy++) {
        for (let ox = -reach; ox <= reach; ox++) {
          const d = Math.sqrt(ox * ox + oy * oy) / rad;
          if (d > 1) continue;
          const fall = 1 - d * d * (3 - 2 * d); // smooth falloff, 1 at center
          const amt = dab.s * fall * 0.25;
          // Splat at 9 wrapped offsets so strokes crossing an edge
          // appear on the opposite side of the tile too.
          for (let wy = -1; wy <= 1; wy++) {
            for (let wx = -1; wx <= 1; wx++) {
              const px = Math.round(cx + ox) + wx * size;
              const py = Math.round(cy + oy) + wy * size;
              if (px < 0 || px >= size || py < 0 || py >= size) continue;
              const idx = py * size + px;
              if (dab.mode === "heal") {
                wet[idx] = Math.max(0, wet[idx] - amt);
                pit[idx] = Math.max(0, pit[idx] - amt);
              } else if (target) {
                target[idx] = Math.min(1.5, target[idx] + amt);
              }
            }
          }
        }
      }
    }
    return { wet, pit, size };
  }

  function sampleField(arr, size, u, v) {
    const x = wrap1(u) * size - 0.5, y = wrap1(v) * size - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const w = (i) => ((i % size) + size) % size;
    const i00 = w(y0) * size + w(x0), i10 = w(y0) * size + w(x0 + 1);
    const i01 = w(y0 + 1) * size + w(x0), i11 = w(y0 + 1) * size + w(x0 + 1);
    const a = arr[i00] + (arr[i10] - arr[i00]) * fx;
    const b = arr[i01] + (arr[i11] - arr[i01]) * fx;
    return a + (b - a) * fy;
  }

  // Continuous height field of the salt surface, periodic in (u, v).
  function makeHeightField(params, brush) {
    const cells = params.crystalScale;
    const seed = params.seed;
    const relief = params.relief;
    const grain = params.grain;
    const porosity = params.porosity;
    return function heightAt(u, v) {
      u = wrap1(u); v = wrap1(v);
      const voro = N.voronoi(u, v, cells, seed);
      const edge = voro.f2 - voro.f1;
      // Planar facet tilt per crystal + domed crystal top.
      const tx = (voro.hx - 0.5) * 2, ty = (voro.hy - 0.5) * 2;
      const dome = clamp(1 - voro.f1 * 1.5, 0, 1);
      const facet = -(voro.rx * tx + voro.ry * ty) * 0.35;
      let h = relief * (0.6 * dome + 0.4 * facet);
      // Groove along crystal boundaries.
      const groove = 1 - N.smooth(clamp(edge / 0.14, 0, 1));
      h -= relief * 0.45 * groove;
      // Fine grain.
      if (grain > 0) h += grain * 0.22 * (N.fbm(u, v, 8, 4, seed + 31) - 0.5);
      // Pores.
      if (porosity > 0) {
        const pn = N.fbm(u, v, 16, 3, seed + 57);
        const t = clamp((porosity * 0.45 - pn) / 0.1, 0, 1);
        h -= porosity * 0.7 * N.smooth(t);
      }
      // Brush pits.
      if (brush) h -= 0.6 * sampleField(brush.pit, brush.size, u, v);
      return h;
    };
  }

  // Render one tile to an RGBA buffer. Throws on invalid params so callers
  // can keep the last good frame instead of going blank.
  function renderTile(params, brush, layers, w, h, opts) {
    const check = P.validateParams(params);
    if (!check.ok) throw new Error("参数无效: " + check.errors.join("; "));
    const p = check.value;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) {
      throw new Error(`输出尺寸非法: ${w}x${h}`);
    }
    layers = layers || P.DEFAULT_LAYERS;
    const lightAngle = (opts && opts.lightAngle) || 0.9;
    const heightAt = makeHeightField(p, brush);
    const seed = p.seed;
    const cells = p.crystalScale;

    const lx = Math.cos(lightAngle) * 0.6, ly = Math.sin(lightAngle) * 0.6, lz = 0.75;
    const llen = Math.hypot(lx, ly, lz);
    const L = [lx / llen, ly / llen, lz / llen];
    const H = [L[0], L[1], (L[2] + 1) / 2]; // half vector, normalized below
    const hlen = Math.hypot(H[0], H[1], H[2]);
    H[0] /= hlen; H[1] /= hlen; H[2] /= hlen;

    const eps = 1.2 / Math.max(w, h);
    const slopeScale = Math.max(w, h) * 0.35 * (0.25 + p.relief);
    const out = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w;
        const hC = heightAt(u, v);
        const hX = heightAt(u + eps, v);
        const hY = heightAt(u, v + eps);
        let nx = -(hX - hC) * slopeScale;
        let ny = -(hY - hC) * slopeScale;
        const nl = Math.hypot(nx, ny, 1);
        nx /= nl; ny /= nl; const nz = 1 / nl;

        const wet = clamp(p.wetness + (brush ? sampleField(brush.wet, brush.size, u, v) : 0), 0, 1.2);
        const voro = N.voronoi(u, v, cells, seed);
        const edge = voro.f2 - voro.f1;
        const edgeLine = 1 - N.smooth(clamp(edge / 0.1, 0, 1));
        const pitLocal = brush ? sampleField(brush.pit, brush.size, u, v) : 0;

        // --- layer: base albedo ---
        const tint = 0.94 + 0.12 * voro.hx;
        let r = 244 * tint, g = 236 * tint, b = 231 * (0.96 + 0.08 * voro.hy);
        if (p.grain > 0) {
          const mottle = 0.9 + 0.2 * N.fbm(u, v, 24, 2, seed + 91) * p.grain;
          r *= mottle; g *= mottle; b *= mottle;
        }
        if (!layers.base) { r = 128; g = 128; b = 128; }

        // --- layer: relief (diffuse + AO) ---
        let shade = 1;
        if (layers.relief) {
          const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
          const ao = clamp(0.62 + 0.75 * (hC + 0.4), 0.35, 1);
          shade = (0.42 + 0.58 * diff) * ao;
        }

        // --- layer: pores ---
        if (layers.pores) {
          let poreT = 0;
          if (p.porosity > 0) {
            const pn = N.fbm(u, v, 16, 3, seed + 57);
            poreT = N.smooth(clamp((p.porosity * 0.45 - pn) / 0.1, 0, 1)) * p.porosity;
          }
          const darken = clamp(1 - 0.6 * poreT - 0.55 * pitLocal, 0.3, 1);
          shade *= darken;
        }

        // --- layer: wet (specular + edge gloss + albedo darkening) ---
        let spec = 0;
        if (layers.wet && wet > 0) {
          const shininess = 8 + 56 * wet;
          const ndh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
          spec = Math.pow(ndh, shininess) * (0.1 + 0.95 * wet) * (1 + 0.8 * wet * edgeLine);
          const wetDark = 1 - 0.3 * clamp(wet, 0, 1);
          r *= wetDark; g *= wetDark; b *= wetDark;
          // Dry salt crusts bright at edges; wet salt turns dark and glossy.
          const crust = (1 - clamp(wet, 0, 1)) * 0.12 - clamp(wet, 0, 1) * 0.18;
          const ef = 1 + crust * edgeLine;
          r *= ef; g *= ef; b *= ef;
        }

        const i = (y * w + x) * 4;
        out[i] = clamp(r * shade + 255 * spec, 0, 255);
        out[i + 1] = clamp(g * shade + 255 * spec, 0, 255);
        out[i + 2] = clamp(b * shade + 252 * spec, 0, 255);
        out[i + 3] = 255;
      }
    }
    return { data: out, width: w, height: h };
  }

  return { BRUSH_FIELD_SIZE, buildBrushFields, sampleField, makeHeightField, renderTile, wrap1 };
});

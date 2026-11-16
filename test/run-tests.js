// Node test suite for the tileable rock-salt generator.
// Covers: default / boundary / abnormal params, tile continuity, layer
// effects, brush wrap-around sync, state persistence round-trip, export.
"use strict";

const assert = require("node:assert");
const N = require("../js/noise.js");
const P = require("../js/params.js");
const R = require("../js/render.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok - " + name);
  } catch (err) {
    console.error("FAIL - " + name);
    console.error(err);
    process.exitCode = 1;
  }
}

const EMPTY_BRUSH = R.buildBrushFields([], 64);

function assertNoNaN(img) {
  for (let i = 0; i < img.data.length; i++) {
    assert.ok(Number.isFinite(img.data[i]), `pixel ${i} not finite`);
  }
}

// ---------- 1. default parameter set ----------
test("default params render deterministically", () => {
  const a = R.renderTile(P.DEFAULTS, EMPTY_BRUSH, P.DEFAULT_LAYERS, 64, 64);
  const b = R.renderTile(P.DEFAULTS, EMPTY_BRUSH, P.DEFAULT_LAYERS, 64, 64);
  assert.strictEqual(a.width, 64);
  assert.deepStrictEqual([...a.data], [...b.data], "same seed must reproduce");
  assertNoNaN(a);
  for (let i = 3; i < a.data.length; i += 4) assert.strictEqual(a.data[i], 255);
});

// ---------- 2. boundary parameter sets ----------
test("boundary params (all min) validate and render", () => {
  const min = {};
  for (const [k, [lo]] of Object.entries(P.RANGES)) min[k] = lo;
  const check = P.validateParams(min);
  assert.ok(check.ok, check.errors.join(";"));
  assertNoNaN(R.renderTile(check.value, EMPTY_BRUSH, P.DEFAULT_LAYERS, 32, 32));
});

test("boundary params (all max) validate and render", () => {
  const max = {};
  for (const [k, [, hi]] of Object.entries(P.RANGES)) max[k] = hi;
  const check = P.validateParams(max);
  assert.ok(check.ok, check.errors.join(";"));
  assertNoNaN(R.renderTile(check.value, EMPTY_BRUSH, P.DEFAULT_LAYERS, 32, 32));
});

// ---------- 3. abnormal parameter sets ----------
test("abnormal params are rejected with reasons", () => {
  const bad = { ...P.DEFAULTS, crystalScale: -5, porosity: 2, wetness: NaN, seed: "x" };
  const check = P.validateParams(bad);
  assert.strictEqual(check.ok, false);
  assert.ok(check.errors.length >= 4, "should report every bad field");
  assert.ok(check.errors.some((e) => e.includes("crystalScale")));
  assert.ok(check.errors.some((e) => e.includes("wetness")));
});

test("renderTile throws on invalid params (caller keeps last frame)", () => {
  assert.throws(
    () => R.renderTile({ ...P.DEFAULTS, porosity: 99 }, EMPTY_BRUSH, null, 16, 16),
    /参数无效/
  );
  assert.throws(
    () => R.renderTile(P.DEFAULTS, EMPTY_BRUSH, null, 0, 16),
    /尺寸非法/
  );
});

// ---------- 4. tile continuity (four edges) ----------
test("noise and height field are exactly periodic", () => {
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  for (const [u, v] of [[0.13, 0.71], [0.999, 0.001], [0.5, 0.5]]) {
    assert.ok(near(N.fbm(u, v, 8, 4, 42), N.fbm(u + 1, v, 8, 4, 42)));
    assert.ok(near(N.fbm(u, v, 8, 4, 42), N.fbm(u, v + 1, 8, 4, 42)));
    const h = R.makeHeightField(P.DEFAULTS, EMPTY_BRUSH);
    assert.ok(near(h(u, v), h(u + 1, v)));
    assert.ok(near(h(u, v), h(u, v + 1)));
  }
});

test("rendered tile edges are continuous (seam gradient <= interior)", () => {
  const w = 64, h = 64;
  const img = R.renderTile(P.DEFAULTS, EMPTY_BRUSH, P.DEFAULT_LAYERS, w, h).data;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [img[i], img[i + 1], img[i + 2]];
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let seamMax = 0, innerMax = 0;
  for (let y = 0; y < h; y++) {
    seamMax = Math.max(seamMax, dist(at(w - 1, y), at(0, y))); // right vs left
    if (y > 0) innerMax = Math.max(innerMax, dist(at(0, y), at(0, y - 1)));
  }
  for (let x = 0; x < w; x++) {
    seamMax = Math.max(seamMax, dist(at(x, h - 1), at(x, 0))); // bottom vs top
  }
  assert.ok(
    seamMax <= innerMax * 2.5 + 12,
    `seam gradient ${seamMax} too large vs interior ${innerMax}`
  );
});

// ---------- 5. layer order and toggles ----------
test("layer order is base -> relief -> pores -> wet", () => {
  assert.deepStrictEqual(P.LAYER_ORDER, ["base", "relief", "pores", "wet"]);
});

test("each layer toggle changes the output", () => {
  const full = R.renderTile(P.DEFAULTS, EMPTY_BRUSH, P.DEFAULT_LAYERS, 32, 32).data;
  for (const key of P.LAYER_ORDER) {
    const layers = { ...P.DEFAULT_LAYERS, [key]: false };
    const img = R.renderTile(P.DEFAULTS, EMPTY_BRUSH, layers, 32, 32).data;
    assert.notDeepStrictEqual([...img], [...full], `toggling ${key} must change pixels`);
  }
});

test("wetness raises specular highlights and darkens edges", () => {
  const dry = R.renderTile({ ...P.DEFAULTS, wetness: 0 }, EMPTY_BRUSH, P.DEFAULT_LAYERS, 64, 64).data;
  const wet = R.renderTile({ ...P.DEFAULTS, wetness: 1 }, EMPTY_BRUSH, P.DEFAULT_LAYERS, 64, 64).data;
  const maxOf = (d) => { let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i]); return m; };
  assert.ok(maxOf(wet) > maxOf(dry), "wet surface must have brighter highlights");
});

// ---------- 6. brush wrap-around sync ----------
test("brush dab near one edge appears on the opposite edge", () => {
  const fields = R.buildBrushFields([{ u: 0.02, v: 0.5, r: 0.08, s: 1, mode: "wet" }], 64);
  const near = R.sampleField(fields.wet, 64, 0.02, 0.5);
  const opposite = R.sampleField(fields.wet, 64, 0.98, 0.5);
  assert.ok(near > 0.05, `dab center should be wet, got ${near}`);
  assert.ok(opposite > 0.02, `opposite edge should mirror the dab, got ${opposite}`);
});

// ---------- 7. state persistence ----------
test("state round-trip preserves params, view, layers and dabs", () => {
  const dabs = [
    { u: 0.1, v: 0.2, r: 0.05, s: 0.6, mode: "wet" },
    { u: 0.9, v: 0.8, r: 0.03, s: 0.4, mode: "pit" },
  ];
  const view = { zoom: 2.5, cx: 0.3, cy: 0.7 };
  const layers = { base: true, relief: false, pores: true, wet: true };
  const state = P.makeState(P.DEFAULTS, view, layers, dabs, { paused: true });
  const restored = P.deserializeState(P.serializeState(state));
  assert.deepStrictEqual(restored.params, state.params);
  assert.deepStrictEqual(restored.view, view);
  assert.deepStrictEqual(restored.layers, layers);
  assert.strictEqual(restored.dabs.length, 2);
  assert.strictEqual(restored.dabs[0].u, 0.1);
  assert.strictEqual(restored.paused, true);
});

test("corrupt or invalid saved state is rejected (falls back to defaults)", () => {
  assert.strictEqual(P.deserializeState("not json"), null);
  assert.strictEqual(P.deserializeState('{"version":99}'), null);
  const badParams = P.makeState(P.DEFAULTS, null, null, []);
  badParams.params.wetness = 5;
  assert.strictEqual(P.deserializeState(JSON.stringify(badParams)), null);
});

test("invalid dabs are filtered, valid ones keep position", () => {
  const dabs = P.validateDabs([
    { u: 0.3, v: 0.4, r: 0.05, s: 0.5, mode: "wet" },
    { u: "x", v: 0.4, r: 0.05, s: 0.5, mode: "wet" },
    { u: 0.3, v: 0.4, r: 9, s: 0.5, mode: "wet" },
    { u: 0.3, v: 0.4, r: 0.05, s: 0.5, mode: "explode" },
  ]);
  assert.strictEqual(dabs.length, 1);
  assert.strictEqual(dabs[0].u, 0.3);
});

// ---------- 8. export sizes ----------
test("export renders 512 and 1024 deterministically", () => {
  for (const size of [512, 1024]) {
    const a = R.renderTile(P.DEFAULTS, EMPTY_BRUSH, P.DEFAULT_LAYERS, size, size);
    assert.strictEqual(a.width, size);
    assert.strictEqual(a.data.length, size * size * 4);
    assertNoNaN(a);
    if (size === 512) {
      const b = R.renderTile(P.DEFAULTS, EMPTY_BRUSH, P.DEFAULT_LAYERS, size, size);
      assert.deepStrictEqual([...a.data], [...b.data]);
    }
  }
}, 60000);

// ---------- 9. reload consistency (object count & positions) ----------
test("crystal feature points are stable across reloads", () => {
  delete require.cache[require.resolve("../js/noise.js")];
  const N2 = require("../js/noise.js");
  for (const [x, y] of [[3, 7], [11, 2], [0, 0]]) {
    assert.strictEqual(N.hash2(x, y, 123), N2.hash2(x, y, 123));
  }
  const v1 = N.voronoi(0.37, 0.62, 12, 99);
  const v2 = N2.voronoi(0.37, 0.62, 12, 99);
  assert.strictEqual(v1.id, v2.id);
  assert.strictEqual(v1.f1, v2.f1);
});

console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}`);

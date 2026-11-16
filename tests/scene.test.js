import test from "node:test";
import assert from "node:assert/strict";
import {
  BED_SIZE,
  BENCH_IDS,
  BEDS,
  DEFAULT_SEED,
  DEFAULT_STATE,
  SceneValidationError,
  cloneDefaultState,
  createScene,
  isPointOnPath,
  mergeState,
  nearestPathPoint,
  pointInsideBed,
  sanitizeLoadedState,
  validateState
} from "../src/scene.js";

function group(name, callback) {
  return test(name, callback);
}

group("默认参数：固定种子、花坛几何与步道避让", () => {
  const first = createScene(DEFAULT_SEED);
  const second = createScene(DEFAULT_SEED);
  assert.equal(first.plantCount, 232);
  assert.deepEqual(first, second, "同一 seed 必须生成完全一致的排布");
  assert.equal(first.beds.length, 4);

  const allPlants = first.beds.flatMap((bed) => bed.plants);
  assert.equal(allPlants.length, 232);
  for (const bed of first.beds) {
    assert.equal(bed.plants.length, 58);
    for (const plant of bed.plants) {
      assert.ok(pointInsideBed(plant.x, plant.z, 0.27), `${plant.id} 必须在花坛内`);
      assert.equal(isPointOnPath(plant.x, plant.z, 0.29), false, `${plant.id} 与步道发生碰撞`);
      assert.ok(Math.abs(plant.x - bed.x) <= BED_SIZE / 2);
      assert.ok(Math.abs(plant.z - bed.z) <= BED_SIZE / 2);
    }
  }

  const state = validateState(cloneDefaultState());
  assert.deepEqual(state.benches.map((bench) => bench.id), BENCH_IDS);
  assert.equal(state.benches.length, 3);
  for (const bench of state.benches) assert.ok(isPointOnPath(bench.x, bench.z));
  assert.deepEqual(state.layers, {
    ground: true,
    paths: true,
    beds: true,
    plants: true,
    benches: true,
    decor: true
  });
});

group("默认参数：长椅吸附后仍在步道上且位置稳定", () => {
  const point = nearestPathPoint(4.8, 4.6);
  assert.ok(isPointOnPath(point.x, point.z));
  const candidate = mergeState(DEFAULT_STATE, {
    benches: DEFAULT_STATE.benches.map((bench) => bench.id === "bench-a"
      ? { ...bench, ...point }
      : bench)
  });
  assert.doesNotThrow(() => validateState(candidate));
  const repeated = nearestPathPoint(4.8, 4.6);
  assert.deepEqual(point, repeated);
});

group("边界参数：极端视角、缩放、种子与步道端点均可用", () => {
  const corners = [
    { angle: -180, zoom: 0.65 },
    { angle: 180, zoom: 1.45 },
    { angle: 0, zoom: 0.65 },
    { angle: 0, zoom: 1.45 }
  ];
  for (const view of corners) {
    assert.doesNotThrow(() => validateState(mergeState(DEFAULT_STATE, {
      view,
      season: "winter",
      layers: { ground: false, decor: false }
    })));
  }

  for (const seed of [1, 4294967295]) {
    const scene = createScene(seed);
    assert.equal(scene.seed, seed);
    assert.equal(scene.plantCount, 232);
  }

  const edgeState = mergeState(DEFAULT_STATE, {
    seed: 4294967295,
    season: "autumn",
    view: { angle: 180, zoom: 1.45 },
    benches: [
      { id: "bench-a", x: 0.82, z: -5.75, rotation: 90 },
      { id: "bench-b", x: -0.82, z: 5.75, rotation: -90 },
      { id: "bench-c", x: 5.75, z: 0.82, rotation: 180 }
    ]
  });
  assert.doesNotThrow(() => validateState(edgeState));

  const clamped = nearestPathPoint(999, -999);
  assert.ok(isPointOnPath(clamped.x, clamped.z));
  assert.ok(Math.abs(clamped.x) <= 0.82 || Math.abs(clamped.z) <= 0.82);
  assert.ok(clamped.z >= -5.75 && clamped.z <= 5.75);
});

group("异常参数：非法种子、视角、季节、长椅和图层均给出原因", () => {
  const cases = [
    [{ seed: 0 }, /seed/],
    [{ seed: 1.5 }, /seed/],
    [{ season: "monsoon" }, /season/],
    [{ view: { angle: -181, zoom: 1 } }, /angle/],
    [{ view: { angle: 0, zoom: 2 } }, /zoom/],
    [{ layers: { ...DEFAULT_STATE.layers, beds: "yes" } }, /图层 beds/],
    [{ benches: [] }, /3 张长椅/],
    [{
      benches: DEFAULT_STATE.benches.map((bench, index) => index === 0
        ? { ...bench, x: 4.8, z: 4.8 }
        : bench)
    }, /必须位于步道上/]
  ];

  for (const [patch, pattern] of cases) {
    assert.throws(
      () => validateState(mergeState(DEFAULT_STATE, patch)),
      (error) => error instanceof SceneValidationError && pattern.test(error.message)
    );
  }

  assert.throws(
    () => validateState(null),
    (error) => error instanceof SceneValidationError && /对象/.test(error.message)
  );
});

group("异常参数：损坏存档回退默认并报告原始原因", () => {
  const broken = sanitizeLoadedState({
    seed: -10,
    season: "spring",
    view: { angle: 0, zoom: 1 },
    layers: DEFAULT_STATE.layers,
    benches: DEFAULT_STATE.benches
  });
  assert.match(broken.error, /seed/);
  assert.equal(broken.state.seed, DEFAULT_SEED);

  const malformed = sanitizeLoadedState("not-an-object");
  assert.ok(malformed.error);
  assert.deepEqual(malformed.state, cloneDefaultState());

  const valid = sanitizeLoadedState({
    seed: 42,
    season: "winter",
    view: { angle: 90, zoom: 0.8 },
    layers: DEFAULT_STATE.layers,
    benches: DEFAULT_STATE.benches,
    paused: true
  });
  assert.equal(valid.error, null);
  assert.equal(valid.state.seed, 42);
  assert.equal(valid.state.season, "winter");
});

group("几何常量：四个花坛彼此分离且不压住步道", () => {
  assert.equal(BEDS.length, 4);
  for (const bed of BEDS) {
    const corners = [
      [bed.x - BED_SIZE / 2, bed.z - BED_SIZE / 2],
      [bed.x + BED_SIZE / 2, bed.z - BED_SIZE / 2],
      [bed.x + BED_SIZE / 2, bed.z + BED_SIZE / 2],
      [bed.x - BED_SIZE / 2, bed.z + BED_SIZE / 2]
    ];
    for (const [x, z] of corners) assert.equal(isPointOnPath(x, z), false);
  }
  for (let left = 0; left < BEDS.length; left += 1) {
    for (let right = left + 1; right < BEDS.length; right += 1) {
      const distance = Math.hypot(BEDS[left].x - BEDS[right].x, BEDS[left].z - BEDS[right].z);
      assert.ok(distance >= BED_SIZE);
    }
  }
});

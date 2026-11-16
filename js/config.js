/* 港区常量、固定尺寸和 seed 世界生成。 */
(function (G) {
  'use strict';
  const RNG = G.TowRNG;

  const CFG = Object.freeze({
    VERSION: 1,
    SAVE_VERSION: 1,
    DT: 1 / 60,
    WORLD_W: 1200,
    WORLD_H: 720,
    LAND_MARGIN: 42,
    WATER_Y: 88,
    WET_QUAY_Y: 182,
    SHIFT_SECONDS: 360,
    TRUCK_MASS: 3.4,
    TRUCK_RADIUS: 14,
    CARGO_RADIUS: 17,
    MAX_FORWARD: 148,
    MAX_REVERSE: 52,
    ENGINE_ACCEL: 105,
    BRAKE_ACCEL: 170,
    WHEELBASE: 35,
    MAX_STEER: 0.66,
    HOOK_RANGE: 46,
    DROP_RANGE: 56,
    DROP_SPEED: 18,
    CHECKPOINT_SCHEMA: 1,
    SEED_DEFAULT: 804,
    CATALOG: Object.freeze({
      FIXED_START: { x: 176, y: 472, heading: -0.18 },
      DROP_SLOTS: [
        { x: 132, y: 584 },
        { x: 242, y: 584 },
        { x: 352, y: 584 }
      ],
      BAYS: [
        [{ x: 316, y: 216 }, { x: 358, y: 208 }, { x: 384, y: 232 }],
        [{ x: 622, y: 526 }, { x: 686, y: 506 }, { x: 708, y: 566 }],
        [{ x: 1006, y: 230 }, { x: 1018, y: 252 }, { x: 988, y: 264 }]
      ],
      ALLEY: { left: 930, right: 1090, top: 170, bottom: 334 },
      OBSTACLE_SLOTS: [
        [520, 142, 'stack'], [682, 140, 'stack'], [808, 196, 'bollard'],
        [470, 332, 'bollard'], [548, 292, 'stack'], [752, 330, 'bollard'],
        [790, 440, 'stack'], [466, 548, 'bollard'], [754, 628, 'stack'],
        [888, 548, 'bollard'], [580, 410, 'bollard'], [262, 348, 'stack'],
        [850, 300, 'bollard'], [560, 648, 'bollard'], [1140, 440, 'stack']
      ],
      DECOR_STACKS: [
        [90, 120, 0.05], [430, 122, -0.03], [760, 118, 0.02],
        [1120, 126, -0.04], [98, 300, 0.02], [1135, 620, -0.03]
      ]
    })
  });

  function pick(rand, list) {
    return list[Math.floor(rand() * list.length) % list.length];
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  function cargoId(seed, index, used) {
    let n = 100 + Math.floor(RNG.hashSeed(seed, 'cargo-' + index) % 900);
    while (used.has(n)) n = 100 + ((n + 17) % 900);
    used.add(n);
    return 'F-' + String(n).padStart(3, '0');
  }

  function generateWorld(seed) {
    seed = Number(seed) >>> 0;
    const rand = RNG.mulberry32(RNG.hashSeed(seed, 'quay-world'));
    const used = new Set();
    const bays = CFG.CATALOG.BAYS.map((variants, i) => ({ ...pick(rand, variants), seq: i + 1 }));
    const dropOrder = [0, 1, 2];
    for (let i = dropOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = dropOrder[i]; dropOrder[i] = dropOrder[j]; dropOrder[j] = t;
    }
    const mission = bays.map((bay, i) => ({
      seq: i + 1,
      cargoId: cargoId(seed, i, used),
      weight: round(4.8 + rand() * 2.6),
      pickup: { x: round(bay.x), y: round(bay.y) },
      drop: { ...CFG.CATALOG.DROP_SLOTS[dropOrder[i]] }
    }));

    const obstacleCount = 10;
    const candidates = CFG.CATALOG.OBSTACLE_SLOTS.slice();
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = candidates[i]; candidates[i] = candidates[j]; candidates[j] = t;
    }
    const obstacles = candidates.slice(0, obstacleCount).map((slot, i) => ({
      id: 'OBS-' + String(i + 1).padStart(2, '0'),
      type: slot[2],
      x: slot[0],
      y: slot[1],
      w: slot[2] === 'stack' ? 38 : 14,
      h: slot[2] === 'stack' ? 27 : 14,
      radius: slot[2] === 'stack' ? 22 : 9,
      order: i
    }));

    const windBase = rand() * Math.PI * 2;
    const windSpeed = round(3.2 + rand() * 5.8);
    const world = {
      seed,
      version: CFG.VERSION,
      width: CFG.WORLD_W,
      height: CFG.WORLD_H,
      waterY: CFG.WATER_Y,
      wetQuayY: CFG.WET_QUAY_Y,
      alley: { ...CFG.CATALOG.ALLEY },
      start: { ...CFG.CATALOG.FIXED_START },
      mission,
      obstacles,
      decorStacks: CFG.CATALOG.DECOR_STACKS.map((d, i) => ({
        id: 'DEC-' + i, x: d[0], y: d[1], angle: d[2]
      })),
      wind: { base: round(windBase), speed: windSpeed },
      dropSlots: CFG.CATALOG.DROP_SLOTS.map((p) => ({ ...p })),
      mapVersion: 'quay-804-a'
    };
    world.signature = worldSignature(world);
    return world;
  }

  function worldSignature(world) {
    const payload = JSON.stringify({
      mapVersion: world.mapVersion,
      mission: world.mission,
      obstacles: world.obstacles,
      wind: world.wind
    });
    return RNG.hashString(payload).toString(16).padStart(8, '0');
  }

  function currentWind(world, t) {
    const angle = world.wind.base + Math.sin(t * 0.028 + world.seed * 0.001) * 0.42;
    const gust = 1 + Math.sin(t * 0.13 + 0.7) * 0.14;
    return {
      angle,
      speed: round(world.wind.speed * gust),
      label: angleLabel(angle)
    };
  }

  function angleLabel(angle) {
    const labels = ['东风', '东南风', '南风', '西南风', '西风', '西北风', '北风', '东北风'];
    const from = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return labels[Math.round(from / (Math.PI / 4)) % 8];
  }

  function wetSurface(world, x, y) {
    return y < world.wetQuayY && y > world.waterY;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  G.TowConfig = { CFG, generateWorld, worldSignature, currentWind, wetSurface, clone, round };
  if (typeof module !== 'undefined' && module.exports) module.exports = G.TowConfig;
})(typeof globalThis !== 'undefined' ? globalThis : this);

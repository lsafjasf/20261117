import { makeRng } from './rng.js';

export const TILE = 48;
export const COLS = 120;
export const ROWS = 24;
export const WATER_HALF_TILES = 6; // 水面半宽（格）

const WAREHOUSE_FRACS = [0.2, 0.5, 0.8];
const CHECKPOINT_FRACS = [0.02, 0.15, 0.42, 0.68];

export function generateWorld(seed) {
  const rng = makeRng(seed);
  const width = COLS * TILE;
  const height = ROWS * TILE;
  const centers = [];
  let y = height / 2;
  for (let c = 0; c < COLS; c++) {
    if (c > 1) y += rng.range(-30, 30);
    y = Math.max(height * 0.34, Math.min(height * 0.66, y));
    centers.push(y);
  }

  // 洞顶净高（格）：普通段较高，随机生成低矮段限制载货高度。
  const clearance = [];
  for (let c = 0; c < COLS; c++) clearance.push(rng.range(6.4, 7.6));
  const lowCount = rng.int(4, 6);
  for (let i = 0; i < lowCount; i++) {
    const start = rng.int(6, COLS - 12);
    const len = rng.int(3, 6);
    const h = rng.range(4.4, 5.1);
    for (let c = start; c < Math.min(COLS, start + len); c++) clearance[c] = h;
  }

  const obstacles = [];
  const warehouseCols = WAREHOUSE_FRACS.map((f) => Math.round(f * (COLS - 1)));
  const checkpointCols = CHECKPOINT_FRACS.map((f) => Math.round(f * (COLS - 1)));
  let nextFreeCol = 6;
  let obstacleId = 0;
  for (let c = 5; c < COLS - 4; c++) {
    const nearWarehouse = warehouseCols.some((w) => Math.abs(w - c) <= 3);
    const nearCheckpoint = checkpointCols.some((w) => Math.abs(w - c) <= 2);
    if (c < nextFreeCol || nearWarehouse || nearCheckpoint) continue;
    if (rng.next() < 0.34) {
      // 岩石必须偏离河道中心线，保证中线深水航路始终可通行。
      const side = rng.next() < 0.5 ? -1 : 1;
      const offsetTiles = side * rng.range(2.6, WATER_HALF_TILES - 1.2);
      obstacles.push({
        id: `rock-${obstacleId++}`,
        type: 'rock',
        x: c * TILE + rng.range(8, TILE - 8),
        y: centers[c] + offsetTiles * TILE,
        r: rng.range(14, 26),
      });
      nextFreeCol = c + rng.int(2, 4);
    }
  }

  const warehouses = warehouseCols.map((c, i) => {
    const side = i % 2 === 0 ? -1 : 1; // 交替靠上/下岸
    return {
      id: `warehouse-${i}`,
      index: i,
      col: c,
      x: c * TILE + TILE / 2,
      y: centers[c] + side * (WATER_HALF_TILES - 4.3) * TILE,
      side,
      delivered: false,
    };
  });

  const checkpoints = checkpointCols.map((c, i) => ({
    id: `cp-${i}`,
    col: c,
    x: c * TILE + TILE / 2,
    y: centers[c],
  }));

  // 每列水流，方向沿河道弯向，强度确定性变化。
  const currents = [];
  for (let c = 0; c < COLS; c++) {
    const bend = c + 1 < COLS ? (centers[c + 1] - centers[c]) / TILE : 0;
    currents.push({
      col: c,
      strength: rng.range(12, 34),
      angle: Math.max(-0.32, Math.min(0.32, bend * 0.5 + rng.range(-0.1, 0.1))),
    });
  }

  const waypoints = centers.map((cy, c) => ({ x: c * TILE + TILE / 2, y: cy }));

  return {
    seed: String(seed),
    TILE,
    COLS,
    ROWS,
    width,
    height,
    waterHalfTiles: WATER_HALF_TILES,
    centers,
    clearance,
    obstacles,
    warehouses,
    checkpoints,
    currents,
    waypoints,
  };
}

export function columnAt(world, x) {
  return Math.max(0, Math.min(world.COLS - 1, Math.floor(x / world.TILE)));
}

export function centerYAt(world, x) {
  return world.centers[columnAt(world, x)];
}

export function waterTopAt(world, x) {
  return centerYAt(world, x) - world.waterHalfTiles * world.TILE;
}

export function waterBottomAt(world, x) {
  return centerYAt(world, x) + world.waterHalfTiles * world.TILE;
}

// 洞顶岩石的下沿 y：洞顶在水面上方（屏幕坐标 y 更小）。
// 船货顶端 topY 小于该值即刮顶；clearance 越小洞顶越低、越危险。
export function ceilingYAt(world, x) {
  const c = columnAt(world, x);
  return waterTopAt(world, x) - 24 - (world.clearance[c] - 4.4) * 26;
}

// 返回 'rock' | 'shoal' | 'water'
export function tileAt(world, x, y) {
  if (x < 0 || x >= world.width || y < 0 || y >= world.height) return 'rock';
  const c = columnAt(world, x);
  const dist = Math.abs(y - world.centers[c]);
  const half = world.waterHalfTiles * world.TILE;
  if (dist <= half - world.TILE * 0.45) return 'water';
  if (dist <= half) return 'shoal';
  return 'rock';
}

export function currentAt(world, x) {
  return world.currents[columnAt(world, x)];
}

// 风仅为环境力，按帧确定，暂停时不推进帧号。
export function windAt(frame, seedHash) {
  const t = frame / 60;
  const angle =
    Math.sin(t * 0.11 + seedHash * 0.000001) * 0.9 +
    Math.sin(t * 0.037 + 1.7) * 0.5;
  const strength = 26 + Math.sin(t * 0.07 + seedHash * 0.000003) * 14;
  return { angle, strength };
}

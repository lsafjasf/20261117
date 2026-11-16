// 确定性生成的栖息地网格数据：正常 / 缺失 / 异常三个时间窗口。
// 所有数据由固定种子的伪随机函数生成，任何数值都不是“写死的预设结果”。

export const GRID_COLS = 16;
export const GRID_ROWS = 12;
export const CELL_COUNT = GRID_COLS * GRID_ROWS;

// 原始量纲的合法范围（异常数据会超出该范围，由管道负责清洗）。
export const RAW_RANGE = {
  elevation: { min: 0, max: 2600 },
  ndvi: { min: -1, max: 1 },
  waterDist: { min: 0, max: 6000 },
};

export const WINDOWS = [
  { id: 'W1', label: '2026-09（正常）', start: '2026-09-01', end: '2026-09-30', kind: 'normal' },
  { id: 'W2', label: '2026-10（缺失）', start: '2026-10-01', end: '2026-10-31', kind: 'missing' },
  { id: 'W3', label: '2026-11（异常）', start: '2026-11-01', end: '2026-11-30', kind: 'anomaly' },
];

// 可复现的 mulberry32 伪随机数。
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 地形基值（不随窗口变化）：高程、距水源距离、植被基准。
function baseTerrain() {
  const rand = rng(hashSeed('base-terrain-v1'));
  const cells = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const id = row * GRID_COLS + col;
      const nx = col / (GRID_COLS - 1);
      const ny = row / (GRID_ROWS - 1);
      const ridge = Math.sin(nx * 5.1) * 320 + Math.cos(ny * 4.3) * 260;
      const elevation = Math.round(clamp(180 + ny * 1500 + ridge + (rand() - 0.5) * 220, 20, 2580));
      // 左下方向存在一条河谷，距离随到河谷的接近程度衰减。
      const river = Math.abs((row - (GRID_ROWS - 1 - col * 0.55)) / GRID_ROWS);
      const waterDist = Math.round(clamp(180 + river * 4600 + (rand() - 0.5) * 500, 40, 5950));
      const ndviBase = clamp(0.82 - ny * 0.55 - elevation / 9000 + (rand() - 0.5) * 0.12, -0.05, 0.95);
      cells.push({ id, row, col, elevation, waterDist, ndviBase });
    }
  }
  return cells;
}

const TERRAIN = baseTerrain();

function tsFor(windowId, index) {
  const w = WINDOWS.find((x) => x.id === windowId);
  const day = (index % 27) + 1;
  const hour = (index * 7) % 24;
  return `${w.start}T${String(hour).padStart(2, '0')}:00:00`;
}

// 生成一个窗口的原始记录（含重复、缺失、异常，按窗口特征注入）。
export function buildWindowRecords(windowId) {
  const win = WINDOWS.find((w) => w.id === windowId);
  const rand = rng(hashSeed(`${windowId}-records-v1`));
  const records = [];
  TERRAIN.forEach((cell) => {
    const shift = (rand() - 0.5) * (win.kind === 'anomaly' ? 0.45 : 0.18);
    const ndvi = clamp(cell.ndviBase + shift + (windowId === 'W3' ? -0.12 : 0), -1, 1);
    const elevation = cell.elevation + Math.round((rand() - 0.5) * 30);
    const waterDist = cell.waterDist + Math.round((rand() - 0.5) * 120);

    const record = {
      recordId: `${windowId}-R${cell.id}`,
      cellId: cell.id,
      row: cell.row,
      col: cell.col,
      windowId,
      timestamp: tsFor(windowId, cell.id),
      elevation,
      ndvi: Number(ndvi.toFixed(3)),
      waterDist,
    };
    records.push(record);

    // 每个窗口都注入约 8% 完全重复的记录，验证去重。
    if (cell.id % 12 === 3) {
      records.push({ ...record, recordId: `${windowId}-R${cell.id}-DUP` });
    }

    if (win.kind === 'missing') {
      // 约 15% 单元格出现字段缺失（null / undefined / NaN 三种形式）。
      if (cell.id % 7 === 2) record.elevation = null;
      if (cell.id % 7 === 4) record.ndvi = undefined;
      if (cell.id % 7 === 6) record.waterDist = Number.NaN;
    }

    if (win.kind === 'anomaly') {
      // 约 12% 单元格出现超范围/错误类型的异常值。
      if (cell.id % 8 === 1) record.elevation = -450;
      if (cell.id % 8 === 3) record.elevation = 99999;
      if (cell.id % 8 === 5) record.ndvi = 2.7;
      if (cell.id % 8 === 7) record.waterDist = -80;
      if (cell.id % 11 === 6) record.ndvi = 'ERR';
    }
  });
  return records;
}

export function buildDataset() {
  const windows = WINDOWS.map((w) => ({
    meta: w,
    records: buildWindowRecords(w.id),
  }));
  return { cols: GRID_COLS, rows: GRID_ROWS, windows, terrain: TERRAIN };
}

// 管网拓扑与三组原始遥测数据的确定性生成器（无 DOM 依赖，可在 Node 中测试）

export const BASE_TIME = Date.UTC(2026, 10, 16, 0, 0, 0); // 2026-11-16T00:00Z
export const STEP_MS = 5 * 60 * 1000; // 5 分钟一个采样槽
export const SLOT_COUNT = 24 * 12; // 24 小时共 288 槽
export const METRICS = ['pressure', 'flow', 'leakage'];

export const THRESHOLDS = {
  pressureMin: 0.16, // MPa，低于此值为低压异常
  pressureMax: 0.6, // MPa，高于此值为超压异常
  leakageMax: 8 // m³/h，高于此值为漏损异常
};

// 世界坐标范围 0..100 / 0..60，渲染时映射到 Canvas
export const NODES = [
  { id: 'N01', zone: '北区', x: 8, y: 12, source: true },
  { id: 'N02', zone: '南区', x: 8, y: 44, source: true },
  { id: 'N03', zone: '北区', x: 28, y: 10 },
  { id: 'N04', zone: '中区', x: 28, y: 30 },
  { id: 'N05', zone: '南区', x: 28, y: 50 },
  { id: 'N06', zone: '北区', x: 50, y: 8 },
  { id: 'N07', zone: '中区', x: 50, y: 26 },
  { id: 'N08', zone: '南区', x: 50, y: 44 },
  { id: 'N09', zone: '北区', x: 72, y: 12 },
  { id: 'N10', zone: '中区', x: 72, y: 30 },
  { id: 'N11', zone: '南区', x: 72, y: 50 },
  { id: 'N14', zone: '北区', x: 90, y: 8 },
  { id: 'N12', zone: '北区', x: 90, y: 20 },
  { id: 'N13', zone: '中区', x: 90, y: 40 }
];

export const EDGES = [
  { id: 'E01', a: 'N01', b: 'N03', d: 350 },
  { id: 'E02', a: 'N03', b: 'N06', d: 300 },
  { id: 'E03', a: 'N06', b: 'N09', d: 300 },
  { id: 'E04', a: 'N09', b: 'N12', d: 250 },
  { id: 'E05', a: 'N09', b: 'N14', d: 200 },
  { id: 'E06', a: 'N01', b: 'N04', d: 350 },
  { id: 'E07', a: 'N02', b: 'N04', d: 350 },
  { id: 'E08', a: 'N02', b: 'N05', d: 350 },
  { id: 'E09', a: 'N03', b: 'N04', d: 250 },
  { id: 'E10', a: 'N04', b: 'N05', d: 250 },
  { id: 'E11', a: 'N06', b: 'N07', d: 250 },
  { id: 'E12', a: 'N07', b: 'N08', d: 250 },
  { id: 'E13', a: 'N05', b: 'N08', d: 300 },
  { id: 'E14', a: 'N07', b: 'N10', d: 250 },
  { id: 'E15', a: 'N09', b: 'N10', d: 250 },
  { id: 'E16', a: 'N10', b: 'N11', d: 250 },
  { id: 'E17', a: 'N08', b: 'N11', d: 300 },
  { id: 'E18', a: 'N10', b: 'N13', d: 200 },
  { id: 'E19', a: 'N12', b: 'N13', d: 200 },
  { id: 'E20', a: 'N11', b: 'N13', d: 200 }
];

export const ZONES = ['北区', '中区', '南区'];

const nodeMap = new Map(NODES.map((n) => [n.id, n]));

// 管线长度按世界坐标距离换算（米），并补充邻接表
EDGES.forEach((e) => {
  const na = nodeMap.get(e.a);
  const nb = nodeMap.get(e.b);
  e.length = Math.round(Math.hypot(na.x - nb.x, na.y - nb.y) * 120);
  e.weight = e.length / (e.d / 200); // 简化水力阻力权重
});
NODES.forEach((n) => { n.adj = []; });
EDGES.forEach((e) => {
  nodeMap.get(e.a).adj.push({ to: e.b, edge: e.id });
  nodeMap.get(e.b).adj.push({ to: e.a, edge: e.id });
});

export function getNode(id) { return nodeMap.get(id); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(x, s) { return Math.exp(-(x * x) / (2 * s * s)); }

// 用水时变化曲线：早 8 点、晚 19 点两个高峰
function demandFactor(slot) {
  const hour = (slot * 5) / 60;
  return 0.72 + 0.22 * gauss(hour - 8, 2.2) + 0.3 * gauss(hour - 19, 2.5);
}

// BFS 求各节点离水源的跳数，作为基础压力衰减依据
function baseHops() {
  const hops = new Map(NODES.map((n) => [n.id, n.source ? 0 : Infinity]));
  const queue = NODES.filter((n) => n.source).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift();
    for (const next of nodeMap.get(id).adj) {
      if (hops.get(next.to) === Infinity) {
        hops.set(next.to, hops.get(id) + 1);
        queue.push(next.to);
      }
    }
  }
  return hops;
}

const HOPS = baseHops();

function completeSeries(dataset) {
  const seed = { normal: 11, missing: 29, anomaly: 47 }[dataset];
  const rand = mulberry32(seed);
  const noise = (amp) => (rand() - 0.5) * 2 * amp;
  const records = [];
  for (const node of NODES) {
    const baseP = node.source ? 0.42 : 0.4 - HOPS.get(node.id) * 0.022;
    const baseFlow = 18 + (node.id.charCodeAt(1) * 7) % 26;
    const baseLeak = 0.4 + (node.id.charCodeAt(2) % 5) * 0.14;
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const ts = BASE_TIME + slot * STEP_MS;
      const demand = demandFactor(slot);
      const pressure = round3(baseP - 0.035 * (demand - 0.95) + noise(0.006));
      const flow = round2(baseFlow * demand + noise(1.4));
      const leakage = round2(baseLeak * Math.pow(pressure / 0.32, 1.4) + noise(0.08));
      records.push(rec(node.id, 'pressure', ts, pressure));
      records.push(rec(node.id, 'flow', ts, Math.max(0, flow)));
      records.push(rec(node.id, 'leakage', ts, Math.max(0, leakage)));
    }
  }
  return { records, rand };
}

function rec(nodeId, metric, ts, value) {
  return { nodeId, metric, ts, value: round3(value), quality: 'measured' };
}
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }

// 返回原始数据（含重复/缺失/异常，等待管线处理），并附带构造说明供测试断言
export function generateRaw(dataset) {
  const { records, rand } = completeSeries(dataset);
  const note = { duplicates: 0, missing: 0, anomalies: 0, duplicateKeys: new Set() };
  if (dataset === 'normal') {
    return { records, note: { ...note, duplicateKeys: [] } };
  }

  const dropRate = dataset === 'missing' ? 0.15 : 0.03;
  const dupRate = dataset === 'missing' ? 0.05 : 0.03;
  const kept = [];
  for (const r of records) {
    // 缺失数据集：N07 压力连续 9 个槽（50~58）整段缺失
    const inGap = dataset === 'missing' && r.nodeId === 'N07' &&
      r.metric === 'pressure' && r.ts >= BASE_TIME + 50 * STEP_MS && r.ts < BASE_TIME + 59 * STEP_MS;
    if (inGap || rand() < dropRate) { note.missing += 1; continue; }
    kept.push(r);
    if (rand() < dupRate) {
      const dup = { ...r, value: round3(r.value * 1.001 + 0.0005) };
      kept.push(dup); // 重复记录，值略有差异，用于验证“后值覆盖前值”
      note.duplicates += 1;
      note.duplicateKeys.add(`${r.nodeId}|${r.metric}|${r.ts}`);
    }
  }

  if (dataset === 'anomaly') {
    // N10 爆管：连续 2 小时低压 + 高漏损
    for (let slot = 150; slot < 175; slot += 1) {
      const ts = BASE_TIME + slot * STEP_MS;
      mutate(kept, 'N10', 'pressure', ts, (v) => Math.min(v, 0.11 + rand() * 0.04));
      mutate(kept, 'N10', 'leakage', ts, () => 12 + rand() * 8);
      note.anomalies += 2;
    }
    // 散落的超压尖峰
    for (let i = 0; i < 8; i += 1) {
      const node = NODES[Math.floor(rand() * NODES.length)].id;
      const slot = Math.floor(rand() * SLOT_COUNT);
      mutate(kept, node, 'pressure', BASE_TIME + slot * STEP_MS, () => 0.62 + rand() * 0.08);
      note.anomalies += 1;
    }
  }
  return { records: kept, note: { ...note, duplicateKeys: [...note.duplicateKeys] } };
}

function mutate(records, nodeId, metric, ts, fn) {
  const target = records.find((r) => r.nodeId === nodeId && r.metric === metric && r.ts === ts);
  if (target) target.value = round3(fn(target.value));
}

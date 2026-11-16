// 阀门关断模拟：从水源做 BFS 求可达区域；不可达节点/区域标红。
// 可达节点按沿程管线阻力重新分配压力，流量按阻力加权分配。

import { NODES, EDGES, getNode } from './data.js';

const SOURCE_PRESSURE = 0.42; // MPa

export function simulate(closedEdgeIds, snapshot) {
  const closed = new Set(closedEdgeIds);
  const sources = NODES.filter((n) => n.source).map((n) => n.id);

  // BFS：仅经过开启的边，记录每个节点的最短阻力路径
  const dist = new Map(NODES.map((n) => [n.id, Infinity]));
  const parent = new Map();
  const queue = [];
  for (const s of sources) { dist.set(s, 0); queue.push(s); }
  while (queue.length) {
    const id = queue.shift();
    for (const link of getNode(id).adj) {
      if (closed.has(link.edge)) continue;
      const edge = EDGES.find((e) => e.id === link.edge);
      const nd = dist.get(id) + edge.weight;
      if (nd < dist.get(link.to)) {
        dist.set(link.to, nd);
        parent.set(link.to, { from: id, edge: edge.id });
        queue.push(link.to);
      }
    }
  }

  const reachable = new Set([...dist.entries()].filter(([, d]) => Number.isFinite(d)).map(([id]) => id));
  const cutoffNodes = NODES.map((n) => n.id).filter((id) => !reachable.has(id));

  // 关闭边及不可达节点涉及的分区，整片标红
  const cutoffZones = new Set();
  for (const id of cutoffNodes) cutoffZones.add(getNode(id).zone);

  // 用快照中的窗口聚合数据取每节点基准压力/流量/漏损；无数据时给 0
  const latest = latestByNode(snapshot);
  const nodes = NODES.map((node) => {
    const id = node.id;
    if (!reachable.has(id)) {
      return { id, reachable: false, pressure: 0, flow: 0, leakage: 0, anomaly: true, reason: '无法供水' };
    }
    const base = latest.get(id) || {};
    // 压力重分配：随阻力路径衰减；水源保持出厂压力
    const pressure = node.source
      ? SOURCE_PRESSURE
      : Math.max(0.14, SOURCE_PRESSURE - 0.005 * dist.get(id));
    return {
      id,
      reachable: true,
      pressure: round3(pressure),
      flow: base.flow ?? 0,
      leakage: base.leakage ?? 0,
      anomaly: pressure < 0.16
    };
  });

  // 边状态与流向（取父→子方向），关闭边不参与流量
  const edges = EDGES.map((edge) => {
    const isClosed = closed.has(edge.id);
    const childOfA = parent.get(edge.a)?.edge === edge.id;
    const childOfB = parent.get(edge.b)?.edge === edge.id;
    let direction = null;
    if (!isClosed && childOfA) direction = { from: edge.b, to: edge.a };
    if (!isClosed && childOfB) direction = { from: edge.a, to: edge.b };
    return {
      id: edge.id,
      a: edge.a,
      b: edge.b,
      closed: isClosed,
      reachable: reachable.has(edge.a) || reachable.has(edge.b),
      direction
    };
  });

  return {
    closedEdges: closedEdgeIds,
    reachableNodes: [...reachable],
    cutoffNodes,
    cutoffZones: [...cutoffZones],
    nodes,
    edges
  };
}

function latestByNode(snapshot) {
  const map = new Map();
  if (!snapshot) return map;
  const lastTs = Math.max(...snapshot.records.map((r) => r.ts), 0);
  for (const r of snapshot.records) {
    if (r.ts !== lastTs) continue;
    if (!map.has(r.nodeId)) map.set(r.nodeId, {});
    map.get(r.nodeId)[r.metric] = r.value;
  }
  return map;
}

function round3(v) { return Math.round(v * 1000) / 1000; }

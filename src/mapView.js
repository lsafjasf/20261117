// Canvas 管网地图：压力色带、异常点、无法供水区域标红、阀门开关与缩放平移

import { NODES, EDGES, getNode, THRESHOLDS } from './data.js';

const WORLD_W = 100;
const WORLD_H = 60;

// 压力 → 色带（低蓝、中青绿、高橙红）；断供节点单独用实心红
export function pressureColor(p) {
  if (p <= 0) return '#dc2626';
  const stops = [
    { v: 0.16, c: [37, 99, 235] },
    { v: 0.28, c: [16, 185, 129] },
    { v: 0.4, c: [45, 212, 191] },
    { v: 0.52, c: [245, 158, 11] },
    { v: 0.65, c: [220, 38, 38] }
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (p >= stops[i].v && p <= stops[i + 1].v) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = Math.min(1, Math.max(0, (p - lo.v) / (hi.v - lo.v)));
  const c = lo.c.map((v, i) => Math.round(v + (hi.c[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function createMapView(canvas, handlers) {
  const ctx = canvas.getContext('2d');
  const view = {
    scale: 1,
    offsetX: 24,
    offsetY: 26,
    pressureById: new Map(),
    selectedNode: null,
    sim: null,
    anomalyNodeIds: new Set(),
    visibleNodeIds: null
  };

  function toScreen(node) {
    return {
      x: view.offsetX + node.x * (canvas.width - 48) / WORLD_W * view.scale,
      y: view.offsetY + node.y * (canvas.height - 52) / WORLD_H * view.scale
    };
  }

  function hitTest(mx, my) {
    for (const node of NODES) {
      const p = toScreen(node);
      if (Math.hypot(mx - p.x, my - p.y) <= 9) return { type: 'node', id: node.id };
    }
    for (const edge of EDGES) {
      const a = toScreen(getNode(edge.a));
      const b = toScreen(getNode(edge.b));
      const d = distToSegment(mx, my, a.x, a.y, b.x, b.y);
      if (d <= 7) return { type: 'edge', id: edge.id };
    }
    return null;
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawCutoffHalo();
    drawEdges();
    drawNodes();
  }

  function drawGrid() {
    ctx.strokeStyle = 'rgba(80,105,145,.12)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= WORLD_W; gx += 10) {
      const a = toScreen({ x: gx, y: 0 });
      const b = toScreen({ x: gx, y: WORLD_H });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let gy = 0; gy <= WORLD_H; gy += 10) {
      const a = toScreen({ x: 0, y: gy });
      const b = toScreen({ x: WORLD_W, y: gy });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  function drawCutoffHalo() {
    if (!view.sim || !view.sim.cutoffNodes.length) return;
    for (const id of view.sim.cutoffNodes) {
      const p = toScreen(getNode(id));
      const grad = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 34);
      grad.addColorStop(0, 'rgba(220,38,38,.55)');
      grad.addColorStop(1, 'rgba(220,38,38,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawEdges() {
    for (const edge of EDGES) {
      const a = toScreen(getNode(edge.a));
      const b = toScreen(getNode(edge.b));
      const simEdge = view.sim?.edges.find((e) => e.id === edge.id);
      ctx.lineWidth = edge.d >= 300 ? 6 : 4;
      if (simEdge?.closed) {
        ctx.strokeStyle = '#ef4444';
        ctx.setLineDash([9, 7]);
      } else if (simEdge && !simEdge.reachable) {
        ctx.strokeStyle = '#7f1d1d';
        ctx.setLineDash([4, 6]);
      } else {
        const pressure = Math.max(view.pressureById.get(edge.a) || 0.28, view.pressureById.get(edge.b) || 0.28);
        ctx.strokeStyle = pressureColor(pressure);
        ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      if (simEdge?.closed) drawValve(a, b, true);
      else drawValve(a, b, false);
    }
  }

  function drawValve(a, b, closed) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.fillStyle = closed ? '#fecaca' : '#0d1420';
    ctx.strokeStyle = closed ? '#dc2626' : '#7dd3fc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, -5); ctx.lineTo(0, 0); ctx.lineTo(-6, 5);
    ctx.moveTo(6, -5); ctx.lineTo(0, 0); ctx.lineTo(6, 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawNodes() {
    for (const node of NODES) {
      if (view.visibleNodeIds && !view.visibleNodeIds.has(node.id)) continue;
      const p = toScreen(node);
      const simNode = view.sim?.nodes.find((n) => n.id === node.id);
      const cutoff = simNode && !simNode.reachable;
      const isAnomaly = view.anomalyNodeIds.has(node.id) || simNode?.anomaly;
      ctx.beginPath();
      ctx.arc(p.x, p.y, node.source ? 8 : 6, 0, Math.PI * 2);
      if (cutoff) ctx.fillStyle = '#dc2626';
      else if (node.source) ctx.fillStyle = '#fde047';
      else ctx.fillStyle = pressureColor(view.pressureById.get(node.id) ?? 0.28);
      ctx.fill();
      ctx.lineWidth = view.selectedNode === node.id ? 3 : 1.5;
      ctx.strokeStyle = view.selectedNode === node.id ? '#ffffff' : isAnomaly ? '#f87171' : '#0d1420';
      ctx.stroke();
      if (isAnomaly && !cutoff) {
        ctx.strokeStyle = '#f87171';
        ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = cutoff ? '#fecaca' : '#cfe0f7';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(node.id + (cutoff ? ' 断供' : ''), p.x + 9, p.y - 8);
    }
  }

  // 交互：点击与拖拽
  let dragging = false;
  let last = null;
  canvas.addEventListener('mousedown', (ev) => {
    dragging = true; last = { x: ev.offsetX, y: ev.offsetY };
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (!dragging) {
      canvas.style.cursor = hitTest(ev.offsetX, ev.offsetY) ? 'pointer' : 'grab';
      return;
    }
    view.offsetX += ev.offsetX - last.x;
    view.offsetY += ev.offsetY - last.y;
    last = { x: ev.offsetX, y: ev.offsetY };
    render();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('click', (ev) => {
    const hit = hitTest(ev.offsetX, ev.offsetY);
    if (hit) handlers.onPick(hit);
  });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    view.scale = Math.min(2.2, Math.max(0.6, view.scale * (ev.deltaY < 0 ? 1.1 : 0.9)));
    render();
  }, { passive: false });

  return {
    render,
    setData({ pressureById, sim, anomalyNodeIds, visibleNodeIds, selectedNode }) {
      view.pressureById = pressureById;
      view.sim = sim;
      view.anomalyNodeIds = anomalyNodeIds;
      view.visibleNodeIds = visibleNodeIds ? new Set(visibleNodeIds) : null;
      view.selectedNode = selectedNode ?? null;
      render();
    },
    getCanvas: () => canvas
  };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function renderLegend(el) {
  const bands = [
    { label: '≤0.16 低压', c: 'rgb(37,99,235)' },
    { label: '0.28 正常', c: 'rgb(16,185,129)' },
    { label: '0.40 偏高', c: 'rgb(45,212,191)' },
    { label: '0.52 高压', c: 'rgb(245,158,11)' },
    { label: '≥0.65 超压', c: 'rgb(220,38,38)' }
  ];
  el.innerHTML = bands.map((b) => `<span><i class="sw" style="background:${b.c}"></i>${b.label}</span>`).join('')
    + `<span><i class="sw dot" style="background:#dc2626"></i>断供节点/区域</span>`
    + `<span><i class="sw" style="background:#ef4444"></i>已关闭阀门</span>`
    + `<span>阈值：压力 ${THRESHOLDS.pressureMin}~${THRESHOLDS.pressureMax} MPa，漏损 &gt; ${THRESHOLDS.leakageMax} m³/h</span>`;
}

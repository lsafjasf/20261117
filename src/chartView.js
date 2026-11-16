// Canvas 趋势曲线：按指标分带绘制，异常点红色标记，空结果显示空状态

import { METRICS } from './data.js';

const META = {
  pressure: { label: '压力 (MPa)', color: '#38bdf8' },
  flow: { label: '流量 (m³/h)', color: '#34d399' },
  leakage: { label: '漏损 (m³/h)', color: '#fbbf24' }
};

export function createChartView(canvas) {
  const ctx = canvas.getContext('2d');

  function render(snapshot, selectedNode) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const records = selectedNode
      ? snapshot.records.filter((r) => r.nodeId === selectedNode)
      : snapshot.records;
    const metrics = METRICS.filter((m) => records.some((r) => r.metric === m));
    if (!records.length || !metrics.length) {
      drawEmpty();
      return;
    }

    const padL = 58;
    const padR = 16;
    const padT = 24;
    const padB = 34;
    const bandH = (canvas.height - padT - padB - (metrics.length - 1) * 10) / metrics.length;
    const tsMin = Math.min(...records.map((r) => r.ts));
    const tsMax = Math.max(...records.map((r) => r.ts));
    const xOf = (ts) => padL + ((ts - tsMin) / Math.max(1, tsMax - tsMin)) * (canvas.width - padL - padR);

    metrics.forEach((metric, bandIdx) => {
      const top = padT + bandIdx * (bandH + 10);
      const items = records.filter((r) => r.metric === metric).sort((a, b) => a.ts - b.ts);
      const values = items.map((r) => r.value);
      let vMin = Math.min(...values);
      let vMax = Math.max(...values);
      if (vMin === vMax) { vMin -= 1; vMax += 1; }
      const pad = (vMax - vMin) * 0.12;
      vMin -= pad; vMax += pad;
      const yOf = (v) => top + bandH - ((v - vMin) / (vMax - vMin)) * (bandH - 14) - 6;

      // 分带边框与标题
      ctx.strokeStyle = 'rgba(80,105,145,.25)';
      ctx.strokeRect(padL, top, canvas.width - padL - padR, bandH);
      ctx.fillStyle = META[metric].color;
      ctx.font = '12px sans-serif';
      ctx.fillText(META[metric].label, padL + 6, top + 14);
      ctx.fillStyle = '#7e8da6';
      ctx.fillText(`均值 ${avg(values)}  最大 ${Math.max(...values)}  最小 ${Math.min(...values)}`, padL + 120, top + 14);

      // y 轴刻度
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      for (let i = 0; i <= 2; i += 1) {
        const v = vMin + (vMax - vMin) * (i / 2);
        const y = yOf(v);
        ctx.fillText(v.toFixed(2), 8, y + 3);
        ctx.strokeStyle = 'rgba(80,105,145,.12)';
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(canvas.width - padR, y); ctx.stroke();
      }

      // 折线（同指标多节点：按节点分组各画一条）
      const byNode = new Map();
      for (const r of items) {
        if (!byNode.has(r.nodeId)) byNode.set(r.nodeId, []);
        byNode.get(r.nodeId).push(r);
      }
      for (const [, series] of byNode) {
        ctx.strokeStyle = META[metric].color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        series.forEach((r, i) => {
          const x = xOf(r.ts);
          const y = yOf(r.value);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      // 异常点红圈
      const anomalyKeys = new Set(snapshot.anomalies.map((a) => `${a.nodeId}|${a.metric}|${a.ts}`));
      ctx.fillStyle = '#f87171';
      for (const r of items) {
        if (anomalyKeys.has(`${r.nodeId}|${r.metric}|${r.ts}`)) {
          ctx.beginPath(); ctx.arc(xOf(r.ts), yOf(r.value), 3.4, 0, Math.PI * 2); ctx.fill();
        }
      }
    });

    // x 轴时间标签
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    for (let i = 0; i <= 4; i += 1) {
      const ts = tsMin + (tsMax - tsMin) * (i / 4);
      const label = new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
      ctx.fillText(label, padL + ((canvas.width - padL - padR) * i) / 4 - 14, canvas.height - 12);
    }
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(selectedNode ? `节点 ${selectedNode} 明细` : `全部节点（${new Set(records.map((r) => r.nodeId)).size} 个）`, padL, 14);
  }

  function drawEmpty() {
    ctx.fillStyle = '#f87171';
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('当前筛选条件下无曲线数据（空结果）', canvas.width / 2, canvas.height / 2);
    ctx.textAlign = 'left';
  }

  function avg(values) {
    return (values.reduce((s, v) => s + v, 0) / values.length).toFixed(2);
  }

  return { render, getCanvas: () => canvas };
}

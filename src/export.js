// 报告导出：HTML（内嵌当前屏幕 Canvas 截图 + 同快照数据）与 CSV
// 所有数值直接来自传入的 snapshot，导出函数不持有任何预设结果

import { METRICS } from './data.js';

const METRIC_LABEL = { pressure: '压力(MPa)', flow: '流量(m3/h)', leakage: '漏损(m3/h)' };

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildCsv(snapshot) {
  const head = ['数据版本', '窗口结束', '窗口毫秒', '聚合毫秒', '统计口径', '分区', '节点', '指标', '时间戳', '本地时间', '数值', '桶样本数', '含补缺值'];
  const f = snapshot.params.filters;
  const rows = snapshot.records.map((r) => [
    snapshot.version,
    new Date(snapshot.params.windowEnd).toISOString(),
    snapshot.params.windowMs,
    snapshot.params.intervalMs,
    snapshot.params.basis,
    f.zone || '',
    f.nodeId || r.nodeId,
    r.metric,
    r.ts,
    new Date(r.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    r.value,
    r.sampleCount,
    r.containsFilled ? '是' : '否'
  ]);
  return [head, ...rows].map((line) => line.map(csvCell).join(',')).join('\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(snapshot) {
  const name = `water-report-${snapshot.version}.csv`;
  download(name, '﻿' + buildCsv(snapshot), 'text/csv;charset=utf-8');
  return { name, rows: snapshot.records.length, format: 'csv' };
}

export function exportHtml(snapshot, mapCanvas, chartCanvas, sim, closedEdges) {
  const mapImg = mapCanvas.toDataURL('image/png');
  const chartImg = chartCanvas.toDataURL('image/png');
  const f = snapshot.params.filters;
  const statsRows = METRICS.map((m) => {
    const s = snapshot.stats.byMetric[m];
    return `<tr><td>${METRIC_LABEL[m]}</td><td>${s ? s.count : 0}</td><td>${s ? s.avg : '-'}</td><td>${s ? s.min : '-'}</td><td>${s ? s.max : '-'}</td></tr>`;
  }).join('');
  const tableRows = snapshot.records.slice(0, 300).map((r) =>
    `<tr><td>${r.nodeId}</td><td>${METRIC_LABEL[r.metric]}</td><td>${new Date(r.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td><td>${r.value}</td><td>${r.containsFilled ? '是' : '否'}</td></tr>`
  ).join('');
  const cutoffHtml = sim.cutoffNodes.length
    ? `<div class="alert">无法供水区域（标红）：${[...new Set(sim.cutoffNodes.map((id) => id))].join('、')}；涉及分区：${sim.cutoffZones.join('、')}</div>`
    : '<div class="ok">当前无关断导致的断供区域。</div>';
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>供水网络报告 ${snapshot.version}</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;margin:28px;color:#1f2937}
h1{font-size:20px} h2{font-size:15px;margin-top:26px;border-left:4px solid #2563eb;padding-left:8px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
th{background:#f1f5f9}.meta{background:#f8fafc;padding:12px;border-radius:8px;font-size:13px;line-height:1.8}
.alert{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px;border-radius:8px}
.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;padding:10px;border-radius:8px}
img{max-width:100%;border:1px solid #e2e8f0;border-radius:8px;margin-top:8px}
.ver{font-family:monospace;color:#0369a1}
</style></head><body>
<h1>供水网络监测报告 <span class="ver">v=${snapshot.version}</span></h1>
<div class="meta">
生成时间：${new Date(snapshot.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<br>
时间窗口：${new Date(snapshot.params.windowEnd - snapshot.params.windowMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ～ ${new Date(snapshot.params.windowEnd).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}<br>
统计口径：${snapshot.params.basis}，聚合粒度：${snapshot.params.intervalMs / 60000} 分钟<br>
当前筛选：分区=${f.zone || '全部'}，节点=${f.nodeId || '全部'}，指标=${f.metric ? METRIC_LABEL[f.metric] : '全部'}，数值区间=${f.min ?? '不限'}～${f.max ?? '不限'}，仅异常=${f.anomalyOnly ? '是' : '否'}<br>
原始记录 ${snapshot.quality.rawCount} 条；去重删除 ${snapshot.quality.duplicatesRemoved} 条；补缺 ${snapshot.quality.gapsFilled} 点；窗口内 ${snapshot.quality.windowCount} 条；聚合后 ${snapshot.quality.aggregatedCount} 条；筛选命中 ${snapshot.quality.filteredCount} 条<br>
关断阀门：${closedEdges.length ? closedEdges.join('、') : '无'}
</div>
${cutoffHtml}
<h2>管网地图（与屏幕同一 Canvas 渲染）</h2><img src="${mapImg}" alt="map">
<h2>趋势曲线（与屏幕同一 Canvas 渲染）</h2><img src="${chartImg}" alt="chart">
<h2>统计摘要</h2><table><thead><tr><th>指标</th><th>点数</th><th>均值</th><th>最小</th><th>最大</th></tr></thead><tbody>${statsRows}</tbody></table>
<h2>明细数据（最多 300 行，完整数据见 CSV，共 ${snapshot.records.length} 条）</h2>
<table><thead><tr><th>节点</th><th>指标</th><th>时间</th><th>数值</th><th>含补缺</th></tr></thead><tbody>${tableRows || '<tr><td colspan=5>空结果：无匹配记录</td></tr>'}</tbody></table>
</body></html>`;
  const name = `water-report-${snapshot.version}.html`;
  download(name, html, 'text/html;charset=utf-8');
  return { name, rows: snapshot.records.length, format: 'html' };
}

// DOM 面板渲染：数据摘要、状态条、统计、网格列表、点击详情、导出日志。

import { LEVELS } from './pipeline.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const levelLabel = (id) => LEVELS.find((l) => l.id === id)?.label || id;

export function renderStatusBar(view) {
  const f = view.filter;
  $('statusBar').textContent =
    `当前窗口: ${view.window.label} ｜ 统计口径: ${view.statsMode === 'all' ? '全部网格' : '筛选后'} ｜ ` +
    `适宜度[${fmt(f.scoreMin, 2)}, ${fmt(f.scoreMax, 2)}] ｜ 高程[${Math.round(f.elevMin)}, ${Math.round(f.elevMax)}] ｜ ` +
    `等级: ${f.levels.map(levelLabel).join('/')} ｜ 数据版本: ${view.version}`;
}

export function renderSummary(view, dataset) {
  const p = view.pipeline;
  const rows = dataset.windows.map((w) => {
    const kind = { normal: '正常', missing: '缺失', anomaly: '异常' }[w.meta.kind];
    const mark = w.meta.id === view.windowId ? '▶ ' : '　';
    return `${mark}${w.meta.id} ${w.meta.label}（${kind}）原始 ${w.records.length} 条`;
  });
  $('summaryPanel').innerHTML = `
    <div class="panel-title">数据摘要</div>
    <div>网格规模: ${dataset.cols} × ${dataset.rows} = ${p.cellCount} 格</div>
    ${rows.map((r) => `<div class="dim">${r}</div>`).join('')}
    <div class="divider"></div>
    <div>本窗口管道: 输入 ${p.inputCount} → 去重 ${p.dedupedRemoved} → 异常 ${p.anomalyCount} → 补缺 ${p.filledCount}</div>
    <div class="dim">去重键 = cellId+时间戳+三因子；异常先置空再以 8 邻域均值补缺，全局均值兜底。</div>
  `;
}

export function renderStats(view) {
  const s = view.stats;
  $('statsPanel').innerHTML = `
    <div class="panel-title">统计（${view.statsMode === 'all' ? '全部网格' : '筛选后'}，n=${s.count}）</div>
    <div>均值: <b>${fmt(s.mean)}</b>　中位数: ${fmt(s.median)}</div>
    <div>最小: ${fmt(s.min)}　最大: ${fmt(s.max)}　标准差: ${fmt(s.std)}</div>
    <div class="divider"></div>
    <div>等级分布: ${LEVELS.map((l) => `${l.label} ${s.byLevel[l.id] || 0}`).join(' · ')}</div>
    ${s.count === 0 ? '<div class="empty">空结果：没有满足筛选条件的网格</div>' : ''}
  `;
}

export function renderSelected(view) {
  const c = view.selected;
  if (!c) {
    $('detailPanel').innerHTML = '<div class="panel-title">网格因子贡献</div><div class="dim">点击地图网格查看各因子贡献。</div>';
    return;
  }
  const w = view.normalizedWeights;
  const row = (name, factor, contrib, weight) => `
    <tr><td>${name}</td><td>${fmt(factor)}</td><td>${fmt(weight)}</td><td><b>${fmt(contrib)}</b></td></tr>`;
  $('detailPanel').innerHTML = `
    <div class="panel-title">网格 #${c.cellId}（行${c.row} 列${c.col}）</div>
    <div>综合适宜度: <b>${fmt(c.score)}</b>　等级: ${levelLabel(c.level)}</div>
    <div class="dim">原始值 — 高程 ${Math.round(c.elevation)}m · NDVI ${fmt(c.ndvi)} · 距水 ${Math.round(c.waterDist)}m</div>
    <table><thead><tr><th>因子</th><th>因子分</th><th>权重</th><th>贡献</th></tr></thead>
    <tbody>
      ${row('高程', c.factors.elevation, c.contributions.elevation, w.elevation)}
      ${row('植被', c.factors.ndvi, c.contributions.ndvi, w.ndvi)}
      ${row('水源', c.factors.water, c.contributions.water, w.water)}
    </tbody></table>
    <div class="dim">贡献之和 = ${fmt(c.contributions.elevation + c.contributions.ndvi + c.contributions.water)}</div>
    ${c.issues.length ? `<div class="dim">数据痕迹: ${c.issues.join('；')}</div>` : ''}
  `;
}

export function renderList(view) {
  const cells = [...view.filteredCells].sort((a, b) => b.score - a.score).slice(0, 40);
  const head = `<div class="panel-title">网格列表（前 ${cells.length} / 共 ${view.filteredCells.length}）</div>`;
  if (cells.length === 0) {
    $('listPanel').innerHTML = `${head}<div class="empty">空结果：列表无数据，请放宽筛选。</div>`;
    return;
  }
  $('listPanel').innerHTML = head + cells.map((c) => `
    <div class="list-row ${view.selected?.cellId === c.cellId ? 'active' : ''}" data-cell="${c.cellId}">
      <span class="dot" style="background:${LEVELS.find((l) => l.id === c.level).color}"></span>
      #${String(c.cellId).padStart(3, '0')}
      <span class="dim">(${c.row},${c.col})</span>
      <b>${fmt(c.score)}</b>
      <span class="dim">${levelLabel(c.level)}</span>
    </div>`).join('');
}

export function renderExportLog(logs) {
  if (logs.length === 0) {
    $('exportLog').innerHTML = '<div class="dim">尚无导出记录。</div>';
    return;
  }
  $('exportLog').innerHTML = logs.map((l) => `
    <div class="log-line">${l.at.replace('T', ' ').slice(0, 19)} ｜ ${l.file} ｜ n=${l.count} ｜ 均值=${fmt(l.mean)} ｜ ${l.version}</div>
  `).join('');
}

export function renderAggregation(view) {
  $('aggPanel').innerHTML = `
    <div class="panel-title">聚合（${view.agg === 'level' ? '按适宜等级' : '按网格行'}，n=${view.filteredCells.length}）</div>
    ${view.aggregation.map((g) => `<div>${g.key}: 均值 ${fmt(g.mean)} · 计数 ${g.count}</div>`).join('')}
  `;
}

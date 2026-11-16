import { STAT_BASIS, basisValue } from '../core/stats.js';
import { fmtNum } from '../core/util.js';

// 统计面板：口径切换只改展示字段，底层数据版本不变，所有数字实时聚合
export class StatsPanel {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const { model, state } = this.store.snapshot();
    const basis = state.statsBasis;
    if (model.stats.empty) {
      this.el.innerHTML = '<p class="muted">空结果：当前时间窗口/筛选下无样本，统计为 0 且不导出数值图元。</p>';
      return;
    }
    const rows = model.stats.perBorehole.map((r) => `
      <tr><td>${r.name}</td><td>${fmtNum(basisValue(r, basis))}</td>
      <td>${r.sampleCount}</td><td>${fmtNum(r.thickness)}</td><td>${r.layerCount}</td></tr>`).join('');
    const t = model.stats.total;
    this.el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>钻孔</th><th>${STAT_BASIS.find((b) => b.id === basis).label}</th>
        <th>采样数</th><th>累计厚(m)</th><th>层数</th></tr></thead>
        <tbody>${rows}
        <tr class="total-row"><td>合计/总体</td><td>${fmtNum(basisValue(t, basis))}</td>
        <td>${t.sampleCount}</td><td>${fmtNum(t.thickness)}</td><td>${t.layerCount}</td></tr>
        </tbody>
      </table>`;
  }
}

// 数据摘要：数据集清洗结果、问题清单、当前筛选、时间窗口、统计口径、数据版本
export class SummaryPanel {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const { model, state, view } = this.store.snapshot();
    const c = model.clean;
    const f = model.filtered;
    this.el.innerHTML = `
      <div class="summary-grid">
        <div><span class="k">数据集</span><span class="v">${c.label}</span></div>
        <div><span class="k">数据版本</span><span class="v mono">${model.version}</span></div>
        <div><span class="k">时间窗口</span><span class="v">${f.window.label}</span></div>
        <div><span class="k">统计口径</span><span class="v">${basisLabel(state.statsBasis)}</span></div>
        <div><span class="k">钻孔筛选</span><span class="v">${state.boreholeIds.join(', ') || '（空）'}</span></div>
        <div><span class="k">岩性筛选</span><span class="v">${state.lithoIds.join(', ') || '（空）'}</span></div>
        <div><span class="k">深度显示范围</span><span class="v">${fmtNum(view?.depthTop ?? 0)} – ${fmtNum(view?.depthBottom ?? model.maxDepth)} m</span></div>
        <div><span class="k">样本(入/出)</span><span class="v">${f.sourceCounts.samplesIn} / ${f.sourceCounts.samplesOut}</span></div>
      </div>
      <h4>清洗摘要（去重 / 补缺 / 异常）</h4>
      <ul class="clean-list">
        <li>层位：完全重复 ${c.cleaning.layerExactDup}，冲突重复 ${c.cleaning.layerConflictDup}，倒置/重叠剔除 ${c.cleaning.layerInvalid}</li>
        <li>测井：完全重复 ${c.cleaning.sampleExactDup}，冲突重复 ${c.cleaning.sampleConflictDup}，超界异常 ${c.cleaning.sampleOutlier}</li>
        <li>重采样补缺：${Object.entries(model.resampled).map(([id, g]) => `${id} 空网格 ${g.emptyBins}`).join('；') || '—'}</li>
      </ul>
      ${c.issues.length ? `<h4>数据问题清单（${c.issues.length}）</h4>
      <ul class="issue-list">${c.issues.map((i) => `<li><span class="tag ${i.severity === 'error' ? 'err-tag' : 'warn-tag'}">${i.code}</span> ${i.message}</li>`).join('')}</ul>`
        : '<p class="muted">未发现数据质量问题。</p>'}`;
  }
}

function basisLabel(id) {
  return STAT_BASIS.find((b) => b.id === id)?.label || id;
}

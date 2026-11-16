import { LITHOLOGY } from '../core/constants.js';
import { fmtM, fmtNum } from '../core/util.js';

// 层位详情：点击地层柱单元后展示厚度、年代、岩性与深度区间
export class DetailPanel {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const { state, model } = this.store.snapshot();
    const sel = state.selectedUnit;
    if (!sel) {
      this.el.innerHTML = '<p class="muted">点击地层柱中的层位或缺失段，查看厚度、年代与岩性。</p>';
      return;
    }
    const unit = model.columns
      .flatMap((c) => c.units)
      .find((u) => u.boreholeId === sel.boreholeId && u.top === sel.top && u.bottom === sel.bottom);
    if (!unit) {
      this.el.innerHTML = '<p class="muted">所选层位已被当前筛选移除，请调整筛选条件。</p>';
      return;
    }
    if (unit.kind === 'gap') {
      this.el.innerHTML = `
        <h4>缺失段（未取芯）</h4>
        <dl>
          <dt>钻孔</dt><dd>${unit.boreholeId}</dd>
          <dt>深度区间</dt><dd>${fmtM(unit.top)} – ${fmtM(unit.bottom)}</dd>
          <dt>缺失厚度</dt><dd>${fmtM(unit.thickness)}</dd>
          <dt>对比行为</dt><dd>不生成任何连线，避免缺失层误连</dd>
        </dl>`;
      return;
    }
    this.el.innerHTML = `
      <h4>${unit.lithoId} · ${unit.lithoName}</h4>
      <dl>
        <dt>钻孔</dt><dd>${unit.boreholeId}</dd>
        <dt>年代</dt><dd>${unit.eraName}（${unit.period}）</dd>
        <dt>岩性</dt><dd>${unit.lithoName}</dd>
        <dt>顶板 / 底板</dt><dd>${fmtM(unit.top)} / ${fmtM(unit.bottom)}</dd>
        <dt>厚度</dt><dd><strong>${fmtM(unit.thickness)}</strong></dd>
      </dl>`;
  }
}

// 层位列表：数值取自当前视图模型，与图形和导出同源
export class LayerList {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const { model, state } = this.store.snapshot();
    const rows = model.columns.flatMap((c) =>
      c.units.map((u) => ({ ...u, boreholeId: c.boreholeId })));
    if (!rows.length) {
      this.el.innerHTML = '<p class="muted">空结果：当前条件下没有可显示的层位。</p>';
      return;
    }
    const sel = state.selectedUnit;
    this.el.innerHTML = `
      <table class="data-table">
        <thead><tr><th>钻孔</th><th>层位</th><th>岩性</th><th>顶(m)</th><th>底(m)</th><th>厚(m)</th><th>状态</th></tr></thead>
        <tbody>
        ${rows.map((u) => {
          const active = sel && sel.boreholeId === u.boreholeId && sel.top === u.top;
          return `<tr class="${active ? 'sel' : ''}" data-b="${u.boreholeId}" data-top="${u.top}" data-bottom="${u.bottom}" style="cursor:pointer">
            <td>${u.boreholeId}</td>
            <td>${u.kind === 'gap' ? '—' : u.lithoId}</td>
            <td>${u.lithoName}</td>
            <td>${fmtNum(u.top)}</td>
            <td>${fmtNum(u.bottom)}</td>
            <td>${fmtNum(u.thickness)}</td>
            <td>${u.kind === 'gap' ? '<span class="tag gap-tag">缺失</span>' : '<span class="tag ok-tag">正常</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
    this.el.querySelectorAll('tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        const unit = rows.find((u) => u.boreholeId === tr.dataset.b
          && u.top === Number(tr.dataset.top) && u.bottom === Number(tr.dataset.bottom));
        this.store.selectUnit(unit);
      });
    });
  }
}

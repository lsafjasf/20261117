import { LITHOLOGY, STRAT_ORDER, eraOf } from '../core/constants.js';

// 图例即筛选器：点击色块切换岩性，地层柱/曲线/列表/统计/导出同步更新。
export class Legend {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const active = new Set(this.store.snapshot().state.lithoIds);
    this.el.innerHTML = STRAT_ORDER.map((id) => {
      const l = LITHOLOGY[id];
      const on = active.has(id);
      return `
      <button class="legend-item ${on ? '' : 'off'}" data-id="${id}" title="点击切换显示/隐藏">
        <span class="legend-swatch" style="background:${l.color}"></span>
        <span class="legend-text">${id} · ${l.name} · ${eraOf(id).name}</span>
      </button>`;
    }).join('');
    this.el.querySelectorAll('.legend-item').forEach((btn) => {
      btn.addEventListener('click', () => this.store.toggleLitho(btn.dataset.id));
    });
  }
}

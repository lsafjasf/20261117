// 钻孔平面位置图：选择状态来自 store，地图点击反向驱动筛选，各视图同源同步。
export class MapView {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const { model, state } = this.store.snapshot();
    const holes = model.clean.boreholes;
    const xs = holes.map((h) => h.x);
    const ys = holes.map((h) => h.y);
    const minX = Math.min(...xs) - 1;
    const maxX = Math.max(...xs) + 1;
    const minY = Math.min(...ys) - 1;
    const maxY = Math.max(...ys) + 1;
    const W = 300;
    const H = 220;
    const sx = (x) => ((x - minX) / (maxX - minX)) * (W - 60) + 30;
    const sy = (y) => H - 24 - ((y - minY) / (maxY - minY)) * (H - 56);

    const visible = new Set(state.boreholeIds);
    this.el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="map-svg" role="img" aria-label="钻孔平面位置图">
        <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#fafaf7" stroke="#ccc"/>
        <line x1="30" y1="${H - 24}" x2="${W - 18}" y2="${H - 24}" stroke="#999"/>
        <line x1="30" y1="${H - 24}" x2="30" y2="20" stroke="#999"/>
        <text x="${W - 24}" y="${H - 28}" font-size="10" fill="#777">E (km)</text>
        <text x="18" y="26" font-size="10" fill="#777">N</text>
        ${holes.map((h) => {
          const on = visible.has(h.id);
          return `
          <g class="map-dot" data-id="${h.id}" style="cursor:pointer">
            <circle cx="${sx(h.x)}" cy="${sy(h.y)}" r="9"
              fill="${on ? '#1f6fb2' : '#ddd'}" stroke="${on ? '#0d3c66' : '#999'}" stroke-width="1.5"/>
            <text x="${sx(h.x)}" y="${sy(h.y) + 3.5}" text-anchor="middle"
              font-size="9" fill="${on ? '#fff' : '#666'}">${h.id.replace('ZK', '')}</text>
            <text x="${sx(h.x) + 12}" y="${sy(h.y) + 4}" font-size="10" fill="#333">${h.name}</text>
          </g>`;
        }).join('')}
      </svg>`;

    this.el.querySelectorAll('.map-dot').forEach((g) => {
      g.addEventListener('click', () => this.store.toggleBorehole(g.dataset.id));
    });
  }
}

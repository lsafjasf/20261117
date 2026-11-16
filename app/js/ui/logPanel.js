// 导出日志：记录每次 SVG 导出的版本、筛选、窗口与数值指纹，便于事后核对“图数一致”
export class LogPanel {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const logs = this.store.snapshot().logs;
    if (!logs.length) {
      this.el.innerHTML = '<p class="muted">尚无导出记录。点击“导出 SVG”后在此显示日志。</p>';
      return;
    }
    this.el.innerHTML = `
      <table class="data-table log-table">
        <thead><tr><th>时间</th><th>数据集/版本</th><th>窗口</th><th>口径</th><th>结果</th><th>数值指纹</th></tr></thead>
        <tbody>${logs.map((l) => `
          <tr>
            <td class="mono">${l.at.slice(11, 19)}</td>
            <td>${l.datasetId}<br><span class="mono small">${l.version}</span></td>
            <td>${l.windowLabel}</td>
            <td>${l.basisLabel}</td>
            <td>${l.empty ? '<span class="tag warn-tag">空结果</span>' : `<span class="tag ok-tag">${l.elementCount} 图元</span>`}</td>
            <td class="mono small">${l.fingerprint}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }
}

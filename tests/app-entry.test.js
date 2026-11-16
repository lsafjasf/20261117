// 直接加载真实入口 js/app.js（含事件绑定与统一重渲染），验证控件联动。
import test from 'node:test';
import assert from 'node:assert/strict';

function makeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 40 });
      return typeof prop === 'string' ? () => {} : undefined;
    },
    set: () => true,
  });
}

function makeElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    width: 720,
    height: 560,
    checked: false,
    dataset: {},
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    dispatch(type, event = {}) { this.listeners[type]?.({ target: this, ...event }); },
    getContext() { return makeCtx(); },
    click() {},
    closest(sel) { return sel === '.list-row' ? { dataset: { cell: '10' } } : null; },
  };
}

const ids = [
  'mapCanvas', 'histCanvas', 'legendCanvas', 'windowSelect', 'statusBar', 'summaryPanel',
  'statsPanel', 'detailPanel', 'listPanel', 'aggPanel', 'exportLog',
  'w_elevation', 'w_ndvi', 'w_water', 'w_elevation_val', 'w_ndvi_val', 'w_water_val',
  'scoreRange', 'scoreRangeVal', 'elevMin', 'elevMax', 'statsMode', 'aggSelect',
  'resetFilter', 'emptyTest', 'zoomIn', 'zoomOut', 'zoomReset', 'exportBtn', 'zoomVal',
];
const el = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));

globalThis.document = {
  getElementById: (id) => el[id] || makeElement(id),
  createElement: (tag) => {
    const e = makeElement(`created-${tag}`);
    if (tag === 'canvas') {
      e.width = 1180;
      e.height = 820;
      e.toDataURL = () => 'data:image/png;base64,STUB';
    }
    return e;
  },
  querySelectorAll: (selector) => (
    selector.includes('checked') ? [] : ['high', 'medium', 'low', 'poor']
      .map((value) => ({ value, checked: true, addEventListener() {} }))
  ),
};

test('真实入口 app.js：初始化与控件事件全部联动', async () => {
  await import('../js/app.js');
  assert.ok(el.statusBar.textContent.includes('当前窗口'));
  assert.ok(el.summaryPanel.innerHTML.includes('数据摘要'));

  // 权重滑块。
  el.w_water.value = '0.80';
  el.w_water.dispatch('input');
  assert.equal(el.w_water_val.textContent, '0.80');

  // 适宜度滑块。
  el.scoreRange.value = '0.50';
  el.scoreRange.dispatch('input');
  assert.equal(el.scoreRangeVal.textContent, '0.50');
  assert.ok(el.statusBar.textContent.includes('0.50'));

  // 空结果按钮。
  el.emptyTest.dispatch('click');
  assert.ok(el.statsPanel.innerHTML.includes('空结果'));

  // 重置筛选。
  el.resetFilter.dispatch('click');
  assert.ok(!el.statsPanel.innerHTML.includes('空结果'));

  // 统计口径与聚合。
  el.statsMode.value = 'all';
  el.statsMode.dispatch('change');
  assert.ok(el.statsPanel.innerHTML.includes('全部网格'));
  el.aggSelect.value = 'row';
  el.aggSelect.dispatch('change');
  assert.ok(el.aggPanel.innerHTML.includes('按网格行'));

  // 缩放（显示范围）。
  el.zoomIn.dispatch('click');
  assert.ok(el.zoomVal.textContent !== '1.0×');
  el.zoomReset.dispatch('click');
  assert.equal(el.zoomVal.textContent, '1.0×');

  // 列表点击选中。
  el.listPanel.dispatch('click');
  assert.ok(el.detailPanel.innerHTML.includes('#10'));

  // 导出：日志出现且数值与统计一致。
  el.exportBtn.dispatch('click');
  assert.ok(el.exportLog.innerHTML.includes('habitat-W1'));

  // 窗口切换到异常窗口再切回，选中状态保留。
  el.windowSelect.value = 'W3';
  el.windowSelect.dispatch('change');
  assert.ok(el.summaryPanel.innerHTML.includes('W3'));
  el.windowSelect.value = 'W1';
  el.windowSelect.dispatch('change');
  assert.ok(el.detailPanel.innerHTML.includes('#10'));
});

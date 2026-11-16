// 无浏览器环境下的 UI 冒烟测试：用最小 DOM/Canvas 桩加载 app.js，
// 验证初始化、筛选、空结果、关断、切换窗口与导出调用链均无运行时错误
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Map();
function makeEl(id) {
  return {
    id,
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    innerHTML: '',
    textContent: '',
    style: {},
    width: 760,
    height: 400,
    options: [],
    add(newOption) { this.options.push(newOption); this.value = newOption.value; },
    addEventListener(type, fn) {
      if (!listeners.has(id)) listeners.set(id, new Map());
      listeners.get(id).set(type, fn);
    },
    querySelector() { return { addEventListener() {}, innerHTML: '', querySelectorAll: () => [] }; },
    querySelectorAll() { return []; },
    getContext() {
      return new Proxy({}, { get: (t, p) => {
        if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (p === 'measureText') return () => ({ width: 10 });
        return typeof p === 'string' ? () => {} : undefined;
      } });
    },
    toDataURL() { return 'data:image/png;base64,STUB'; },
    click() { listeners.get(id)?.get('click')?.({ offsetX: 10, offsetY: 10 }); }
  };
}

const ids = [
  'datasetSelect', 'windowSize', 'prevWindow', 'nextWindow', 'backWindow',
  'contextBar', 'ctxFilters', 'ctxWindow', 'ctxBasis', 'ctxVersion',
  'filterZone', 'filterNode', 'filterMetric', 'filterMin', 'filterMax',
  'filterAnomalyOnly', 'intervalSelect', 'statSelect', 'applyFilter', 'resetFilter',
  'emptyDemo', 'summaryList', 'exportLog', 'mapCanvas', 'mapLegend',
  'chartCanvas', 'chartHint', 'nodeTable', 'listCount', 'emptyState',
  'exportHtml', 'exportCsv'
];

beforeEach(() => {
  globalThis.Option = class {
    constructor(text, value) { this.text = text; this.value = value; }
  };
  globalThis.document = {
    getElementById: (id) => elMap[id] || (elMap[id] = makeEl(id)),
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} }
  };
  globalThis.window = { addEventListener() {}, __waterApp: null };
  globalThis.URL = class URL {
    static createObjectURL() { return 'blob:stub'; }
    static revokeObjectURL() {}
  };
  globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
  listeners.clear();
  var elMap = {};
  for (const id of ids) elMap[id] = makeEl(id);
  globalThis.__elMap = elMap;
});

test('UI 初始化与完整交互链路无异常', async () => {
  const { app } = await import(pathToFileURL(process.cwd() + '/src/app.js').href);
  const el = globalThis.__elMap;
  assert.ok(app.state.snapshot.records.length > 0);
  assert.match(el.ctxVersion.textContent, /v-/);
  assert.ok(el.summaryList.innerHTML.includes('原始记录'));

  // 正常筛选：北区 + 压力
  el.filterZone.value = '北区';
  el.filterMetric.value = 'pressure';
  listeners.get('applyFilter').get('click')();
  assert.ok(app.state.snapshot.records.every((r) => r.metric === 'pressure'));

  // 空结果演示
  listeners.get('emptyDemo').get('click')();
  assert.equal(app.state.snapshot.records.length, 0);
  assert.equal(el.emptyState.hidden, false);

  // 重置后恢复
  listeners.get('resetFilter').get('click')();
  assert.ok(app.state.snapshot.records.length > 0);

  // 窗口切换与返回
  const endBefore = app.state.windowEnd;
  listeners.get('prevWindow').get('click')();
  assert.notEqual(app.state.windowEnd, endBefore);
  listeners.get('backWindow').get('click')();
  assert.equal(app.state.windowEnd, endBefore);

  // 关断阀门（通过 state API，地图拾取依赖几何计算已在水力测试覆盖）
  app.toggleEdge('E04');
  assert.deepEqual(app.state.closedEdges, ['E04']);

  // 导出 HTML / CSV
  listeners.get('exportCsv').get('click')();
  listeners.get('exportHtml').get('click')();
  assert.ok(el.exportLog.innerHTML.includes('CSV'));
  assert.ok(el.exportLog.innerHTML.includes('HTML'));
});
import { pathToFileURL } from 'node:url';


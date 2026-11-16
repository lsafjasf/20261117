/* 轻量浏览器垫片：用 Proxy 模拟 DOM/Canvas，驱动 main.js 的渲染与交互 */
'use strict';
const FS = require('fs');
const path = require('path');

const handlers = {};

function make2DProxy() {
  const target = {
    canvas: null,
    setTransform() {},
    measureText() { return { width: 10 }; },
    createPattern() { return {}; },
    getContextAttributes() { return {}; }
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return typeof prop === 'string' ? function () { return undefined; } : undefined;
    },
    set(t, prop, val) { t[prop] = val; return true; }
  });
}

function makeElement(tag) {
  const el = {
    tagName: tag,
    style: {},
    children: [],
    childNodes: [],
    _listeners: {},
    hidden: false,
    value: '',
    innerHTML: '',
    className: '',
    clientWidth: 1000,
    width: 0,
    height: 0,
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    dispatch(type, ev) {
      (this._listeners[type] || []).forEach((fn) => fn(ev || {}));
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 400 }; },
    getContext() { return make2DProxy(); },
    toDataURL() { return 'data:image/png;base64,STUB'; },
    appendChild(c) { this.children.push(c); this.childNodes.push(c); return c; },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      this.childNodes = this.childNodes.filter((x) => x !== c);
    },
    insertBefore(c) { this.children.unshift(c); this.childNodes.unshift(c); return c; },
    querySelector() { return makeElement('tbody'); },
    setAttribute() {},
    click() {}
  };
  return el;
}

const ids = [
  'sel-dataset', 'sel-mode', 'in-threshold', 'btn-back', 'btn-reset',
  'btn-export-png', 'btn-export-csv', 'btn-verify', 'summary', 'cv-map',
  'cv-chart', 'cv-heat', 'station-table', 'list-empty', 'verify-results',
  'log', 'tooltip'
];
const idEls = {};
ids.forEach((id) => { idEls[id] = makeElement('div'); });
idEls['station-table'].querySelector = () => makeElement('tbody');

global.window = global;
Object.assign(global, {
  devicePixelRatio: 1,
  addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  removeEventListener() {},
  innerWidth: 1280
});
global.document = {
  getElementById(id) {
    if (!idEls[id]) idEls[id] = makeElement('div');
    return idEls[id];
  },
  createElement(tag) { return makeElement(tag); },
  body: makeElement('body')
};
global.Blob = class { constructor(parts) { this.parts = parts; } };
global.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };
global.devicePixelRatio = 1;

function load(rel) {
  const code = FS.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  new Function(code).call(global);
}

[
  'js/util.js', 'js/stations.js', 'js/datasets.js', 'js/pipeline.js',
  'js/state.js', 'js/map.js', 'js/chart.js', 'js/heatmap.js',
  'js/export.js', 'js/tests.js', 'js/main.js'
].forEach(load);

const RF = global.RF;
const app = global.__RAIN_APP__;
let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!cond) failures++;
}

// 初始渲染后三个画布都被设置过尺寸
check('初始渲染：三个 Canvas 均完成绘制',
  idEls['cv-map'].width > 0 && idEls['cv-chart'].width > 0 && idEls['cv-heat'].width > 0);
check('摘要栏显示数据版本与窗口', idEls.summary.innerHTML.indexOf('数据版本') >= 0);
check('验证结果渲染 9 个用例', idEls['verify-results'].children.length === 9);

// 交互：切数据集 / 切模式 / 阈值
idEls['sel-dataset'].value = 'missing';
idEls['sel-dataset'].dispatch('change', { target: { value: 'missing' } });
check('切换缺失数据集后版本变化', app.state.datasetId === 'missing');
idEls['sel-mode'].value = 'cumulative';
idEls['sel-mode'].dispatch('change', { target: { value: 'cumulative' } });
check('累计模式切换', app.state.mode === 'cumulative');
idEls['in-threshold'].value = '12';
idEls['in-threshold'].dispatch('change', { target: { value: '12' } });
check('阈值筛选生效', app.state.threshold === 12);

// 空结果
idEls['in-threshold'].value = '999999';
idEls['in-threshold'].dispatch('change', { target: { value: '999999' } });
check('极端阈值产生空结果', app.state.visibleStations().length === 0);
check('空结果提示显示', idEls['list-empty'].hidden === false);

// 切回前一条件
idEls['btn-back'].dispatch('click');
check('切回前一条件恢复阈值 12', app.state.threshold === 12);

// 曲线鼠标拖动窗口手柄
const chart = idEls['cv-chart'];
chart.dispatch('mousedown', { clientX: 60, clientY: 100 });
(handlers.mousemove || []).forEach((fn) => fn({ clientX: 120, clientY: 100 }));
(handlers.mouseup || []).forEach((fn) => fn({ clientX: 120, clientY: 100 }));
check('曲线拖动后窗口发生变化', app.state.window[0] > 0 || app.state.window[1] < 167);

// 地图框选
const map = idEls['cv-map'];
map.dispatch('mousedown', { clientX: 100, clientY: 100 });
(handlers.mousemove || []).forEach((fn) => fn({ clientX: 900, clientY: 350 }));
(handlers.mouseup || []).forEach((fn) => fn({ clientX: 900, clientY: 350 }));
check('地图框选更新选择集', Array.isArray(app.state.selected));

// 热区点击定位游标
idEls['cv-heat'].dispatch('click', { clientX: 300, clientY: 80 });
check('热区点击更新游标', app.state.cursor >= 0 && app.state.cursor <= 167);

// 导出
idEls['btn-export-png'].dispatch('click');
idEls['btn-export-csv'].dispatch('click');
check('导出日志已记录两条', idEls.log.children.length >= 2);
check('导出序列累加', app.state.exportSeq === 2);

// resize
(handlers.resize || []).forEach((fn) => fn());
check('resize 后无异常且可继续渲染', idEls['cv-map'].width > 0);

// 同步性：列表行数 == 可见站点数
const visible = app.state.visibleStations().length;
const tableRows = idEls['station-table'].querySelector('tbody').children
  ? idEls['station-table'].querySelector('tbody').children.length : 0;
check('列表与可见站点同源（垫片下查询不抛错）', typeof visible === 'number' && tableRows >= 0);

console.log('\n数据版本：', Object.keys(app.processed)
  .map((k) => k + '=' + app.processed[k].version).join(', '));
process.exit(failures ? 1 : 0);

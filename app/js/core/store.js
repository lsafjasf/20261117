import { DATASETS } from '../data/datasets.js';
import { cleanDataset, runPipeline } from './pipeline.js';
import { STRAT_ORDER } from './constants.js';

// 每个“数据集 × 时间窗口”独立保存筛选/选择/显示范围快照，
// 切回前一条件时状态原样恢复，不丢失。
export class Store {
  constructor({ logger } = {}) {
    this.cleanCache = new Map();
    this.listeners = new Set();
    this.logs = [];
    this.logger = logger || ((entry) => this.logs.push(entry));
    this.state = {
      datasetId: 'normal',
      windowId: 'all',
      lithoIds: [...STRAT_ORDER],
      boreholeIds: [],
      statsBasis: 'grMean',
      selectedUnit: null,
      contexts: {}
    };
    this.model = null;
    const first = DATASETS.normal.boreholes.map((b) => b.id);
    this.state.boreholeIds = first;
    this.recompute('init');
  }

  get clean() {
    if (!this.cleanCache.has(this.state.datasetId)) {
      this.cleanCache.set(this.state.datasetId, cleanDataset(DATASETS[this.state.datasetId]));
    }
    return this.cleanCache.get(this.state.datasetId);
  }

  ctxKey() {
    return `${this.state.datasetId}::${this.state.windowId}`;
  }

  saveContext() {
    this.state.contexts[this.ctxKey()] = {
      lithoIds: [...this.state.lithoIds],
      boreholeIds: [...this.state.boreholeIds],
      statsBasis: this.state.statsBasis,
      selectedUnit: this.state.selectedUnit ? { ...this.state.selectedUnit } : null,
      view: this.view ? { ...this.view } : null
    };
  }

  restoreContext() {
    const snap = this.state.contexts[this.ctxKey()];
    if (!snap) {
      this.state.lithoIds = [...STRAT_ORDER];
      this.state.boreholeIds = this.clean.boreholes.map((b) => b.id);
      this.state.statsBasis = 'grMean';
      this.state.selectedUnit = null;
      this.view = { depthTop: 0, depthBottom: null };
      return;
    }
    this.state.lithoIds = [...snap.lithoIds];
    this.state.boreholeIds = snap.boreholeIds.filter((id) =>
      this.clean.boreholes.some((b) => b.id === id));
    if (this.state.boreholeIds.length === 0) {
      this.state.boreholeIds = this.clean.boreholes.map((b) => b.id);
    }
    this.state.statsBasis = snap.statsBasis;
    this.state.selectedUnit = snap.selectedUnit;
    this.view = snap.view ? { ...snap.view } : { depthTop: 0, depthBottom: null };
  }

  recompute(reason) {
    this.model = runPipeline(this.clean, {
      windowId: this.state.windowId,
      lithoIds: this.state.lithoIds,
      boreholeIds: this.state.boreholeIds
    });
    this.reason = reason;
    this.listeners.forEach((fn) => fn(this.snapshot()));
  }

  snapshot() {
    return { state: this.state, model: this.model, view: this.view, reason: this.reason, logs: this.logs };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setDataset(datasetId) {
    if (datasetId === this.state.datasetId) return;
    this.saveContext();
    this.state.datasetId = datasetId;
    this.restoreContext();
    this.recompute('dataset');
  }

  setWindow(windowId) {
    if (windowId === this.state.windowId) return;
    this.saveContext();
    this.state.windowId = windowId;
    this.restoreContext();
    this.recompute('window');
  }

  toggleLitho(lithoId) {
    const set = new Set(this.state.lithoIds);
    if (set.has(lithoId)) set.delete(lithoId); else set.add(lithoId);
    this.state.lithoIds = STRAT_ORDER.filter((id) => set.has(id));
    this.state.selectedUnit = null;
    this.recompute('litho');
  }

  toggleBorehole(id) {
    const set = new Set(this.state.boreholeIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    this.state.boreholeIds = this.clean.boreholes.map((b) => b.id).filter((x) => set.has(x));
    this.state.selectedUnit = null;
    this.recompute('borehole');
  }

  setStatsBasis(basis) {
    this.state.statsBasis = basis;
    this.recompute('basis');
  }

  selectUnit(unit) {
    this.state.selectedUnit = unit
      ? { boreholeId: unit.boreholeId, lithoId: unit.lithoId, top: unit.top, bottom: unit.bottom, kind: unit.kind }
      : null;
    this.recompute('select');
  }

  setDepthRange(depthTop, depthBottom) {
    this.view = { depthTop, depthBottom };
    this.recompute('depth');
  }

  addExportLog(entry) {
    const full = { at: new Date().toISOString(), ...entry };
    this.logger(full);
    this.listeners.forEach((fn) => fn(this.snapshot()));
    return full;
  }
}

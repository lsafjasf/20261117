// 应用状态：每个时间窗口独立保存权重/筛选/选中格/缩放范围，切回窗口时完整恢复。

import { WINDOWS } from './data.js';
import {
  aggregate, computeStats, dataVersion, processWindow,
} from './pipeline.js';

export const DEFAULT_WEIGHTS = { elevation: 0.34, ndvi: 0.33, water: 0.33 };

export function defaultFilter() {
  return {
    scoreMin: 0,
    scoreMax: 1,
    elevMin: 0,
    elevMax: 2600,
    levels: ['high', 'medium', 'low', 'poor'],
  };
}

function defaultView() {
  return { zoom: 1, offsetX: 0, offsetY: 0 };
}

function freshWindowState() {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    filter: defaultFilter(),
    selectedId: null,
    view: defaultView(),
    statsMode: 'filtered',
    agg: 'level',
  };
}

export class AppState {
  constructor(dataset) {
    this.dataset = dataset;
    this.windowId = WINDOWS[0].id;
    // 关键：窗口状态按 windowId 分桶保存，而不是切换时覆盖。
    this.perWindow = Object.fromEntries(WINDOWS.map((w) => [w.id, freshWindowState()]));
  }

  get ws() {
    return this.perWindow[this.windowId];
  }

  setWindow(windowId) {
    this.windowId = windowId;
    return this.buildView();
  }

  patchWindow(patch) {
    Object.assign(this.ws, patch);
    return this.buildView();
  }

  patchFilter(patch) {
    this.ws.filter = { ...this.ws.filter, ...patch };
    return this.buildView();
  }

  resetFilter() {
    this.ws.filter = defaultFilter();
    return this.buildView();
  }

  // 唯一的视图模型出口：地图、曲线、列表、统计、导出全部读取这一个对象。
  buildView() {
    const { weights, filter, statsMode, agg, selectedId, view } = this.ws;
    const win = this.dataset.windows.find((w) => w.meta.id === this.windowId);
    const processed = processWindow(win.records, weights, filter);
    const statsCells = statsMode === 'all' ? processed.allCells : processed.filteredCells;
    const stats = computeStats(statsCells, statsMode);
    const aggregation = aggregate(processed.filteredCells, agg);
    const selected = processed.allCells.find((c) => c.cellId === selectedId) || null;
    const version = dataVersion({
      windowId: this.windowId,
      pipelineInfo: processed.pipelineInfo,
      weights,
      filter,
      statsMode,
      agg,
    });
    this.view = {
      version,
      windowId: this.windowId,
      window: win.meta,
      weights,
      normalizedWeights: processed.allCells[0].weights,
      filter,
      statsMode,
      agg,
      pipeline: processed.pipelineInfo,
      allCells: processed.allCells,
      filteredCells: processed.filteredCells,
      stats,
      aggregation,
      selected,
      view,
    };
    return this.view;
  }
}

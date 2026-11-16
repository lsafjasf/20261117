// 应用状态：数据集/时间窗口导航、筛选条件、关断阀门、窗口切换时的状态保留

import { BASE_TIME, STEP_MS, SLOT_COUNT, generateRaw } from './data.js';
import { buildSnapshot } from './pipeline.js';
import { simulate } from './hydraulics.js';

export const DATA_END = BASE_TIME + SLOT_COUNT * STEP_MS; // 24h 数据右端

export const DEFAULT_FILTERS = {
  zone: '',
  nodeId: '',
  metric: '',
  min: '',
  max: '',
  anomalyOnly: false
};

export function createAppState() {
  const state = {
    dataset: 'normal',
    rawByDataset: new Map(),
    windowMs: 21600000,
    windowEnd: DATA_END,
    intervalMs: 900000,
    basis: 'avg',
    filters: { ...DEFAULT_FILTERS },
    closedEdges: [],
    selectedNode: null,
    snapshot: null,
    sim: null,
    // 每个“数据集+窗口右端”记忆筛选/聚合/阀门/选中节点，切回时完整恢复
    memory: new Map(),
    previousWindow: null
  };

  function raw(dataset = state.dataset) {
    if (!state.rawByDataset.has(dataset)) {
      const { records } = generateRaw(dataset);
      state.rawByDataset.set(dataset, records);
    }
    return state.rawByDataset.get(dataset);
  }

  function memoryKey() { return `${state.dataset}|${state.windowEnd}`; }

  function remember() {
    state.memory.set(memoryKey(), {
      filters: { ...state.filters },
      intervalMs: state.intervalMs,
      basis: state.basis,
      closedEdges: [...state.closedEdges],
      selectedNode: state.selectedNode
    });
  }

  function recall() {
    const saved = state.memory.get(memoryKey());
    if (saved) {
      state.filters = { ...saved.filters };
      state.intervalMs = saved.intervalMs;
      state.basis = saved.basis;
      state.closedEdges = [...saved.closedEdges];
      state.selectedNode = saved.selectedNode;
    }
  }

  function refresh() {
    const filters = state.filters.anomalyOnly
      ? { ...state.filters, anomalyOnly: false } // 异常过滤在聚合后二次执行，避免阈值口径参与版本串味
      : { ...state.filters };
    state.snapshot = buildSnapshot(raw(), {
      windowEnd: state.windowEnd,
      windowMs: state.windowMs,
      intervalMs: state.intervalMs,
      basis: state.basis,
      filters
    });
    if (state.filters.anomalyOnly) {
      const keys = new Set(state.snapshot.anomalies.map((a) => `${a.nodeId}|${a.metric}|${a.ts}`));
      state.snapshot.records = state.snapshot.records.filter((r) => keys.has(`${r.nodeId}|${r.metric}|${r.ts}`));
      state.snapshot.nodeIds = [...new Set(state.snapshot.records.map((r) => r.nodeId))];
      state.snapshot.stats.activeNodes = new Set(state.snapshot.records.map((r) => r.nodeId)).size;
      state.snapshot.stats.totalPoints = state.snapshot.records.length;
    }
    state.sim = simulate(state.closedEdges, state.snapshot);
    return state.snapshot;
  }

  function setWindow(end, { keepPrevious = true } = {}) {
    remember();
    if (keepPrevious) state.previousWindow = { windowEnd: state.windowEnd, windowMs: state.windowMs };
    state.windowEnd = end;
    recall();
    return refresh();
  }

  return {
    state,
    refresh,
    setDataset(dataset) {
      remember();
      state.dataset = dataset;
      recall();
      return refresh();
    },
    setWindowSize(ms) {
      remember();
      state.windowMs = ms;
      return refresh();
    },
    shiftWindow(dir) {
      const next = Math.min(DATA_END, Math.max(BASE_TIME + state.windowMs, state.windowEnd + dir * state.windowMs));
      if (next === state.windowEnd) return state.snapshot;
      return setWindow(next);
    },
    goBack() {
      if (!state.previousWindow) return state.snapshot;
      const target = state.previousWindow;
      state.previousWindow = null;
      remember();
      state.windowEnd = target.windowEnd;
      state.windowMs = target.windowMs;
      recall();
      return refresh();
    },
    setFilters(next) {
      state.filters = { ...state.filters, ...next };
      remember();
      return refresh();
    },
    resetFilters() {
      state.filters = { ...DEFAULT_FILTERS };
      remember();
      return refresh();
    },
    // 空结果演示：设一个任何数据都达不到的数值下限
    emptyDemo() {
      state.filters = { ...DEFAULT_FILTERS, min: 99999 };
      remember();
      return refresh();
    },
    toggleEdge(edgeId) {
      remember();
      const i = state.closedEdges.indexOf(edgeId);
      if (i >= 0) state.closedEdges.splice(i, 1);
      else state.closedEdges.push(edgeId);
      return refresh();
    },
    selectNode(nodeId) {
      state.selectedNode = state.selectedNode === nodeId ? null : nodeId;
      remember();
      return state.snapshot;
    },
    canShift(dir) {
      const next = state.windowEnd + dir * state.windowMs;
      return dir < 0 ? next >= BASE_TIME + state.windowMs : next <= DATA_END;
    },
    hasPrevious() { return state.previousWindow !== null; }
  };
}

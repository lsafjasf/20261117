/* 应用状态：数据集 / 模式 / 时间窗口 / 游标 / 阈值 / 选择集 / 历史快照 */
(function (root) {
  'use strict';
  var RF = root.RF;
  var H = RF.util.HOURS;

  function snapshot(s) {
    return {
      datasetId: s.datasetId,
      mode: s.mode,
      window: s.window.slice(),
      cursor: s.cursor,
      threshold: s.threshold,
      selected: s.selected.slice()
    };
  }

  function AppState(dataByDataset, initial) {
    this.dataByDataset = dataByDataset;
    this.datasetId = initial && initial.datasetId || 'normal';
    this.mode = initial && initial.mode || 'instant';
    this.window = initial && initial.window || [0, H - 1];
    this.cursor = initial && initial.cursor || 48;
    this.threshold = initial && initial.threshold || 0;
    this.selected = initial && initial.selected ? initial.selected.slice() :
      RF.stations.STATIONS.map(function (s) { return s.id; });
    this.history = [];
    this.listeners = [];
    this.exportSeq = 0;
  }

  AppState.prototype.data = function () {
    return this.dataByDataset[this.datasetId];
  };

  AppState.prototype.subscribe = function (fn) {
    this.listeners.push(fn);
  };

  AppState.prototype.emit = function (reason) {
    this.listeners.forEach(function (fn) { fn(reason); });
  };

  AppState.prototype._pushHistory = function () {
    this.history.push(snapshot(this));
    if (this.history.length > 30) this.history.shift();
  };

  // 交互开始（如拖动手柄）时记录拖动前条件，供“切回前一条件”
  AppState.prototype.saveCheckpoint = function () {
    this._pushHistory();
  };

  AppState.prototype.canBack = function () {
    return this.history.length > 0;
  };

  // 切回前一条件：当前条件先入栈，选择状态与显示范围原样恢复
  AppState.prototype.back = function () {
    if (!this.history.length) return false;
    var prev = this.history.pop();
    this.datasetId = prev.datasetId;
    this.mode = prev.mode;
    this.window = prev.window.slice();
    this.cursor = RF.util.clamp(prev.cursor, prev.window[0], prev.window[1]);
    this.threshold = prev.threshold;
    this.selected = prev.selected.slice();
    this.emit('back');
    return true;
  };

  AppState.prototype.setDataset = function (id) {
    if (id === this.datasetId) return;
    this._pushHistory();
    this.datasetId = id;
    this.selected = RF.stations.STATIONS.map(function (s) { return s.id; });
    this.window = [0, H - 1];
    this.cursor = 48;
    this.emit('dataset');
  };

  AppState.prototype.setMode = function (mode) {
    if (mode === this.mode) return;
    this._pushHistory();
    this.mode = mode;
    this.emit('mode');
  };

  AppState.prototype.setThreshold = function (t) {
    var v = Math.max(0, Number(t) || 0);
    if (v === this.threshold) return;
    this._pushHistory();
    this.threshold = v;
    this.emit('threshold');
  };

  AppState.prototype.setWindow = function (w0, w1, skipHistory) {
    w0 = RF.util.clamp(Math.round(w0), 0, H - 1);
    w1 = RF.util.clamp(Math.round(w1), 0, H - 1);
    if (w0 > w1) { var tmp = w0; w0 = w1; w1 = tmp; }
    if (!skipHistory && (w0 !== this.window[0] || w1 !== this.window[1])) this._pushHistory();
    this.window = [w0, w1];
    this.cursor = RF.util.clamp(this.cursor, w0, w1);
    if (!skipHistory) this.emit('window');
  };

  AppState.prototype.setCursor = function (h, skipEmit) {
    this.cursor = RF.util.clamp(Math.round(h), this.window[0], this.window[1]);
    if (!skipEmit) this.emit('cursor');
  };

  AppState.prototype.toggleStation = function (id) {
    this._pushHistory();
    var idx = this.selected.indexOf(id);
    if (idx >= 0) this.selected.splice(idx, 1);
    else this.selected.push(id);
    this.emit('selection');
  };

  AppState.prototype.setSelection = function (ids, additive) {
    this._pushHistory();
    if (additive) {
      var merged = this.selected.slice();
      ids.forEach(function (id) { if (merged.indexOf(id) < 0) merged.push(id); });
      this.selected = merged;
    } else {
      this.selected = ids.slice();
    }
    this.emit('selection');
  };

  AppState.prototype.clearSelection = function () {
    if (!this.selected.length) return;
    this._pushHistory();
    this.selected = [];
    this.emit('selection');
  };

  AppState.prototype.selectAll = function () {
    this._pushHistory();
    this.selected = RF.stations.STATIONS.map(function (s) { return s.id; });
    this.emit('selection');
  };

  // 阈值筛选：窗口内最大瞬时雨强达到阈值的站点才可见
  AppState.prototype.visibleStations = function () {
    var self = this;
    var d = this.data();
    return RF.stations.STATIONS.filter(function (st) {
      var agg = RF.pipeline.aggregate(d.grid[st.id], self.window[0], self.window[1]);
      return (agg.maxInstant || 0) >= self.threshold;
    });
  };

  AppState.prototype.seriesAt = function (stationId, h) {
    var cell = this.data().grid[stationId];
    if (this.mode === 'cumulative') {
      return cell.status[h] === RF.pipeline.ST.MISSING ||
        cell.status[h] === RF.pipeline.ST.ANOMALOUS ? null : cell.cum[h];
    }
    return cell.status[h] === RF.pipeline.ST.MISSING ||
      cell.status[h] === RF.pipeline.ST.ANOMALOUS ? null : cell.values[h];
  };

  RF.AppState = AppState;
})(typeof window !== 'undefined' ? window : globalThis);

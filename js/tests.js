/* 验证套件：浏览器与 Node 均可运行，覆盖正常 / 缺失 / 异常三组数据 */
(function (root) {
  'use strict';
  var RF = root.RF;
  var ST = RF.pipeline.ST;

  function assert(cond, message) {
    if (!cond) throw new Error(message);
  }

  function approx(a, b, eps) {
    return Math.abs(a - b) <= (eps || 1e-6);
  }

  function runAll() {
    var results = [];
    function caseRun(name, fn) {
      try {
        fn();
        results.push({ name: name, pass: true });
      } catch (e) {
        results.push({ name: name, pass: false, error: e.message });
      }
    }

    var processed = {};
    Object.keys(RF.datasets.DATASETS).forEach(function (id) {
      processed[id] = RF.pipeline.process(RF.datasets.DATASETS[id]);
    });

    caseRun('去重：同站点同小时仅保留一条', function () {
      var d = RF.datasets.DATASETS.normal;
      var r = RF.pipeline.dedupe(d.records);
      assert(r.dupRemoved > 0, '应存在重复记录');
      var unique = d.records.length - r.dupRemoved;
      assert(Object.keys(r.map).length === unique, '唯一键数量不一致');
      var seen = {};
      Object.keys(r.map).forEach(function (k) {
        assert(!seen[k], '仍有重复键 ' + k);
        seen[k] = 1;
      });
    });

    caseRun('异常校验：负值与超量程全部剔除', function () {
      var p = processed.anomaly;
      assert(p.totals.anomalyCells > 0, '异常数据集应检出异常单元');
      RF.stations.STATIONS.forEach(function (st) {
        var cell = p.grid[st.id];
        for (var h = 0; h < RF.util.HOURS; h++) {
          if (cell.raw[h] === null) continue;
          var rawInvalid = !RF.pipeline.isValidRain(cell.raw[h], RF.datasets.MAX_VALID);
          if (rawInvalid) {
            assert(cell.origin[h] === ST.ANOMALOUS,
              st.id + '@' + h + ' 异常来源未记录');
            assert(cell.status[h] === ST.FILLED || cell.status[h] === ST.MISSING,
              st.id + '@' + h + ' 异常值未被剔除/隔离');
            assert(cell.raw[h] !== cell.values[h] || cell.values[h] === null,
              st.id + '@' + h + ' 异常原值仍参与绘图');
          }
        }
      });
    });

    caseRun('补缺：缺失位置被线性插值且显式标记', function () {
      var p = processed.missing;
      assert(p.totals.filledCells > 0, '缺失数据集应产生补缺单元');
      assert(p.totals.missingCells >= 0, '缺失计数应非负');
      RF.stations.STATIONS.forEach(function (st) {
        var cell = p.grid[st.id];
        cell.status.forEach(function (stv, h) {
          if (stv === ST.FILLED) {
            assert(cell.values[h] !== null && cell.values[h] >= 0,
              st.id + '@' + h + ' 补缺值非法');
          }
        });
      });
    });

    caseRun('聚合：窗口统计等于逐小时同口径求和', function () {
      var p = processed.normal;
      var cell = p.grid.S01;
      var agg = RF.pipeline.aggregate(cell, 24, 72);
      var sum = 0, observed = 0;
      for (var h = 24; h <= 72; h++) {
        if (cell.status[h] === ST.VALID || cell.status[h] === ST.FILLED) {
          sum += cell.values[h];
          observed++;
        }
      }
      assert(approx(agg.total, sum, 1e-6), '窗口累计不一致');
      assert(agg.valid + agg.filled + agg.missing + agg.anomalous === agg.windowLength,
        '分类计数之和应等于窗口长度');
      assert(approx(agg.mean, sum / observed, 1e-6), '均值口径不一致');
    });

    caseRun('正常筛选：阈值收窄后可见站点减少且全部达标', function () {
      var state = new RF.AppState(processed, { datasetId: 'normal' });
      var all = state.visibleStations().length;
      var maxes = RF.stations.STATIONS.map(function (st) {
        var agg = RF.pipeline.aggregate(processed.normal.grid[st.id], 0, RF.util.HOURS - 1);
        return agg.maxInstant || 0;
      }).sort(function (a, b) { return a - b; });
      var mid = maxes[Math.floor(maxes.length / 2)];
      state.setThreshold(mid);
      var filtered = state.visibleStations();
      assert(filtered.length < all, '提高阈值后站点数应减少');
      filtered.forEach(function (st) {
        var agg = RF.pipeline.aggregate(processed.normal.grid[st.id],
          state.window[0], state.window[1]);
        assert((agg.maxInstant || 0) >= mid, st.id + ' 未达阈值却可见');
      });
      assert(filtered.length > 0, '正常数据在该阈值下应仍有结果');
    });

    caseRun('空结果：极端阈值返回零站点并被 UI 口径识别', function () {
      var state = new RF.AppState(processed, { datasetId: 'normal' });
      state.setThreshold(100000);
      assert(state.visibleStations().length === 0, '极端阈值应为空结果');
      var csv = RF.exporter.exportCSV(state);
      assert(csv.rows.length === 0, '空结果 CSV 不应包含数据行');
      assert(csv.text.indexOf('空结果') >= 0, 'CSV 应明确标注空结果');
    });

    caseRun('切回前一条件：窗口与选择状态完整恢复', function () {
      var state = new RF.AppState(processed, { datasetId: 'normal' });
      state.setWindow(30, 90);
      state.setSelection(['S02', 'S05']);
      var before = { window: state.window.slice(), selected: state.selected.slice(),
        threshold: state.threshold };
      state.saveCheckpoint();
      state.window = [50, 120];
      state.threshold = 5;
      state.selected = ['S09'];
      assert(state.canBack(), '应存在历史快照');
      state.back();
      assert(state.window[0] === before.window[0] && state.window[1] === before.window[1],
        '窗口未恢复');
      assert(state.selected.join(',') === before.selected.join(','), '选择集未恢复');
      assert(state.threshold === before.threshold, '阈值未恢复');
    });

    caseRun('版本稳定：同一数据重复处理哈希一致，改动后变化', function () {
      var p1 = RF.pipeline.process(RF.datasets.DATASETS.normal);
      var p2 = RF.pipeline.process(RF.datasets.DATASETS.normal);
      assert(p1.version === p2.version, '同数据版本哈希应稳定');
      assert(p1.version !== processed.missing.version, '不同数据版本应不同');
    });

    caseRun('导出一致：CSV 行与屏幕聚合行同值', function () {
      var state = new RF.AppState(processed, { datasetId: 'missing' });
      state.setWindow(40, 110);
      var rows = RF.exporter.buildRows(state);
      rows.forEach(function (r) {
        var agg = RF.pipeline.aggregate(processed.missing.grid[r.id],
          state.window[0], state.window[1]);
        if (r.total === '') {
          assert(agg.total === null, r.id + ' 空值导出不一致');
        } else {
          assert(approx(Number(r.total), agg.total, 0.011), r.id + ' 导出累计与屏幕不一致');
        }
        assert(Number(r.valid) === agg.valid && Number(r.missing) === agg.missing,
          r.id + ' 导出计数与屏幕不一致');
      });
    });

    return results;
  }

  RF.tests = { runAll: runAll };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runAll: runAll };
  }
})(typeof window !== 'undefined' ? window : globalThis);

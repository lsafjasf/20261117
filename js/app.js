/* 界面控制器：仿真时钟、参数/设备绑定、日志、导出与场景验证 */
(function () {
  'use strict';

  var sim = new PressSim.Simulation();
  var renderer = new PressRenderer(document.getElementById('lineCanvas'));
  var audio = new PumpAudio();
  var timer = null;
  var running = false;
  var intervalMs = 250;
  var renderedEvents = 0;

  var el = function (id) { return document.getElementById(id); };

  function setRunningState(state) {
    var badge = el('runState');
    badge.className = 'badge badge-' + state.cls;
    badge.textContent = state.text;
  }

  function playLoop() {
    clearInterval(timer);
    timer = setInterval(function () {
      sim.tick();
      render();
      if (sim.isBatchComplete()) {
        pauseLoop(true);
      }
    }, intervalMs);
  }

  function pauseLoop(batchDone) {
    running = false;
    clearInterval(timer);
    timer = null;
    audio.stop();
    setRunningState(batchDone
      ? { cls: 'done', text: '批次完成' }
      : { cls: 'paused', text: '已暂停' });
    el('btnPlay').textContent = batchDone ? '批次已完成' : '运行';
  }

  function startLoop() {
    if (sim.isBatchComplete()) {
      return;
    }
    running = true;
    audio.start();
    setRunningState({ cls: 'running', text: '运行中' });
    el('btnPlay').textContent = '运行中';
    playLoop();
  }

  function render() {
    var snap = sim.getSnapshot();
    renderer.draw(snap);
    el('simClock').textContent = snap.simTime.toFixed(2) + ' s';
    el('statGood').textContent = snap.goodCount;
    el('statReject').textContent = snap.rejectCount;
    el('statYield').textContent = snap.finished.length ? snap.yieldRate + '%' : '—';
    el('statPeakKW').textContent = snap.peakPowerKW + ' kW';
    el('statPeakP').textContent = snap.peakPressure + ' MPa';
    el('statEnergy').textContent = snap.energyKWh + ' kWh';
    el('statPumpKW').textContent = snap.pumpPowerKW + ' kW';
    markOutOfLimit(snap);
    renderEquipmentButtons(snap);
    appendNewEvents();
    audio.update(snap.pumpPowerKW, snap.params.pressure);
  }

  function markOutOfLimit(snap) {
    Object.keys(snap.limits).forEach(function (name) {
      var lim = snap.limits[name];
      var v = snap.params[name];
      el('ctrl-' + name).classList.toggle('out-of-limit', v < lim.min || v > lim.max);
    });
  }

  function renderEquipmentButtons(snap) {
    var names = { former: '铺装机', heater: '蒸汽预热器', pump: '液压泵' };
    document.querySelectorAll('.eq-btn').forEach(function (btn) {
      var key = btn.dataset.eq;
      var on = snap.equipment[key].running;
      btn.classList.toggle('eq-on', on);
      btn.classList.toggle('eq-off', !on);
      btn.textContent = names[key] + ' ' + (on ? '运行中（点击停机）' : '已停机（点击恢复）');
    });
  }

  var LOG_STYLE = {
    PARAM_CHANGE: '参数变化', PARAM_OUT_OF_LIMIT: '参数越限',
    EQUIPMENT_START: '设备启动', EQUIPMENT_STOP: '设备停机',
    DEFECT: '缺陷触发', BATCH_COMPLETE: '批次完成',
    BATCH_RESET: '批次重置', FORM_START: '铺装开始',
    PRESS_ENTER: '进入压机', PRESS_RELEASE: '压机释放',
    PREHEAT_ENTER: '进入热区', BUFFER_IN: '进入缓存'
  };

  function appendNewEvents() {
    var events = sim.getEvents();
    var box = el('eventLog');
    for (var i = renderedEvents; i < events.length; i++) {
      var e = events[i];
      var row = document.createElement('div');
      row.className = 'log-row ' + e.type;
      var typeCell = document.createElement('span');
      typeCell.className = 'log-type';
      typeCell.textContent = (LOG_STYLE[e.type] || e.type);
      var tCell = document.createElement('span');
      tCell.className = 'log-t';
      tCell.textContent = e.t.toFixed(2) + 's';
      var msg = document.createElement('span');
      msg.className = 'log-msg';
      msg.textContent = describeEvent(e);
      row.appendChild(tCell);
      row.appendChild(typeCell);
      row.appendChild(msg);
      box.appendChild(row);
    }
    renderedEvents = events.length;
    box.scrollTop = box.scrollHeight;
  }

  function describeEvent(e) {
    var d = e.detail;
    switch (e.type) {
      case 'PARAM_CHANGE':
        return d.name + ' ' + d.old + ' → ' + d.next + (d.outOfRange ? '（已越出安全区）' : '');
      case 'PARAM_OUT_OF_LIMIT':
        return d.label + '=' + d.value + ' 超出安全区 [' + d.safeMin + ', ' + d.safeMax + ']';
      case 'EQUIPMENT_STOP':
        return e.source + ' 停机，原因：' + d.reason;
      case 'EQUIPMENT_START':
        return e.source + ' 恢复运行，恢复时刻 ' + d.recoveredAt + 's';
      case 'DEFECT':
        return '板材 #' + d.boardId + ' 检出 ' + d.label;
      case 'PRESS_RELEASE':
        return '板材 #' + d.boardId + ' 密度 ' + d.density + '，' + (d.passed ? '良品' : '废品 ' + d.defects.join(','));
      case 'BATCH_COMPLETE':
        return '良品 ' + d.good + ' / 废品 ' + d.reject + '，良品率 ' + d.yieldRate + '%';
      case 'BATCH_RESET':
        return '新批次开始，旧缓存与日志已清空';
      default:
        return JSON.stringify(d);
    }
  }

  function hardReset() {
    pauseLoop(false);
    sim.reset();
    renderedEvents = 0;
    el('eventLog').innerHTML = '';
    syncControlsFromSim();
    render();
  }

  function syncControlsFromSim() {
    var snap = sim.getSnapshot();
    el('rng-moisture').value = snap.params.moisture;
    el('rng-pressure').value = snap.params.pressure;
    el('rng-holdTime').value = snap.params.holdTime;
    el('val-moisture').textContent = snap.params.moisture + '%';
    el('val-pressure').textContent = snap.params.pressure + ' MPa';
    el('val-holdTime').textContent = snap.params.holdTime + ' s';
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    var report = sim.exportReport();
    download('batch-report-' + Date.now() + '.json', JSON.stringify(report, null, 2), 'application/json');
  }

  function exportCsv() {
    var rows = [['time_s', 'type', 'source', 'detail_json', 'moisture', 'pressure', 'holdTime'].join(',')];
    sim.getEvents().forEach(function (e) {
      rows.push([
        e.t, e.type, e.source,
        '"' + JSON.stringify(e.detail).replace(/"/g, '""') + '"',
        e.values.moisture, e.values.pressure, e.values.holdTime
      ].join(','));
    });
    download('event-log-' + Date.now() + '.csv', rows.join('\n'), 'text/csv');
  }

  // 场景脚本：重置为全新批次（不保留旧缓存），自动执行并汇总结果
  function runScenario(name) {
    hardReset();
    var result;
    if (name === 'normal') {
      sim.runToComplete();
    } else if (name === 'outOfLimit') {
      sim.setParam('pressure', 4.6);
      sim.setParam('moisture', 14);
      sim.setParam('holdTime', 4);
      sim.runToComplete();
    } else if (name === 'downtime') {
      // 先停蒸汽：板材仍在铺装/排队，热区必然吃到蒸汽中断
      sim.setEquipment('heater', false, '蒸汽阀门故障');
      var guard = 0;
      var preheatBoard = sim.getSnapshot().stations.preheat;
      while (guard++ < 200 && !(preheatBoard && preheatBoard.defects.indexOf('GLUE_UNCURED') !== -1)) {
        sim.tick();
        preheatBoard = sim.getSnapshot().stations.preheat;
      }
      sim.setEquipment('heater', true);
      // 再停液压泵：等板材进入压机后停机
      guard = 0;
      while (!sim.getSnapshot().stations.press && guard++ < 200) sim.tick();
      sim.setEquipment('pump', false, '液压泵过载保护触发');
      for (var p = 0; p < 4; p++) sim.tick();
      sim.setEquipment('pump', true);
      sim.runToComplete();
    }
    syncControlsFromSim();
    render();
    pauseLoop(true);
    result = sim.exportReport();
    showScenarioSummary(name, result);
  }

  function showScenarioSummary(name, report) {
    var defects = {};
    report.boards.forEach(function (b) {
      b.defectLabels.forEach(function (label, i) {
        var key = '板材#' + b.boardId + ' ' + b.defects[i];
        defects[key] = label;
      });
    });
    var title = { normal: '正常生产', outOfLimit: '参数越限', downtime: '设备停机' }[name];
    var lines = [
      '场景：' + title,
      '良品数：' + report.goodCount + ' / ' + report.batchSize,
      '良品率：' + report.yieldRate + '%',
      '峰值功率：' + report.peakPowerKW + ' kW；峰值压力：' + report.peakPressure + ' MPa',
      '停机原因：' + (report.downtime.length ? report.downtime.map(function (d) {
        return d.reason + '(' + d.startAt + 's→' + d.endAt + 's)';
      }).join('；') : '无'),
      '异常位置：' + (Object.keys(defects).length ? Object.keys(defects).join('；') : '无')
    ];
    window.alert(lines.join('\n'));
  }

  function bindControls() {
    el('btnPlay').addEventListener('click', startLoop);
    el('btnPause').addEventListener('click', function () { pauseLoop(false); });
    el('btnStep').addEventListener('click', function () {
      pauseLoop(false);
      sim.tick();
      render();
      if (sim.isBatchComplete()) {
        pauseLoop(true);
      }
    });
    el('btnReset').addEventListener('click', hardReset);
    el('selSpeed').addEventListener('change', function (e) {
      intervalMs = Number(e.target.value);
      if (running) {
        playLoop();
      }
    });
    el('chkMute').addEventListener('change', function (e) {
      audio.setMuted(e.target.checked);
    });

    var paramMeta = {
      moisture: { el: 'rng-moisture', out: 'val-moisture', suffix: '%' },
      pressure: { el: 'rng-pressure', out: 'val-pressure', suffix: ' MPa' },
      holdTime: { el: 'rng-holdTime', out: 'val-holdTime', suffix: ' s' }
    };
    Object.keys(paramMeta).forEach(function (name) {
      var meta = paramMeta[name];
      el(meta.el).addEventListener('input', function (e) {
        sim.setParam(name, Number(e.target.value));
        el(meta.out).textContent = sim.getSnapshot().params[name] + meta.suffix;
        render();
      });
    });

    document.querySelectorAll('.eq-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.eq;
        var snap = sim.getSnapshot();
        var on = snap.equipment[key].running;
        var reason = {
          former: '铺装机手动停机',
          heater: '蒸汽系统手动停机',
          pump: '液压泵手动停机'
        }[key];
        sim.setEquipment(key, !on, on ? reason : undefined);
        render();
      });
    });

    document.querySelectorAll('.scenarios button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        runScenario(btn.dataset.scenario);
      });
    });
    el('btnExportJson').addEventListener('click', exportJson);
    el('btnExportCsv').addEventListener('click', exportCsv);
    el('btnClearLog').addEventListener('click', function () {
      el('eventLog').innerHTML = '';
    });
  }

  bindControls();
  syncControlsFromSim();
  render();
  window.addEventListener('beforeunload', function () {
    if (timer) {
      clearInterval(timer);
    }
  });
})();

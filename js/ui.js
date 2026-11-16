/* UI 绑定：指标表、目标、位点、检查点、日志、处置对比 */
(function (root) {
  'use strict';

  const U = root.WetlandUtil;
  const CFG = U.CFG;

  function WetlandUI() {
    this.el = {
      metrics: document.getElementById('metricsTable'),
      targets: document.getElementById('targets'),
      sites: document.getElementById('sites'),
      checkpoints: document.getElementById('checkpoints'),
      log: document.getElementById('logBox'),
      compare: document.getElementById('compareBox'),
      clock: document.getElementById('clock'),
      weather: document.getElementById('weather'),
      runStatus: document.getElementById('runStatus'),
    };
    this._lastLogCount = 0;
    this._buildMetricHeader();
  }

  WetlandUI.prototype._buildMetricHeader = function () {
    this.el.metrics.innerHTML =
      '<tr><th>指标</th><th>实际值</th><th>观测值</th><th>告警</th></tr>';
  };

  const ROWS = [
    { key: 'level', label: '水位', unit: 'cm', real: (s) => s.levelCm,
      obs: (o) => o.level, digits: 1 },
    { key: 'carbon', label: '碳储量', unit: 't/ha', real: (s) => s.carbon,
      obs: (o) => o.carbon, digits: 2 },
    { key: 'pollution', label: '污染指数', unit: '', real: (s) => s.pollution,
      obs: (o) => o.pollution, digits: 1 },
    { key: 'birds', label: '鸟类数量', unit: '只', real: (s) => s.birds,
      obs: (o) => o.birds, digits: 0 },
    { key: 'do', label: '溶解氧', unit: 'mg/L', real: (s) => s.doMgL,
      obs: (o) => o.doMgL, digits: 2, alarmKey: null },
    { key: 'reed', label: '芦苇生物量', unit: '', real: (s) => s.reed,
      obs: null, digits: 0, alarmKey: null },
  ];

  WetlandUI.prototype.render = function (sim) {
    this._renderClock(sim);
    this._renderMetrics(sim);
    this._renderTargets(sim);
    this._renderSites(sim);
    this._renderCheckpoints(sim);
    this._renderLogs(sim);
    this._renderCompare(sim);
    this._renderStatus(sim);
  };

  WetlandUI.prototype._renderClock = function (sim) {
    const d = U.simDate(Math.min(sim.hour, CFG.HOURS_PER_YEAR - 1));
    this.el.clock.textContent = d.text + '  (' +
      (sim.hour / CFG.HOURS_PER_YEAR * 100).toFixed(1) + '%)';
    const w = sim.weather[Math.min(sim.hour, CFG.HOURS_PER_YEAR - 1)];
    this.el.weather.textContent = '气温 ' + w.tempC.toFixed(1) + '℃ · 降雨 ' +
      w.rainMmH.toFixed(2) + ' mm/h · 风速 ' + w.windMs.toFixed(1) +
      ' m/s · 云量 ' + Math.round(w.cloud * 100) + '%';
  };

  WetlandUI.prototype._renderMetrics = function (sim) {
    const s = sim.state;
    const o = sim.observations;
    const rows = ROWS.map((r) => {
      const realVal = r.real(s);
      const obsCell = r.obs ?
        '<td class="obs">' + U.fmt(r.obs(o), r.digits) + '</td>' :
        '<td class="obs">—</td>';
      const alarmKey = r.alarmKey === null ? null : r.key;
      let badge = '<span class="badge ok">—</span>';
      if (alarmKey && sim.alarms[alarmKey]) {
        const st = sim.alarms[alarmKey].status;
        const text = st === 'ok' ? '正常' : st === 'warn' ? '预警' : '临界';
        badge = '<span class="badge ' + (st === 'ok' ? 'ok' : st) + '">' +
          text + '</span>';
      }
      return '<tr><td>' + r.label + '</td>' +
        '<td class="real">' + U.fmt(realVal, r.digits) + ' ' + r.unit + '</td>' +
        obsCell + '<td>' + badge + '</td></tr>';
    }).join('');
    this.el.metrics.innerHTML =
      '<tr><th>指标</th><th>实际值</th><th>观测值(含噪声)</th><th>告警</th></tr>' +
      rows;
  };

  WetlandUI.prototype._renderTargets = function (sim) {
    const s = sim.state;
    const items = [
      { label: '鸟类数量 ≥ ' + CFG.TARGET_BIRDS + ' 只',
        val: Math.round(s.birds), met: s.birds >= CFG.TARGET_BIRDS },
      { label: '物种数 ≥ ' + CFG.TARGET_SPECIES,
        val: s.species, met: s.species >= CFG.TARGET_SPECIES },
      { label: '碳储量 ≥ ' + CFG.TARGET_CARBON + ' t/ha',
        val: s.carbon.toFixed(1), met: s.carbon >= CFG.TARGET_CARBON },
    ];
    this.el.targets.innerHTML = items.map((it) =>
      '<div class="target-row ' + (it.met ? 'met' : 'unmet') + '">' +
      '<span>' + it.label + '</span><span>' + it.val +
      (it.met ? ' ✓' : ' ✗') + '</span></div>').join('');
  };

  WetlandUI.prototype._renderSites = function (sim) {
    this.el.sites.innerHTML = sim.sites.map((site) =>
      '<div class="site"><span><span class="dot" style="background:#ffd678"></span>#' +
      site.id + ' ' + site.label + '</span>' +
      '<span>偏好 ' + site.preferredDepth.toFixed(0) + 'cm · ' +
      site.birds + ' 只</span></div>').join('');
  };

  root.WetlandUI = WetlandUI;

  WetlandUI.prototype._renderCheckpoints = function (sim) {
    const icon = { pending: '○', pass: '✓', fail: '✗' };
    this.el.checkpoints.innerHTML = sim.checkpoints.map((cp) => {
      const cls = cp.status === 'pass' ? 'cp-pass' :
        cp.status === 'fail' ? 'cp-fail' : 'cp-pending';
      const time = cp.time !== null ?
        U.simDate(cp.time).short : '—';
      return '<li class="' + cls + '"><span class="cp-icon">' +
        icon[cp.status] + '</span><span>' + cp.label + '</span>' +
        '<span class="cp-time">' + time + '</span></li>';
    }).join('');
  };

  WetlandUI.prototype._renderLogs = function (sim) {
    if (sim.logs.length === this._lastLogCount) return;
    this._lastLogCount = sim.logs.length;
    this.el.log.innerHTML = sim.logs.slice().reverse().map((entry) =>
      '<div class="log-entry ' + entry.level + '"><span class="log-time">[' +
      U.simDate(entry.hour).short + ' ' +
      String(entry.hour % 24).padStart(2, '0') + ':00]</span> ' +
      entry.msg + '</div>').join('');
  };

  WetlandUI.prototype._renderCompare = function (sim) {
    if (!sim.snapshots.length) {
      this.el.compare.innerHTML =
        '<div style="color:#6f8a7d;font-size:12px">暂无处置记录（收割等干预后生成 7 天对比）</div>';
      return;
    }
    this.el.compare.innerHTML = sim.snapshots.slice().reverse().map((snap) => {
      const t = U.simDate(snap.hour);
      const title = (snap.type === 'harvest' ? '芦苇收割' : '干预') +
        ' · ' + (snap.result === 'failure' ? '处置失败' :
        snap.result === 'success' ? '处置成功' : '进行中') +
        ' · 触发 ' + t.short;
      if (!snap.settled) {
        return '<div class="compare-card"><h4>' + title +
          '</h4><div>等待 7 天后数据结算…</div></div>';
      }
      const b = snap.before, a = snap.after;
      const row = (label, key, digits, lowerWorse) => {
        const d = a[key] - b[key];
        const cls = Math.abs(d) < 0.05 ? '' :
          ((d > 0) !== lowerWorse ? 'delta-up' : 'delta-down');
        const sign = d >= 0 ? '+' : '';
        return '<span>' + label + '</span><span class="arrow">→</span>' +
          '<span class="' + cls + '">' + U.fmt(a[key], digits) +
          ' (' + sign + U.fmt(d, digits) + ')</span>';
      };
      return '<div class="compare-card"><h4>' + title + '</h4>' +
        '<div class="compare-grid">' +
        row('水位 cm', 'level', 1, false) +
        row('鸟类 只', 'birds', 0, true) +
        row('物种', 'species', 0, true) +
        row('碳 t/ha', 'carbon', 2, true) +
        row('污染', 'pollution', 1, false) +
        row('芦苇', 'reed', 0, true) +
        '</div><div style="margin-top:4px;color:#7fa394">处置前基线：水位 ' +
        U.fmt(b.level, 1) + ' / 鸟 ' + U.fmt(b.birds, 0) +
        ' / 碳 ' + U.fmt(b.carbon, 2) + '</div></div>';
    }).join('');
  };

  WetlandUI.prototype._renderStatus = function (sim) {
    const anyCrit = Object.keys(sim.alarms).some((k) =>
      sim.alarms[k].status === 'critical');
    const anyWarn = Object.keys(sim.alarms).some((k) =>
      sim.alarms[k].status === 'warn');
    let cls = '', text = '连续运行中';
    if (sim.finished) {
      cls = 'done';
      text = sim.verdict.success ? '一年结束 · 双指标达标 成功' :
        '一年结束 · 未达标';
    } else if (anyCrit) {
      cls = 'critical'; text = '临界事件 · 需立即处置';
    } else if (anyWarn) {
      cls = 'fail'; text = '预警状态';
    } else if (sim.hour < 24 * 30) {
      cls = 'steady'; text = '稳态观察窗口';
    }
    this.el.runStatus.className = 'run-status ' + cls;
    this.el.runStatus.textContent = text;
  };
})(typeof self !== 'undefined' ? self : this);

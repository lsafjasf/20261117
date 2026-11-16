/*
 * 界面主控：连续运行、重置、场景接管、指标三态、事件日志
 */
(function () {
  'use strict';
  var RT = window.RT;
  var $ = function (id) { return document.getElementById(id); };

  var sim, timer, running = false, autoScenario = null, hoverCell = null;
  var intervalMs = 100;
  var audio = new window.PumpAudio();
  var mapCanvas = $('map');
  var chartCanvas = $('chart');

  function currentSeed() { return $('seedInput').value.trim() || 'estuary-2026'; }

  function syncSliders() {
    $('aerSlider').value = sim.controls.aeration;
    $('divSlider').value = sim.controls.diversion;
    $('aerVal').textContent = sim.controls.aeration.toFixed(2);
    $('divVal').textContent = sim.controls.diversion.toFixed(2);
  }

  function resetSim() {
    stopLoop();
    sim = RT.createSim(currentSeed());
    autoScenario = null;
    syncSliders();
    hideModal();
    renderAll();
  }

  function applyScenario(key) {
    stopLoop();
    sim = RT.createSim(currentSeed());
    RT.Scenarios[key].deploy(sim);
    autoScenario = key;
    syncSliders();
    hideModal();
    renderAll();
    startLoop();
  }

  function advance() {
    if (sim.status !== 'running') { stopLoop(); openModal(); return; }
    if (autoScenario) {
      var p = RT.Scenarios[autoScenario].policy(sim);
      RT.setControl(sim, 'aeration', p.aeration);
      RT.setControl(sim, 'diversion', p.diversion);
    }
    RT.step(sim);
    syncSliders();
    audio.update(sim.controls.aeration, sim.controls.diversion);
    renderAll();
    if (sim.status !== 'running') { stopLoop(); openModal(); }
  }

  function startLoop() {
    if (running || sim.status !== 'running') return;
    audio.ensure();
    running = true;
    $('btnRun').textContent = '暂停';
    $('btnRun').classList.add('running');
    timer = setInterval(advance, intervalMs);
  }

  function stopLoop() {
    running = false;
    clearInterval(timer);
    timer = null;
    $('btnRun').textContent = '连续运行';
    $('btnRun').classList.remove('running');
  }

  function observedAggregate() {
    var cov = RT.coverageMap(sim);
    var sum = { algae: 0, do2: 0, turb: 0, nutrient: 0 };
    var n = 0;
    sim.cells.forEach(function (c, i) {
      if (cov[i] && c.obs && c.obs.age === 0) {
        sum.algae += c.obs.algae; sum.do2 += c.obs.do2;
        sum.turb += c.obs.turb; sum.nutrient += c.obs.nutrient; n++;
      }
    });
    return n ? { algae: sum.algae / n, do2: sum.do2 / n, turb: sum.turb / n, nutrient: sum.nutrient / n, n: n } : null;
  }

  function card(name, actual, obs, unit, violated, noObs) {
    var cls = noObs ? 'na' : (violated ? 'alarm' : 'ok');
    var txt = noObs ? '无观测' : (violated ? '告警' : '正常');
    return '<div class="metric' + (violated ? ' violation' : '') + '"><div class="name">' + name +
      '</div><div class="row"><span class="actual">' + actual.toFixed(2) + '<small> ' + unit +
      '</small></span><span class="flag ' + cls + '">' + txt + '</span></div>' +
      '<div class="obs">观测值：' + (noObs ? '— 浮标未覆盖' : obs.toFixed(2) + ' ' + unit) + '</div></div>';
  }

  var WEATHER = {
    sunny: '晴', cloudy: '多云', overcast: '阴', rain: '雨'
  };

  function renderBadges(agg, obs) {
    $('weatherBadge').textContent = '天气：' + WEATHER[sim.weather.kind] +
      '（光照 ' + sim.weather.light.toFixed(2) + '）';
    $('tideBadge').textContent = '水位：' + sim.waterLevel.toFixed(2) + ' m' +
      (sim.activePulses.some(function (t) { return sim.tick - t <= 3; }) ? ' · 营养盐脉冲' : '');
    var sb = $('statusBadge');
    var map = { running: ['运行中', ''], success: ['达标成功', 'good'], failed: ['处置失败', 'bad'] };
    sb.textContent = '状态：' + map[sim.status][0] +
      (sim.postTicks ? ' · 恢复观察 ' + sim.postTicks + '/' + RT.POST_RUN_TICKS : '');
    sb.className = 'badge ' + map[sim.status][1];
    $('simClock').textContent = RT.simTimeLabel(sim.tick) + ' · 步 ' + sim.tick +
      '/' + RT.DURATION_TICKS + ' · seed ' + sim.seed;
  }

  function renderMetrics(agg) {
    var obs = observedAggregate();
    var noObs = obs === null;
    var th = RT.TH;
    var html = '';
    html += card('藻密度（实际）', agg.avgAlgae, noObs ? 0 : obs.algae, 'µg/L',
      agg.avgAlgae >= th.algae, noObs);
    html += card('热点藻密度', agg.hotspotAlgae, noObs ? 0 : obs.algae, 'µg/L',
      agg.hotspotAlgae >= th.algae, noObs);
    html += card('溶解氧', agg.avgDo, noObs ? 0 : obs.do2, 'mg/L',
      agg.avgDo < th.doLow || agg.avgDo > th.doHigh, noObs);
    html += card('营养盐', agg.avgNutrient, noObs ? 0 : obs.nutrient, 'mg/L',
      agg.avgNutrient >= th.nutrient, noObs);
    html += card('浊度', agg.avgTurb, noObs ? 0 : obs.turb, 'NTU',
      agg.avgTurb >= th.turbidity, noObs);
    html += card('鱼类存活率', agg.avgFish * 100, noObs ? 0 : agg.avgFish * 100, '%',
      agg.avgFish < th.fishSurvival, false);
    $('metricGrid').innerHTML = html;

    $('buoyVal').textContent = sim.buoys.length + '/' + RT.MAX_BOUYS;
    $('missVal').textContent = '漏报热点 ' + sim.missedHotspots +
      '（累计 ' + (sim.missedTicks || 0) + ' 步）';
    $('buoyCap').textContent = RT.MAX_BOUYS;
    renderBadges(agg, obs);
  }

  function renderLog() {
    var tb = $('logTable').querySelector('tbody');
    var rows = sim.events.slice(-60).map(function (e) {
      return '<tr class="ev-' + e.type + '"><td>' + e.simTime + '</td><td>' + e.tick +
        '</td><td>' + e.type + '</td><td>' + e.msg +
        '<br><small style="color:#6e93a3">墙钟 ' + e.wallTime + '</small></td></tr>';
    });
    tb.innerHTML = rows.join('');
    var scroller = $('logTable').closest('.log-panel');
    scroller.scrollTop = scroller.scrollHeight;
  }

  function renderAll() {
    var agg = RT.aggregate(sim);
    RT.drawMap(mapCanvas, sim, hoverCell);
    RT.drawChart(chartCanvas, sim);
    renderMetrics(agg);
    renderLog();
  }

  function openModal() {
    $('modalTitle').textContent = sim.status === 'success' ? '四天达标' : '处置失败';
    $('modalBody').textContent = sim.endReason;
    $('btnRecovery').classList.toggle('hidden', sim.status !== 'success');
    $('modal').classList.remove('hidden');
    if (sim.status === 'success') audio.blip(880);
    else audio.blip(180);
  }

  function hideModal() { $('modal').classList.add('hidden'); }

  function runRecovery() {
    hideModal();
    RT.postRecoveryRun(sim);
    renderAll();
    openModal();
  }

  function cellFromEvent(ev) {
    var rect = mapCanvas.getBoundingClientRect();
    var x = Math.floor((ev.clientX - rect.left) / rect.width * RT.GRID_W);
    var y = Math.floor((ev.clientY - rect.top) / rect.height * RT.GRID_H);
    if (x < 0 || y < 0 || x >= RT.GRID_W || y >= RT.GRID_H) return null;
    return { x: x, y: y };
  }

  function bindEvents() {
    $('btnRun').addEventListener('click', function () {
      if (running) stopLoop(); else startLoop();
    });
    $('btnStep').addEventListener('click', function () { stopLoop(); advance(); });
    $('btnReset').addEventListener('click', resetSim);
    $('btnModalReset').addEventListener('click', resetSim);
    $('btnRecovery').addEventListener('click', runRecovery);
    $('speedSel').addEventListener('change', function (e) {
      intervalMs = parseInt(e.target.value, 10);
      if (running) { stopLoop(); startLoop(); }
    });
    $('btnSound').addEventListener('click', function () {
      var on = audio.toggle();
      $('btnSound').textContent = '声音：' + (on ? '开' : '关');
      if (on) audio.update(sim.controls.aeration, sim.controls.diversion);
    });
    $('aerSlider').addEventListener('input', function (e) {
      autoScenario = null;
      RT.setControl(sim, 'aeration', parseFloat(e.target.value));
      syncSliders();
      audio.update(sim.controls.aeration, sim.controls.diversion);
    });
    $('divSlider').addEventListener('input', function (e) {
      autoScenario = null;
      RT.setControl(sim, 'diversion', parseFloat(e.target.value));
      syncSliders();
      audio.update(sim.controls.aeration, sim.controls.diversion);
    });
    document.querySelectorAll('.scenario').forEach(function (btn) {
      btn.addEventListener('click', function () { applyScenario(btn.dataset.sc); });
    });
    mapCanvas.addEventListener('click', function (ev) {
      var cell = cellFromEvent(ev);
      if (!cell) return;
      var existed = sim.buoys.some(function (b) { return b.x === cell.x && b.y === cell.y; });
      if (existed) RT.removeBuoy(sim, cell.x, cell.y);
      else {
        if (!RT.placeBuoy(sim, cell.x, cell.y)) audio.blip(160);
        else audio.blip(720);
      }
      renderAll();
    });
    mapCanvas.addEventListener('mousemove', function (ev) {
      hoverCell = cellFromEvent(ev);
      RT.drawMap(mapCanvas, sim, hoverCell);
    });
    mapCanvas.addEventListener('mouseleave', function () {
      hoverCell = null;
      RT.drawMap(mapCanvas, sim, null);
    });
    $('btnExport').addEventListener('click', function () {
      var payload = {
        seed: sim.seed, exportedAt: new Date().toISOString(),
        hotspots: sim.hotspots, weatherSeq: sim.weatherSeq, pulses: sim.pulses,
        finalAggregate: RT.aggregate(sim), status: sim.status,
        endReason: sim.endReason, events: sim.events,
        historyTail: sim.history.slice(-120)
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'redtide-' + sim.seed + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  sim = RT.createSim(currentSeed());
  bindEvents();
  syncSliders();
  renderAll();
})();

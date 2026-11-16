/* 主控制器：运行循环、干预按钮、跑批、重置与复现性自检 */
(function () {
  'use strict';

  const U = window.WetlandUtil;
  const CFG = U.CFG;
  const $ = (id) => document.getElementById(id);

  let sim, director, renderer, ui, audio;
  let running = false;
  let lastFrame = 0;

  function init() {
    renderer = new window.WetlandRenderer($('wetlandCanvas'));
    ui = new window.WetlandUI();
    audio = new window.WetlandAudio();
    director = new window.WetlandDirector.ScenarioDirector();
    boot();
    bindControls();
    requestAnimationFrame(loop);
  }

  function boot() {
    const seed = $('seedInput').value.trim() || 'WETLAND-2026';
    const mode = $('modeSelect').value;
    sim = new window.WetlandSimModule.WetlandSim(seed, { mode: mode });
    director.reset();
    window.__sim = sim;
    window.__director = director;
    running = false;
    $('btnPlay').textContent = '▶ 连续运行';
    syncInterventionButtons();
    ui._lastLogCount = 0;
    ui.render(sim);
    renderer.render(sim, sim.weather[0]);
  }

  function bindControls() {
    $('btnPlay').addEventListener('click', () => {
      running = !running;
      $('btnPlay').textContent = running ? '⏸ 暂停' : '▶ 连续运行';
    });
    $('btnStep').addEventListener('click', () => {
      if (!sim.finished) {
        director.beforeStep(sim);
        sim.step(1);
        director.afterStep(sim);
      }
    });
    $('btnBatch').addEventListener('click', runBatch);
    $('btnRepro').addEventListener('click', runReproCheck);
    $('btnReset').addEventListener('click', boot);
    $('btnSound').addEventListener('click', () => {
      const on = audio.toggle();
      $('btnSound').textContent = on ? '🔊 声音开' : '🔇 声音关';
    });
    $('btnGate').addEventListener('click', () => {
      sim.setGate(!sim.interventions.gateOpen);
      syncInterventionButtons();
    });
    document.querySelectorAll('.pump-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        sim.setPump(Number(btn.dataset.pump));
        syncInterventionButtons();
      });
    });
    $('btnHarvest').addEventListener('click', () => {
      sim.harvest();
      syncInterventionButtons();
    });
  }

  function syncInterventionButtons() {
    $('btnGate').textContent = '排水闸：' +
      (sim.interventions.gateOpen ? '开' : '关');
    $('btnGate').classList.toggle('active', sim.interventions.gateOpen);
    document.querySelectorAll('.pump-btn').forEach((btn) => {
      btn.classList.toggle('active',
        Number(btn.dataset.pump) === sim.interventions.pumpRate);
    });
    const hint = sim.hour < sim.harvestEffectUntil ?
      '收割干扰持续中（剩余 ' +
      Math.ceil((sim.harvestEffectUntil - sim.hour) / 24) + ' 天）' : '';
    $('interveneHint').textContent = hint;
  }

  function loop(ts) {
    const speed = Number($('speedSelect').value);
    if (running && !sim.finished && ts - lastFrame > 60) {
      const steps = Math.max(1, Math.round(speed * 0.6));
      for (let i = 0; i < steps && !sim.finished; i++) {
        director.beforeStep(sim);
        sim.step(1);
        director.afterStep(sim);
      }
      lastFrame = ts;
    }
    const w = sim.weather[Math.min(sim.hour, CFG.HOURS_PER_YEAR - 1)];
    renderer.render(sim, w);
    ui.render(sim);
    syncInterventionButtons();
    const anyCrit = Object.keys(sim.alarms).some((k) =>
      sim.alarms[k].status === 'critical');
    audio.update({
      windMs: w.windMs, rainy: w.rainy, levelCm: sim.state.levelCm,
      birdDensity: sim.state.birds / 140, anyCritical: anyCrit,
    });
    requestAnimationFrame(loop);
  }

  function runBatch() {
    running = false;
    $('btnPlay').textContent = '▶ 连续运行';
    const t0 = performance.now();
    while (!sim.finished) {
      director.beforeStep(sim);
      sim.step(1);
      director.afterStep(sim);
    }
    const ms = (performance.now() - t0).toFixed(0);
    ui.render(sim);
    alert('验证跑批完成，耗时 ' + ms + ' ms。\n' +
      '检查点：\n' + sim.checkpoints.map((c) =>
        '  [' + c.status + '] ' + c.label).join('\n') +
      '\n\n年末结论：' + (sim.verdict.success ? '双指标达标，成功' : '未达标'));
  }

  // 同 seed 重开复现性自检：天气序列、目标位点、逐小时状态必须一致
  function runReproCheck() {
    const seed = $('seedInput').value.trim() || 'WETLAND-2026';
    const a = new window.WetlandSimModule.WetlandSim(seed, { mode: 'free' });
    const b = new window.WetlandSimModule.WetlandSim(seed, { mode: 'free' });
    const da = new window.WetlandDirector.ScenarioDirector();
    const db = new window.WetlandDirector.ScenarioDirector();
    while (!a.finished) { da.beforeStep(a); a.step(1); da.afterStep(a); }
    while (!b.finished) { db.beforeStep(b); b.step(1); db.afterStep(b); }
    const weatherSame = JSON.stringify(a.weather) === JSON.stringify(b.weather);
    const sitesSame = JSON.stringify(a.sites) === JSON.stringify(b.sites);
    const stateSame = JSON.stringify(a.state) === JSON.stringify(b.state);
    const result = weatherSame && sitesSame && stateSame;
    alert('复现性自检（seed=' + seed + '）\n' +
      '  天气序列一致：' + weatherSame +
      '\n  目标位点分布一致：' + sitesSame +
      '\n  逐小时状态一致：' + stateSame +
      '\n结论：' + (result ? '✔ 同 seed 重开完全复现' : '✘ 存在不确定性偏差'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// 主控:游戏循环、交互、面板刷新
(function () {
  'use strict';
  const { Sim, WEATHER_NAME } = window.RanchSim;
  const UI = window.RanchUI;
  const audio = new window.RanchAudio();

  const canvas = document.getElementById('view');
  const els = {
    clock: document.getElementById('clock'),
    weather: document.getElementById('weather'),
    season: document.getElementById('season'),
    result: document.getElementById('result'),
    metrics: document.getElementById('metrics'),
    targets: document.getElementById('targets'),
    interventions: document.getElementById('interventions'),
    log: document.getElementById('log'),
    report: document.getElementById('verify-report'),
    herdControls: document.getElementById('herd-controls'),
  };

  let sim = new Sim(document.getElementById('seed').value);
  let running = false;
  let speed = 4;
  let lastAlertCount = 0;
  let herdSig = '';
  const HOURS_PER_SECOND = 2; // 1x 速度下每秒推进2小时

  function buildHerdControls() {
    els.herdControls.innerHTML = '';
    sim.herds.forEach(h => {
      const card = document.createElement('div');
      card.className = 'herd-card';
      const sel = document.createElement('select');
      sim.pastures.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `草地${p.name}(草${p.grass.toFixed(0)})`;
        sel.appendChild(opt);
      });
      sel.value = (h.pasture + 1) % 4;
      const btn = document.createElement('button');
      btn.textContent = '转场';
      btn.onclick = () => { audio.ensure(); sim.moveHerd(h.id, +sel.value); refresh(); };
      card.append(`${h.species}群(${h.size}头) 在${'ABCD'[h.pasture]} → `, sel, btn);
      els.herdControls.appendChild(card);
    });
    const waterBtn = document.createElement('button');
    waterBtn.textContent = `设饮水点(剩${sim.waterPointsLeft})`;
    waterBtn.onclick = () => {
      audio.ensure();
      const p = sim.pastures.find(x => !x.waterPoint);
      if (p) sim.placeWater(p.id);
      refresh();
    };
    els.herdControls.appendChild(waterBtn);
  }

  function refresh() {
    els.clock.textContent = sim.timeStr();
    els.weather.textContent = `天气: ${WEATHER_NAME[sim.weatherNow]}`;
    const d = sim.day;
    els.season.textContent = d >= 8 && d <= 14 ? '雨季时段' : d >= 20 && d <= 27 ? '干旱时段' : '常规时段';
    if (sim.finished) {
      els.result.textContent = sim.success ? '✔ 达标成功' : '✘ 未达标';
      els.result.className = sim.success ? 'ok' : 'bad';
    } else els.result.textContent = '';
    UI.draw(canvas, sim);
    UI.renderMetrics(els.metrics, sim);
    UI.renderTargets(els.targets, sim);
    UI.renderLog(els.log, sim.logs);
    els.interventions.innerHTML =
      `<div>放牧时长:${sim.grazeHours}h/日</div>` +
      `<div>饮水点配额剩余:${sim.waterPointsLeft}</div>` +
      `<div>最近操作:${[...sim.logs].reverse().find(l => l.type === 'op' || l.type === 'fail')?.msg || '无'}</div>`;
    const sig = sim.herds.map(h => h.pasture).join(',') + '|' + sim.waterPointsLeft;
    if (sig !== herdSig) { herdSig = sig; buildHerdControls(); }
    const ac = Object.keys(sim.activeAlerts).length;
    if (ac > lastAlertCount) audio.beep();
    lastAlertCount = ac;
    audio.update(sim.weatherNow);
  }

  let acc = 0, lastTs = 0;
  function loop(ts) {
    if (running && !sim.finished) {
      acc += (ts - lastTs) / 1000 * HOURS_PER_SECOND * speed;
      while (acc >= 0.5) { sim.step(0.5); acc -= 0.5; }
      refresh();
    }
    lastTs = ts;
    requestAnimationFrame(loop);
  }

  document.getElementById('btn-run').onclick = e => {
    audio.ensure();
    running = !running;
    e.target.textContent = running ? '⏸ 暂停' : '▶ 连续运行';
  };
  document.getElementById('speed').onchange = e => { speed = +e.target.value; };
  document.getElementById('graze-hours').oninput = e => {
    sim.grazeHours = +e.target.value;
    document.getElementById('graze-hours-v').textContent = sim.grazeHours + 'h';
  };
  document.getElementById('btn-reset').onclick = () => {
    sim = new Sim(document.getElementById('seed').value);
    running = false;
    document.getElementById('btn-run').textContent = '▶ 连续运行';
    refresh();
  };
  document.getElementById('btn-audio').onclick = e => {
    audio.ensure();
    e.target.textContent = audio.toggle() ? '🔊 声音开' : '🔇 静音';
  };
  document.getElementById('btn-verify').onclick = () => {
    els.report.textContent = '验证运行中...';
    setTimeout(() => {
      const { report, pass } = window.RanchVerify.runVerification(sim.seed);
      els.report.innerHTML = report.map(r =>
        `<div class="${r.pass ? 'pass' : 'fail'}">${r.pass ? '✔' : '✘'} ${r.name}:${r.detail}</div>`
      ).join('') + `<div><b>${pass ? '全部通过' : '存在未通过项'}</b></div>`;
    }, 30);
  };

  refresh();
  requestAnimationFrame(loop);
})();

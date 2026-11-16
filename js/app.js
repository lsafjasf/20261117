/* 主控：固定步长循环（确定性）+ 控件 + HUD + 验证报告 */
(function () {
  const { CFG } = BeeConfig;
  const Sim = BeeSim;
  const canvas = document.getElementById('scene');
  const renderer = BeeRenderer(canvas);
  let audio = null;

  let sim = Sim.createSimulation(42);
  let running = false;
  let acc = 0;
  let lastTs = 0;
  let lastLogLen = 0;
  let prevPhase = sim.phase;

  const $ = (id) => document.getElementById(id);

  function ensureAudio() {
    if (!audio) audio = BeeAudio();
    audio.resume();
    return audio;
  }

  function reset(seed) {
    const s = seed || parseInt($('seedInput').value, 10) || 42;
    sim = Sim.createSimulation(s);
    acc = 0;
    lastLogLen = 0;
    prevPhase = sim.phase;
    running = false;
    $('log').innerHTML = '';
    $('btnRun').textContent = '连续运行';
    syncControls();
    renderAll();
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const frame = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    if (running) {
      acc += frame;
      while (acc >= CFG.DT) {
        Sim.step(sim);
        acc -= CFG.DT;
      }
    }
    renderAll();
    if (audio) audio.update(sim);
    requestAnimationFrame(loop);
  }

  function renderAll() {
    renderer.draw(sim);
    renderMetrics();
    renderTargets();
    renderLog();
    renderBanner();
  }

  function levelClass(level) {
    return level === 'alert' ? 'alert' : level === 'warn' ? 'warn' : 'ok';
  }

  function metricCard(name, obs, actual, unit, alarm, sub) {
    const obsStr = obs === null || obs === undefined ? '—' : (typeof obs === 'number' ? obs.toFixed(1) : obs);
    const actStr = actual === null || actual === undefined ? '—' : actual.toFixed(1);
    return `<div class="metric ${levelClass(alarm)}">
      <div class="m-name">${name}
        <span class="tag obs">观测</span><span class="tag act">实际</span>
        ${alarm !== 'ok' ? `<span class="tag alarm-tag">${alarm === 'alert' ? '告警' : '预警'}</span>` : ''}
      </div>
      <div class="m-val">${obsStr} <span style="font-size:11px;color:#9db59d">/ ${actStr} ${unit}</span></div>
      <div class="m-sub">${sub || ''}</div>
    </div>`;
  }

  function renderMetrics() {
    const aliveHives = sim.hives.filter((h) => h.alive);
    const hotObs = aliveHives.length
      ? Math.max(...sim.observed.temp.filter((v) => v !== null))
      : null;
    const hotActual = sim.hives.reduce((m, h) => Math.max(m, h.temp), -Infinity);
    const dmgObs = Math.max(...sim.observed.damage);
    const dmgActual = Math.max(...sim.hives.map((h) => h.damage));
    const envActual = BeeConfig.ambientTemp(sim.world, sim.t);
    // 仅用于界面平滑抖动，不消耗仿真 RNG，保证同 seed 状态轨迹与帧率无关
    const envObs = envActual + Math.sin(sim.t * 3.1) * 0.35;
    const rows = [
      metricCard('箱温(最高)', hotObs, hotActual, '°C', sim.alarms.temp,
        '阈值 预警35 / 告警38 / 致死42'),
      metricCard('颠簸损伤', dmgObs, dmgActual, '%', sim.alarms.damage,
        '阈值 预警40% / 告警65%'),
      metricCard('水箱水位', sim.observed.water, sim.water, '%', sim.alarms.water,
        sim.spray ? '喷淋中，耗水 ' + CFG.SPRAY_USE + '%/s' : '喷淋关闭'),
      metricCard('环境温度', envObs, envActual, '°C', 'ok',
        '天气：' + weatherLabel()),
      metricCard('污染指数', null, sim.pollution, '', sim.alarms.pollution,
        '基线 ' + CFG.POLLUTION_BASE + '，预警 ≥ ' + CFG.POLLUTION_WARN),
      `<div class="metric ok">
        <div class="m-name">田间物种数 <span class="tag act">实际</span></div>
        <div class="m-val">${sim.species} 种</div>
        <div class="m-sub">授粉成功后 +6（蜜源增加）</div>
      </div>`
    ];
    $('metrics').innerHTML = rows.join('');
  }

  function weatherLabel() {
    const w = BeeConfig.weatherAt(sim.world, sim.t);
    const t = [];
    if (w.heatwave) t.push('热浪');
    if (w.wind) t.push('大风');
    if (w.rain) t.push('降雨');
    return t.length ? t.join('+') : '晴好';
  }

  function renderTargets() {
    const rows = sim.hives.map((h, i) => {
      const p = sim.world.targets[i];
      const cls = h.alive ? (sim.phase === 'pollinated' ? 'done' : '') : 'dead';
      const state = !h.alive ? '已损毁'
        : sim.phase === 'pollinated' ? '已授粉'
        : sim.phase === 'arrived' ? '授粉中' : '运输中';
      return `<div class="target-row ${cls}">
        <span><span class="dot"></span>蜂箱#${i + 1} → 落点(${p.x.toFixed(0)}, ${p.y.toFixed(0)})</span>
        <span>${state}</span>
      </div>`;
    }).join('');
    const eta = sim.observed.eta;
    $('targets').innerHTML = rows +
      `<div class="hint">花田花量 ${sim.world.fieldFlowers} 朵 · 花期窗口 ${CFG.BLOOM_WINDOW}s` +
      (eta !== null && sim.phase === 'transport' ? ` · ETA 观测 ${eta.toFixed(0)}s（窗口告警：${sim.alarms.window}）` : '') +
      `</div>`;
  }

  function renderLog() {
    if (sim.log.length === lastLogLen) return;
    const box = $('log');
    const entries = sim.log.slice(lastLogLen).map((e) =>
      `<div class="entry ${e.level === 'alarm' ? 'alarm' : e.level === 'ok' ? 'ok' : ''}">` +
      `<span class="ts">${Sim.fmt(e.t)}</span>${e.msg}</div>`).join('');
    box.insertAdjacentHTML('beforeend', entries);
    box.scrollTop = box.scrollHeight;
    lastLogLen = sim.log.length;
  }

  function renderBanner() {
    const b = $('phaseBanner');
    const map = {
      idle: '待机：在果园完成装车安排后出发',
      transport: '运输中：管理通风 / 喷淋 / 车速，警惕热浪与颠簸',
      arrived: '已抵达花田：三箱授粉进行中…',
      pollinated: '任务成功：三箱安全到场并完成授粉，残留观察运行中',
      failed: '任务失败：' + (sim.failReason || '')
    };
    b.textContent = map[sim.phase];
    b.className = 'phase-banner ' + (sim.phase === 'failed' ? 'failed'
      : sim.phase === 'pollinated' ? 'success' : '');
  }

  function syncControls() {
    $('segRoute').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.route === sim.route));
    $('segArrangement').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.arr === sim.arrangement));
    $('segSpeed').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', b.dataset.speed === sim.speedMode));
    $('btnVent').textContent = '强通风：' + (sim.vent ? '开' : '关');
    $('btnVent').className = 'intervention ' + (sim.vent ? 'on' : 'off');
    $('btnSpray').textContent = '水箱喷淋：' + (sim.spray ? '开' : '关');
    $('btnSpray').className = 'intervention ' + (sim.spray ? 'on' : 'off');
    const before = sim.phase === 'idle';
    $('btnDepart').disabled = !before;
    $('segRoute').querySelectorAll('button').forEach((b) => b.disabled = !before);
    $('segArrangement').querySelectorAll('button').forEach((b) => b.disabled = !before);
  }

  // ---- 控件绑定 ----
  $('btnRun').onclick = () => {
    ensureAudio().click();
    running = !running;
    $('btnRun').textContent = running ? '暂停运行' : '连续运行';
    lastTs = 0;
  };
  $('btnPause').onclick = () => { running = false; $('btnRun').textContent = '连续运行'; };
  $('btnReset').onclick = () => { ensureAudio().click(); reset(); };
  $('btnMute').onclick = () => {
    const m = ensureAudio().toggleMute();
    $('btnMute').textContent = m ? '🔇 静音' : '🔊 声音';
  };
  $('btnDepart').onclick = () => {
    ensureAudio().click();
    Sim.actions.depart(sim);
    running = true;
    $('btnRun').textContent = '暂停运行';
    syncControls();
  };
  $('btnVent').onclick = () => { ensureAudio().click(); Sim.actions.toggleVent(sim); syncControls(); };
  $('btnSpray').onclick = () => { ensureAudio().click(); Sim.actions.toggleSpray(sim); syncControls(); };
  $('segRoute').addEventListener('click', (e) => {
    if (e.target.dataset.route) Sim.actions.setRoute(sim, e.target.dataset.route);
    syncControls();
  });
  $('segArrangement').addEventListener('click', (e) => {
    if (e.target.dataset.arr) Sim.actions.setArrangement(sim, e.target.dataset.arr);
    syncControls();
  });
  $('segSpeed').addEventListener('click', (e) => {
    if (e.target.dataset.speed) Sim.actions.setSpeed(sim, e.target.dataset.speed);
    syncControls();
  });

  // ---- 验证报告 ----
  $('btnValidate').onclick = () => {
    const seed = parseInt($('seedInput').value, 10) || 42;
    const report = BeeValidate.runAll(seed);
    renderValidateReport(report);
  };

  function renderValidateReport(r) {
    const html = r.checks.map((c) =>
      `<div class="v-check ${c.pass ? 'pass' : 'fail'}">
        <span class="status">${c.pass ? '✓ PASS' : '✗ FAIL'}</span>${c.name}
        <span class="detail">${c.detail}</span>
      </div>`).join('');
    const cmp = ['steady', 'critical', 'failure', 'windowFail'].map((k) => {
      const pair = r.comparisons[k];
      if (!pair.before || !pair.after) return '';
      const b = pair.before;
      const a = pair.after;
      return `<div class="v-compare"><b>${scenarioName(k)}</b>
        <table>
          <tr><th>指标</th><th>操作前</th><th>操作后</th></tr>
          <tr><td>物种数</td><td>${b.species}</td><td>${a.species}</td></tr>
          <tr><td>水位%</td><td>${b.water}</td><td>${a.water}</td></tr>
          <tr><td>污染指数</td><td>${b.pollution}</td><td>${a.pollution}</td></tr>
          <tr><td>存活蜂箱</td><td>${b.alive}</td><td>${a.alive}</td></tr>
          <tr><td>平均实际箱温°C</td><td>${b.avgTemp}</td><td>${a.avgTemp}</td></tr>
          <tr><td>平均损伤%</td><td>${b.avgDamage}</td><td>${a.avgDamage}</td></tr>
        </table></div>`;
    }).join('');
    $('validateReport').innerHTML =
      `<p style="color:${r.allPass ? '#7bd17b' : '#ff9c8d'};font-weight:700">` +
      `seed=${r.seed} · ${r.allPass ? '全部 ' + r.checks.length + ' 项通过' : '存在失败项'}</p>` +
      html + cmp;
  }

  function scenarioName(k) {
    return { steady: '稳态场景', critical: '临界事件场景', failure: '过热处置失败', windowFail: '花期超时失败' }[k];
  }

  // 成功/失败音效
  setInterval(() => {
    if (sim.phase !== prevPhase) {
      if (audio) {
        if (sim.phase === 'pollinated') audio.success();
        if (sim.phase === 'failed') audio.fail();
      }
      prevPhase = sim.phase;
      syncControls();
    }
  }, 150);

  syncControls();
  renderAll();
  requestAnimationFrame(loop);

  // 调试/自动化钩子：测试可直接读取状态并用固定步长推进，不依赖实时帧率
  window.__beeApp = {
    get sim() { return sim; },
    step: (n) => { for (let i = 0; i < n; i++) Sim.step(sim); renderAll(); },
    actions: Sim.actions,
    reset
  };
})();

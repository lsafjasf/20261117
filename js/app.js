/* 应用主控：固定步长驱动、暂停/单步/恢复/重置/回放、HUD 与事件日志。 */
(function () {
  'use strict';
  const CFG = window.CRANE_CFG;
  const P = window.CranePhysics;
  const R = window.CraneRender;
  const Chart = window.CraneChart;

  const scene = document.getElementById('scene');
  const sctx = scene.getContext('2d');
  const trend = document.getElementById('trend');
  const tctx = trend.getContext('2d');

  let state = P.createInitialState();
  let mode = 'idle'; // idle | running | paused | replaying
  let replay = null;
  let rafId = null;
  let acc = 0;
  let lastTs = 0;
  const held = { left: false, right: false, hoistUp: false, hoistDown: false };

  const $ = (id) => document.getElementById(id);

  function currentInput() {
    return {
      left: held.left, right: held.right,
      hoistUp: held.hoistUp, hoistDown: held.hoistDown,
      brake: state.brake
    };
  }

  function buildGauges() {
    const wrap = $('gauges');
    wrap.innerHTML = '';
    Object.entries(CFG.limits).forEach(([key, lim]) => {
      const div = document.createElement('div');
      div.className = 'gauge';
      div.id = 'gauge-' + key;
      div.innerHTML =
        '<div class="gauge-head"><span>' + lim.label + '</span>'
        + '<span class="gauge-val" id="val-' + key + '">—</span></div>'
        + '<div class="gauge-bar"><div class="gauge-fill" id="fill-' + key + '"></div></div>'
        + '<div class="gauge-lim">[' + lim.min + ' ~ ' + lim.max + ' ' + lim.unit + ']</div>';
      wrap.appendChild(div);
    });
  }

  function updateGauges() {
    Object.entries(CFG.limits).forEach(([key, lim]) => {
      const v = state[key];
      const ratio = (v - lim.min) / (lim.max - lim.min);
      const fill = $('fill-' + key);
      const val = $('val-' + key);
      if (fill) {
        fill.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
        const over = v > lim.max || v < lim.min;
        fill.className = 'gauge-fill' + (over ? ' over' : '')
          + (ratio > 0.85 ? ' warn' : '');
      }
      if (val) val.textContent = (typeof v === 'number' ? v.toFixed(1) : '—') + ' ' + lim.unit;
    });
  }

  function updatePills() {
    const statusMap = {
      idle: '待机', active: '运行中', fault: '故障停机', done: '任务完成'
    };
    $('statusPill').textContent = statusMap[state.status] || state.status;
    $('statusPill').className = 'pill ' + state.status;
    $('liftPill').textContent = '第 ' + (state.liftIndex + 1) + ' 次吊装 / 共 '
      + CFG.lifts.length + ' 次';
    $('clockPill').textContent = 't = ' + state.time.toFixed(2) + ' s';
    $('checksumPill').textContent = 'chk = ' + P.checksum(state);
  }

  function renderEventLog() {
    const log = $('eventLog');
    log.innerHTML = state.events
      .slice(-12).reverse()
      .map((e) => '<div class="ev"><b>' + e.t.toFixed(2) + 's</b> ' + e.msg + '</div>')
      .join('');
  }

  function renderAll() {
    R.drawScene(sctx, state, $('forceToggle').checked);
    Chart.drawTrend(tctx, state);
    updateGauges();
    updatePills();
    renderEventLog();
    updateFaultBanner();
  }

  function updateFaultBanner() {
    const banner = $('faultBanner');
    if (state.status === 'fault' && state.faults.length) {
      const f = state.faults[0];
      banner.classList.remove('hidden');
      banner.innerHTML = '⚠ 首次越限：<b>' + f.part + '</b>（' + f.label + '='
        + f.value.toFixed(2) + ' ' + f.unit + '，' + f.dir + ' ' + f.bound + ' ' + f.unit
        + '）<br>时间 ' + f.t.toFixed(2) + 's，坐标 (' + f.x.toFixed(0) + ', '
        + f.y.toFixed(0) + ')，计算已冻结';
    } else {
      banner.classList.add('hidden');
    }
  }

  function physicsTick() {
    if (mode === 'replaying') {
      replayStep();
      return;
    }
    if (mode !== 'running') return;
    P.stepOnce(state, currentInput());
    if (state.status === 'fault' || state.status === 'done') {
      mode = 'paused';
      $('runBtn').textContent = '运行';
    }
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    let frame = (ts - lastTs) / 1000;
    lastTs = ts;
    if (frame > 0.1) frame = 0.1;
    if (mode === 'running' || mode === 'replaying') {
      acc += frame;
      let guard = 0;
      while (acc >= CFG.DT && guard < 8) {
        physicsTick();
        acc -= CFG.DT;
        guard += 1;
      }
    }
    renderAll();
    rafId = requestAnimationFrame(loop);
  }

  function setMode(m) {
    mode = m;
    $('runBtn').textContent = m === 'running' ? '运行中…' : '运行';
  }

  function startPause() {
    if (state.status === 'fault' || state.status === 'done') return;
    setMode(mode === 'running' ? 'paused' : 'running');
    acc = 0;
  }

  function singleStep() {
    if (state.status === 'fault' || state.status === 'done') return;
    setMode('paused');
    P.stepOnce(state, currentInput());
    renderAll();
  }

  function resetAll() {
    P.resetState(state);
    state.counterweight = parseInt($('cwSelect').value, 10);
    replay = null;
    setMode('idle');
    acc = 0;
    $('replayBtn').disabled = true;
    renderAll();
  }

  function startReplay() {
    if (!state.inputLog.length) return;
    // 用输入日志在全新状态上重建，保证与原轨迹逐位一致
    replay = {
      log: state.inputLog.slice(),
      idx: 0,
      rebuilt: P.createInitialState()
    };
    setMode('replaying');
  }

  function replayStep() {
    if (!replay) { setMode('paused'); return; }
    const code = replay.log[replay.idx];
    if (code === undefined) {
      setMode('paused');
      return;
    }
    const inp = {
      left: !!(code & 1), right: !!(code & 2),
      hoistUp: !!(code & 4), hoistDown: !!(code & 8),
      brake: !!(code & 16)
    };
    P.stepOnce(replay.rebuilt, inp);
    replay.idx += 1;
    state = replay.rebuilt;
    window.CraneApp.state = () => state;
    if (replay.idx >= replay.log.length) {
      setMode('paused');
      P.logEvent(state, '回放结束：重建轨迹校验和 ' + P.checksum(state));
    }
  }

  function buildReport() {
    const L = CFG.limits;
    const lines = [];
    lines.push('===== 吊装模拟最终报告 =====');
    lines.push('结束状态：' + ({ idle: '待机', active: '运行中', fault: '故障停机', done: '任务成功' })[state.status]);
    lines.push('仿真时间：' + state.time.toFixed(2) + ' s（' + state.step + ' 个固定步长，dt=' + CFG.DT + 's）');
    lines.push('完成吊装：' + state.placedBoxes.length + ' / ' + CFG.lifts.length);
    lines.push('能耗累计：' + (state.energyJ / 1000).toFixed(2) + ' kJ');
    lines.push('');
    lines.push('--- 峰值记录（含发生时刻）---');
    Object.entries(state.peaks).forEach(([k, pk]) => {
      lines.push(L[k].label + ' 峰值=' + pk.value.toFixed(2) + ' ' + L[k].unit
        + ' @ t=' + pk.t.toFixed(2) + 's（限值 ' + L[k].min + '~' + L[k].max + '）');
    });
    lines.push('');
    if (state.faults.length) {
      const f = state.faults[0];
      lines.push('--- 首次故障定位 ---');
      lines.push('部件：' + f.part);
      lines.push('指标：' + f.label + '=' + f.value.toFixed(2) + ' ' + f.unit
        + '（' + f.dir + '，边界 ' + f.bound + ' ' + f.unit + '）');
      lines.push('时间：t=' + f.t.toFixed(2) + 's，第 ' + f.step + ' 步');
      lines.push('位置：(' + f.x.toFixed(1) + ', ' + f.y.toFixed(1) + ')');
    } else {
      lines.push('--- 无故障：全程未发生碰撞或越限 ---');
    }
    lines.push('');
    lines.push('确定性校验和：' + P.checksum(state));
    return lines.join('\n');
  }

  function showModal(title, body) {
    $('modalTitle').textContent = title;
    $('modalBody').textContent = body;
    $('modal').classList.remove('hidden');
  }

  // 按钮接线
  $('runBtn').addEventListener('click', startPause);
  $('pauseBtn').addEventListener('click', () => { if (mode === 'running') setMode('paused'); });
  $('stepBtn').addEventListener('click', singleStep);
  $('resetBtn').addEventListener('click', resetAll);
  $('replayBtn').addEventListener('click', startReplay);
  $('reportBtn').addEventListener('click', () => showModal('最终报告', buildReport()));
  $('modalClose').addEventListener('click', () => $('modal').classList.add('hidden'));

  $('brakeBtn').addEventListener('click', () => {
    state.brake = !state.brake;
    $('brakeBtn').textContent = '刹车：' + (state.brake ? '开' : '关');
    $('brakeBtn').classList.toggle('active', state.brake);
  });
  $('attachBtn').addEventListener('click', () => {
    if (state.status === 'fault' || state.status === 'done') return;
    state.requestAttach = true;
  });
  $('cwSelect').addEventListener('change', (e) => {
    state.counterweight = parseInt(e.target.value, 10);
    P.logEvent(state, '配重调整为 ' + state.counterweight + ' kg');
  });

  document.querySelectorAll('button.hold').forEach((btn) => {
    const key = btn.dataset.input;
    const on = (e) => { e.preventDefault(); held[key] = true; btn.classList.add('pressed'); };
    const off = (e) => { e.preventDefault(); held[key] = false; btn.classList.remove('pressed'); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
  });

  const keyMap = {
    ArrowLeft: 'left', ArrowRight: 'right',
    ArrowUp: 'hoistUp', ArrowDown: 'hoistDown'
  };
  window.addEventListener('keydown', (e) => {
    if (keyMap[e.key]) { held[keyMap[e.key]] = true; e.preventDefault(); }
    if (e.code === 'Space') {
      state.brake = !state.brake;
      $('brakeBtn').textContent = '刹车：' + (state.brake ? '开' : '关');
      e.preventDefault();
    }
    if (e.key === 'p' || e.key === 'P') startPause();
    if (e.key === 'n' || e.key === 'N') singleStep();
    if (e.key === 'r' || e.key === 'R') resetAll();
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.key]) held[keyMap[e.key]] = false;
  });

  // 有运行历史后允许回放
  setInterval(() => {
    $('replayBtn').disabled = state.inputLog.length === 0 || mode === 'replaying';
  }, 300);

  window.CraneApp = {
    state: () => state, mode: () => mode,
    buildReport, startReplay, resetAll, singleStep: singleStep
  };

  buildGauges();
  renderAll();
  rafId = requestAnimationFrame(loop);
})();

// 主控：构建控件、驱动仿真/渲染、回放、报告与确定性自检
(function () {
  const C = window.CONFIG;
  const track = window.Track.build();
  const sim = new window.Simulator(track);
  const canvas = document.getElementById('trackCanvas');
  const renderer = new window.Renderer(canvas, track);
  const trend = new window.TrendChart(document.getElementById('trendCanvas'));
  const audio = new window.AudioFeedback();

  const inputs = { current: 40, damping: 2500, v0: 10, load: 80 };
  let showForce = true;
  let replayMode = false;
  let replayIdx = 0;
  let replayTimer = null;

  // ---- 控件滑块 ----
  const sliderDefs = [
    ['current', '电流'], ['damping', '阻尼'], ['v0', '初始速度'], ['load', '负载']
  ];
  const sliderEls = {};
  function buildSliders() {
    const host = document.getElementById('sliders');
    sliderDefs.forEach(([key, label]) => {
      const cfg = C.input[key];
      const wrap = document.createElement('div');
      wrap.innerHTML =
        '<label>' + label + ' <span class="val" id="val-' + key + '"></span> ' +
        cfg.unit + '</label>' +
        '<input type="range" id="in-' + key + '" min="' + cfg.min +
        '" max="' + cfg.max + '" step="' + cfg.step + '" value="' + inputs[key] + '">' +
        '<div class="bound"><span>' + cfg.min + cfg.unit + '</span>' +
        '<span>' + cfg.max + cfg.unit + '</span></div>';
      host.appendChild(wrap);
      const el = document.getElementById('in-' + key);
      sliderEls[key] = el;
      el.addEventListener('input', () => {
        inputs[key] = parseFloat(el.value);
        document.getElementById('val-' + key).textContent =
          parseFloat(el.value).toFixed(key === 'damping' ? 0 : 1);
      });
      el.dispatchEvent(new Event('input'));
    });
  }

  function buildLimits() {
    const host = document.getElementById('limits');
    Object.entries(C.limits).forEach(([key, lim]) => {
      const row = document.createElement('div');
      row.className = 'lim-row';
      const range = lim.min === undefined
        ? '≤ ' + lim.max
        : lim.min + ' ~ ' + lim.max;
      row.innerHTML = '<span>' + lim.label + '</span><span class="rng">' +
        range + ' ' + lim.unit + '</span>';
      host.appendChild(row);
    });
  }

  function buildMetricTabs() {
    const host = document.getElementById('metricTabs');
    window.TREND_METRICS.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.textContent = m.label.split(' ')[0];
      if (i === 0) btn.className = 'active';
      btn.addEventListener('click', () => {
        trend.setMetric(m.key);
        host.querySelectorAll('button').forEach(b => b.className = '');
        btn.className = 'active';
      });
      host.appendChild(btn);
    });
  }

  buildSliders();
  buildLimits();
  buildMetricTabs();
  sim.reset(inputs);

  // ---- 主循环 ----
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (!replayMode) {
      sim.update(dt);
      renderer.render(sim.view, sim.state.fault, showForce);
      trend.draw(sim.replay);
      updatePanel();
      audio.update(sim.view.B, sim.mode === 'running');
      handleModeChange();
    } else {
      trend.draw(sim.replay.slice(0, replayIdx + 1));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    renderer.resize();
    trend.resize();
  });

  function handleModeChange() {
    const badge = document.getElementById('modeBadge');
    const map = {
      idle: ['就绪', ''], running: ['运行中', 'running'],
      paused: ['已暂停', 'paused'], fault: ['故障停机', 'fault'],
      win: ['三圈成功', 'win']
    };
    const [text, cls] = map[sim.mode];
    badge.textContent = text;
    badge.className = 'mode-badge ' + cls;
    if ((sim.mode === 'fault' || sim.mode === 'win') && !replayMode) {
      showEndOverlay();
    }
  }

  // ---- 实时物理量面板 ----
  const METRIC_VIEW = [
    ['gap', '悬浮间隙', v => (v * 1000).toFixed(2) + ' mm', 'gap'],
    ['v', '运行速度', v => v.toFixed(2) + ' m/s', 'speed'],
    ['temp', '线圈温度', v => v.toFixed(1) + ' °C', 'temp'],
    ['pressure', '支撑压力', v => (v / 1000).toFixed(2) + ' kPa', 'pressure'],
    ['B', '磁场强度', v => v.toFixed(0) + ' (归一)', null],
    ['accelZ', '竖向加速度', v => v.toFixed(2) + ' m/s²', null],
    ['lap', '已完成圈数', v => v + ' / ' + C.sim.lapsToWin, null],
    ['time', '运行时间', v => v.toFixed(2) + ' s', null]
  ];
  const metricHost = document.getElementById('metrics');
  METRIC_VIEW.forEach(([key, label, fmt, limKey]) => {
    const row = document.createElement('div');
    row.className = 'm-row';
    row.id = 'm-' + key;
    row.innerHTML = '<span>' + label + '</span><span class="m-val"></span>';
    metricHost.appendChild(row);
  });

  function updatePanel() {
    const v = replayMode ? sim.replay[replayIdx] : sim.view;
    METRIC_VIEW.forEach(([key, label, fmt, limKey]) => {
      const row = document.getElementById('m-' + key);
      row.querySelector('.m-val').textContent = fmt(v[key]);
      if (limKey) {
        const lim = C.limits[limKey];
        const val = v[key];
        const warn = val < lim.min || val > lim.max;
        row.className = 'm-row ' + (warn ? 'warn' : 'ok');
      }
    });
  }

  // ---- 按钮事件 ----
  document.getElementById('btnRun').addEventListener('click', () => {
    stopReplay();
    if (sim.mode === 'idle' || sim.mode === 'fault' || sim.mode === 'win') {
      syncInputsAndReset();
    }
    sim.start();
  });
  document.getElementById('btnPause').addEventListener('click', () => {
    stopReplay();
    sim.pause();
  });
  document.getElementById('btnStep').addEventListener('click', () => {
    stopReplay();
    if (sim.mode === 'idle' || sim.mode === 'fault' || sim.mode === 'win') {
      syncInputsAndReset();
    }
    sim.singleStep();
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    stopReplay();
    syncInputsAndReset();
    hideOverlay();
  });
  document.getElementById('btnForce').addEventListener('click', (e) => {
    showForce = !showForce;
    e.target.textContent = '受力箭头：' + (showForce ? '开' : '关');
  });
  document.getElementById('btnSound').addEventListener('click', (e) => {
    const on = audio.toggle();
    e.target.textContent = '声音：' + (on ? '开' : '关');
  });
  document.getElementById('btnFaultClose').addEventListener('click', hideOverlay);

  function syncInputsAndReset() {
    Object.assign(inputs, Object.fromEntries(
      Object.keys(sliderEls).map(k => [k, parseFloat(sliderEls[k].value)])
    ));
    sim.reset(inputs);
    overlayState = 'hidden';
    document.getElementById('report').textContent = '尚未运行。';
    document.getElementById('replayInfo').textContent =
      '第 0 / ' + sim.replay.length + ' 帧';
    document.getElementById('replayScrub').value = 0;
  }

  // ---- 故障 / 成功弹层 ----
  let overlayState = 'hidden';   // hidden | shown | dismissed
  function showEndOverlay() {
    if (overlayState !== 'hidden') return;
    overlayState = 'shown';
    const overlay = document.getElementById('faultOverlay');
    const title = document.getElementById('faultTitle');
    const detail = document.getElementById('faultDetail');
    if (sim.mode === 'win') {
      title.textContent = '三圈稳定运行成功';
      detail.innerHTML = buildReport(false);
    } else {
      const f = sim.state.fault;
      title.textContent = '运行失败：' + f.name;
      detail.innerHTML = buildFaultText(f);
    }
    overlay.classList.remove('hidden');
    writeReport();
  }
  function hideOverlay() {
    document.getElementById('faultOverlay').classList.add('hidden');
    overlayState = 'dismissed';
  }

  function buildFaultText(f) {
    return '首次越限部件：<b>' + f.name + '</b><br>' +
      '触发时间：<b>' + f.time.toFixed(3) + ' s</b><br>' +
      '所在弧段：第 ' + f.segment + ' 曲率段（第 ' + (f.lap + 1) + ' 圈）<br>' +
      '故障值：' + f.value.toFixed(4) + ' ' + f.unit +
      '（边界 ' + f.limit + ' ' + f.unit + '）<br>' +
      '位置坐标：(' + f.x.toFixed(2) + ', ' + f.y.toFixed(2) + ') m';
  }

  // ---- 最终报告（峰值与故障位置）----
  function writeReport() {
    document.getElementById('report').textContent = buildReport(true);
  }
  function buildReport(plain) {
    const st = sim.state, pk = st.peaks;
    const lines = [
      '状态：' + (sim.mode === 'win' ? '三圈成功' : '故障停机'),
      '运行时间：' + st.time.toFixed(2) + ' s　圈数：' + st.lap,
      '输入：电流 ' + sim.inputs.current + ' A，阻尼 ' + sim.inputs.damping +
        ' N·s/m，初速 ' + sim.inputs.v0 + ' m/s，负载 ' + sim.inputs.load + ' kg',
      '── 峰值记录 ──',
      '间隙峰值：' + (pk.gap * 1000).toFixed(2) + ' mm（最小 ' +
        (pk.gapMin * 1000).toFixed(2) + ' mm，限 3~40 mm）',
      '速度峰值：' + pk.speed.toFixed(2) + ' m/s（限 1.8~22）',
      '温度峰值：' + pk.temp.toFixed(1) + ' °C（限 ≤120）',
      '压力峰值：' + (pk.pressure / 1000).toFixed(2) + ' kPa（限 ≤120）',
      '竖向加速度峰值：' + pk.accelZ.toFixed(2) + ' m/s²'
    ];
    if (st.fault) {
      const f = st.fault;
      lines.push('── 首次故障 ──',
        f.name + ' @ ' + f.time.toFixed(3) + ' s',
        '弧段 ' + f.segment + '，第 ' + (f.lap + 1) + ' 圈',
        '坐标 (' + f.x.toFixed(2) + ', ' + f.y.toFixed(2) + ') m',
        '值 ' + f.value.toFixed(4) + ' ' + f.unit + ' / 限 ' + f.limit + ' ' + f.unit);
    }
    lines.push('回放帧数：' + sim.replay.length);
    return plain ? lines.join('\n') : lines.join('<br>');
  }

  // ---- 回放 ----
  const scrub = document.getElementById('replayScrub');
  function stopReplay() {
    replayMode = false;
    if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
    if (sim.replay.length) {
      replayIdx = sim.replay.length - 1;
    }
  }
  document.getElementById('btnReplay').addEventListener('click', () => {
    if (sim.replay.length < 2) return;
    hideOverlay();
    sim.pause();
    replayMode = true;
    replayIdx = 0;
    scrub.max = sim.replay.length - 1;
    if (replayTimer) clearInterval(replayTimer);
    replayTimer = setInterval(() => {
      replayIdx++;
      if (replayIdx >= sim.replay.length) {
        clearInterval(replayTimer);
        replayTimer = null;
        replayIdx = sim.replay.length - 1;
        renderReplayFrame();
        replayMode = false;
        return;
      }
      renderReplayFrame();
    }, 40);
    renderReplayFrame();
  });
  document.getElementById('btnReplayPause').addEventListener('click', stopReplay);
  scrub.addEventListener('input', () => {
    hideOverlay();
    if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
    replayMode = true;
    replayIdx = parseInt(scrub.value, 10);
    renderReplayFrame();
  });
  function renderReplayFrame() {
    const f = sim.replay[replayIdx];
    scrub.value = replayIdx;
    document.getElementById('replayInfo').textContent =
      '第 ' + (replayIdx + 1) + ' / ' + sim.replay.length + ' 帧　t=' +
      f.time.toFixed(2) + 's';
    renderer.render(f, sim.state.fault, showForce);
    updatePanel();
  }

  // ---- 确定性自检：两次独立运行逐步对比 ----
  document.getElementById('btnDeterm').addEventListener('click', () => {
    const a = window.Physics.createInitial(inputs, track);
    const b = window.Physics.createInitial(inputs, track);
    let maxDiff = 0, steps = 0;
    for (let i = 0; i < 400000; i++) {
      window.Physics.step(a, track, inputs.current, inputs.damping);
      window.Physics.step(b, track, inputs.current, inputs.damping);
      maxDiff = Math.max(maxDiff, Math.abs(a.gap - b.gap),
        Math.abs(a.s - b.s), Math.abs(a.temp - b.temp));
      steps++;
      if (a.fault || a.lap >= C.sim.lapsToWin) break;
    }
    // 重置一致性：再创建一次初始状态比对
    const c = window.Physics.createInitial(inputs, track);
    const resetDiff = Math.abs(c.gap - window.Physics.createInitial(inputs, track).gap);
    alert('确定性自检（' + steps + ' 步）\n' +
      '两次独立运行最大差异：' + maxDiff.toExponential(2) + '\n' +
      '重复重置初始位置差异：' + resetDiff.toExponential(2) + '\n' +
      (maxDiff === 0 && resetDiff === 0 ? '结论：轨迹完全一致，重置无漂移 ✓'
        : '结论：存在差异，请检查 ✗'));
  });

  window.__app = { track, sim, inputs, renderer, trend, audio, stopReplay, hideOverlay };
})();

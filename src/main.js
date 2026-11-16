/* global DBEngine, DBRenderer, DBAutopilot, DBReplayViewer, DBConfig */
/** 页面主控：固定步长引擎循环、键盘同时输入、HUD 与回放联动。 */
(function () {
  'use strict';
  const C = DBConfig;
  const engine = new DBEngine();
  const renderer = new DBRenderer(document.getElementById('canvas'));

  const els = {
    pause: document.getElementById('btn-pause'),
    restart: document.getElementById('btn-restart'),
    debug: document.getElementById('btn-debug'),
    openReplay: document.getElementById('btn-replay'),
    g1: document.getElementById('gauges-p1'),
    g2: document.getElementById('gauges-p2'),
    idle1: document.getElementById('idle-p1'),
    idle2: document.getElementById('idle-p2'),
    mission: document.getElementById('mission'),
    overlay: document.getElementById('overlay'),
    conflict: document.getElementById('conflict-list'),
    bar: document.getElementById('replay-bar'),
    play: document.getElementById('rp-play'),
    scrub: document.getElementById('rp-scrub'),
    label: document.getElementById('rp-label'),
    exportJson: document.getElementById('rp-export'),
    close: document.getElementById('rp-close'),
    discP1: document.getElementById('btn-disconnect-p1'),
    discP2: document.getElementById('btn-disconnect-p2'),
    reconnect: document.getElementById('btn-reconnect'),
    driveP1: document.getElementById('btn-drive-p1'),
    driveP2: document.getElementById('btn-drive-p2'),
    panelP1: document.getElementById('panel-p1'),
    panelP2: document.getElementById('panel-p2')
  };

  const viewer = new DBReplayViewer(els);
  const held = new Set();
  let lastConflictCount = 0;

  // —— 固定步长循环 ——
  function frame(now) {
    // 每帧按固定步长推进一次（30Hz），与引擎 DT 对齐，保证确定性与回放一致。
    const frameDt = C.DT;
    if (els.bar.hidden) {
      DBAutopilot.tick(engine);
      engine.step();
      render(engine.getSnapshot());
    } else {
      viewer.tick();
    }
    requestAnimationFrame(frame);
  }

  // —— HUD 仪表定义：两侧读取同一快照，仅“我的职责”高亮 ——
  const GAUGES = [
    { key: 'depth', label: '深度', unit: 'm', owner: 'p1' },
    { key: 'vSpeed', label: '升降速度', unit: 'm/s', owner: 'p1' },
    { key: 'ballast', label: '压载量', unit: '%', owner: 'p1' },
    { key: 'slack', label: '缆绳松弛', unit: 'm', owner: 'p2' },
    { key: 'tension', label: '缆绳张力', unit: '', owner: 'p2' },
    { key: 'valve', label: '供气阀门', unit: '%', owner: 'p2' },
    { key: 'o2', label: '含氧量', unit: '%', owner: 'p2' },
    { key: 'reserve', label: '储气量', unit: '%', owner: 'p2' },
    { key: 'temp', label: '舱内温度', unit: '℃', owner: 'shared' },
    { key: 'stress', label: '缆绳应力', unit: '%', owner: 'p2' },
    { key: 'drift', label: '水平漂移', unit: 'm', owner: 'p2' },
    { key: 'hypoxiaLeft', label: '缺氧倒计时', unit: 's', owner: 'p2' }
  ];

  function gaugeClass(def, g) {
    if (def.key === 'o2' && (g.o2 < C.O2_LOW_WARN || g.o2 > C.O2_HIGH_WARN)) return 'warn';
    if (def.key === 'o2' && g.o2 < C.O2_MIN) return 'danger';
    if (def.key === 'hypoxiaLeft' && g.hypoxiaLeft < 8) return 'danger';
    if (def.key === 'stress' && g.stress > 60) return g.stress > 85 ? 'danger' : 'warn';
    if (def.key === 'tension' && g.tensionState === 'tight') return 'danger';
    if (def.key === 'temp' && g.temp < C.TEMP_COLD_WARN) return 'warn';
    if (def.key === 'reserve' && g.reserve < 20) return 'warn';
    return '';
  }

  function renderGauges(snap) {
    [els.g1, els.g2].forEach(function (container, idx) {
      const side = idx === 0 ? 'p1' : 'p2';
      container.innerHTML = GAUGES.map(function (def) {
        const mine = def.owner === side || def.owner === 'shared' ? ' mine' : '';
        const warn = gaugeClass(def, snap.gauges);
        return '<div class="gauge ' + warn + mine + '">' +
          '<div class="label">' + def.label + '</div>' +
          '<div class="value">' + snap.gauges[def.key] +
          '<span class="unit">' + def.unit + '</span></div></div>';
      }).join('');
    });
  }

  function renderMission(snap) {
    const m = snap.mission;
    const rows = C.STATIONS.map(function (st) {
      const done = m.completed.indexOf(st.id) !== -1;
      const active = m.activeStation === st.id;
      const cls = done ? 'done' : active ? 'active' : '';
      const mark = done ? '✓ 已完成' : active ? '● 当前目标 ' + st.depth + 'm' : '○ 待取样';
      return '<div class="' + cls + '">取样点 ' + st.id + '：' + mark + '</div>';
    }).join('');
    const sample = m.sample
      ? '<div>取样进度 ' + Math.round(m.sample.ratio * 100) + '%</div>'
      : '<div>计时 ' + snap.time.toFixed(1) + 's · 模式 ' +
        (snap.mode === 'debug' ? '单人调试' : '双人协作') + '</div>';
    els.mission.innerHTML = rows + sample;
  }

  window.__dbRender = render;
  function render(snap) {
    renderer.draw(snap);
    renderGauges(snap);
    renderMission(snap);
    els.idle1.textContent = snap.protection.idleLeft.p1.toFixed(1);
    els.idle2.textContent = snap.protection.idleLeft.p2.toFixed(1);
    renderOverlay(snap);
    renderConflicts(snap);
  }

  function renderOverlay(snap) {
    if (snap.phase === 'running') {
      els.overlay.hidden = true;
      return;
    }
    els.overlay.hidden = false;
    const map = {
      paused: ['已暂停', '按 P 继续，物理与倒计时冻结。'],
      protecting: ['保护状态：' +
        (snap.protection.side === 'p1' ? '玩家一' : '玩家二') +
        (snap.protection.reason === 'disconnect' ? ' 断开' : ' 输入超时'),
        '钟体已自动悬停，取样中止。排除问题后点击“重连保护侧”恢复。'],
      failed: ['任务失败：' + failText(snap.failReason), '按 R 重开，仪表、目标与计时同时复位。'],
      success: ['任务成功！', '三个取样点完成并安全上浮。按 F2 查看回放，按 R 重新开始。']
    };
    const pair = map[snap.phase] || [''];
    els.overlay.innerHTML = pair[0] + (pair[1] ? '<small>' + pair[1] + '</small>' : '');
  }

  function failText(reason) {
    return {
      hypoxia: '舱内缺氧超时',
      cable_stress: '脐带缆绳应力超限',
      over_depth: '超出最大作业深度',
      rapid_ascent: '上浮速度过快'
    }[reason] || reason;
  }

  function renderConflicts(snap) {
    if (snap.conflicts.length === lastConflictCount) return;
    lastConflictCount = snap.conflicts.length;
    els.conflict.innerHTML = snap.conflicts.slice(-20).map(function (cf) {
      const danger = cf.kind === 'cable_tight';
      const cls = danger ? 'danger' : 'warn';
      return '<li class="' + cls + '">[' + cf.time.toFixed(1) + 's] ' +
        conflictText(cf) + '</li>';
    }).concat(snap.events.filter(function (ev) {
      return ev.type === 'sample_complete' || ev.type === 'success' || ev.type === 'fail';
    }).map(function (ev) {
      return '<li class="info">[' + ev.time.toFixed(1) + 's] ' + eventText(ev) + '</li>';
    })).join('');
  }

  function conflictText(cf) {
    if (cf.kind === 'cable_tight') return '缆绳过紧拉扯脐带（松弛 ' + cf.slack + 'm）';
    if (cf.kind === 'sample_blocked') return '取样被拒：' + cf.reasons.join('、') + ' 不达标';
    if (cf.kind === 'sample_interrupted') return '取样中断：' + cf.reasons.join('、') + ' 偏离';
    return cf.kind;
  }

  function eventText(ev) {
    if (ev.type === 'sample_complete') return '取样点 ' + ev.payload.stationId + ' 完成';
    if (ev.type === 'success') return '任务成功上浮';
    if (ev.type === 'fail') return '失败：' + ev.payload.reason;
    return ev.type;
  }

  // —— 键盘：每个物理码独立映射，两侧按键可同时按下 ——
  window.addEventListener('keydown', function (ev) {
    if (ev.code === 'KeyP') { ev.preventDefault(); engine.togglePause(); return; }
    if (ev.code === 'KeyR') { ev.preventDefault(); doRestart(); return; }
    if (ev.code === 'KeyD') { ev.preventDefault(); toggleDebug(); return; }
    if (ev.code === 'F2') { ev.preventDefault(); openReplay(); return; }
    const map = C.KEYMAP[ev.code];
    if (!map) return;
    ev.preventDefault();
    if (held.has(ev.code)) return; // 长按不重复触发，方向保持到 keyup
    held.add(ev.code);
    engine.applyAction(map.player, map.action);
  });

  window.addEventListener('keyup', function (ev) {
    const map = C.KEYMAP[ev.code];
    if (!map) return;
    ev.preventDefault();
    held.delete(ev.code);
    // 松开后关闭对应机构（仅当没有同组另一键仍按住）
    if (map.action.indexOf('ballast') === 0 && !held.has('KeyW') && !held.has('KeyS')) {
      engine.applyAction('p1', 'ballast_off');
    }
    if (map.action.indexOf('air') === 0 && !held.has('ArrowLeft') && !held.has('ArrowRight')) {
      engine.applyAction('p2', 'air_off');
    }
    if (map.action.indexOf('cable') === 0 && !held.has('ArrowUp') && !held.has('ArrowDown')) {
      engine.applyAction('p2', 'cable_off');
    }
  });

  // 窗口失焦自动暂停，防止“卡键”与无人值守
  window.addEventListener('blur', function () {
    held.clear();
    engine.pause();
  });

  function doRestart() {
    viewer.close();
    held.clear();
    lastConflictCount = 0;
    els.conflict.innerHTML = '';
    engine.reset(engine.state.mode);
  }

  function toggleDebug() {
    const mode = engine.state.mode === 'debug' ? 'coop' : 'debug';
    viewer.close();
    held.clear();
    engine.reset(mode);
    document.body.classList.toggle('debug-on', mode === 'debug');
    els.debug.textContent = mode === 'debug' ? '退出调试 (D)' : '单人调试 (D)';
  }

  function openReplay() {
    viewer.open(engine, render);
  }

  els.pause.addEventListener('click', function () { engine.togglePause(); });
  els.restart.addEventListener('click', doRestart);
  els.debug.addEventListener('click', toggleDebug);
  els.openReplay.addEventListener('click', openReplay);
  els.discP1.addEventListener('click', function () { engine.disconnect('p1'); });
  els.discP2.addEventListener('click', function () { engine.disconnect('p2'); });
  els.reconnect.addEventListener('click', function () {
    if (engine.state.protectedSide) engine.reconnect(engine.state.protectedSide);
  });
  els.driveP1.addEventListener('click', function () {
    DBAutopilot.p1 = !DBAutopilot.p1;
    els.driveP1.textContent = DBAutopilot.p1 ? '取消托管 P1' : '托管 P1';
  });
  els.driveP2.addEventListener('click', function () {
    DBAutopilot.p2 = !DBAutopilot.p2;
    els.driveP2.textContent = DBAutopilot.p2 ? '取消托管 P2' : '托管 P2';
  });
  els.play.addEventListener('click', function () { viewer.togglePlay(); });
  els.scrub.addEventListener('input', function () { viewer.scrub(els.scrub.value); });
  els.exportJson.addEventListener('click', function () { viewer.exportJson(); });
  els.close.addEventListener('click', function () {
    viewer.close();
    render(engine.getSnapshot());
  });

  requestAnimationFrame(frame);
})();

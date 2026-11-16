/* 主控：固定步长循环、输入、HUD、检查点、本地存档与验收。 */
(function (G) {
  'use strict';
  const { CFG, currentWind } = G.TowConfig;
  const Sim = G.TowSim;
  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');
  const renderer = G.TowRenderer(canvas);
  const audio = G.TowAudio();

  let sim = Sim.createSimulation(parseInt($('seedInput').value, 10) || CFG.SEED_DEFAULT);
  let paused = false;
  let accumulator = 0;
  let lastFrame = 0;
  let lastUi = -1;
  let debugEnabled = true;
  let held = { up: false, down: false, left: false, right: false, brake: false };
  let lastToastKey = '';
  let toastUntil = 0;
  let recoveredUntil = 0;
  let logSignature = '';
  let validationBusy = false;

  function ensureAudio() {
    audio.resume();
    return audio;
  }

  function parseSeed() {
    const n = Math.abs(Math.floor(Number($('seedInput').value) || CFG.SEED_DEFAULT));
    return n || CFG.SEED_DEFAULT;
  }

  function applyHeldInput() {
    Sim.setInput(sim, {
      throttle: (held.up ? 1 : 0) - (held.down ? 1 : 0),
      steer: (held.right ? 1 : 0) - (held.left ? 1 : 0),
      brake: held.brake
    });
  }

  function clearHeld() {
    held = { up: false, down: false, left: false, right: false, brake: false };
    document.querySelectorAll('.drive-key').forEach((b) => b.classList.remove('active'));
    if (sim.phase === 'playing') Sim.setInput(sim, { throttle: 0, steer: 0, brake: false });
  }

  function loop(ts) {
    if (!lastFrame) lastFrame = ts;
    const frame = Math.min(0.08, (ts - lastFrame) / 1000);
    lastFrame = ts;
    if (!paused && sim.phase === 'playing') {
      applyHeldInput();
      accumulator += frame;
      let guard = 0;
      while (accumulator >= CFG.DT && guard++ < 8) {
        Sim.step(sim, CFG.DT);
        accumulator -= CFG.DT;
        if (sim.phase !== 'playing') {
          clearHeld();
          break;
        }
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(sim, { debug: debugEnabled });
    if (ts - lastUi > 85) {
      updateUi(false);
      lastUi = ts;
    }
    audio.update(sim, !paused && sim.phase === 'playing');
    requestAnimationFrame(loop);
  }

  function updateUi(force) {
    const load = Sim.loadInfo(sim);
    const mission = Sim.activeMission(sim);
    const delivered = sim.progress.delivered;

    $('progressText').textContent = delivered + ' / 3';
    $('progressBar').style.width = (delivered / 3 * 100) + '%';
    $('missionTitle').textContent = missionTitle(mission);
    $('missionRows').innerHTML = sim.world.mission.map((m, i) => {
      const cargo = sim.cargoStates[i];
      const active = i === sim.progress.activeIndex && sim.phase === 'playing';
      const done = cargo.status === 'delivered';
      const attached = cargo.status === 'attached';
      const state = done ? 'DELIVERED' : attached ? 'ATTACHED' : active ? 'NEXT' : 'WAIT';
      return '<div class="mission-row ' + (done ? 'done' : active ? 'active' : '') + '">' +
        '<span class="seq">' + m.seq + '</span>' +
        '<span class="cargo">' + m.cargoId + ' · ' + m.weight.toFixed(1) + 't</span>' +
        '<span class="state">' + state + '</span></div>';
    }).join('');

    const battery = Math.max(0, sim.resources.battery);
    const drawbar = Math.max(0, sim.resources.drawbar);
    $('batteryText').textContent = battery.toFixed(0) + '%';
    $('drawbarText').textContent = drawbar.toFixed(0) + '%';
    $('batteryBar').style.width = battery + '%';
    $('drawbarBar').style.width = drawbar + '%';
    $('batteryBar').style.background = battery < 25 ? 'var(--red)' : '';
    $('drawbarBar').style.background = drawbar < 30 ? 'var(--red)' : '';
    $('shiftText').textContent = Sim.fmtTime(sim.resources.shiftLeft);
    $('shiftText').style.color = sim.resources.shiftLeft < 45 ? 'var(--red)' : '';
    $('recoveryText').textContent = '检查点恢复 ' + sim.recoveryCount + ' 次';

    const kmh = Math.abs(sim.truck.speed) * 0.4;
    $('speedText').textContent = kmh.toFixed(1);
    $('loadText').textContent = load.weight.toFixed(1) + 't';
    $('loadPercent').textContent = load.percent + '%';
    $('surfaceText').textContent = G.TowConfig.wetSurface(sim.world, sim.truck.x, sim.truck.y) ? '湿滑' : '干燥';
    $('gearText').textContent = held.brake ? 'BRAKE' : sim.truck.speed > 0.8 ? 'D' : sim.truck.speed < -0.8 ? 'R' : 'N';
    const steerRatio = sim.truck.steer / CFG.MAX_STEER;
    $('steerNeedle').style.left = (50 + steerRatio * 44) + '%';
    $('steerText').textContent = (sim.truck.steer * 180 / Math.PI).toFixed(0) + '°';

    const wind = currentWind(sim.world, sim.t);
    $('windArrow').style.transform = 'rotate(' + wind.angle + 'rad)';
    $('windLabel').textContent = wind.label;
    $('windSpeed').textContent = wind.speed.toFixed(1);
    $('windHint').textContent = Math.abs(Math.sin(wind.angle)) < 0.35 ? '顺/逆风' : '侧风';

    $('debugSeed').textContent = sim.seed;
    $('signatureValue').textContent = sim.world.signature;
    $('debugRoute').textContent = mission ?
      (sim.attachedId ? '交付 ' + mission.cargoId + ' → S' + mission.seq : '挂接 ' + mission.cargoId + ' → 起点') :
      '全部完成';
    $('debugLoad').textContent = load.label + ' / ' + load.percent + '%';
    $('debugWind').textContent = wind.label + ' ' + wind.speed.toFixed(1) + ' m/s · ' +
      (wind.angle * 180 / Math.PI).toFixed(0) + '°';
    $('debugObstacles').textContent = sim.world.obstacles.map((o) => o.id).join(' · ');

    const cp = Sim.currentCheckpoint(sim);
    $('checkpointInfo').textContent = cp
      ? cp.id + ' · ' + cp.label + ' · ' + Sim.fmtTime(cp.t)
      : '暂无检查点';
    $('btnContinue').disabled = !(sim.phase === 'failed' && cp);
    $('btnManualCheckpoint').disabled = sim.phase !== 'playing';
    $('btnInteract').disabled = sim.phase !== 'playing';
    const failText = $('lastFailureReason');
    if (sim.lastFailureReason) {
      failText.textContent = '最近失败：' + sim.lastFailureReason;
      failText.classList.add('active');
    } else {
      failText.textContent = '最近失败：暂无';
      failText.classList.remove('active');
    }
    if (sim.failure) {
      const recovered = sim.phase === 'playing' && sim.recoveredFrom;
      $('failureMeta').textContent =
        't=' + Sim.fmtTime(sim.failure.t) + ' · ' + sim.failure.type +
        ' · ' + (recovered ? '已从 ' + sim.recoveredFrom + ' 恢复' : '可按检查点继续');
    } else {
      $('failureMeta').textContent = '尚未发生失败';
    }
    $('btnPause').textContent = paused ? '继续' : '暂停';

    if (sim.phase === 'failed') {
      setBanner('失败 · ' + (sim.lastFailureReason || '未知原因'), 'failed', true);
    } else if (sim.phase === 'won') {
      setBanner('任务完成 · 三个货柜均已按序交付', 'success', true);
    } else if (paused) {
      setBanner('已暂停 · 仿真时间冻结', 'paused', true);
    } else if (recoveredUntil > sim.t) {
      setBanner('已从 ' + sim.recoveredFrom + ' 恢复，目标与资源回到检查点', 'success', true);
    } else {
      setBanner('', 'paused', false);
    }
    renderLog(force);
    updateToast();
  }

  function missionTitle(mission) {
    if (sim.phase === 'won') return '任务完成 · 全部货柜已交付';
    if (sim.phase === 'failed') return '任务失败 · 等待检查点恢复';
    if (!mission) return '全部货柜已交付';
    if (sim.attachedId) return '拖运 ' + mission.cargoId + ' → 隔离位 ' + mission.seq;
    return '前往挂接 ' + mission.cargoId;
  }

  function setBanner(text, kind, show) {
    const el = $('statusBanner');
    el.textContent = text;
    el.className = 'status-banner ' + kind + (show ? ' show' : '');
  }

  function updateToast() {
    if (sim.lastMessage !== lastToastKey) {
      lastToastKey = sim.lastMessage;
      if (sim.lastMessage) {
        const last = sim.log[sim.log.length - 1];
        const toast = $('toast');
        toast.textContent = sim.lastMessage;
        toast.className = 'toast show' + (last && last.level === 'alarm' ? ' alarm' : '');
        toastUntil = performance.now() + 2800;
      }
    }
    if (toastUntil && performance.now() > toastUntil) {
      $('toast').classList.remove('show');
      toastUntil = 0;
    }
  }

  function renderLog(force) {
    const signature = sim.log.length + '|' + sim.t.toFixed(1) + '|' + (sim.log[sim.log.length - 1] || {}).msg;
    if (!force && signature === logSignature) return;
    logSignature = signature;
    $('log').innerHTML = sim.log.map((entry) =>
      '<div class="log-entry ' + (entry.level || '') + '">' +
      '<time>' + Sim.fmtTime(entry.t) + '</time><span>' + entry.msg + '</span></div>'
    ).join('');
    $('log').scrollTop = $('log').scrollHeight;
  }

  function restart(seedArg) {
    const seed = Number.isFinite(Number(seedArg)) ? Math.abs(Math.floor(Number(seedArg))) : parseSeed();
    $('seedInput').value = seed;
    sim = Sim.createSimulation(seed);
    paused = false;
    accumulator = 0;
    lastFrame = 0;
    recoveredUntil = 0;
    lastToastKey = '';
    logSignature = '';
    clearHeld();
    updateUi(true);
  }

  function togglePause() {
    if (sim.phase !== 'playing') return;
    paused = !paused;
    if (paused) clearHeld();
    updateUi(true);
  }

  function manualCheckpoint() {
    if (sim.phase !== 'playing') return;
    const cp = Sim.createCheckpoint(sim, '手动检查点');
    Sim.log(sim, '已保存手动检查点 ' + cp.id + '。', 'recovery');
    updateUi(true);
  }

  function continueFromCheckpoint() {
    const result = Sim.restoreLatestCheckpoint(sim);
    if (!result.ok) return result;
    paused = false;
    recoveredUntil = sim.t + 7;
    clearHeld();
    lastToastKey = '';
    updateUi(true);
    return result;
  }

  function saveGame() {
    const status = $('saveStatus');
    try {
      const payload = Sim.saveToStorage(sim);
      status.textContent = '存档：已保存 ' + new Date(payload.savedAt).toLocaleTimeString('zh-CN') +
        ' · ' + sim.world.signature;
      status.className = 'save-status ok';
      return { ok: true, payload };
    } catch (err) {
      status.textContent = '存档失败：' + err.message;
      status.className = 'save-status error';
      return { ok: false, error: err.message };
    }
  }

  function loadGame() {
    const status = $('saveStatus');
    try {
      const loaded = Sim.loadFromStorage();
      sim = loaded;
      paused = true;
      accumulator = 0;
      recoveredUntil = 0;
      lastToastKey = '';
      logSignature = '';
      clearHeld();
      $('seedInput').value = sim.seed;
      status.textContent = '存档：已载入 · 位置与胜负条件校验通过';
      status.className = 'save-status ok';
      updateUi(true);
      return { ok: true, state: Sim.criticalState(sim) };
    } catch (err) {
      status.textContent = '载入失败：' + err.message;
      status.className = 'save-status error';
      return { ok: false, error: err.message };
    }
  }

  function interact() {
    ensureAudio().click();
    const result = Sim.interact(sim);
    updateUi(true);
    return result;
  }

  function setDebug(enabled) {
    debugEnabled = !!enabled;
    $('debugToggle').checked = debugEnabled;
  }

  function runValidation() {
    if (validationBusy) return null;
    validationBusy = true;
    const button = $('btnValidate');
    button.disabled = true;
    button.textContent = '验收中…';
    $('validateReport').textContent = '正在运行固定步长场景，请稍候…';
    setTimeout(function () {
      try {
        const report = G.TowValidate.runAll(parseSeed());
        renderValidationReport(report);
        return report;
      } catch (err) {
        $('validateReport').innerHTML = '<div class="validate-summary fail"><strong>验收异常</strong><span>' +
          String(err.message) + '</span></div>';
        return null;
      } finally {
        validationBusy = false;
        button.disabled = false;
        button.textContent = '运行验收';
      }
    }, 30);
    return null;
  }

  function renderValidationReport(report) {
    const pass = report.checks.filter((c) => c.pass).length;
    const rows = report.checks.map((c) =>
      '<div class="v-check ' + (c.pass ? 'pass' : 'fail') + '">' +
      '<span class="status">' + (c.pass ? 'PASS' : 'FAIL') + '</span>' +
      '<span>' + c.name + '</span>' +
      '<span class="detail">' + c.detail + '</span></div>'
    ).join('');
    $('validateReport').innerHTML =
      '<div class="validate-summary ' + (report.allPass ? 'pass' : 'fail') + '">' +
      '<strong>' + (report.allPass ? '全部通过' : '存在失败项') + ' · ' + pass + '/' + report.checks.length + '</strong>' +
      '<span>seed=' + report.seed + ' · signature=' + report.signature + '</span></div>' +
      rows +
      '<div class="compare-row">' +
      '<span class="compare-chip">正常路线 <b>' + report.comparisons.normal.after.delivered + '/3</b></span>' +
      '<span class="compare-chip">碰撞损伤 <b>' +
        (100 - report.comparisons.collision.after.drawbar).toFixed(1) + '%</b></span>' +
      '<span class="compare-chip">恢复进度 <b>' + report.comparisons.recovery.after.delivered + '/3</b></span>' +
      '<span class="compare-chip">风向 <b>' + report.debug.wind.label + ' ' +
        report.debug.wind.speed.toFixed(1) + 'm/s</b></span>' +
      '</div>';
  }

  function toggleMute() {
    const muted = ensureAudio().toggleMute();
    $('btnMute').textContent = muted ? '静音' : '声音';
    $('btnMute').title = muted ? '打开声音' : '关闭声音';
  }

  function bindKeyboard() {
    const driveKeys = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      Space: 'brake'
    };
    window.addEventListener('keydown', function (event) {
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (driveKeys[event.code]) {
        held[driveKeys[event.code]] = true;
        event.preventDefault();
        ensureAudio();
      } else if (event.code === 'KeyE' && !event.repeat) {
        event.preventDefault();
        interact();
      } else if (event.code === 'KeyP' && !event.repeat) {
        event.preventDefault();
        togglePause();
      } else if (event.code === 'KeyR' && !event.repeat) {
        event.preventDefault();
        restart();
      } else if (event.code === 'KeyM' && !event.repeat) {
        event.preventDefault();
        toggleMute();
      }
    });
    window.addEventListener('keyup', function (event) {
      if (driveKeys[event.code]) {
        held[driveKeys[event.code]] = false;
        event.preventDefault();
      }
    });
    window.addEventListener('blur', clearHeld);
  }

  function bindTouchControls() {
    const map = { up: 'up', down: 'down', left: 'left', right: 'right', brake: 'brake' };
    document.querySelectorAll('[data-drive]').forEach((button) => {
      const action = map[button.dataset.drive];
      const press = (event) => {
        event.preventDefault();
        ensureAudio();
        held[action] = true;
        button.classList.add('active');
        if (button.setPointerCapture && event.pointerId !== undefined) {
          button.setPointerCapture(event.pointerId);
        }
      };
      const release = (event) => {
        if (event) event.preventDefault();
        held[action] = false;
        button.classList.remove('active');
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    });
  }

  $('btnPause').addEventListener('click', function () { ensureAudio().click(); togglePause(); });
  $('btnRestart').addEventListener('click', function () { ensureAudio().click(); restart(); });
  $('btnDebugScene').addEventListener('click', function () {
    ensureAudio().click();
    $('seedInput').value = CFG.SEED_DEFAULT;
    restart(CFG.SEED_DEFAULT);
    setDebug(true);
    Sim.log(sim, '已载入可重复调试场景 seed=' + CFG.SEED_DEFAULT + '：显示导航路径、载重和当前风向。', 'recovery');
    updateUi(true);
  });
  $('btnSave').addEventListener('click', function () { ensureAudio().click(); saveGame(); });
  $('btnLoad').addEventListener('click', function () { ensureAudio().click(); loadGame(); });
  $('btnContinue').addEventListener('click', function () { ensureAudio().click(); continueFromCheckpoint(); });
  $('btnManualCheckpoint').addEventListener('click', function () { ensureAudio().click(); manualCheckpoint(); });
  $('btnMute').addEventListener('click', toggleMute);
  $('btnValidate').addEventListener('click', function () { ensureAudio().click(); runValidation(); });
  $('btnInteract').addEventListener('click', interact);
  $('debugToggle').addEventListener('change', function (event) { setDebug(event.target.checked); });
  $('seedInput').addEventListener('change', function () {
    restart(parseSeed());
  });
  $('seedInput').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      restart(parseSeed());
      $('seedInput').blur();
    }
  });

  bindKeyboard();
  bindTouchControls();
  document.addEventListener('pointerdown', function () { audio.resume(); }, { once: true });

  G.__towApp = {
    get sim() { return sim; },
    get paused() { return paused; },
    get seed() { return sim.seed; },
    restart,
    reset: restart,
    togglePause,
    pause() { if (!paused && sim.phase === 'playing') togglePause(); },
    resume() { if (paused && sim.phase === 'playing') togglePause(); },
    save: saveGame,
    load: loadGame,
    continueFromCheckpoint,
    manualCheckpoint,
    interact,
    setDebug,
    setInput(patch) { Sim.setInput(sim, patch); return Sim.criticalState(sim); },
    step(count) {
      const n = Math.max(1, Math.floor(count || 1));
      for (let i = 0; i < n; i++) Sim.step(sim, CFG.DT);
      updateUi(true);
      return Sim.criticalState(sim);
    },
    advance(seconds) {
      Sim.advance(sim, seconds);
      updateUi(true);
      return Sim.criticalState(sim);
    },
    snapshot() { return Sim.criticalState(sim); },
    conditions() { return Sim.winLossConditions(sim); },
    path() {
      const target = Sim.navTarget(sim);
      return target ? G.TowNav.findPath(sim.world, sim.truck, target, 25) : [];
    },
    validate() { return G.TowValidate.runAll(parseSeed()); },
    runValidation,
    saveKey: 'quayTow.save.v1'
  };

  updateUi(true);
  requestAnimationFrame(loop);
})(typeof globalThis !== 'undefined' ? globalThis : this);



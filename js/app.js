(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sim = new window.GlazeSimulation();
  const renderer = new window.GlazeRenderer($('stage'));
  const audio = new window.GlazeAudio();
  const types = window.GlazeSimulation.PIECE_TYPES;
  const limitLabels = {
    soakTime: '浸釉时长',
    rotation: '旋转速度',
    dripSpeed: '滴釉速度'
  };
  const eventLabels = {
    'device-start': '设备启动',
    'device-stop': '设备停止',
    'param-change': '参数变化',
    'param-limit': '参数越限',
    'batch-start': '批次开始',
    'batch-result': '批次结果',
    'batch-reset': '批次重置',
    'phase-change': '工序变化',
    'piece-result': '陶器结果',
    'queue-next': '装载换件',
    'emergency-stop': '设备急停',
    'equipment-recover': '设备恢复',
    pause: '暂停',
    resume: '恢复',
    'single-step': '单步',
    refill: '补液',
    'audit-clear': '清空审计',
    validation: '流程验收'
  };

  const ui = {
    batchId: $('batch-id'),
    simClock: $('sim-clock'),
    systemStatus: $('system-status'),
    phaseLabel: $('phase-label'),
    thicknessLive: $('thickness-live'),
    thicknessFill: $('thickness-fill'),
    targetWindow: $('target-window'),
    levelLive: $('level-live'),
    levelFill: $('level-fill'),
    pieceKicker: $('piece-kicker'),
    pieceName: $('piece-name'),
    pieceTarget: $('piece-target'),
    primary: $('primary-action'),
    secondary: $('secondary-action'),
    metricGood: $('metric-good'),
    metricYield: $('metric-yield'),
    metricEnergy: $('metric-energy'),
    metricPower: $('metric-power'),
    metricLevel: $('metric-level'),
    metricVolume: $('metric-volume'),
    metricCache: $('metric-cache'),
    metricCacheTime: $('metric-cache-time'),
    queue: $('piece-queue'),
    queueProgress: $('queue-progress'),
    soak: $('soak-time'),
    soakOutput: $('soak-output'),
    rotation: $('rotation-speed'),
    rotationOutput: $('rotation-output'),
    drip: $('drip-speed'),
    dripOutput: $('drip-output'),
    paramLock: $('param-lock'),
    refill: $('refill-button'),
    estop: $('estop-button'),
    pause: $('pause-button'),
    pauseLabel: $('pause-label'),
    step: $('step-button'),
    reset: $('reset-button'),
    clearLog: $('clear-log-button'),
    logCount: $('log-count'),
    eventLog: $('event-log'),
    runValidation: $('run-validation'),
    validationYield: $('validation-yield'),
    validationAnomaly: $('validation-anomaly'),
    validationStop: $('validation-stop'),
    validationList: $('validation-list'),
    exportJson: $('export-json'),
    exportCsv: $('export-csv'),
    audioToggle: $('audio-toggle'),
    helpToggle: $('help-toggle'),
    helpDialog: $('help-dialog'),
    helpClose: $('help-close'),
    toastRegion: $('toast-region')
  };

  let uiDirty = true;
  let logDirty = true;
  let lastUiAt = 0;
  let lastFrame = performance.now();
  let lastEventSeq = -1;
  let validating = false;

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const tenths = Math.floor((safe % 1) * 10);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
  }

  function formatPercent(value) {
    return `${Math.round(value * 1000) / 10}%`;
  }

  function toast(title, message, tone = '') {
    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
    ui.toastRegion.appendChild(node);
    window.setTimeout(() => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      node.style.transition = '180ms ease';
      window.setTimeout(() => node.remove(), 200);
    }, 3200);
    while (ui.toastRegion.children.length > 3) ui.toastRegion.firstElementChild.remove();
  }

  function potSvg(type, status) {
    const fill = status === 'bad' ? '#82594d' : type.glaze;
    const paths = {
      cup: 'M10 8 C9 18 8 27 15 35 Q20 38 25 35 C32 27 31 18 30 8 Z',
      jar: 'M15 5 C12 12 7 17 7 27 C7 35 13 39 20 39 C27 39 33 35 33 27 C33 17 28 12 25 5 Z',
      vase: 'M16 3 C15 10 14 14 10 18 C5 24 7 35 20 39 C33 35 35 24 30 18 C26 14 25 10 24 3 Z'
    };
    return `<svg viewBox="0 0 40 44" aria-hidden="true"><path d="${paths[type.id]}" fill="${fill}" opacity="${status ? 0.9 : 0.34}" stroke="rgba(240,235,217,.42)" stroke-width="1.2"/></svg>`;
  }

  function statusCopy(status) {
    return {
      idle: '待机',
      running: '生产中',
      paused: '已暂停',
      fault: '设备停机',
      complete: '批次完成'
    }[status] || status;
  }

  function phaseCopy() {
    if (sim.fault) return '设备急停';
    if (sim.paused) return '时钟暂停';
    if (sim.phase === 'dip') return '沉浸上釉';
    if (sim.phase === 'spin') return '旋转排釉';
    if (sim.phase === 'drip') return '滴釉调整';
    if (sim.phase === 'complete') return '批次完成';
    if (sim.batch) return '等待浸釉';
    return '待开始';
  }

  function qualityFor(thickness, range) {
    if (thickness < range.min) return { id: 'thin', label: '偏薄 · 有露底风险', color: '#e2b365' };
    if (thickness > range.max) return { id: 'thick', label: '偏厚 · 有流挂风险', color: '#e26d5c' };
    return { id: 'good', label: '目标区间内', color: '#b8c69a' };
  }

  function renderQueue() {
    const batch = sim.batch;
    const rows = types.map((type, index) => {
      const piece = batch ? batch.pieces[index] : null;
      const isCurrent = Boolean(batch && !batch.complete && index === sim.currentIndex);
      const classes = ['queue-item'];
      if (isCurrent) classes.push('current');
      if (piece) classes.push('done');
      if (piece && piece.status !== 'good') classes.push('failed');
      let resultText = '待处理';
      let resultClass = '';
      if (piece) {
        resultText = piece.status === 'good' ? `${piece.thickness.toFixed(2)} mm ✓` : '不合格';
        resultClass = piece.status === 'good' ? 'good' : 'bad';
      } else if (isCurrent) {
        resultText = `${sim.thickness.toFixed(2)} mm`;
        if (sim.phase === 'complete') resultText = '—';
      }
      return `
        <div class="${classes.join(' ')}" data-piece="${index}">
          <span class="queue-swatch">${potSvg(type, piece ? piece.status : null)}</span>
          <span class="queue-copy">
            <strong>${escapeHtml(type.name)}</strong>
            <span>目标 ${type.target.toFixed(2)} mm · ±${type.tolerance.toFixed(2)}</span>
          </span>
          <span class="queue-result ${resultClass}">${resultText}</span>
        </div>`;
    });
    ui.queue.innerHTML = rows.join('');
    ui.queueProgress.textContent = `${sim.finishedCount} / 3`;
  }

  function updateSlider(input, output, value, unit, fixed = 1) {
    const min = Number(input.min);
    const max = Number(input.max);
    const fill = ((Number(value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${clampNumber(fill, 0, 100)}%`);
    output.textContent = `${Number(value).toFixed(fixed)} ${unit}`;
    if (document.activeElement !== input) input.value = String(value);
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function renderMetrics() {
    const good = sim.goodCount;
    const finished = sim.finishedCount;
    const range = sim.window;
    const quality = qualityFor(sim.thickness, range);
    const thicknessPercent = clampNumber((sim.thickness / 1.65) * 100, 0, 100);
    ui.metricGood.innerHTML = `${good} <small>/ 3</small>`;
    ui.metricYield.textContent = finished ? `良品率 ${formatPercent(sim.yieldRate)}` : '良品率 —';
    ui.metricEnergy.innerHTML = `${sim.energyKWh.toFixed(4)} <small>kWh</small>`;
    ui.metricPower.textContent = `峰值 ${sim.peakPowerW} W · 当前 ${sim.currentPowerW} W`;
    ui.metricLevel.innerHTML = `${Math.round(sim.level)} <small>%</small>`;
    ui.metricVolume.textContent = `${(sim.level * 0.18).toFixed(1)} L / 18.0 L`;
    ui.metricCache.innerHTML = `${sim.cache.length} <small>帧</small>`;
    const latest = sim.cache.length ? sim.cache[sim.cache.length - 1] : null;
    ui.metricCacheTime.textContent = latest ? `最新 @ ${formatClock(latest.simTime)}` : '无快照';

    ui.thicknessLive.innerHTML = `${sim.thickness.toFixed(2)} <small>mm</small>`;
    ui.thicknessLive.style.color = quality.color;
    ui.thicknessFill.style.width = `${thicknessPercent}%`;
    ui.thicknessFill.style.background = quality.color;
    ui.targetWindow.style.left = `${(range.min / 1.65) * 100}%`;
    ui.targetWindow.style.width = `${((range.max - range.min) / 1.65) * 100}%`;
    ui.levelLive.innerHTML = `${sim.level.toFixed(1)} <small>%</small>`;
    ui.levelFill.style.width = `${sim.level}%`;
    ui.levelFill.style.background = sim.level < 35 ? '#e2b365' : '#7eb6b6';

    updateSlider(ui.soak, ui.soakOutput, sim.params.soakTime, 's');
    updateSlider(ui.rotation, ui.rotationOutput, sim.params.rotation, 'RPM', 0);
    updateSlider(ui.drip, ui.dripOutput, sim.params.dripSpeed, 'mm/s');
  }

  function renderTransport() {
    const fault = Boolean(sim.fault);
    const paused = sim.paused;
    const complete = sim.phase === 'complete';
    let primaryText = '开始浸釉';
    let primaryDisabled = false;
    let secondaryText = '完成当前件';
    let secondaryDisabled = true;

    if (fault) {
      primaryText = '恢复设备并继续';
      secondaryText = '等待设备恢复';
    } else if (paused) {
      primaryText = '时钟已暂停';
      primaryDisabled = true;
      secondaryText = '时钟已暂停';
    } else if (complete) {
      primaryText = '开始下一批';
      secondaryText = '本批已结束';
    } else if (sim.phase === 'dip') {
      primaryText = '提前提起';
    } else if (sim.phase === 'spin') {
      primaryText = '旋转排釉中';
      primaryDisabled = true;
      secondaryText = '等待自动滴釉';
    } else if (sim.phase === 'drip') {
      primaryText = '滴釉观察中';
      primaryDisabled = true;
      secondaryText = '完成当前件';
      secondaryDisabled = false;
    } else if (sim.phase === 'idle' && sim.batch) {
      primaryText = '开始浸釉';
      secondaryText = '尚未滴釉';
    }

    ui.primary.textContent = primaryText;
    ui.primary.disabled = primaryDisabled;
    ui.secondary.textContent = secondaryText;
    ui.secondary.disabled = secondaryDisabled;
    ui.estop.disabled = fault;
    ui.refill.disabled = paused || fault;
    ui.step.disabled = !paused;
    ui.pauseLabel.textContent = paused ? '恢复' : '暂停';
    ui.pause.dataset.active = String(paused);
    ui.paramLock.textContent = paused ? '暂停锁定' : fault ? '联锁锁定' : '可调';
    const lockParams = paused || fault;
    ui.soak.disabled = lockParams;
    ui.rotation.disabled = lockParams;
    ui.drip.disabled = lockParams;
  }

  function renderUI() {
    const summary = sim.getSummary();
    ui.batchId.textContent = summary.batchId || '—';
    ui.simClock.textContent = formatClock(sim.simTime);
    ui.systemStatus.dataset.status = summary.status;
    ui.systemStatus.querySelector('span').textContent = statusCopy(summary.status);
    ui.phaseLabel.textContent = phaseCopy();
    ui.pieceKicker.textContent = `第 ${Math.min(sim.currentIndex + 1, 3)} / 3 件`;
    ui.pieceName.textContent = sim.currentType.name;
    ui.pieceTarget.textContent = `目标 ${sim.currentType.target.toFixed(2)} mm · 区间 ${sim.window.min.toFixed(2)}–${sim.window.max.toFixed(2)}`;
    renderMetrics();
    renderTransport();
    renderQueue();
  }

  function renderLog(force = false) {
    const newest = sim.events.length ? sim.events[sim.events.length - 1].seq : 0;
    if (!force && newest === lastEventSeq) return;
    lastEventSeq = newest;
    ui.logCount.textContent = `${sim.events.length} 条`;
    if (!sim.events.length) {
      ui.eventLog.innerHTML = '<tr><td colspan="4" class="empty-state">尚无事件。开始生产或运行验收后将在此记录。</td></tr>';
      return;
    }
    const entries = sim.events.slice(-180).reverse();
    ui.eventLog.innerHTML = entries.map((entry) => `
      <tr data-level="${escapeHtml(entry.level)}">
        <td>${formatClock(entry.simTime)}</td>
        <td>${escapeHtml(eventLabels[entry.type] || entry.type)}</td>
        <td>${escapeHtml(entry.device)}</td>
        <td>${escapeHtml(entry.message)}</td>
      </tr>
    `).join('');
  }

  function readingText(scenario) {
    const reading = scenario.reading || {};
    if (scenario.id === 'normal') {
      return `暂停冻结 ${reading.pauseFrozen ? '是' : '否'} · 单步 ${Number(reading.singleStepSeconds || 0).toFixed(2)}s · 釉厚 ${Number(reading.thickness || 0).toFixed(3)} mm · 液位 ${reading.level}%`;
    }
    if (scenario.id === 'limit') {
      return `写入 ${reading.attempted}s · 当前值 ${reading.currentSoakTime}s · 釉厚 ${Number(reading.thickness || 0).toFixed(3)} mm · 功率 ${reading.powerW}W · 拒绝 ${reading.rejected ? '是' : '否'}`;
    }
    return `相位 ${reading.phase || '—'} · 釉厚 ${Number(reading.thickness || 0).toFixed(3)} mm · 液位 ${reading.level}% · 功率 ${reading.powerW}W`;
  }

  function recoveryText(scenario) {
    const recovery = scenario.recovery || {};
    if (!recovery.required) return recovery.result || '无需恢复';
    return `@${Number(recovery.at || 0).toFixed(1)}s / ${recovery.phase || '—'} / 釉厚 ${Number(recovery.thickness || 0).toFixed(3)} mm / ${recovery.result || '—'}`;
  }

  function renderValidation() {
    const report = sim.validation;
    if (!report) {
      ui.validationYield.textContent = '—';
      ui.validationAnomaly.textContent = '未运行';
      ui.validationStop.textContent = '—';
      ui.validationList.innerHTML = '<p class="empty-state">运行验收后，将记录触发时刻、当前数值与恢复结果。</p>';
      return;
    }
    ui.validationYield.textContent = formatPercent(report.summary.yieldRate);
    ui.validationAnomaly.textContent = report.summary.anomalyLocations.join(' / ') || '无';
    ui.validationStop.textContent = report.summary.stopReasons.join(' / ') || '无停机';
    ui.validationList.innerHTML = report.scenarios.map((scenario) => `
      <article class="validation-card ${scenario.passed ? '' : 'fail'}">
        <header>
          <i></i>
          <strong>${escapeHtml(scenario.name)}</strong>
          <span>${scenario.passed ? '通过' : '失败'}</span>
        </header>
        <p>触发 @${Number(scenario.triggerAt || 0).toFixed(1)}s · ${escapeHtml(scenario.triggerLabel || '')}</p>
        <dl>
          <dt>当前值</dt><dd>${escapeHtml(readingText(scenario))}</dd>
          <dt>恢复</dt><dd>${escapeHtml(recoveryText(scenario))}</dd>
          <dt>结果</dt><dd>良品 ${scenario.result.goodCount}/${scenario.result.finishedCount} · ${formatPercent(scenario.result.yieldRate)} · 峰值 ${scenario.result.peakThickness}mm / ${scenario.result.peakPowerW}W</dd>
          <dt>异常位置</dt><dd>${escapeHtml(scenario.anomalyLocation)}</dd>
        </dl>
      </article>
    `).join('');
  }

  function renderAll(forceLog = false) {
    renderUI();
    renderLog(forceLog);
    renderValidation();
    uiDirty = false;
  }

  function frame(now) {
    const elapsed = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    sim.advance(elapsed);
    renderer.draw(sim, now);
    audio.update(sim);
    if (uiDirty || now - lastUiAt > 120) {
      renderUI();
      lastUiAt = now;
    }
    if (logDirty) {
      renderLog();
      logDirty = false;
    }
    requestAnimationFrame(frame);
  }

  function setParameterFromSlider(key, input, output, unit, fixed) {
    const value = Number(input.value);
    const result = sim.setParameter(key, value, { source: 'operator' });
    if (!result.ok) {
      toast('参数越限', `${limitLabels[key]}已拒绝，当前值 ${result.value} ${unit}`, 'error');
    }
    updateSlider(input, output, result.value, unit, fixed);
    uiDirty = true;
  }

  function handlePrimary() {
    if (sim.fault) {
      const result = sim.recoverEquipment({ source: 'operator' });
      if (result.ok) toast('设备已恢复', `从 ${result.recovery.phase} 继续当前批次`, '');
      uiDirty = true;
      return;
    }
    if (sim.paused) {
      toast('共享时钟已暂停', '先点击“恢复”再继续生产。', 'warn');
      return;
    }
    if (sim.phase === 'complete') {
      const batch = sim.startBatch();
      const started = batch.ok ? sim.beginDip() : batch;
      if (started.ok) toast('新批次已开始', `延续釉池余量，装载 ${sim.currentType.name}`, '');
      else toast('无法开始下一批', started.reason, 'warn');
      return;
    }
    if (sim.phase === 'dip') {
      const result = sim.liftEarly();
      if (result.ok) toast('已提前提起', '进入旋转排釉', '');
      return;
    }
    if (sim.phase === 'idle') {
      const result = sim.beginDip();
      if (!result.ok) toast('无法开始浸釉', result.reason, 'warn');
    }
  }

  function handleFinish() {
    if (sim.phase !== 'drip' || sim.paused || sim.fault) return;
    const finished = sim.finishPiece({ source: 'operator' });
    if (!finished.ok) {
      toast('无法完成当前件', finished.reason, 'warn');
      return;
    }
    if (finished.result.status === 'good') {
      toast('陶器合格', `${finished.result.name} 釉厚 ${finished.result.thickness} mm`, '');
    } else {
      toast('陶器不合格', `${finished.result.name} · ${finished.result.defect}`, 'error');
    }
    if (finished.batchComplete) {
      toast(
        sim.batch.success ? '批次成功' : '批次完成',
        `良品 ${sim.goodCount}/3，良品率 ${formatPercent(sim.yieldRate)}`,
        sim.batch.success ? '' : 'warn'
      );
    }
  }

  function runValidation() {
    if (validating) return;
    validating = true;
    ui.runValidation.disabled = true;
    ui.runValidation.textContent = '运行中…';
    window.setTimeout(() => {
      try {
        const report = window.GlazeVerification.runAll();
        sim.validation = report;
        sim.log(
          'validation',
          `三类流程验收${report.summary.allPassed ? '全部通过' : '存在失败'}：良品 ${report.summary.goodCount}/${report.summary.finishedCount}，综合良品率 ${formatPercent(report.summary.yieldRate)}，异常位置 ${report.summary.anomalyLocations.join('、') || '无'}`,
          {
            level: report.summary.allPassed ? 'success' : 'error',
            device: '验收器',
            data: {
              allPassed: report.summary.allPassed,
              yieldRate: report.summary.yieldRate,
              stopReasons: report.summary.stopReasons,
              anomalyLocations: report.summary.anomalyLocations
            }
          }
        );
        renderValidation();
        toast(
          report.summary.allPassed ? '验收通过' : '验收失败',
          `3 类流程 · 9 件样件 · 良品率 ${formatPercent(report.summary.yieldRate)}`,
          report.summary.allPassed ? '' : 'error'
        );
      } catch (error) {
        toast('验收执行异常', error.message, 'error');
      } finally {
        validating = false;
        ui.runValidation.disabled = false;
        ui.runValidation.textContent = '运行全部验收';
      }
    }, 30);
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function buildCsvReport() {
    const report = sim.buildExport();
    const rows = [
      ['section', 'key', 'value'],
      ['summary', 'batch_id', report.batch ? report.batch.id : 'none'],
      ['summary', 'good_count', report.summary.goodCount],
      ['summary', 'finished_count', report.summary.finishedCount],
      ['summary', 'yield_rate', report.summary.yieldRate],
      ['summary', 'peak_thickness_mm', report.summary.peakThickness],
      ['summary', 'peak_power_w', report.summary.peakPowerW],
      ['summary', 'energy_kwh', report.summary.energyKWh],
      ['summary', 'level_percent', report.summary.level],
      ['summary', 'stop_reasons', report.summary.stopReasons.join(' | ')],
      ['summary', 'status', report.summary.status],
      ['cache', 'storage', report.cache.storage],
      ['cache', 'cleared_on_reload', report.cache.clearedOnReload],
      ['cache', 'count', report.cache.count]
    ];
    for (const piece of report.batch ? report.batch.pieces : []) {
      rows.push(['piece', `${piece.index + 1}-${piece.name}`, `${piece.thickness}mm,${piece.status},${piece.defect || '合格'}`]);
    }
    for (const anomaly of report.anomalyLocations) {
      rows.push(['anomaly', anomaly.location, `t=${anomaly.simTime},value=${anomaly.value},expected=${anomaly.expected}`]);
    }
    if (report.validation) {
      for (const scenario of report.validation.scenarios) {
        rows.push([
          'validation',
          scenario.name,
          `passed=${scenario.passed};trigger=${scenario.triggerAt};reading=${JSON.stringify(scenario.reading)};recovery=${JSON.stringify(scenario.recovery)};good=${scenario.result.goodCount}/${scenario.result.finishedCount};anomaly=${scenario.anomalyLocation}`
        ]);
      }
    }
    for (const event of report.events) {
      rows.push(['event', `${event.simTime}s / ${event.type}`, `${event.device}: ${event.message}`]);
    }
    return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportName(extension) {
    const batchId = sim.batch ? sim.batch.id : 'no-batch';
    const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\..+/, '');
    return `glaze-${batchId}-${stamp}.${extension}`;
  }

  function exportJson() {
    const report = sim.buildExport();
    downloadFile(exportName('json'), JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
    toast('已导出 JSON', `良品 ${report.summary.goodCount} 件 · 峰值釉厚 ${report.summary.peakThickness} mm`, '');
  }

  function exportCsv() {
    const csv = buildCsvReport();
    downloadFile(exportName('csv'), csv, 'text/csv;charset=utf-8');
    toast('已导出 CSV', '包含汇总、陶器、异常、验收与全部事件记录', '');
  }

  function stepOnce() {
    if (!sim.paused) {
      toast('需要先暂停', '共享时钟运行中不能单步。', 'warn');
      return;
    }
    const result = sim.step(0.1);
    if (result.ok) toast('单步完成', `时钟 +0.10s，釉厚 ${sim.thickness.toFixed(3)} mm`, '');
    uiDirty = true;
    logDirty = true;
  }

  function togglePause() {
    if (sim.paused) {
      sim.resume();
      toast('已恢复', '当前批次从冻结的共享时钟继续', '');
    } else {
      sim.pause('操作员暂停检查');
      toast('已暂停', '生产、能耗与内存缓存快照全部冻结', 'warn');
    }
    uiDirty = true;
    logDirty = true;
  }

  function resetBatch() {
    sim.resetBatch({ source: 'operator' });
    uiDirty = true;
    logDirty = true;
    renderAll(true);
    toast('批次已重置', '釉池、能耗、厚度与内存缓存已归零', 'warn');
  }

  sim.subscribe(() => {
    uiDirty = true;
    logDirty = true;
  });

  ui.primary.addEventListener('click', () => {
    handlePrimary();
    uiDirty = true;
    logDirty = true;
  });

  ui.secondary.addEventListener('click', () => {
    handleFinish();
    uiDirty = true;
    logDirty = true;
  });

  ui.soak.addEventListener('input', () => {
    setParameterFromSlider('soakTime', ui.soak, ui.soakOutput, 's', 1);
  });

  ui.rotation.addEventListener('input', () => {
    setParameterFromSlider('rotation', ui.rotation, ui.rotationOutput, 'RPM', 0);
  });

  ui.drip.addEventListener('input', () => {
    setParameterFromSlider('dripSpeed', ui.drip, ui.dripOutput, 'mm/s', 1);
  });

  ui.pause.addEventListener('click', togglePause);
  ui.step.addEventListener('click', stepOnce);
  ui.reset.addEventListener('click', resetBatch);

  ui.refill.addEventListener('click', () => {
    const result = sim.refill(4);
    if (result.ok) toast('已补充釉液', `液位 +${result.amount}%，当前 ${result.level.toFixed(1)}%`, '');
    else toast('无需补液', '釉池已满', 'warn');
    uiDirty = true;
    logDirty = true;
  });

  ui.estop.addEventListener('click', () => {
    const result = sim.emergencyStop('人工设备急停', 'operator');
    if (result.ok) {
      toast('设备已急停', `触发 @${result.fault.at.toFixed(1)}s，当前釉厚 ${result.fault.thickness} mm`, 'error');
    }
    uiDirty = true;
    logDirty = true;
  });

  ui.clearLog.addEventListener('click', () => {
    sim.clearAudit();
    uiDirty = true;
    logDirty = true;
    lastEventSeq = -1;
    renderAll(true);
    toast('记录已清空', '运行中的仿真与内存快照仍保留', 'warn');
  });

  ui.runValidation.addEventListener('click', runValidation);
  ui.exportJson.addEventListener('click', exportJson);
  ui.exportCsv.addEventListener('click', exportCsv);

  ui.audioToggle.addEventListener('click', async () => {
    try {
      const enabled = await audio.toggle();
      ui.audioToggle.setAttribute('aria-pressed', String(enabled));
      ui.audioToggle.title = enabled ? '关闭声音' : '开启声音';
      toast(enabled ? '声音已开启' : '声音已关闭', enabled ? '电机与液流将随仿真状态变化' : '合成音频已静音', '');
    } catch (error) {
      toast('无法开启声音', error.message, 'error');
    }
  });

  ui.helpToggle.addEventListener('click', () => ui.helpDialog.showModal());
  ui.helpClose.addEventListener('click', () => ui.helpDialog.close());
  ui.helpDialog.addEventListener('click', (event) => {
    const rect = ui.helpDialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) ui.helpDialog.close();
  });

  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (ui.helpDialog.open || tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
    } else if (event.key.toLowerCase() === 's' && sim.paused) {
      event.preventDefault();
      stepOnce();
    }
  });

  window.glazeLab = {
    sim,
    renderer,
    audio,
    storagePolicy: 'memory-only',
    runValidation,
    buildJsonReport: () => sim.buildExport(),
    buildCsvReport,
    renderAll
  };

  renderAll(true);
  requestAnimationFrame(frame);
})();

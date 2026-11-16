/* UI wiring for the tape repair workbench. */
(function () {
  const $ = (id) => document.getElementById(id);
  const BANDS = TapeVerify.BANDS;
  let engine = null;
  let params = Object.assign({}, TapeParams.DEFAULTS);
  let lastExport = null;
  let rafPending = false;

  const LABELS = {
    speed: '带速倍率',
    wowDepth: '抖晃深度',
    clickLevel: '咔哒声量',
    noiseLevel: '底噪量',
    deessFreq: '去齿音频率 Hz',
    deessGain: '去齿音增益 dB',
    notchFreq: '陷波频率 Hz',
    notchQ: '陷波 Q 值',
    gateThreshold: '门限阈值 dB',
    outputGain: '输出增益',
  };

  function buildControls() {
    const host = $('controls');
    for (const key of Object.keys(TapeParams.SCHEMA)) {
      const spec = TapeParams.SCHEMA[key];
      const row = document.createElement('label');
      row.className = 'ctl';
      row.innerHTML =
        '<span>' + LABELS[key] + '</span>' +
        '<input type="range" min="' + spec.min + '" max="' + spec.max +
        '" step="' + spec.step + '" data-key="' + key + '">' +
        '<output id="val-' + key + '"></output>';
      host.appendChild(row);
    }
    const gateRow = document.createElement('label');
    gateRow.className = 'ctl';
    gateRow.innerHTML =
      '<span>启用噪声门</span>' +
      '<input type="checkbox" data-key="gateEnabled" style="justify-self:start">' +
      '<output></output>';
    host.appendChild(gateRow);
    host.addEventListener('input', onControlInput);
  }

  function syncControls() {
    for (const key of Object.keys(TapeParams.SCHEMA)) {
      const input = document.querySelector('input[data-key="' + key + '"]');
      const out = $('val-' + key);
      input.value = params[key];
      out.textContent = params[key];
    }
    document.querySelector('input[data-key="gateEnabled"]').checked =
      params.gateEnabled;
  }

  function onControlInput(e) {
    const input = e.target;
    const key = input.dataset.key;
    if (key === 'gateEnabled') {
      params.gateEnabled = input.checked;
    } else {
      params[key] = parseFloat(input.value);
      $('val-' + key).textContent = input.value;
    }
    params.mode = engine ? engine.mode : params.mode;
    if (engine) engine.applyParams(params);
  }

  function updateModeButtons() {
    $('btnMain').classList.toggle('active', params.mode === 'main');
    $('btnBypass').classList.toggle('active', params.mode === 'bypass');
    $('btnMute').classList.toggle('active', params.mode === 'mute');
    const text = { main: '主输出', bypass: '旁路', mute: '静音' };
    $('modeLabel').textContent = '状态: ' + text[params.mode];
  }

  function setMeters(meters) {
    const toDb = (v) => v <= 0.00001 ? -Infinity : 20 * Math.log10(v);
    $('barL').style.width = Math.min(100, meters.peakL * 100) + '%';
    $('barR').style.width = Math.min(100, meters.peakR * 100) + '%';
    $('dbL').textContent = isFinite(toDb(meters.peakL))
      ? toDb(meters.peakL).toFixed(1) + ' dB' : '-∞ dB';
    $('dbR').textContent = isFinite(toDb(meters.peakR))
      ? toDb(meters.peakR).toFixed(1) + ' dB' : '-∞ dB';
  }

  function renderLoop() {
    rafPending = false;
    if (!engine || !engine.ctx) return;
    const analysers = engine.getAnalysers();
    TapeDraw.drawWaveform($('waveCanvas'), analysers.post, engine.mode,
      engine.isPlaying ? engine.readMeters() : null);
    TapeDraw.drawSpectrum($('spectrumCanvas'),
      analysers.pre, analysers.post, engine.mode);
    TapeDraw.drawNodeChain($('chainCanvas'),
      engine.listNodes(), engine.mode, engine.isPlaying);
    requestAnimationFrame(renderLoop);
  }

  function kickRender() {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(renderLoop);
    }
  }

  async function ensureEngine() {
    if (engine) return engine;
    engine = new AudioEngine();
    window.__engine = engine;
    engine.onActive = (count) => {
      $('nodeLabel').textContent = '活动节点: ' + count;
    };
    engine.onPosition = (pos) => {
      const sec = pos / engine.ctx.sampleRate;
      $('timeLabel').textContent =
        '内容位置: ' + sec.toFixed(2) + 's / ' + TapeParams.DURATION_SEC + 's';
    };
    engine.onMeters = setMeters;
    await engine.init(params);
    updateModeButtons();
    kickRender();
    return engine;
  }

  async function handlePlay() {
    const eng = await ensureEngine();
    await eng.play();
  }

  async function handlePause() {
    if (!engine) return;
    engine.pause();
    setMeters({ peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 });
    const silence = await probeSilenceAfterPause();
    $('exportInfo').textContent =
      '暂停后 200ms 采样峰值: ' + silence.peak.toFixed(5) +
      '，AudioContext: ' + silence.ctxState +
      (silence.peak < 1e-6 && silence.ctxState === 'suspended'
        ? '（确认无声音、无尾音）' : '（检测到残留！）');
  }

  async function handleReplay() {
    const eng = await ensureEngine();
    await eng.replay();
  }

  async function handleStep() {
    const eng = await ensureEngine();
    await eng.step();
  }

  function handleRestart() {
    if (!engine) return;
    engine.seekZero();
  }

  async function handleMode(mode) {
    params.mode = mode;
    if (!engine) {
      updateModeButtons();
      return;
    }
    const eng = await ensureEngine();
    eng.setMode(mode);
    updateModeButtons();
  }

  async function probeSilenceAfterPause() {
    const ctxState = engine.ctx.state;
    const rate = engine.ctx.sampleRate;
    const frames = Math.floor(0.25 * rate);
    const ctx = new OfflineAudioContext(2, frames, rate);
    await ctx.audioWorklet.addModule('js/worklet-tape.js');
    const source = new AudioWorkletNode(ctx, 'tape-source', {
      numberOfOutputs: 1, outputChannelCount: [2],
    });
    source.parameters.get('running').value = 0;
    const sink = new GainNode(ctx);
    source.connect(sink);
    sink.connect(ctx.destination);
    const rendered = await ctx.startRendering();
    let peak = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const ch = rendered.getChannelData(c);
      for (let i = 0; i < ch.length; i++) {
        peak = Math.max(peak, Math.abs(ch[i]));
      }
    }
    try { source.disconnect(); sink.disconnect(); } catch (_) { /* gone */ }
    return { peak, ctxState };
  }

  function handleSave() {
    if (engine) params.mode = engine.mode;
    const saved = TapeParams.save(params);
    $('saveInfo').textContent =
      '已保存 ' + Object.keys(saved).length + ' 个参数 @ ' + saved.savedAt;
  }

  async function handleLoad(autoplay) {
    const loaded = TapeParams.load();
    if (!loaded) {
      $('saveInfo').textContent = '没有已保存的参数';
      return null;
    }
    params = loaded.params;
    syncControls();
    updateModeButtons();
    $('saveInfo').textContent =
      '已重载保存于 ' + (loaded.savedAt || '未知时间') + ' 的参数';
    const eng = await ensureEngine();
    eng.applyParams(params);
    if (autoplay) await eng.replay();
    return params;
  }

  function handleReset() {
    params = Object.assign({}, TapeParams.DEFAULTS);
    syncControls();
    updateModeButtons();
    if (engine) engine.applyParams(params);
  }

  async function exportCurrent(label) {
    if (engine) params.mode = engine.mode;
    const render = await AudioEngine.renderOffline(
      params, TapeParams.DURATION_SEC, 48000);
    const summary = AudioMetrics.summarize(
      render.channels, render.sampleRate, BANDS);
    if (summary.clippedSamples > 0 || summary.peak >= 0.9999) {
      $('exportInfo').innerHTML =
        '<span class="fail">导出被阻止：检测到 ' +
        summary.clippedSamples + ' 个削波样本，峰值 ' +
        summary.peak.toFixed(4) + '。请降低输出增益。</span>';
      return { blocked: true, summary, render };
    }
    const wav = WavCodec.encodeWav(render.channels, render.sampleRate);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const link = $('downloadLink');
    link.href = url;
    link.download = 'tape-repair-' + label + '.wav';
    link.textContent = '下载 ' + link.download;
    link.classList.remove('hidden');
    $('exportInfo').innerHTML =
      '<span class="pass">导出成功</span>：' +
      summary.durationSec.toFixed(3) + 's，' +
      render.channels.length + ' 声道，L 峰值 ' +
      summary.peaks[0].toFixed(4) + ' / R 峰值 ' +
      summary.peaks[1].toFixed(4) + '，大小 ' +
      (blob.size / 1024).toFixed(1) + ' KB';
    return { blocked: false, summary, render, wav };
  }

  function renderCompareTable(compare, first, second) {
    const rows = compare.checks.map((c) =>
      '<tr><td>' + c.name + '</td><td class="' +
      (c.passed ? 'pass' : 'fail') + '">' +
      (c.passed ? '通过' : '失败') + '</td><td>' + c.detail + '</td></tr>')
      .join('');
    $('exportCompare').innerHTML =
      '<table><thead><tr><th>对比项</th><th>结果</th><th>数值</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="hint">首次导出时长 ' + first.durationSec.toFixed(3) +
      's，重载后 ' + second.durationSec.toFixed(3) + 's</p>';
  }

  async function handleExport() {
    const result = await exportCurrent('current');
    if (result && !result.blocked) lastExport = result;
  }

  async function handleExportReload() {
    const first = lastExport;
    if (!first) {
      $('exportInfo').textContent = '请先完成一次成功导出，再执行重载对比。';
      return;
    }
    const reloaded = await handleLoad(false);
    if (!reloaded) return;
    const second = await exportCurrent('reloaded');
    if (!second || second.blocked) return;
    const compare = TapeVerify.compareExports(
      first.summary, second.summary);
    renderCompareTable(compare, first.summary, second.summary);
    if (engine) await engine.replay();
  }

  async function handleVerify() {
    $('verifyResults').innerHTML = '<p class="hint">离线渲染中，请稍候…</p>';
    const probeEngine = new AudioEngine();
    await probeEngine.init(params);
    const beforeCount = probeEngine.activeCount;
    await probeEngine.teardown();
    const leakProbe = () => probeEngine.activeCount;
    const report = await TapeVerify.runSuite(
      params, TapeParams.DURATION_SEC, 48000, leakProbe);
    const rows = report.checks.map((c) =>
      '<tr><td>' + c.name + '</td><td class="' +
      (c.passed ? 'pass' : 'fail') + '">' +
      (c.passed ? '通过' : '失败') + '</td><td>' + c.detail + '</td></tr>')
      .join('');
    $('verifyResults').innerHTML =
      '<table><thead><tr><th>验证维度</th><th>结果</th><th>测量值</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></tbody></table>' +
      '<p class="hint">验证用引擎建图 ' + beforeCount +
      ' 个节点，拆除后 ' + probeEngine.activeCount +
      ' 个；基准节拍均值 ' +
      report.baseline.beat.mean.toFixed(3) + 's，0.75x 时 ' +
      report.slower.beat.mean.toFixed(3) + 's</p>';
  }

  function bind() {
    $('btnPlay').addEventListener('click', handlePlay);
    $('btnPause').addEventListener('click', handlePause);
    $('btnReplay').addEventListener('click', handleReplay);
    $('btnStep').addEventListener('click', handleStep);
    $('btnRestart').addEventListener('click', handleRestart);
    $('btnMain').addEventListener('click', () => handleMode('main'));
    $('btnBypass').addEventListener('click', () => handleMode('bypass'));
    $('btnMute').addEventListener('click', () => handleMode('mute'));
    $('btnSave').addEventListener('click', handleSave);
    $('btnLoad').addEventListener('click', () => handleLoad(true));
    $('btnReset').addEventListener('click', handleReset);
    $('btnExport').addEventListener('click', handleExport);
    $('btnExportReload').addEventListener('click', handleExportReload);
    $('btnVerify').addEventListener('click', handleVerify);
  }

  buildControls();
  syncControls();
  updateModeButtons();
  bind();
})();

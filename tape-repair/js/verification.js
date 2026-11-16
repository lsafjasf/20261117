/* Browser-side verification suite driven by offline renders. */
(function (root) {
  const BANDS = {
    low: [60, 250],
    mid: [400, 1600],
    high: [5000, 10000],
    notch: [2800, 3800],
  };

  function cloneParams(base, patch) {
    return Object.assign({}, base, patch);
  }

  async function render(base, patch, duration, rate) {
    const params = cloneParams(base, patch);
    const result = await root.AudioEngine.renderOffline(params, duration, rate);
    const summary = root.AudioMetrics.summarize(result.channels, result.sampleRate, BANDS);
    return { result, summary, params };
  }

  function check(name, passed, detail) {
    return { name, passed: !!passed, detail };
  }

  async function runSuite(baseParams, durationSec, rate, teardownProbe) {
    const checks = [];

    const baseline = await render(baseParams, {}, durationSec, rate);
    const slower = await render(baseParams, { speed: 0.75 }, durationSec, rate);
    const repaired = await render(baseParams, {
      deessGain: -20, notchQ: 25, gateThreshold: -35, noiseLevel: 0.02,
    }, durationSec, rate);
    const gated = await render(baseParams, {
      gateEnabled: false, noiseLevel: 0.3,
    }, durationSec, rate);

    const bandDelta =
      Math.abs(repaired.summary.bands.high - baseline.summary.bands.high) /
      (baseline.summary.bands.high + 1e-12);
    checks.push(check('频段随陷波/去齿音变化',
      bandDelta > 0.15,
      '高频能量相对变化 ' + (bandDelta * 100).toFixed(1) + '%'));

    const baseMean = baseline.summary.beat.mean;
    const slowMean = slower.summary.beat.mean;
    checks.push(check('节拍间隔随带速变化',
      baseMean > 0 && slowMean > 0 &&
      Math.abs(slowMean / baseMean - 1 / 0.75) < 0.12,
      '基准 ' + baseMean.toFixed(3) + 's → 0.75x ' + slowMean.toFixed(3) + 's'));

    const balanceDelta = Math.abs(
      baseline.summary.balance.diff - gated.summary.balance.diff);
    checks.push(check('左右声道存在差异且随处理变化',
      baseline.summary.balance.diff > 0.001 && balanceDelta > 1e-5,
      '声道差 ' + baseline.summary.balance.diff.toFixed(4) +
      '，处理后变化 ' + balanceDelta.toFixed(5)));

    const drift = baseline.summary.beat.maxDriftSec;
    checks.push(check('节拍无漂移',
      drift !== null && drift < 0.02,
      '最大间隔偏差 ' + (drift === null ? 'N/A' : drift.toFixed(4) + 's')));

    const loud = await render(baseParams, { outputGain: 1.5 }, durationSec, rate);
    checks.push(check('削波样本可被检出并阻止导出',
      loud.summary.clippedSamples > 0,
      '增益 1.5 时削波样本 ' + loud.summary.clippedSamples + ' 个，峰值 ' +
      loud.summary.peak.toFixed(3)));

    checks.push(check('修复后无削波',
      baseline.summary.clippedSamples === 0,
      '默认参数削波样本 ' + baseline.summary.clippedSamples + ' 个'));

    const wav = root.WavCodec.encodeWav(
      baseline.result.channels, baseline.result.sampleRate);
    const reloaded = root.WavCodec.decodeWav(wav);
    const reSummary = root.AudioMetrics.summarize(
      reloaded.channels, reloaded.sampleRate, BANDS);
    const lenOk = reloaded.channels.length === 2 &&
      Math.abs(reSummary.durationSec - baseline.summary.durationSec) < 0.002;
    const peakErr = Math.abs(reSummary.peak - baseline.summary.peak);
    checks.push(check('WAV 导出/回读：时长、声道、峰值',
      lenOk && peakErr < 0.002,
      '时长 ' + reSummary.durationSec.toFixed(3) + 's，声道 ' +
      reloaded.channels.length + '，峰值误差 ' + peakErr.toFixed(5)));

    const leak = teardownProbe ? teardownProbe() : null;
    checks.push(check('拆除后无未关闭节点',
      leak !== null && leak === 0,
      '剩余活动节点 ' + (leak === null ? 'N/A' : leak)));

    return {
      checks,
      passed: checks.every((c) => c.passed),
      baseline: baseline.summary,
      repaired: repaired.summary,
      slower: slower.summary,
      loud: loud.summary,
      reloaded: reSummary,
    };
  }

  function compareExports(first, second, tolerance) {
    const tol = tolerance || { duration: 0.002, peak: 0.002, balance: 0.01 };
    const checks = [];
    checks.push(check('两次导出时长一致',
      Math.abs(first.durationSec - second.durationSec) <= tol.duration,
      first.durationSec.toFixed(4) + 's vs ' + second.durationSec.toFixed(4) + 's'));
    checks.push(check('两次导出声道数一致',
      first.channels === second.channels,
      first.channels + ' vs ' + second.channels));
    const peakDelta = Math.abs(first.peak - second.peak);
    checks.push(check('两次导出关键峰值一致',
      peakDelta <= tol.peak,
      '峰值差 ' + peakDelta.toFixed(5)));
    const lDelta = Math.abs(first.peaks[0] - second.peaks[0]);
    const rDelta = Math.abs(first.peaks[1] - second.peaks[1]);
    checks.push(check('左右声道峰值分别一致',
      lDelta <= tol.peak && rDelta <= tol.peak,
      'L 差 ' + lDelta.toFixed(5) + '，R 差 ' + rDelta.toFixed(5)));
    const balDelta = Math.abs(first.balance.diff - second.balance.diff);
    checks.push(check('左右声道平衡一致',
      balDelta <= tol.balance,
      '平衡差 ' + balDelta.toFixed(5)));
    return {
      checks,
      passed: checks.every((c) => c.passed),
    };
  }

  root.TapeVerify = { runSuite, compareExports, BANDS };
})(typeof self !== 'undefined' ? self : globalThis);

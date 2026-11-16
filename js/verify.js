/* 导出 WAV 与自动化验证:时长/声道/峰值/频段/节拍漂移/尾音/节点关闭/重载一致性。 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let verifyRunning = false;

async function exportWAV() {
  log('离线渲染 20s 立体声混音...');
  const { buffer, peak, normalized } = await Exporter.renderOffline(project, engine.masterGainValue);
  const m = Exporter.analyzeBuffer(buffer);
  const blob = Exporter.encodeWAV(buffer);
  Exporter.download(blob, 'mix-20s.wav');
  log(`导出完成: 时长=${m.duration.toFixed(3)}s 声道=${m.channels} 采样率=${m.sampleRate}Hz ` +
      `峰值=${peak.toFixed(3)}${normalized ? '(已归一化防削波)' : ''} 文件=${(blob.size / 1024).toFixed(0)}KB`, 'pass');
  log(`L 峰值=${m.peakL.toFixed(3)} R 峰值=${m.peakR.toFixed(3)} ` +
      `频段能量 低=${m.bandLow.toFixed(4)} 中=${m.bandMid.toFixed(4)} 高=${m.bandHigh.toFixed(4)}`);
  const cols = 600, L = buffer.getChannelData(0), peaks = new Float32Array(cols);
  for (let i = 0; i < L.length; i++) {
    const c = Math.floor(i / L.length * cols), a = Math.abs(L[i]);
    if (a > peaks[c]) peaks[c] = a;
  }
  Timeline.setWaveform(peaks);
  return m;
}

function check(results, name, ok, detail) {
  results.push(ok);
  log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`, ok ? 'pass' : 'fail');
}

async function runVerify() {
  if (verifyRunning) return;
  verifyRunning = true;
  const R = [];
  log('──────── 开始验证 ────────');
  try {
    engine.stop();
    check(R, '停止后无未关闭片段节点', engine.clipGraphs.length === 0,
      `残留图=${engine.clipGraphs.length}`);

    saveProject();
    const solo = type => ({ clips: project.clips.filter(c => c.type === type) });

    // A. 完整混音渲染
    const ra = await Exporter.renderOffline(project, engine.masterGainValue);
    const A = Exporter.analyzeBuffer(ra.buffer);
    check(R, '时长 = 20s', Math.abs(A.duration - 20) < 1 / A.sampleRate, `${A.duration.toFixed(4)}s`);
    check(R, '立体声双声道', A.channels === 2, `channels=${A.channels}`);
    check(R, '无削波 (峰值 ≤ 0.98)', ra.peak <= 0.98 + 1e-6, `peak=${ra.peak.toFixed(4)}`);
    check(R, '维度1·左右声道真实变化', Math.abs(A.peakL - A.peakR) > 1e-4,
      `peakL=${A.peakL.toFixed(4)} peakR=${A.peakR.toFixed(4)} Δ=${Math.abs(A.peakL - A.peakR).toFixed(4)}`);
    const bands = [A.bandLow, A.bandMid, A.bandHigh];
    check(R, '维度2·频段能量分布真实变化',
      bands.every(b => b > 1e-4) && new Set(bands.map(b => b.toFixed(3))).size === 3,
      `低=${A.bandLow.toFixed(4)} 中=${A.bandMid.toFixed(4)} 高=${A.bandHigh.toFixed(4)}`);
    check(R, '无尾音 (末尾 50ms 静音)', A.tailRms < 1e-3, `tailRms=${A.tailRms.toExponential(2)}`);

    // B. 节拍维度:脚步与机械独奏渲染,测起点间隔漂移
    const fs = project.clips.find(c => c.type === 'footsteps');
    const mc = project.clips.find(c => c.type === 'mechanical');
    const rFs = await Exporter.renderOffline(solo('footsteps'), 1);
    const onFs = Exporter.detectOnsets(rFs.buffer, 0.4 / fs.params.tempo);
    const dFs = Exporter.beatDrift(onFs, 1 / fs.params.tempo);
    check(R, '维度3·脚步节拍无漂移', dFs.drift !== null && dFs.drift < 0.03,
      `期望间隔=${(1 / fs.params.tempo).toFixed(3)}s 实测=${dFs.meanInterval?.toFixed(3)}s 最大漂移=${(dFs.drift * 1000)?.toFixed(1)}ms`);
    const rMc = await Exporter.renderOffline(solo('mechanical'), 1);
    const onMc = Exporter.detectOnsets(rMc.buffer, 0.05);
    const dMc = Exporter.beatDrift(onMc, 60 / mc.params.bpm / 4);
    check(R, '维度3·机械节拍无漂移', dMc.drift !== null && dMc.drift < 0.03,
      `期望间隔=${(60 / mc.params.bpm / 4).toFixed(3)}s 实测=${dMc.meanInterval?.toFixed(3)}s 最大漂移=${(dMc.drift * 1000)?.toFixed(1)}ms`);

    // C. 参数重载后再次导出,逐指标比较
    reloadProject();
    const rb = await Exporter.renderOffline(project, engine.masterGainValue);
    const B = Exporter.analyzeBuffer(rb.buffer);
    check(R, '重载后时长一致', Math.abs(A.duration - B.duration) < 1e-6,
      `${A.duration.toFixed(4)}s vs ${B.duration.toFixed(4)}s`);
    check(R, '重载后峰值一致', Math.abs(A.peakL - B.peakL) < 1e-4 && Math.abs(A.peakR - B.peakR) < 1e-4,
      `ΔL=${Math.abs(A.peakL - B.peakL).toExponential(1)} ΔR=${Math.abs(A.peakR - B.peakR).toExponential(1)}`);
    check(R, '重载后左右声道 RMS 一致',
      Math.abs(A.rmsL - B.rmsL) < 1e-4 && Math.abs(A.rmsR - B.rmsR) < 1e-4,
      `ΔrmsL=${Math.abs(A.rmsL - B.rmsL).toExponential(1)} ΔrmsR=${Math.abs(A.rmsR - B.rmsR).toExponential(1)}`);

    // D. 重载后再实时播放一次:节点生命周期与暂停静音
    engine.replay(project);
    await sleep(1200);
    check(R, '重载后实时播放节点已建立', engine.state === 'playing' && engine.activeNodeCount() > 9,
      `活动节点=${engine.activeNodeCount()}`);
    engine.pause();
    await sleep(100);
    const lv = engine.levels();
    check(R, '暂停后声音停止且节点全部关闭',
      engine.clipGraphs.length === 0 && Math.max(lv.l, lv.r) < -50,
      `残留图=${engine.clipGraphs.length} 电平 L=${lv.l.toFixed(1)}dB R=${lv.r.toFixed(1)}dB`);
    engine.stop();
  } catch (e) {
    log('验证异常: ' + e.message, 'fail');
    R.push(false);
  }
  const passed = R.filter(Boolean).length;
  log(`──────── 验证结束: ${passed}/${R.length} 通过 ────────`, passed === R.length ? 'pass' : 'fail');
  verifyRunning = false;
}

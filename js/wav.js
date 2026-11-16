// WAV (PCM16) 编码与缓冲分析，纯函数，可在 Node 下测试。

export function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

// 提取可比较的关键指标：时长、声道、每声道峰值/RMS、左右峰值比。
export function analyzeBuffer(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const perChannel = [];
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    let peak = 0;
    let sumSq = 0;
    let peakIndex = 0;
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) { peak = abs; peakIndex = i; }
      sumSq += data[i] * data[i];
    }
    perChannel.push({
      peak: round(peak),
      peakTimeMs: Math.round((peakIndex / audioBuffer.sampleRate) * 1000),
      rms: round(Math.sqrt(sumSq / data.length)),
    });
  }
  const result = {
    durationMs: Math.round(audioBuffer.duration * 1000),
    sampleRate: audioBuffer.sampleRate,
    channels,
    perChannel,
  };
  if (channels >= 2) {
    result.leftRightPeakDelta = round(Math.abs(perChannel[0].peak - perChannel[1].peak));
    result.leftRightRmsDelta = round(Math.abs(perChannel[0].rms - perChannel[1].rms));
  }
  return result;
}

// 对比两次导出：时长与声道必须一致，关键峰值差异按容差报告。
export function compareMetrics(a, b, tolerance = 1e-3) {
  const rows = [];
  rows.push({
    metric: '时长(ms)',
    a: a.durationMs, b: b.durationMs,
    pass: a.durationMs === b.durationMs,
  });
  rows.push({
    metric: '声道数',
    a: a.channels, b: b.channels,
    pass: a.channels === b.channels,
  });
  const common = Math.min(a.perChannel.length, b.perChannel.length);
  for (let c = 0; c < common; c++) {
    const delta = Math.abs(a.perChannel[c].peak - b.perChannel[c].peak);
    rows.push({
      metric: `CH${c + 1} 峰值`,
      a: a.perChannel[c].peak, b: b.perChannel[c].peak,
      pass: delta <= tolerance,
    });
  }
  if (a.leftRightPeakDelta !== undefined && b.leftRightPeakDelta !== undefined) {
    rows.push({
      metric: '左右峰值差',
      a: a.leftRightPeakDelta, b: b.leftRightPeakDelta,
      pass: Math.abs(a.leftRightPeakDelta - b.leftRightPeakDelta) <= tolerance,
    });
  }
  return { rows, allPass: rows.every((r) => r.pass) };
}

function round(v) {
  return Math.round(v * 1e6) / 1e6;
}

// Node 测试用：由交错 Float32 数组构造类 AudioBuffer 对象。
export function makeFakeBuffer(channelCount, sampleRate, interleaved) {
  const length = Math.floor(interleaved.length / channelCount);
  const channels = [];
  for (let c = 0; c < channelCount; c++) {
    channels.push(new Float32Array(length));
    for (let i = 0; i < length; i++) channels[c][i] = interleaved[i * channelCount + c];
  }
  return {
    numberOfChannels: channelCount,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData(c) { return channels[c]; },
  };
}

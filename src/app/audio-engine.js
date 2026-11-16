// Web Audio 引擎：所有声音事件以时间线毫秒为唯一基准，
// 播放/暂停/拖动/循环都由外部同一播放头驱动，保证音画对齐。
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.active = new Map(); // eventId -> { osc, gain }
    this.horizonMs = 1500;   // 前瞻调度窗口
  }

  ensureContext() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  suspend() {
    this.stopAll(0);
    if (this.ctx) this.ctx.suspend();
  }

  // currentMs：当前播放头；events：本窗口内的音频事件；playing：是否在播。
  update(currentMs, events, playing) {
    if (!playing || !this.ctx) {
      this.stopAll(0);
      return;
    }
    const now = this.ctx.currentTime;
    for (const ev of events) {
      const startMs = ev.atMs;
      const endMs = ev.atMs + ev.durationMs;
      if (endMs < currentMs || startMs > currentMs + this.horizonMs) continue;
      if (this.active.has(ev.id)) continue;
      const offset = Math.max(0, currentMs - startMs) / 1000;
      const when = Math.max(now, now + (startMs - currentMs) / 1000);
      const dur = (endMs - Math.max(currentMs, startMs)) / 1000;
      this._start(ev, when, dur, offset);
    }
    for (const [id, node] of this.active) {
      const ev = events.find((e) => e.id === id);
      if (!ev || ev.atMs + ev.durationMs < currentMs) this._stopNode(id, node, now);
    }
  }

  _start(ev, when, dur, offset) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = ev.wave || 'sine';
    osc.frequency.value = ev.freq;
    const peak = ev.gain ?? 0.2;
    const fadeIn = (ev.fadeInMs ?? 80) / 1000;
    const fadeOut = (ev.fadeOutMs ?? 160) / 1000;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + Math.min(fadeIn, dur));
    gain.gain.setValueAtTime(peak, Math.max(when, when + dur - fadeOut));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain).connect(this.master);
    osc.start(when, offset);
    osc.stop(when + dur + 0.02);
    const node = { osc, gain };
    osc.onended = () => this.active.delete(ev.id);
    this.active.set(ev.id, node);
  }

  _stopNode(id, node, now) {
    try {
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setTargetAtTime(0.0001, now, 0.02);
      node.osc.stop(now + 0.08);
    } catch { /* 已停止 */ }
    this.active.delete(id);
  }

  stopAll(fadeSec = 0.05) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [id, node] of this.active) this._stopNode(id, node, now + fadeSec);
    this.active.clear();
  }

  // 导出时离屏渲染音频（离线上下文），生成与视频同长度的 WAV。
  async renderOffline(durationMs, events) {
    const sampleRate = 48000;
    const length = Math.ceil((durationMs / 1000) * sampleRate);
    const offline = new OfflineAudioContext(2, length, sampleRate);
    const master = offline.createGain();
    master.gain.value = 0.9;
    master.connect(offline.destination);
    for (const ev of events) {
      const osc = offline.createOscillator();
      const gain = offline.createGain();
      osc.type = ev.wave || 'sine';
      osc.frequency.value = ev.freq;
      const peak = ev.gain ?? 0.2;
      const start = ev.atMs / 1000;
      const dur = ev.durationMs / 1000;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + (ev.fadeInMs ?? 80) / 1000);
      gain.gain.setValueAtTime(peak, start + dur - (ev.fadeOutMs ?? 160) / 1000);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
    const buffer = await offline.startRendering();
    return audioBufferToWav(buffer);
  }
}

function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  const channels = Array.from({ length: numCh }, (_, c) => buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

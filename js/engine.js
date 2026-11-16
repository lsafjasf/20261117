/* 播放引擎:负责实时图构建、暂停/重播/单步、监听状态与节点生命周期。
 * 暂停/停止时关闭并断开全部节点,保证无未关闭节点与尾音。 */
const TIMELINE_LEN = 20;

class Engine {
  constructor() {
    this.ctx = null;
    this.state = 'stopped'; // stopped | playing | paused
    this.offset = 0;        // 播放头位置(秒)
    this.t0 = 0;            // ctx 时间轴上 timeline 0 对应时刻
    this.monitor = 'main';  // main | bypass | mute
    this.masterGainValue = 0.9;
    this.clipGraphs = [];
    this._stepTimer = null;
  }

  ensureCtx() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const c = this.ctx;
    this.clipBus = c.createGain();
    this.monGain = c.createGain();
    this.masterGain = c.createGain();
    this.masterGain.gain.value = this.masterGainValue;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -6; this.comp.ratio.value = 8;
    this.mixOut = c.createGain();
    this.splitter = c.createChannelSplitter(2);
    this.anaL = c.createAnalyser(); this.anaR = c.createAnalyser();
    this.anaL.fftSize = 2048; this.anaR.fftSize = 2048;
    this.clipBus.connect(this.monGain);
    this.mixOut.connect(c.destination);
    this.mixOut.connect(this.splitter);
    this.splitter.connect(this.anaL, 0);
    this.splitter.connect(this.anaR, 1);
    this._routeMonitor();
  }

  _routeMonitor() {
    if (!this.ctx) return;
    this.monGain.disconnect();
    this.masterGain.disconnect();
    this.comp.disconnect();
    if (this.monitor === 'main') {
      this.monGain.gain.value = 1;
      this.masterGain.gain.value = this.masterGainValue;
      this.monGain.connect(this.masterGain);
      this.masterGain.connect(this.comp);
      this.comp.connect(this.mixOut);
    } else if (this.monitor === 'bypass') {
      this.monGain.gain.value = 1;
      this.monGain.connect(this.mixOut); // 跳过主增益与压缩器
    } else { // mute
      this.monGain.gain.value = 0;
      this.monGain.connect(this.mixOut);
    }
  }

  setMonitor(mode) { this.monitor = mode; this._routeMonitor(); }
  setMasterGain(v) {
    this.masterGainValue = v;
    if (this.ctx && this.monitor === 'main') this.masterGain.gain.value = v;
  }

  _buildGraphs(project, fromOffset) {
    const t0 = this.ctx.currentTime + 0.08 - fromOffset;
    this.t0 = t0;
    Synths.resetRandom(20261117);
    this.clipGraphs = project.clips.map(clip => {
      const g = Synths[clip.type](this.ctx, clip, this.clipBus, t0);
      g.clip = clip;
      return g;
    });
  }

  _teardown() {
    for (const g of this.clipGraphs) {
      for (const s of g.sources) { try { s.stop(); } catch (e) { /* 已停止 */ } }
      for (const n of g.nodes) { try { n.disconnect(); } catch (e) { /* 已断开 */ } }
    }
    this.clipGraphs = [];
  }

  activeNodeCount() {
    let n = this.clipGraphs.reduce((a, g) => a + g.nodes.length, 0);
    return this.ctx ? n + 9 : 0; // 9 = 主链固定节点
  }

  play(project, fromOffset = this.offset) {
    this.ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._teardown();
    if (this._stepTimer) { clearTimeout(this._stepTimer); this._stepTimer = null; }
    this.offset = Math.min(Math.max(0, fromOffset), TIMELINE_LEN);
    this._buildGraphs(project, this.offset);
    this.state = 'playing';
  }

  pause() {
    if (this.state !== 'playing') return;
    this.offset = Math.min(Math.max(0, this.ctx.currentTime - this.t0), TIMELINE_LEN);
    this._teardown(); // 立即关闭所有声源,声音必须停止
    this.state = 'paused';
  }

  stop() {
    if (this._stepTimer) { clearTimeout(this._stepTimer); this._stepTimer = null; }
    if (this.ctx) this._teardown();
    this.offset = 0;
    this.state = 'stopped';
  }

  replay(project) { this.stop(); this.play(project, 0); }

  step(project, stepSize) {
    if (this.state === 'playing') this.pause();
    if (this.offset >= TIMELINE_LEN) this.offset = 0;
    this.play(project, this.offset);
    this._stepTimer = setTimeout(() => { this._stepTimer = null; this.pause(); }, stepSize * 1000);
  }

  playhead() {
    if (this.state === 'playing' && this.ctx)
      return Math.min(Math.max(0, this.ctx.currentTime - this.t0), TIMELINE_LEN);
    return this.offset;
  }

  levels() {
    if (!this.ctx) return { l: -Infinity, r: -Infinity };
    const buf = new Float32Array(this.anaL.fftSize);
    const rms = a => {
      a.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const v = Math.sqrt(s / buf.length);
      return v > 1e-6 ? 20 * Math.log10(v) : -Infinity;
    };
    return { l: rms(this.anaL), r: rms(this.anaR) };
  }
}

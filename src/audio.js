// 纯 Web Audio 合成：磨轮声随压力/进给变化，冷却水用滤波噪声表示。
// 浏览器中按需创建；AudioContext 必须在用户手势后恢复。
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.wheelOsc = null;
    this.wheelGain = null;
    this.waterSrc = null;
    this.waterGain = null;
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    this.wheelOsc = this.ctx.createOscillator();
    this.wheelOsc.type = 'sawtooth';
    this.wheelOsc.frequency.value = 90;
    const wheelFilter = this.ctx.createBiquadFilter();
    wheelFilter.type = 'lowpass';
    wheelFilter.frequency.value = 600;
    this.wheelGain = this.ctx.createGain();
    this.wheelGain.gain.value = 0;
    this.wheelOsc.connect(wheelFilter).connect(this.wheelGain).connect(this.master);
    this.wheelOsc.start();

    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.waterSrc = this.ctx.createBufferSource();
    this.waterSrc.buffer = buffer;
    this.waterSrc.loop = true;
    const waterFilter = this.ctx.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 1400;
    this.waterGain = this.ctx.createGain();
    this.waterGain.gain.value = 0;
    this.waterSrc.connect(waterFilter).connect(this.waterGain).connect(this.master);
    this.waterSrc.start();
  }

  resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 由渲染循环每帧调用：running 才出声，参数决定音高/音量
  update(running, params, heat) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (running) {
      const freq = 70 + params.pressure * 1.6 + params.feed * 3;
      this.wheelOsc.frequency.setTargetAtTime(freq, t, 0.08);
      this.wheelGain.gain.setTargetAtTime(0.12 + params.pressure / 400, t, 0.1);
      this.waterGain.gain.setTargetAtTime(Math.min(0.16, params.coolant * 0.02), t, 0.15);
    } else {
      this.wheelGain.gain.setTargetAtTime(0, t, 0.12);
      this.waterGain.gain.setTargetAtTime(0, t, 0.15);
    }
    // 高温时叠加轻微警示颤音
    this.wheelOsc.detune.setTargetAtTime(heat > 100 ? (heat - 100) * 4 : 0, t, 0.2);
  }

  blip(freq = 440, duration = 0.08) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }
}

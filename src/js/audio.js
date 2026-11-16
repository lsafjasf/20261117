// Lightweight generative ambience: filtered noise "wind" with a slow LFO
// plus one quiet warm drone. No samples, no network assets.
export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.nodes = [];
    this.playing = false;
    this.volume = 0.35;
  }

  async start() {
    if (this.playing) return;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) throw new Error('当前浏览器不支持 Web Audio API');
    if (!this.ctx) this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    // ~3 seconds of looping noise buffer.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 987654321;
    for (let i = 0; i < data.length; i += 1) {
      state = (Math.imul(state, 1103515245) + 12345) | 0;
      data[i] = (state & 65535) / 32768 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    filter.Q.value = 0.7;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(filter.frequency);

    const windGain = ctx.createGain();
    windGain.gain.value = 0.5;
    noise.connect(filter).connect(windGain).connect(this.master);

    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 110;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    drone.connect(droneGain).connect(this.master);

    noise.start();
    lfo.start();
    drone.start();
    this.nodes = [noise, lfo, drone];
    this.playing = true;
  }

  setVolume(value) {
    this.volume = value;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.1);
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend();
    return Promise.resolve();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume();
    return Promise.resolve();
  }

  stop() {
    if (!this.playing) return;
    for (const node of this.nodes) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    this.nodes = [];
    if (this.master) {
      this.master.disconnect();
      this.master = null;
    }
    this.playing = false;
  }
}

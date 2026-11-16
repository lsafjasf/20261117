export class GreenhouseSound {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.state = { fan: false, mist: false };
    this.master = null;
    this.fanGain = null;
    this.mistGain = null;
    this.fanFilter = null;
  }

  createNoiseSource(context) {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  async start() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      const context = new AudioContextClass();
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = 0;
      this.master.connect(context.destination);

      const noise = this.createNoiseSource(context);
      this.fanFilter = context.createBiquadFilter();
      this.fanFilter.type = "lowpass";
      this.fanFilter.frequency.value = 180;
      this.fanFilter.Q.value = 0.7;
      this.fanGain = context.createGain();
      this.fanGain.gain.value = 0;
      noise.connect(this.fanFilter);
      this.fanFilter.connect(this.fanGain);
      this.fanGain.connect(this.master);

      const fanHum = context.createOscillator();
      const fanHumGain = context.createGain();
      fanHum.type = "sine";
      fanHum.frequency.value = 56;
      fanHumGain.gain.value = 0.012;
      fanHum.connect(fanHumGain);
      fanHumGain.connect(this.fanGain);
      fanHum.start();

      const mistNoise = this.createNoiseSource(context);
      const mistFilter = context.createBiquadFilter();
      mistFilter.type = "bandpass";
      mistFilter.frequency.value = 2100;
      mistFilter.Q.value = 0.35;
      this.mistGain = context.createGain();
      this.mistGain.gain.value = 0;
      mistNoise.connect(mistFilter);
      mistFilter.connect(this.mistGain);
      this.mistGain.connect(this.master);

      noise.start();
      mistNoise.start();
    }
    await this.context.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(0.8, this.context.currentTime, 0.18);
    this.applyState();
    return true;
  }

  async toggle() {
    if (this.enabled) {
      this.enabled = false;
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
      return false;
    }
    return this.start();
  }

  applyState() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.fanGain.gain.setTargetAtTime(this.state.fan && this.enabled ? 0.085 : 0, now, 0.16);
    this.mistGain.gain.setTargetAtTime(this.state.mist && this.enabled ? 0.028 : 0, now, 0.12);
    this.fanFilter.frequency.setTargetAtTime(this.state.fan ? 260 : 120, now, 0.2);
  }

  update(controls) {
    if (controls.fan === this.state.fan && controls.mist === this.state.mist) return;
    this.state = { fan: controls.fan, mist: controls.mist };
    this.applyState();
  }

  alert() {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(620, now);
    oscillator.frequency.exponentialRampToValueAtTime(410, now + 0.55);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.72);
  }
}

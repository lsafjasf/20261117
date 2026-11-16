export class PlantAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.master = null;
    this.noiseGain = null;
    this.noiseFilter = null;
    this.mixerOscillator = null;
    this.mixerGain = null;
  }

  async toggle() {
    if (!this.enabled) {
      await this._ensure();
      this.enabled = true;
      if (this.context?.state === "suspended") await this.context.resume();
    } else {
      this.enabled = false;
      this._silence();
    }
    return this.enabled;
  }

  async _ensure() {
    if (this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("当前浏览器不支持 WebAudio");
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(this.context.destination);

    const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.87 + white * 0.13;
      samples[index] = last;
    }
    const noise = this.context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.noiseFilter = this.context.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.Q.value = 0.8;
    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = 0.0001;
    noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    noise.start();

    this.mixerOscillator = this.context.createOscillator();
    this.mixerOscillator.type = "sawtooth";
    this.mixerOscillator.frequency.value = 52;
    this.mixerGain = this.context.createGain();
    this.mixerGain.gain.value = 0.0001;
    const lowpass = this.context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 150;
    this.mixerOscillator.connect(lowpass).connect(this.mixerGain).connect(this.master);
    this.mixerOscillator.start();
  }

  update(sim) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const totalActual = sim.screws.reduce((sum, screw) => sum + screw.actual, 0);
    const screwEnergy = Math.min(1, totalActual / 170);
    const paused = sim.paused || sim.phase === "stopped";
    const targetGain = paused ? 0.0001 : 0.12;
    this.master.gain.setTargetAtTime(targetGain, now, 0.05);
    this.noiseGain.gain.setTargetAtTime(paused ? 0.0001 : 0.035 + screwEnergy * 0.24, now, 0.08);
    this.noiseFilter.frequency.setTargetAtTime(220 + screwEnergy * 760, now, 0.08);
    this.mixerGain.gain.setTargetAtTime(paused || !sim.mixer.on ? 0.0001 : 0.035, now, 0.1);
    this.mixerOscillator.frequency.setTargetAtTime(48 + (sim.mixer.on ? 4 : 0), now, 0.1);
  }

  _silence() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(0.0001, now, 0.04);
    this.noiseGain.gain.setTargetAtTime(0.0001, now, 0.04);
    this.mixerGain.gain.setTargetAtTime(0.0001, now, 0.04);
  }
}

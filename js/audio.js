export class MachineAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.master = null;
    this.motor = null;
    this.motorGain = null;
    this.noiseBuffer = null;
    this.lastMachineKey = "";
  }

  async toggle() {
    if (this.enabled) {
      this.enabled = false;
      this.motorGain?.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
      return false;
    }
    if (!this.context && !this.ensureContext()) return false;
    await this.context.resume();
    this.enabled = true;
    this.startMotor();
    return true;
  }

  ensureContext() {
    if (this.context) return true;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.context.destination);
    const length = Math.floor(this.context.sampleRate * 0.35);
    this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return true;
  }

  startMotor() {
    if (!this.context || this.motor) return;
    this.motor = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    this.motorGain = this.context.createGain();
    this.motor.type = "sawtooth";
    this.motor.frequency.value = 42;
    filter.type = "lowpass";
    filter.frequency.value = 180;
    this.motorGain.gain.value = 0.012;
    this.motor.connect(filter);
    filter.connect(this.motorGain);
    this.motorGain.connect(this.master);
    this.motor.start();
  }

  setMachine(mode, speed) {
    if (!this.context || !this.motor) return;
    const key = `${mode}:${speed}:${this.enabled}`;
    if (key === this.lastMachineKey) return;
    this.lastMachineKey = key;
    const running = mode === "running";
    const frequency = 34 + (Number(speed) || 60) * 0.34;
    this.motor.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.12);
    this.motorGain.gain.setTargetAtTime(running && this.enabled ? 0.013 : 0.002, this.context.currentTime, 0.12);
  }

  beat(kind, speed, quality = "ok") {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    const rate = Math.min(140, Math.max(25, Number(speed) || 60));
    if (kind === "glue") {
      this.noise(now, 0.09 + rate / 2400, 0.022, 2200);
      this.tone(now, 720 + rate * 2.4, 0.035, 0.018, "square", 1400);
      return;
    }
    if (kind === "press") {
      this.tone(now, 52 + rate * 0.18, 0.13, 0.09, "sine", 120);
      this.tone(now + 0.015, 150, 0.045, 0.023, "triangle", 420);
      return;
    }
    const base = kind === "feed" ? 190 : 330;
    this.tone(now, base + rate * 1.1, 0.035, 0.024, "triangle", 900);
    if (quality !== "ok") {
      this.tone(now + 0.04, 118, 0.12, 0.025, "sawtooth", 280);
    }
  }

  fault() {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    this.tone(now, 165, 0.16, 0.045, "square", 380);
    this.tone(now + 0.2, 128, 0.22, 0.04, "square", 320);
    this.motorGain?.gain.setTargetAtTime(0.002, now, 0.08);
  }

  success() {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    [392, 523, 659].forEach((frequency, index) => {
      this.tone(now + index * 0.08, frequency, 0.13, 0.025, "triangle", 1600);
    });
  }

  tone(at, frequency, duration, volume, type = "sine", cutoff = 1200) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  noise(at, duration, volume, cutoff) {
    if (!this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = cutoff;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(at);
    source.stop(at + duration + 0.01);
  }
}

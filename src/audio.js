export class LabAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
  }

  ensureContext() {
    if (!this.enabled) return null;
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.ensureContext();
  }

  tone(frequency, duration = 0.06, volume = 0.025, delay = 0, type = "sine") {
    const context = this.ensureContext();
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  clockTick(emphasis = false) {
    this.tone(emphasis ? 740 : 560, 0.035, emphasis ? 0.025 : 0.014);
    if (emphasis) this.tone(560, 0.045, 0.018, 0.11);
  }

  sample() {
    this.tone(880, 0.06, 0.03);
    this.tone(1180, 0.09, 0.022, 0.055);
  }

  warning() {
    this.tone(430, 0.09, 0.035, 0, "triangle");
    this.tone(380, 0.12, 0.03, 0.12, "triangle");
  }

  critical() {
    [0, 0.16, 0.32].forEach((delay) => {
      this.tone(610, 0.1, 0.045, delay, "square");
      this.tone(460, 0.12, 0.03, delay + 0.06, "triangle");
    });
  }

  failure() {
    this.tone(320, 0.22, 0.04, 0, "sawtooth");
    this.tone(210, 0.32, 0.035, 0.16, "sawtooth");
  }

  success() {
    [620, 760, 980].forEach((frequency, index) => {
      this.tone(frequency, 0.14, 0.025, index * 0.09, "sine");
    });
  }
}

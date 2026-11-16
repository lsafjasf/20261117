/* AudioWorklet scope: synthetic damaged-tape stereo source. */
const TAU = Math.PI * 2;
const NOTE_HZ = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0];

class TapeSourceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'speed', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0,
        automationRate: 'k-rate' },
      { name: 'wowDepth', defaultValue: 0.012, minValue: 0, maxValue: 0.05,
        automationRate: 'k-rate' },
      { name: 'clickLevel', defaultValue: 0.55, minValue: 0, maxValue: 1,
        automationRate: 'k-rate' },
      { name: 'noiseLevel', defaultValue: 0.12, minValue: 0, maxValue: 0.5,
        automationRate: 'k-rate' },
      { name: 'running', defaultValue: 1, minValue: 0, maxValue: 1,
        automationRate: 'k-rate' },
      { name: 'stepPulse', defaultValue: 0, minValue: 0, maxValue: 100000,
        automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.wowPhase = 0;
    this.flutterPhase = 0;
    this.hissState = 0;
    this.kickPhase = 0;
    this.contentPos = 0;
    this.nextClickBeat = 3;
    this.clickEnv = 0;
    this.stepBudget = 0;
    this.stepLatched = 0;
    this.noiseSeed = 0x12345678;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'seek') {
        this.contentPos = Math.max(0, d.position | 0);
      }
    };
  }

  nextNoise() {
    let x = this.noiseSeed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.noiseSeed = x;
    return (x / 4294967296) * 2 - 1;
  }

  process(_inputs, outputs, params) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || left;
    const n = left.length;
    const speed = params.speed[0];
    const wowDepth = params.wowDepth[0];
    const clickLevel = params.clickLevel[0];
    const noiseLevel = params.noiseLevel[0];
    if (params.stepPulse[0] > 0 && !this.stepLatched) {
      this.stepBudget = params.stepPulse[0];
      this.stepLatched = 1;
    } else if (params.stepPulse[0] === 0) {
      this.stepLatched = 0;
    }
    const sr = sampleRate;
    const stepSamples = Math.min(n, Math.floor(this.stepBudget));
    let stepUsed = 0;

    for (let i = 0; i < n; i++) {
      const active = params.running[0] > 0.5 || i < stepSamples;
      if (i < stepSamples) stepUsed++;
      const advance = active ? speed : 0;
      if (active) {
        this.wowPhase += TAU * 0.7 * speed / sr;
        this.flutterPhase += TAU * 5.5 * speed / sr;
      }
      const wobble =
        Math.sin(this.wowPhase) * wowDepth +
        Math.sin(this.flutterPhase) * wowDepth * 0.35;

      const t = (this.contentPos + i * advance) / sr;
      const beatDur = 0.5;
      const beat = t / beatDur;
      const beatIndex = Math.floor(beat);
      const beatFrac = beat - beatIndex;
      const note = NOTE_HZ[beatIndex % NOTE_HZ.length];
      const vibrato = 1 + wobble;

      if (active) this.phase += TAU * note * vibrato * speed / sr;
      const melody =
        Math.sin(this.phase) * 0.22 +
        Math.sin(this.phase * 2.01) * 0.07;

      if (active) {
        this.kickPhase +=
          TAU * (110 - 55 * Math.min(1, beatFrac * 4)) * speed / sr;
      }
      const kickEnv = Math.exp(-beatFrac * 9);
      const kick = Math.sin(this.kickPhase) * kickEnv * 0.5;

      this.hissState = this.hissState * 0.72 + this.nextNoise() * 0.28;
      const hiss = this.hissState * noiseLevel;

      if (active && beatIndex >= this.nextClickBeat && beatFrac < 0.02) {
        this.nextClickBeat = beatIndex + 2 +
          ((this.nextNoise() + 1) * 1.5 | 0);
        this.clickEnv = 1;
      }
      this.clickEnv *= 0.82;
      const click = this.nextNoise() * this.clickEnv * clickLevel * 0.8;

      const pan = Math.sin(beatIndex * 0.9) * 0.45;
      const dryL = melody * (0.7 - pan * 0.5) + kick * 0.9;
      const dryR = melody * (0.7 + pan * 0.5) + kick * 0.9;
      if (active) {
        left[i] = dryL + hiss + click;
        right[i] = dryR + hiss * 0.9 + click * 0.9;
      } else {
        left[i] = 0;
        right[i] = 0;
      }
    }

    if (params.running[0] > 0.5) {
      this.contentPos += n * speed;
    } else {
      this.contentPos += stepUsed * speed;
    }
    this.stepBudget = Math.max(0, this.stepBudget - stepUsed);
    if (params.running[0] < 0.5 && this.stepBudget === 0 &&
        params.stepPulse[0] > 0) {
      this.port.postMessage({ type: 'stepDone' });
    }
    this.port.postMessage({ type: 'position', position: this.contentPos });
    return true;
  }
}

registerProcessor('tape-source', TapeSourceProcessor);

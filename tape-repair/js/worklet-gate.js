/* AudioWorklet scope: stereo noise gate with hold + smooth release. */
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thresholdDb', defaultValue: -50, minValue: -90, maxValue: -20,
        automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1,
        automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.envelope = 0;
    this.gain = 1;
    this.holdSamples = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const enabled = params.enabled[0] > 0.5;
    const threshold = Math.pow(10, params.thresholdDb[0] / 20);
    const hold = Math.floor(sampleRate * 0.05);

    for (let i = 0; i < inL.length; i++) {
      const level = Math.max(Math.abs(inL[i]), Math.abs(inR[i]));
      this.envelope = Math.max(level, this.envelope * 0.9995);
      if (!enabled) {
        this.gain = 1;
      } else if (this.envelope >= threshold) {
        this.gain = Math.min(1, this.gain + 0.02);
        this.holdSamples = hold;
      } else if (this.holdSamples > 0) {
        this.holdSamples--;
      } else {
        this.gain = Math.max(0, this.gain - 0.002);
      }
      outL[i] = inL[i] * this.gain;
      outR[i] = inR[i] * this.gain;
    }
    return true;
  }
}

registerProcessor('noise-gate', NoiseGateProcessor);

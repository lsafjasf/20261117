export class WetlandAudio {
  constructor() {
    this.context = null;
    this.source = null;
    this.filter = null;
    this.gain = null;
    this.enabled = false;
  }

  async toggle() {
    if (!this.context) this.create();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = !this.enabled;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(this.enabled ? 0.04 : 0, now, 0.25);
    return this.enabled;
  }

  create() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    const frameCount = this.context.sampleRate * 3;
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[index] = last * 2.8;
    }
    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.filter = this.context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 520;
    this.filter.Q.value = 0.9;
    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.filter).connect(this.gain).connect(this.context.destination);
    this.source.start();
  }

  update(inflow, storm) {
    if (!this.enabled || !this.context || !this.filter) return;
    const flow = Math.min(1.8, Math.max(0.25, inflow / 8));
    const filterTarget = 360 + flow * 760 + storm * 380;
    const gainTarget = 0.035 + flow * 0.045 + storm * 0.025;
    const now = this.context.currentTime;
    this.filter.frequency.setTargetAtTime(filterTarget, now, 0.18);
    this.gain.gain.setTargetAtTime(gainTarget, now, 0.18);
  }
}

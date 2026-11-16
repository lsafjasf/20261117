(function (global) {
  'use strict';

  class GlazeAudio {
    constructor() {
      this.context = null;
      this.enabled = false;
      this.master = null;
      this.motorOsc = null;
      this.motorGain = null;
      this.motorFilter = null;
      this.flowSource = null;
      this.flowGain = null;
      this.flowFilter = null;
      this.pumpGain = null;
    }

    async enable() {
      if (!this.context) this._build();
      await this.context.resume();
      this.enabled = true;
      this.master.gain.setTargetAtTime(0.22, this.context.currentTime, 0.08);
      return true;
    }

    disable() {
      if (!this.context) return;
      this.enabled = false;
      this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.06);
    }

    toggle() {
      if (this.enabled) {
        this.disable();
        return Promise.resolve(false);
      }
      return this.enable();
    }

    _build() {
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      this.context = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.0001;
      this.master.connect(ctx.destination);

      this.motorOsc = ctx.createOscillator();
      this.motorOsc.type = 'sawtooth';
      this.motorOsc.frequency.value = 58;
      this.motorFilter = ctx.createBiquadFilter();
      this.motorFilter.type = 'lowpass';
      this.motorFilter.frequency.value = 260;
      this.motorFilter.Q.value = 2.4;
      this.motorGain = ctx.createGain();
      this.motorGain.gain.value = 0.0001;
      this.motorOsc.connect(this.motorFilter);
      this.motorFilter.connect(this.motorGain);
      this.motorGain.connect(this.master);
      this.motorOsc.start();

      const seconds = 2;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.93 + white * 0.07;
        data[index] = last * 2.4;
      }
      this.flowSource = ctx.createBufferSource();
      this.flowSource.buffer = buffer;
      this.flowSource.loop = true;
      this.flowFilter = ctx.createBiquadFilter();
      this.flowFilter.type = 'bandpass';
      this.flowFilter.frequency.value = 900;
      this.flowFilter.Q.value = 0.75;
      this.flowGain = ctx.createGain();
      this.flowGain.gain.value = 0.0001;
      this.pumpGain = ctx.createGain();
      this.pumpGain.gain.value = 0.0001;
      this.flowSource.connect(this.flowFilter);
      this.flowFilter.connect(this.flowGain);
      this.flowGain.connect(this.master);
      this.flowSource.start();

      const pumpOsc = ctx.createOscillator();
      pumpOsc.type = 'triangle';
      pumpOsc.frequency.value = 112;
      pumpOsc.connect(this.pumpGain);
      this.pumpGain.connect(this.master);
      pumpOsc.start();
      this.pumpOsc = pumpOsc;
    }

    update(sim) {
      if (!this.context || !this.enabled) return;
      const now = this.context.currentTime;
      const frozen = sim.paused || sim.fault;
      const motorOn = !frozen && sim.devices.motor && sim.params.rotation > 0;
      const pumpOn = !frozen && sim.devices.pump;
      const draining = !frozen && sim.devices.drainValve && sim.params.dripSpeed > 0;

      const motorFreq = 46 + sim.params.rotation * 2.1 + (sim.phase === 'spin' ? 13 : 0);
      this.motorOsc.frequency.setTargetAtTime(motorFreq, now, 0.08);
      this.motorFilter.frequency.setTargetAtTime(200 + sim.params.rotation * 6, now, 0.1);
      this.motorGain.gain.setTargetAtTime(motorOn ? 0.2 : 0.0001, now, motorOn ? 0.09 : 0.05);

      const flowFreq = draining ? 620 + sim.params.dripSpeed * 430 : 760 + sim.params.rotation * 5;
      this.flowFilter.frequency.setTargetAtTime(flowFreq, now, 0.12);
      this.flowGain.gain.setTargetAtTime(draining ? 0.08 + sim.params.dripSpeed * 0.075 : 0.0001, now, 0.06);
      this.pumpOsc.frequency.setTargetAtTime(pumpOn ? 108 + Math.sin(now * 2) * 5 : 82, now, 0.1);
      this.pumpGain.gain.setTargetAtTime(pumpOn ? 0.06 : 0.0001, now, 0.07);
    }
  }

  global.GlazeAudio = GlazeAudio;
})(window);

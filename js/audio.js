(function (global) {
  "use strict";

  const Canyon = global.Canyon;

  const AudioEngine = {
    context: null,
    master: null,
    hum: null,
    humGain: null,
    harmonic: null,
    harmonicGain: null,
    noise: null,
    noiseFilter: null,
    noiseGain: null,
    muted: false,
    started: false,

    ensure() {
      if (!this.context) {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextClass) {
          return false;
        }
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.22;
        this.master.connect(this.context.destination);

        this.hum = this.context.createOscillator();
        this.hum.type = "triangle";
        this.hum.frequency.value = 156;
        this.humGain = this.context.createGain();
        this.humGain.gain.value = 0.034;
        this.hum.connect(this.humGain).connect(this.master);
        this.hum.start();

        this.harmonic = this.context.createOscillator();
        this.harmonic.type = "sine";
        this.harmonic.frequency.value = 312;
        this.harmonicGain = this.context.createGain();
        this.harmonicGain.gain.value = 0.009;
        this.harmonic.connect(this.harmonicGain).connect(this.master);
        this.harmonic.start();

        const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        let previous = 0;
        for (let i = 0; i < data.length; i += 1) {
          const white = Math.random() * 2 - 1;
          previous = previous * 0.92 + white * 0.08;
          data[i] = previous;
        }
        this.noise = this.context.createBufferSource();
        this.noise.buffer = buffer;
        this.noise.loop = true;
        this.noiseFilter = this.context.createBiquadFilter();
        this.noiseFilter.type = "bandpass";
        this.noiseFilter.frequency.value = 420;
        this.noiseFilter.Q.value = 0.6;
        this.noiseGain = this.context.createGain();
        this.noiseGain.gain.value = 0.015;
        this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
        this.noise.start();
        this.started = true;
      }
      if (this.context.state === "suspended") {
        this.context.resume();
      }
      return true;
    },

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (!this.context) {
        return;
      }
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.22, this.context.currentTime, 0.04);
    },

    toggle() {
      this.ensure();
      this.setMuted(!this.muted);
      return this.muted;
    },

    setTelemetry(tension, wind, active) {
      if (!this.context) {
        return;
      }
      const now = this.context.currentTime;
      const pitch = 82 + tension * 80;
      const windLevel = Math.min(1, Math.abs(wind) / 2.4);
      this.hum.frequency.setTargetAtTime(pitch, now, 0.09);
      this.harmonic.frequency.setTargetAtTime(pitch * 2.01, now, 0.09);
      this.humGain.gain.setTargetAtTime(active ? 0.026 + tension * 0.012 : 0.008, now, 0.15);
      this.harmonicGain.gain.setTargetAtTime(active ? 0.004 + tension * 0.005 : 0.002, now, 0.15);
      this.noiseFilter.frequency.setTargetAtTime(300 + windLevel * 900, now, 0.12);
      this.noiseGain.gain.setTargetAtTime(0.006 + windLevel * 0.025, now, 0.18);
    },

    pulse(frequency, duration, volume, type) {
      if (!this.ensure() || this.muted) {
        return;
      }
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(volume || 0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    },

    playCrash() {
      if (!this.ensure() || this.muted) {
        return;
      }
      const now = this.context.currentTime;
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 0.45, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        const fade = 1 - i / data.length;
        data[i] = (Math.random() * 2 - 1) * fade * fade;
      }
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.value = 420;
      gain.gain.value = 0.2;
      source.connect(filter).connect(gain).connect(this.master);
      source.start(now);
      this.pulse(76, 0.35, 0.11, "sawtooth");
    },

    playRepair() {
      this.pulse(660, 0.16, 0.07, "sine");
      global.setTimeout(() => this.pulse(880, 0.22, 0.055, "sine"), 110);
    },

    playRecovery() {
      this.pulse(140, 0.42, 0.055, "triangle");
      global.setTimeout(() => this.pulse(110, 0.48, 0.05, "triangle"), 420);
      global.setTimeout(() => this.pulse(92, 0.62, 0.045, "triangle"), 860);
    },

    playWin() {
      [392, 523, 659, 784].forEach((frequency, index) => {
        global.setTimeout(() => this.pulse(frequency, 0.42, 0.055, "sine"), index * 135);
      });
    }
  };

  Canyon.audio = AudioEngine;
})(window);

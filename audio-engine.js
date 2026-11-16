(function () {
  "use strict";

  const GROUP_SOUNDS = [
    { id: "A", pitch: 54, click: 1450, pan: -0.72, delay: 0.19, seed: 0x11a7 },
    { id: "B", pitch: 66, click: 2050, pan: -0.26, delay: 0.23, seed: 0x22b9 },
    { id: "C", pitch: 79, click: 2680, pan: 0.26, delay: 0.29, seed: 0x33c1 },
    { id: "D", pitch: 94, click: 3380, pan: 0.72, delay: 0.35, seed: 0x44d3 }
  ];

  const SAMPLE_RATE = 44100;
  const LOOKAHEAD = 0.11;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function makeNoiseBuffer(context, seed, seconds = 0.32) {
    const length = Math.max(1, Math.ceil(context.sampleRate * seconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = seed >>> 0;
    for (let index = 0; index < length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[index] = (state / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  function createBus(context, monitor) {
    const input = context.createGain();
    const main = context.createGain();
    const bypass = context.createGain();
    const transportGate = context.createGain();
    const muteGate = context.createGain();
    const master = context.createGain();
    const mainDry = context.createGain();
    const delaySendL = context.createGain();
    const delaySendR = context.createGain();
    const delayL = context.createDelay(1);
    const delayR = context.createDelay(1);
    const delayPanL = context.createStereoPanner();
    const delayPanR = context.createStereoPanner();
    const delayWetL = context.createGain();
    const delayWetR = context.createGain();
    const feedbackL = context.createGain();
    const feedbackR = context.createGain();
    const analyser = context.createAnalyser();
    const splitter = context.createChannelSplitter(2);
    const analyserL = context.createAnalyser();
    const analyserR = context.createAnalyser();

    main.gain.value = 0.0001;
    bypass.gain.value = 0.0001;
    transportGate.gain.value = 1;
    muteGate.gain.value = 1;
    master.gain.value = 0.82;
    mainDry.gain.value = 0.82;
    delaySendL.gain.value = 0.34;
    delaySendR.gain.value = 0.22;
    delayL.delayTime.value = 0.19;
    delayR.delayTime.value = 0.37;
    delayPanL.pan.value = -0.66;
    delayPanR.pan.value = 0.66;
    delayWetL.gain.value = 0.22;
    delayWetR.gain.value = 0.15;
    feedbackL.gain.value = 0.18;
    feedbackR.gain.value = 0.14;
    analyser.fftSize = 1024;
    analyserL.fftSize = 1024;
    analyserR.fftSize = 1024;
    analyserL.smoothingTimeConstant = 0.5;
    analyserR.smoothingTimeConstant = 0.5;

    input.connect(mainDry);
    mainDry.connect(main);
    input.connect(delaySendL);
    input.connect(delaySendR);
    delaySendL.connect(delayL);
    delaySendR.connect(delayR);
    delayL.connect(delayPanL);
    delayR.connect(delayPanR);
    delayPanL.connect(delayWetL);
    delayPanR.connect(delayWetR);
    delayWetL.connect(main);
    delayWetR.connect(main);
    delayL.connect(feedbackL);
    delayR.connect(feedbackR);
    feedbackL.connect(delayL);
    feedbackR.connect(delayR);
    input.connect(bypass);
    main.connect(transportGate);
    bypass.connect(transportGate);
    transportGate.connect(muteGate);
    muteGate.connect(master);
    master.connect(analyser);
    master.connect(context.destination);
    master.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    const bus = {
      input,
      main,
      bypass,
      transportGate,
      muteGate,
      master,
      analyser,
      analyserL,
      analyserR,
      nodes: [input, main, bypass, transportGate, muteGate, master, mainDry,
        delaySendL, delaySendR, delayL, delayR, delayPanL, delayPanR,
        delayWetL, delayWetR, feedbackL, feedbackR, analyser, splitter,
        analyserL, analyserR]
    };
    setBusMonitor(bus, monitor, context.currentTime);
    return bus;
  }

  function setBusMonitor(bus, mode, now) {
    const time = Math.max(0, now || 0);
    const mainTarget = mode === "main" ? 1 : 0.0001;
    const bypassTarget = mode === "bypass" ? 1 : 0.0001;
    const muteTarget = mode === "mute" ? 0.0001 : 1;
    bus.main.gain.cancelScheduledValues(time);
    bus.bypass.gain.cancelScheduledValues(time);
    bus.muteGate.gain.cancelScheduledValues(time);
    bus.main.gain.setTargetAtTime(mainTarget, time, 0.008);
    bus.bypass.gain.setTargetAtTime(bypassTarget, time, 0.008);
    bus.muteGate.gain.setTargetAtTime(muteTarget, time, 0.006);
  }

  function register(cleanup, node) {
    cleanup.push(node);
    return node;
  }

  function scheduleVoice(context, destination, groupIndex, step, when, velocity, noiseBuffers) {
    const sound = GROUP_SOUNDS[groupIndex];
    const cleanup = [];
    const panner = register(cleanup, context.createStereoPanner());
    panner.connect(destination);
    panner.pan.setValueAtTime(sound.pan, when);

    const pitchRatio = 1 + ((step % 4) - 1.5) * 0.018;
    const thud = register(cleanup, context.createOscillator());
    const thudGain = register(cleanup, context.createGain());
    thud.type = "sine";
    thud.frequency.setValueAtTime(sound.pitch * 1.55 * pitchRatio, when);
    thud.frequency.exponentialRampToValueAtTime(sound.pitch * 0.72, when + 0.16);
    thudGain.gain.setValueAtTime(0.0001, when);
    thudGain.gain.exponentialRampToValueAtTime(0.5 * velocity, when + 0.006);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.21);
    thud.connect(thudGain);
    thudGain.connect(panner);
    thud.start(when);
    thud.stop(when + 0.24);

    const body = register(cleanup, context.createOscillator());
    const bodyGain = register(cleanup, context.createGain());
    body.type = "triangle";
    body.frequency.setValueAtTime(sound.pitch * 2.2, when);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.exponentialRampToValueAtTime(0.08 * velocity, when + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    body.connect(bodyGain);
    bodyGain.connect(panner);
    body.start(when);
    body.stop(when + 0.11);

    const click = register(cleanup, context.createBufferSource());
    const clickFilter = register(cleanup, context.createBiquadFilter());
    const clickGain = register(cleanup, context.createGain());
    click.buffer = noiseBuffers[groupIndex];
    clickFilter.type = "bandpass";
    clickFilter.frequency.setValueAtTime(sound.click * pitchRatio, when);
    clickFilter.Q.setValueAtTime(2.6, when);
    clickGain.gain.setValueAtTime(0.0001, when);
    clickGain.gain.exponentialRampToValueAtTime(0.23 * velocity, when + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.065);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(panner);
    click.start(when);
    click.stop(when + 0.08);

    const tick = register(cleanup, context.createOscillator());
    const tickGain = register(cleanup, context.createGain());
    tick.type = "square";
    tick.frequency.setValueAtTime(1260 + groupIndex * 214, when);
    tickGain.gain.setValueAtTime(0.0001, when);
    tickGain.gain.exponentialRampToValueAtTime(0.014 * velocity, when + 0.001);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.022);
    tick.connect(tickGain);
    tickGain.connect(panner);
    tick.start(when);
    tick.stop(when + 0.03);

    const sources = [thud, body, click, tick];
    const voice = { panner, cleanup, sources, finished: false };
    let stopped = 0;
    const dispose = () => {
      stopped += 1;
      if (stopped < sources.length) return;
      voice.finished = true;
      cleanup.forEach((node) => {
        try { node.disconnect(); } catch (error) { /* already disconnected */ }
      });
    };
    sources.forEach((source) => { source.onended = dispose; });
    return voice;
  }

  class LoomAudioEngine {
    constructor(options = {}) {
      this.context = null;
      this.bus = null;
      this._needsBusReset = false;
      this.noiseBuffers = [];
      this.tracks = options.tracks || [];
      this.bpm = options.bpm || 92;
      this.monitor = "main";
      this.playing = false;
      this.paused = false;
      this.completed = false;
      this.cursor = 0;
      this.wovenRows = 0;
      this.activeStep = -1;
      this.nextTime = 0;
      this.schedulerTimer = null;
      this.visualTimers = new Set();
      this.voices = [];
      this.levelData = {
        left: new Float32Array(1024),
        right: new Float32Array(1024)
      };
      this.onStep = options.onStep || (() => {});
      this.onComplete = options.onComplete || (() => {});
      this.onPause = options.onPause || (() => {});
      this.onReset = options.onReset || (() => {});
      this.onNodes = options.onNodes || (() => {});
      this._nodeUpdateAt = 0;
    }

    setTracks(tracks) {
      this.tracks = tracks.map((track) => ({
        steps: track.steps.slice(),
        name: track.name
      }));
    }

    setBpm(bpm) {
      this.bpm = clamp(Number(bpm) || 92, 60, 160);
    }

    stepDuration() {
      return 60 / this.bpm / 2;
    }

    loopDuration() {
      return this.stepDuration() * 8;
    }

    async activate() {
      if (!this.context) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
        this.context = new AudioContextClass({ latencyHint: "interactive" });
        this.bus = createBus(this.context, this.monitor);
        this._needsBusReset = false;
        this.noiseBuffers = GROUP_SOUNDS.map((group) =>
          makeNoiseBuffer(this.context, group.seed));
        this._gateUp(0);
      }
      if (this.context.state !== "running") {
        await this.context.resume();
      }
      return this.context;
    }

    _gateUp(when) {
      if (!this.bus) return;
      const time = Math.max(0, when ?? this.context.currentTime);
      this.bus.transportGate.gain.cancelScheduledValues(time);
      this.bus.transportGate.gain.setValueAtTime(0.0001, time);
      this.bus.transportGate.gain.exponentialRampToValueAtTime(1, time + 0.012);
    }

    _gateDown(when) {
      if (!this.bus) return;
      const time = Math.max(0, when ?? this.context.currentTime);
      this.bus.transportGate.gain.cancelScheduledValues(time);
      this.bus.transportGate.gain.setValueAtTime(this.bus.transportGate.gain.value, time);
      this.bus.transportGate.gain.exponentialRampToValueAtTime(0.0001, time + 0.012);
    }

    setMonitor(mode) {
      if (!["main", "bypass", "mute"].includes(mode)) return;
      this.monitor = mode;
      if (this.bus && this.context) {
        setBusMonitor(this.bus, mode, this.context.currentTime);
      }
    }

    _rebuildBus() {
      if (!this.context) return;
      const previous = this.bus;
      this.bus = createBus(this.context, this.monitor);
      if (previous) {
        previous.nodes.forEach((node) => {
          try { node.disconnect(); } catch (error) { /* already disconnected */ }
        });
      }
      this._needsBusReset = false;
      this._gateUp();
    }

    _velocityForStep(step) {
      const activeGroups = this.tracks.reduce((count, track) =>
        count + (track.steps[step] ? 1 : 0), 0);
      if (activeGroups >= 4) return 0.68;
      if (activeGroups === 3) return 0.78;
      if (activeGroups === 2) return 0.9;
      return 1;
    }

    _scheduleStep(step, when, destination, context, noiseBuffers, live) {
      const velocity = this._velocityForStep(step);
      const added = [];
      this.tracks.forEach((track, groupIndex) => {
        if (!track.steps[step]) return;
        const voice = scheduleVoice(
          context,
          destination,
          groupIndex,
          step,
          when,
          velocity,
          noiseBuffers
        );
        added.push(voice);
      });
      if (live) {
        this.voices.push(...added);
        this._emitNodes(true);
      }
      return added;
    }

    async play(options = {}) {
      await this.activate();
      if (options.restart || this.completed) this.resetProgress();
      if (this.playing) return;
      if (this._needsBusReset) this._rebuildBus();
      this._gateUp();
      this.playing = true;
      this.paused = false;
      this.completed = false;
      this.nextTime = this.context.currentTime + 0.055;
      this.schedulerTimer = window.setInterval(() => this._schedulerTick(), 24);
      this._schedulerTick();
    }

    _schedulerTick() {
      if (!this.playing || !this.context || this.cursor >= 8) return;
      const now = this.context.currentTime;
      while (
        this.playing &&
        this.cursor < 8 &&
        this.nextTime < now + LOOKAHEAD
      ) {
        const step = this.cursor;
        const when = this.nextTime;
        this._scheduleStep(
          step,
          when,
          this.bus.input,
          this.context,
          this.noiseBuffers,
          true
        );
        const delay = Math.max(0, (when - now) * 1000);
        const visualTimer = window.setTimeout(() => {
          this.visualTimers.delete(visualTimer);
          this.activeStep = step;
          this.wovenRows = Math.max(this.wovenRows, step + 1);
          this.onStep(step, this.wovenRows);
          this._emitNodes(false);
        }, delay);
        this.visualTimers.add(visualTimer);

        if (step === 7) {
          const finishDelay = Math.max(0, (when - now) * 1000 + 420);
          const finishTimer = window.setTimeout(() => {
            this.visualTimers.delete(finishTimer);
            if (!this.playing) return;
            this.playing = false;
            this.completed = true;
            this.cursor = 8;
            this.activeStep = -1;
            this._gateDown();
            this._stopVoices(0.01);
            this.onComplete();
          }, finishDelay);
          this.visualTimers.add(finishTimer);
        }
        this.cursor += 1;
        this.nextTime += this.stepDuration();
      }
    }

    _stopVoices(fadeSeconds = 0.02) {
      if (!this.context) return;
      const stopAt = this.context.currentTime + 0.002;
      this.voices.forEach((voice) => {
        voice.sources.forEach((source) => {
          try { source.stop(stopAt); } catch (error) { /* already stopped */ }
        });
      });
      this.voices = [];
      this._emitNodes(true);
    }

    pause() {
      if (!this.context || !this.playing) {
        this._silenceNow();
        if (this.context) this._needsBusReset = true;
        return;
      }
      this.playing = false;
      this.paused = true;
      this.activeStep = -1;
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      this.visualTimers.forEach((timer) => window.clearTimeout(timer));
      this.visualTimers.clear();
      this._gateDown();
      this._stopVoices();
      this._needsBusReset = true;
      this.onPause(this.cursor, this.wovenRows);
    }

    _silenceNow() {
      if (!this.context) return;
      this._gateDown();
      this._stopVoices();
    }

    async replay() {
      this.resetProgress();
      await this.play({ restart: true });
    }

    async singleStep() {
      if (this.completed || this.playing || this.cursor >= 8) return false;
      await this.activate();
      if (this._needsBusReset) this._rebuildBus();
      this._gateUp();
      const step = this.cursor;
      const when = this.context.currentTime + 0.045;
      this._scheduleStep(
        step,
        when,
        this.bus.input,
        this.context,
        this.noiseBuffers,
        true
      );
      this.activeStep = step;
      this.cursor += 1;
      this.wovenRows = Math.max(this.wovenRows, this.cursor);
      this.paused = this.cursor < 8;
      this.onStep(step, this.wovenRows);
      if (this.cursor >= 8) {
        this.completed = true;
        this.paused = false;
        window.setTimeout(() => {
          if (this.completed) {
            this._gateDown();
            this._stopVoices();
            this._needsBusReset = true;
            this.onComplete();
          }
        }, (when - this.context.currentTime) * 1000 + 380);
      } else {
        this.onPause(this.cursor, this.wovenRows);
      }
      return true;
    }

    resetProgress() {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      this.visualTimers.forEach((timer) => window.clearTimeout(timer));
      this.visualTimers.clear();
      this.playing = false;
      this.paused = false;
      this.completed = false;
      this.cursor = 0;
      this.wovenRows = 0;
      this.activeStep = -1;
      this._silenceNow();
      if (this.context) this._needsBusReset = true;
      this.onReset();
    }

    _pruneVoices() {
      this.voices = this.voices.filter((voice) => !voice.finished);
    }

    _emitNodes(force) {
      const now = performance.now();
      if (!force && now - this._nodeUpdateAt < 60) return;
      this._nodeUpdateAt = now;
      this._pruneVoices();
      this.onNodes(this._activeNodeCount());
    }

    _activeNodeCount() {
      return this.voices.reduce((total, voice) =>
        total + voice.cleanup.length, 0);
    }

    getLevels() {
      if (!this.bus || !this.context) {
        return { left: 0, right: 0, dbL: -Infinity, dbR: -Infinity };
      }
      this.bus.analyserL.getFloatTimeDomainData(this.levelData.left);
      this.bus.analyserR.getFloatTimeDomainData(this.levelData.right);
      let peakL = 0;
      let peakR = 0;
      let sumL = 0;
      let sumR = 0;
      for (let index = 0; index < 1024; index += 1) {
        const left = this.levelData.left[index];
        const right = this.levelData.right[index];
        peakL = Math.max(peakL, Math.abs(left));
        peakR = Math.max(peakR, Math.abs(right));
        sumL += left * left;
        sumR += right * right;
      }
      const rmsL = Math.sqrt(sumL / 1024);
      const rmsR = Math.sqrt(sumR / 1024);
      return {
        left: clamp(peakL, 0, 1),
        right: clamp(peakR, 0, 1),
        dbL: rmsL > 0.000001 ? 20 * Math.log10(rmsL) : -Infinity,
        dbR: rmsR > 0.000001 ? 20 * Math.log10(rmsR) : -Infinity
      };
    }

    debugSnapshot() {
      this._pruneVoices();
      const levels = this.getLevels();
      return {
        contextState: this.context ? this.context.state : "suspended",
        monitor: this.monitor,
        activeNodes: this._activeNodeCount(),
        playing: this.playing,
        paused: this.paused,
        completed: this.completed,
        cursor: this.cursor,
        wovenRows: this.wovenRows,
        bpm: this.bpm,
        stepDuration: this.stepDuration(),
        loopDuration: this.loopDuration(),
        levels,
        delayTimes: [0.19, 0.37]
      };
    }

    async renderOffline(tracks, bpm, monitor = "main") {
      const stepDuration = 60 / clamp(Number(bpm) || 92, 60, 160) / 2;
      const duration = stepDuration * 8 + 0.72;
      const frameCount = Math.ceil(duration * SAMPLE_RATE);
      const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const context = new OfflineContextClass(2, frameCount, SAMPLE_RATE);
      const bus = createBus(context, monitor);
      const noiseBuffers = GROUP_SOUNDS.map((group) =>
        makeNoiseBuffer(context, group.seed));

      bus.transportGate.gain.setValueAtTime(1, 0);
      bus.transportGate.gain.setValueAtTime(1, duration - 0.1);
      bus.transportGate.gain.linearRampToValueAtTime(0.0001, duration - 0.012);

      const engineTracks = tracks.map((track) => ({
        steps: (Array.isArray(track) ? track : track.steps).slice(),
        name: track.name || ""
      }));
      for (let step = 0; step < 8; step += 1) {
        const activeGroups = engineTracks.reduce((count, track) =>
          count + (track.steps[step] ? 1 : 0), 0);
        const velocity = activeGroups >= 4 ? 0.68 : activeGroups === 3 ? 0.78 :
          activeGroups === 2 ? 0.9 : 1;
        engineTracks.forEach((track, groupIndex) => {
          if (!track.steps[step]) return;
          scheduleVoice(
            context,
            bus.input,
            groupIndex,
            step,
            0.045 + step * stepDuration,
            velocity,
            noiseBuffers
          );
        });
      }
      const buffer = await context.startRendering();
      return {
        buffer,
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        analysis: this.analyzeBuffer(buffer)
      };
    }

    analyzeBuffer(buffer) {
      const channels = buffer.numberOfChannels;
      const peaks = [];
      const peakTimes = [];
      const rms = [];
      for (let channel = 0; channel < channels; channel += 1) {
        const data = buffer.getChannelData(channel);
        let peak = 0;
        let peakIndex = 0;
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const value = Math.abs(data[index]);
          if (value > peak) {
            peak = value;
            peakIndex = index;
          }
          sum += data[index] * data[index];
        }
        peaks.push(peak);
        peakTimes.push(peakIndex / buffer.sampleRate);
        rms.push(Math.sqrt(sum / data.length));
      }
      return {
        duration: buffer.duration,
        channels,
        sampleRate: buffer.sampleRate,
        peaks,
        peakTimes,
        rms
      };
    }

    encodeWav(buffer) {
      const channels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const frameCount = buffer.length;
      const bytesPerSample = 2;
      const blockAlign = channels * bytesPerSample;
      const dataSize = frameCount * blockAlign;
      const wav = new ArrayBuffer(44 + dataSize);
      const view = new DataView(wav);

      const writeString = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };

      writeString(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, dataSize, true);

      const channelData = [];
      for (let channel = 0; channel < channels; channel += 1) {
        channelData.push(buffer.getChannelData(channel));
      }
      let offset = 44;
      for (let frame = 0; frame < frameCount; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const sample = clamp(channelData[channel][frame], -1, 1);
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          offset += 2;
        }
      }
      return new Blob([wav], { type: "audio/wav" });
    }

    async dispose() {
      this.pause();
      if (this.bus) {
        this.bus.nodes.forEach((node) => {
          try { node.disconnect(); } catch (error) { /* disconnected */ }
        });
      }
      this.bus = null;
      if (this.context && this.context.state !== "closed") {
        await this.context.close();
      }
      this.context = null;
    }
  }

  window.LoomAudio = {
    engine: LoomAudioEngine,
    groups: GROUP_SOUNDS,
    sampleRate: SAMPLE_RATE
  };
})();

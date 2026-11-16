/* Live and offline Web Audio graph for the tape repair workbench. */
(function (root) {
  const WORKLET_TAPE = 'js/worklet-tape.js';
  const WORKLET_GATE = 'js/worklet-gate.js';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.nodes = {};
      this.params = null;
      this.mode = 'main';
      this.position = 0;
      this.isPlaying = false;
      this.activeCount = 0;
      this.onPosition = null;
      this.onMeters = null;
      this.onActive = null;
      this._meterTimer = 0;
    }

    async init(params) {
      if (this.ctx) return;
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule(WORKLET_TAPE);
      await ctx.audioWorklet.addModule(WORKLET_GATE);
      this.ctx = ctx;
      this.params = Object.assign({}, params);
      this._buildGraph(ctx);
      this._startMeterLoop();
      this.applyParams(params);
      this.setMode(params.mode || 'main');
      this.pause();
    }

    _register(name, node) {
      this.nodes[name] = node;
      this.activeCount = Object.keys(this.nodes).length;
      if (this.onActive) this.onActive(this.activeCount);
      return node;
    }

    _buildGraph(ctx) {
      const source = this._register('source',
        new AudioWorkletNode(ctx, 'tape-source', {
          numberOfOutputs: 1, outputChannelCount: [2],
        }));
      source.port.onmessage = (e) => {
        if (e.data && e.data.type === 'position') {
          this.position = e.data.position;
          if (this.onPosition) this.onPosition(this.position);
        } else if (e.data && e.data.type === 'stepDone') {
          this.isPlaying = false;
          source.parameters.get('running').value = 0;
          source.parameters.get('stepPulse').value = 0;
          this.ctx.suspend();
        }
      };

      const preGain = this._register('preGain', new GainNode(ctx));
      const deess = this._register('deess', new BiquadFilterNode(ctx, {
        type: 'peaking', frequency: 7000, Q: 1.2, gain: -8,
      }));
      const notch = this._register('notch', new BiquadFilterNode(ctx, {
        type: 'notch', frequency: 3300, Q: 12,
      }));
      const gate = this._register('gate',
        new AudioWorkletNode(ctx, 'noise-gate', {
          numberOfInputs: 1, numberOfOutputs: 1,
          inputChannelCount: [2], outputChannelCount: [2],
        }));
      const mainOut = this._register('mainOut', new GainNode(ctx));
      const bypassOut = this._register('bypassOut', new GainNode(ctx));
      const muteOut = this._register('muteOut', new GainNode(ctx));
      const master = this._register('master', new GainNode(ctx));

      const split = this._register('split',
        new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }));
      const meterL = this._register('meterL', new AnalyserNode(ctx, {
        fftSize: 1024, smoothingTimeConstant: 0.4,
      }));
      const meterR = this._register('meterR', new AnalyserNode(ctx, {
        fftSize: 1024, smoothingTimeConstant: 0.4,
      }));
      const preAnalyser = this._register('preAnalyser', new AnalyserNode(ctx, {
        fftSize: 2048,
      }));
      const postAnalyser = this._register('postAnalyser', new AnalyserNode(ctx, {
        fftSize: 2048,
      }));

      source.connect(preGain);
      source.connect(preAnalyser);
      preGain.connect(deess);
      deess.connect(notch);
      notch.connect(gate);
      gate.connect(mainOut);
      source.connect(bypassOut);
      muteOut.gain.value = 0;
      mainOut.connect(master);
      bypassOut.connect(master);
      muteOut.connect(master);
      master.connect(postAnalyser);
      master.connect(split);
      split.connect(meterL, 0);
      split.connect(meterR, 1);
      master.connect(ctx.destination);
    }

    applyParams(params) {
      this.params = Object.assign({}, params);
      if (!this.ctx) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const sp = this.nodes.source.parameters;
      sp.get('speed').setTargetAtTime(params.speed, t, 0.02);
      sp.get('wowDepth').setTargetAtTime(params.wowDepth, t, 0.02);
      sp.get('clickLevel').setTargetAtTime(params.clickLevel, t, 0.02);
      sp.get('noiseLevel').setTargetAtTime(params.noiseLevel, t, 0.02);
      sp.get('running').setValueAtTime(this.isPlaying ? 1 : 0, t);
      this.nodes.deess.frequency.setTargetAtTime(params.deessFreq, t, 0.02);
      this.nodes.deess.gain.setTargetAtTime(params.deessGain, t, 0.02);
      this.nodes.notch.frequency.setTargetAtTime(params.notchFreq, t, 0.02);
      this.nodes.notch.Q.setTargetAtTime(params.notchQ, t, 0.02);
      this.nodes.master.gain.setTargetAtTime(params.outputGain, t, 0.02);
      const gp = this.nodes.gate.parameters;
      gp.get('thresholdDb').setTargetAtTime(params.gateThreshold, t, 0.02);
      gp.get('enabled').setValueAtTime(params.gateEnabled ? 1 : 0, t);
      this.setMode(params.mode || this.mode);
    }

    setMode(mode) {
      if (mode !== 'main' && mode !== 'bypass' && mode !== 'mute') return;
      this.mode = mode;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const ramp = 0.015;
      this.nodes.mainOut.gain.cancelScheduledValues(t);
      this.nodes.bypassOut.gain.cancelScheduledValues(t);
      this.nodes.muteOut.gain.cancelScheduledValues(t);
      this.nodes.mainOut.gain.setTargetAtTime(mode === 'main' ? 1 : 0, t, ramp);
      this.nodes.bypassOut.gain.setTargetAtTime(mode === 'bypass' ? 1 : 0, t, ramp);
      this.nodes.muteOut.gain.setTargetAtTime(mode === 'mute' ? 1 : 0, t, ramp);
    }

    async play() {
      if (!this.ctx) return;
      await this.ctx.resume();
      this.isPlaying = true;
      this.nodes.source.parameters.get('running').value = 1;
    }

    pause() {
      if (!this.ctx) return;
      this.isPlaying = false;
      this.nodes.source.parameters.get('running').value = 0;
      this.ctx.suspend();
    }

    async replay() {
      if (!this.ctx) return;
      this.nodes.source.port.postMessage({ type: 'seek', position: 0 });
      this.position = 0;
      if (this.onPosition) this.onPosition(0);
      await this.ctx.resume();
      this.isPlaying = true;
      this.nodes.source.parameters.get('running').value = 1;
    }

    async step() {
      if (!this.ctx) return;
      this.nodes.source.parameters.get('running').value = 0;
      await this.ctx.suspend();
      await this.ctx.resume();
      this.isPlaying = false;
      const source = this.nodes.source;
      source.parameters.get('stepPulse').value += 128;
    }

    seekZero() {
      this.nodes.source.port.postMessage({ type: 'seek', position: 0 });
      this.position = 0;
      if (this.onPosition) this.onPosition(0);
    }

    getAnalysers() {
      return {
        pre: this.nodes.preAnalyser,
        post: this.nodes.postAnalyser,
        meterL: this.nodes.meterL,
        meterR: this.nodes.meterR,
      };
    }

    readMeters() {
      const { meterL, meterR } = this.getAnalysers();
      const bufL = new Float32Array(meterL.fftSize);
      const bufR = new Float32Array(meterR.fftSize);
      meterL.getFloatTimeDomainData(bufL);
      meterR.getFloatTimeDomainData(bufR);
      let peakL = 0;
      let peakR = 0;
      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < bufL.length; i++) {
        peakL = Math.max(peakL, Math.abs(bufL[i]));
        peakR = Math.max(peakR, Math.abs(bufR[i]));
        sumL += bufL[i] * bufL[i];
        sumR += bufR[i] * bufR[i];
      }
      return {
        peakL, peakR,
        rmsL: Math.sqrt(sumL / bufL.length),
        rmsR: Math.sqrt(sumR / bufR.length),
      };
    }

    _startMeterLoop() {
      const tick = () => {
        if (!this.ctx) return;
        if (this.onMeters && this.isPlaying) this.onMeters(this.readMeters());
        this._meterTimer = requestAnimationFrame(tick);
      };
      this._meterTimer = requestAnimationFrame(tick);
    }

    static async renderOffline(params, durationSec, baseRate, paused) {
      const rate = baseRate || 48000;
      const mode = params.mode || 'main';
      const frames = Math.ceil((durationSec / params.speed) * rate);
      const ctx = new OfflineAudioContext(2, frames, rate);
      await ctx.audioWorklet.addModule(WORKLET_TAPE);
      await ctx.audioWorklet.addModule(WORKLET_GATE);
      const nodes = [];
      const make = (name, node) => { nodes.push([name, node]); return node; };

      const source = make('source', new AudioWorkletNode(ctx, 'tape-source', {
        numberOfOutputs: 1, outputChannelCount: [2],
      }));
      const preGain = make('preGain', new GainNode(ctx));
      const deess = make('deess', new BiquadFilterNode(ctx, {
        type: 'peaking', Q: 1.2,
      }));
      const notch = make('notch', new BiquadFilterNode(ctx, {
        type: 'notch',
      }));
      const gate = make('gate', new AudioWorkletNode(ctx, 'noise-gate', {
        numberOfInputs: 1, numberOfOutputs: 1,
        inputChannelCount: [2], outputChannelCount: [2],
      }));
      const mainOut = make('mainOut', new GainNode(ctx));
      const bypassOut = make('bypassOut', new GainNode(ctx));
      const muteOut = make('muteOut', new GainNode(ctx));
      const master = make('master', new GainNode(ctx));

      const sp = source.parameters;
      sp.get('speed').value = params.speed;
      sp.get('wowDepth').value = params.wowDepth;
      sp.get('clickLevel').value = params.clickLevel;
      sp.get('noiseLevel').value = params.noiseLevel;
      sp.get('running').value = paused ? 0 : 1;
      deess.frequency.value = params.deessFreq;
      deess.gain.value = params.deessGain;
      notch.frequency.value = params.notchFreq;
      notch.Q.value = params.notchQ;
      gate.parameters.get('thresholdDb').value = params.gateThreshold;
      gate.parameters.get('enabled').value = params.gateEnabled ? 1 : 0;
      master.gain.value = params.outputGain;

      source.connect(preGain);
      preGain.connect(deess);
      deess.connect(notch);
      notch.connect(gate);
      gate.connect(mainOut);
      source.connect(bypassOut);
      mainOut.connect(master);
      bypassOut.connect(master);
      muteOut.connect(master);
      mainOut.gain.value = mode === 'main' ? 1 : 0;
      bypassOut.gain.value = mode === 'bypass' ? 1 : 0;
      muteOut.gain.value = mode === 'mute' ? 1 : 0;
      master.connect(ctx.destination);

      const rendered = await ctx.startRendering();
      const channels = [];
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        channels.push(rendered.getChannelData(c).slice());
      }
      for (const [, node] of nodes) {
        try { node.disconnect(); } catch (_) { /* already gone */ }
      }
      return {
        channels,
        sampleRate: rate,
        nodeCount: nodes.length,
        graph: nodes.map(([name]) => name),
      };
    }

    listNodes() {
      return Object.keys(this.nodes);
    }

    teardown() {
      if (!this.ctx) return Promise.resolve();
      cancelAnimationFrame(this._meterTimer);
      const names = Object.keys(this.nodes);
      for (const name of names) {
        const node = this.nodes[name];
        try {
          if (typeof node.stop === 'function') node.stop(this.ctx.currentTime);
        } catch (_) { /* not stoppable */ }
        try { node.disconnect(); } catch (_) { /* already disconnected */ }
        delete this.nodes[name];
      }
      this.activeCount = 0;
      if (this.onActive) this.onActive(0);
      const ctx = this.ctx;
      this.ctx = null;
      this.isPlaying = false;
      return ctx.close();
    }
  }

  root.AudioEngine = AudioEngine;
})(typeof self !== 'undefined' ? self : globalThis);

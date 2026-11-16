import { clamp, DEFAULT_PARAMS, PROFILES } from "./scenario";
import type {
  EchoEvent,
  MonitorMode,
  ScanRecord,
  SonarParams,
  WavAnalysis,
  RenderResult,
} from "./types";

interface MixGraph {
  input: GainNode;
  output: GainNode;
  mainGain: GainNode;
  bypassGain: GainNode;
}

interface VoiceRef {
  sources: AudioScheduledSourceNode[];
  terminals: AudioNode[];
}

type StopHandler = (voice: VoiceRef) => void;

const MAX_TRANSPORT_BEATS = 16;
const LOOKAHEAD_SECONDS = 0.08;

export class SonarAudio {
  private ctx: AudioContext | null = null;
  private graph: MixGraph | null = null;
  private master: GainNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private meterLeft = new Float32Array(1024);
  private meterRight = new Float32Array(1024);
  private voices = new Set<VoiceRef>();
  private ambientSources: AudioScheduledSourceNode[] = [];
  private timers = new Set<number>();
  private animationFrame = 0;
  private params: SonarParams = { ...DEFAULT_PARAMS };
  private monitor: MonitorMode = "main";
  private playing = false;
  private startBeat = 0;
  private startTime = 0;
  private transportEnd = 0;
  private lastRecord: ScanRecord | null = null;
  private stopListener: (() => void) | null = null;

  get activeNodeCount(): number {
    return this.voices.size;
  }

  get currentMonitor(): MonitorMode {
    return this.monitor;
  }

  get isAudioReady(): boolean {
    return this.ctx !== null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get contextState(): string {
    return this.ctx?.state ?? "uninitialized";
  }

  setStopListener(listener: () => void): void {
    this.stopListener = listener;
  }

  async ensure(): Promise<AudioContext> {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.graph = this.createGraph(ctx, this.params, this.monitor);
      this.master = ctx.createGain();
      this.master.gain.value = this.params.master;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;
      this.graph.output.connect(this.master);
      this.master.connect(limiter);

      this.splitter = ctx.createChannelSplitter(2);
      this.analyserL = ctx.createAnalyser();
      this.analyserR = ctx.createAnalyser();
      this.analyserL.fftSize = 2048;
      this.analyserR.fftSize = 2048;
      limiter.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
      const meterSink = ctx.createGain();
      meterSink.gain.value = 0;
      this.analyserL.connect(meterSink);
      this.analyserR.connect(meterSink);
      meterSink.connect(ctx.destination);
      limiter.connect(ctx.destination);
      this.meterLeft = new Float32Array(this.analyserL.fftSize);
      this.meterRight = new Float32Array(this.analyserR.fftSize);
      this.monitorGains(0.004);
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  updateParams(next: SonarParams): void {
    this.params = { ...next };
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(next.master, this.ctx.currentTime, 0.015);
    }
  }

  setMonitor(mode: MonitorMode): void {
    this.monitor = mode;
    if (this.ctx) {
      this.monitorGains();
    }
  }

  getLevels(): { left: number; right: number; dbLeft: number; dbRight: number } {
    if (!this.analyserL || !this.analyserR) {
      return { left: 0, right: 0, dbLeft: -Infinity, dbRight: -Infinity };
    }
    this.analyserL.getFloatTimeDomainData(this.meterLeft);
    this.analyserR.getFloatTimeDomainData(this.meterRight);
    const left = rms(this.meterLeft);
    const right = rms(this.meterRight);
    return {
      left,
      right,
      dbLeft: toDb(left),
      dbRight: toDb(right),
    };
  }

  getMeterSamples(): { left: Float32Array; right: Float32Array } {
    if (this.analyserL && this.analyserR) {
      this.analyserL.getFloatTimeDomainData(this.meterLeft);
      this.analyserR.getFloatTimeDomainData(this.meterRight);
    }
    return { left: this.meterLeft, right: this.meterRight };
  }

  async startAmbient(): Promise<void> {
    const ctx = await this.ensure();
    if (this.ambientSources.length || !this.graph) return;
    const hum = ctx.createOscillator();
    const undertow = ctx.createOscillator();
    const humGain = ctx.createGain();
    const undertowGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    hum.type = "sine";
    undertow.type = "triangle";
    hum.frequency.value = 47;
    undertow.frequency.value = 73.5;
    humGain.gain.value = 0.018;
    undertowGain.gain.value = 0.007;
    filter.type = "lowpass";
    filter.frequency.value = 180;
    hum.connect(humGain).connect(filter);
    undertow.connect(undertowGain).connect(filter);
    filter.connect(this.graph.input);
    hum.start();
    undertow.start();
    const voice: VoiceRef = {
      sources: [hum, undertow],
      terminals: [filter],
    };
    this.trackVoice(voice);
    this.ambientSources = [hum, undertow];
  }

  async liveScan(contacts: EchoEvent[], beat: number): Promise<void> {
    const ctx = await this.ensure();
    const at = ctx.currentTime + 0.025;
    this.schedulePing(ctx, this.graph!.input, at, this.params);
    for (const echo of contacts) {
      this.scheduleEcho(ctx, this.graph!.input, at, echo, this.params);
    }
    this.startBeat = Math.max(this.startBeat, beat);
  }

  async replay(records: ScanRecord[], contactsHint?: EchoEvent[], fromBeat = 0): Promise<void> {
    const ctx = await this.ensure();
    this.pause();
    this.lastRecord = records[records.length - 1] ?? null;
    this.playing = true;
    this.startBeat = Math.max(0, fromBeat);
    this.startTime = ctx.currentTime + LOOKAHEAD_SECONDS;
    const secondsPerBeat = 60 / this.params.tempo;
    this.transportEnd = this.startTime + Math.max(0, MAX_TRANSPORT_BEATS - this.startBeat) * secondsPerBeat;
    await this.startAmbient();
    this.scheduleTransport(records, contactsHint, this.startBeat);
    this.startClock();
  }

  async step(records: ScanRecord[]): Promise<number> {
    const ctx = await this.ensure();
    if (this.playing) this.pause();
    const beat = Math.ceil(this.displayBeat());
    const at = ctx.currentTime + 0.03;
    const secondsPerBeat = 60 / this.params.tempo;
    this.scheduleBeatPulse(ctx, this.graph!.input, at, beat, this.params);
    const stepEnd = beat + 1;
    const record = this.lastRecord ?? records[records.length - 1];
    if (record) {
      const relative = record.beat - Math.floor(beat);
      if (relative >= -0.01 && relative < 1) {
        const pingAt = at + Math.max(0, relative) * secondsPerBeat;
        this.schedulePing(ctx, this.graph!.input, pingAt, this.params);
        for (const echo of record.echoes) {
          this.scheduleEcho(ctx, this.graph!.input, pingAt, echo, this.params);
        }
      }
    } else {
      this.schedulePing(ctx, this.graph!.input, at, this.params);
    }
    this.startBeat = stepEnd;
    this.startTime = at;
    this.startClock();
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      this.stopClock();
      this.stopAllVoices();
      this.stopListener?.();
    }, secondsPerBeat * 1000 + 350);
    this.timers.add(timer);
    return stepEnd;
  }

  async successCue(): Promise<void> {
    const ctx = await this.ensure();
    if (!this.graph) return;
    const at = ctx.currentTime + 0.03;
    const notes = [392, 523.25, 659.25, 783.99];
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      const noteAt = at + index * 0.13;
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, noteAt);
      gain.gain.setValueAtTime(0.0001, noteAt);
      gain.gain.exponentialRampToValueAtTime(0.11, noteAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.55);
      pan.pan.value = -0.65 + index * 0.42;
      osc.connect(gain).connect(pan).connect(this.graph!.input);
      osc.start(noteAt);
      osc.stop(noteAt + 0.58);
      this.trackVoice({ sources: [osc], terminals: [pan] });
    });
  }

  pause(): void {
    const pauseBeat = this.displayBeat();
    this.playing = false;
    this.startBeat = pauseBeat;
    this.stopAllVoices();
    this.stopClock();
  }

  stopEverything(): void {
    this.pause();
  }

  displayBeat(): number {
    if (!this.ctx) return this.startBeat;
    if (!this.playing) return this.startBeat;
    const elapsed = Math.max(0, this.ctx.currentTime - this.startTime);
    return this.startBeat + elapsed / (60 / this.params.tempo);
  }

  private createGraph(ctx: BaseAudioContext, params: SonarParams, monitor: MonitorMode): MixGraph {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const mainGain = ctx.createGain();
    const bypassGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    filter.type = "lowpass";
    filter.frequency.value = Math.max(1800, 2500 + params.echoGain * 500);
    filter.Q.value = 0.65;
    compressor.threshold.value = -19;
    compressor.knee.value = 13;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.14;
    input.connect(filter).connect(compressor).connect(mainGain).connect(output);
    input.connect(bypassGain).connect(output);
    mainGain.gain.value = monitor === "main" ? 0.82 : 0;
    bypassGain.gain.value = monitor === "bypass" ? 0.7 : 0;
    return { input, output, mainGain, bypassGain };
  }

  private monitorGains(timeConstant = 0.012): void {
    if (!this.ctx || !this.graph) return;
    const now = this.ctx.currentTime;
    const main = this.monitor === "main" ? 0.82 : 0;
    const bypass = this.monitor === "bypass" ? 0.7 : 0;
    this.graph.mainGain.gain.cancelScheduledValues(now);
    this.graph.bypassGain.gain.cancelScheduledValues(now);
    this.graph.mainGain.gain.setTargetAtTime(main, now, timeConstant);
    this.graph.bypassGain.gain.setTargetAtTime(bypass, now, timeConstant);
  }

  private scheduleTransport(records: ScanRecord[], contactsHint?: EchoEvent[], fromBeat = 0): void {
    if (!this.ctx || !this.graph) return;
    const ctx = this.ctx;
    const secondsPerBeat = 60 / this.params.tempo;
    const base = this.startTime;
    const maxBeat = this.transportSeconds() / secondsPerBeat;
    for (let beat = Math.ceil(fromBeat); beat < maxBeat; beat += 1) {
      this.scheduleBeatPulse(
        ctx,
        this.graph.input,
        base + (beat - fromBeat) * secondsPerBeat,
        beat,
        this.params,
      );
    }
    const scans = records.length
      ? records
      : contactsHint
        ? [{
            id: 0,
            beat: 1,
            time: 0,
            echoes: contactsHint,
          }]
        : [];
    for (const record of scans) {
      if (record.beat < fromBeat - 0.01) continue;
      const pingAt = base + (record.beat - fromBeat) * secondsPerBeat;
      this.schedulePing(ctx, this.graph.input, pingAt, this.params);
      for (const echo of record.echoes) {
        this.scheduleEcho(ctx, this.graph.input, pingAt, echo, this.params);
      }
    }
  }

  private transportSeconds(): number {
    return (MAX_TRANSPORT_BEATS * 60) / this.params.tempo;
  }

  private startClock(): void {
    this.stopClock();
    const tick = () => {
      if (!this.ctx) return;
      if (this.ctx.currentTime >= this.transportEnd && this.playing) {
        this.playing = false;
        this.stopAllVoices();
        this.stopListener?.();
        return;
      }
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private stopClock(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    for (const timer of this.timers) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
  }

  private trackVoice(voice: VoiceRef, onStopped?: StopHandler): void {
    this.voices.add(voice);
    let remaining = voice.sources.length;
    for (const source of voice.sources) {
      source.addEventListener("ended", () => {
        remaining -= 1;
        if (remaining <= 0) {
          this.voices.delete(voice);
          for (const terminal of voice.terminals) {
            try {
              terminal.disconnect();
            } catch {
              // The terminal may already be detached during a hard pause.
            }
          }
          onStopped?.(voice);
        }
      }, { once: true });
    }
  }

  private schedulePing(
    ctx: BaseAudioContext,
    destination: AudioNode,
    at: number,
    params: SonarParams,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const pan = ctx.createStereoPanner();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1080 + params.echoGain * 180, at);
    osc.frequency.exponentialRampToValueAtTime(360, at + 0.34);
    filter.type = "bandpass";
    filter.frequency.value = 720;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.19, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.48);
    osc.connect(filter).connect(gain).connect(pan).connect(destination);
    osc.start(at);
    osc.stop(at + 0.5);
    this.trackVoice({ sources: [osc], terminals: [pan] });
  }

  private scheduleEcho(
    ctx: BaseAudioContext,
    destination: AudioNode,
    pingAt: number,
    echo: EchoEvent,
    params: SonarParams,
  ): void {
    const profile = PROFILES[echo.kind];
    const start = pingAt + echo.delay;
    const strength = clamp(echo.intensity * params.echoGain, 0.025, 0.62);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(echo.pan * params.panWidth, -1, 1);
    pan.connect(destination);
    const sources: AudioScheduledSourceNode[] = [];

    for (let tap = 0; tap < profile.taps.length; tap += 1) {
      const tapAt = start + profile.taps[tap] * profile.decay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const glide = echo.kind === "rock" ? 0.75 : echo.kind === "shallow" ? 0.92 : 0.84;
      const tapGain = strength * Math.pow(0.52, tap);
      osc.type = profile.wave;
      osc.frequency.setValueAtTime(echo.frequency * (1 + tap * 0.025), tapAt);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(70, echo.frequency * glide),
        tapAt + profile.decay * 0.8,
      );
      filter.type = echo.kind === "shallow" ? "lowpass" : "bandpass";
      filter.frequency.value = echo.frequency;
      filter.Q.value = echo.kind === "rock" ? 1.8 : echo.kind === "debris" ? 0.7 : 0.5;
      gain.gain.setValueAtTime(0.0001, tapAt);
      gain.gain.exponentialRampToValueAtTime(tapGain, tapAt + 0.013);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        tapAt + Math.max(0.08, profile.decay * (echo.kind === "rock" ? 1.3 : 1.8)),
      );
      osc.connect(filter).connect(gain).connect(pan);
      osc.start(tapAt);
      osc.stop(tapAt + Math.max(0.1, profile.decay * 2));
      sources.push(osc);
    }

    if (echo.kind === "debris") {
      const noise = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      noise.buffer = seededNoise(ctx, 0.22, hashString(echo.contactId) + Math.round(echo.delay * 1000));
      filter.type = "bandpass";
      filter.frequency.value = 780;
      filter.Q.value = 0.55;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(strength * 0.34, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + profile.decay * 1.8);
      noise.connect(filter).connect(gain).connect(pan);
      noise.start(start);
      noise.stop(start + profile.decay * 1.9);
      sources.push(noise);
    }
    this.trackVoice({ sources, terminals: [pan] });
  }

  private scheduleBeatPulse(
    ctx: BaseAudioContext,
    destination: AudioNode,
    at: number,
    beat: number,
    params: SonarParams,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const tone = ctx.createBiquadFilter();
    osc.type = "sine";
    const accent = beat % 4 === 0;
    osc.frequency.setValueAtTime(accent ? 78 : 61, at);
    osc.frequency.exponentialRampToValueAtTime(accent ? 42 : 39, at + 0.12);
    tone.type = "lowpass";
    tone.frequency.value = 180;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.055 : 0.026, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(tone).connect(gain).connect(destination);
    osc.start(at);
    osc.stop(at + 0.22);
    this.trackVoice({ sources: [osc], terminals: [gain] });
    void params;
  }

  private stopAllVoices(): void {
    this.stopClock();
    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (const voice of [...this.voices]) {
        for (const source of voice.sources) {
          try {
            source.stop(now + 0.006);
          } catch {
            // Already stopped sources are safe to ignore.
          }
        }
        for (const terminal of voice.terminals) {
          try {
            terminal.disconnect();
          } catch {
            // Already disconnected terminals are safe to ignore.
          }
        }
        this.voices.delete(voice);
      }
    }
    this.ambientSources = [];
  }
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function toDb(value: number): number {
  return value > 0.000001 ? 20 * Math.log10(value) : -Infinity;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function seededNoise(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let state = seed || 1;
  for (let i = 0; i < length; i += 1) {
    state = Math.imul(1664525, state) + 1013904223;
    data[i] = ((state >>> 0) / 4294967296) * 2 - 1;
  }
  return buffer;
}

export function buildDefaultRecords(contacts: EchoEvent[], tempo: number): ScanRecord[] {
  const secondsPerBeat = 60 / tempo;
  return [{
    id: 1,
    beat: 1,
    time: 0,
    echoes: contacts.map((echo) => ({ ...echo, beat: 1 + echo.time / secondsPerBeat })),
  }];
}

export async function renderOffline(
  records: ScanRecord[],
  params: SonarParams,
  duration = 10,
  monitor: MonitorMode = "main",
): Promise<RenderResult> {
  const sampleRate = 44100;
  const frameCount = Math.ceil(duration * sampleRate);
  const ctx = new OfflineAudioContext(2, frameCount, sampleRate);
  const synth = new OfflineSynth(ctx, params, monitor);
  synth.schedule(records, duration);
  const buffer = await ctx.startRendering();
  const wav = encodeWav(buffer);
  return {
    buffer,
    wav,
    analysis: analyzeBuffer(buffer),
    events: records.flatMap((record) => record.echoes),
    duration: buffer.duration,
  };
}

class OfflineSynth {
  private ctx: OfflineAudioContext;
  private params: SonarParams;
  private monitor: MonitorMode;
  private graph: MixGraph;

  constructor(ctx: OfflineAudioContext, params: SonarParams, monitor: MonitorMode) {
    this.ctx = ctx;
    this.params = params;
    this.monitor = monitor;
    this.graph = this.createGraph();
  }

  schedule(records: ScanRecord[], duration: number): void {
    const secondsPerBeat = 60 / this.params.tempo;
    const totalBeats = Math.ceil(duration / secondsPerBeat);
    const scans = records.length
      ? records
      : buildDefaultRecords(defaultEchoes(this.params.tempo), this.params.tempo);
    for (let beat = 0; beat < totalBeats; beat += 1) {
      const at = beat * secondsPerBeat;
      if (at + 0.25 < duration) this.scheduleBeatPulse(at, beat);
    }
    for (const record of scans) {
      const base = Math.max(0, record.beat * secondsPerBeat);
      this.schedulePing(base);
      for (const echo of record.echoes) {
        this.scheduleEcho(base, echo, echo.delay);
      }
    }
  }

  private createGraph(): MixGraph {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const output = ctx.createGain();
    const mainGain = ctx.createGain();
    const bypassGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor();
    filter.type = "lowpass";
    filter.frequency.value = 2500 + this.params.echoGain * 500;
    filter.Q.value = 0.65;
    compressor.threshold.value = -19;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.14;
    input.connect(filter).connect(compressor).connect(mainGain).connect(output);
    input.connect(bypassGain).connect(output);
    mainGain.gain.value = this.monitor === "bypass" ? 0.0001 : 0.82;
    bypassGain.gain.value = this.monitor === "bypass" ? 0.7 : 0.0001;
    const master = ctx.createGain();
    master.gain.value = this.params.master;
    output.connect(master).connect(ctx.destination);
    return { input, output, mainGain, bypassGain };
  }

  private schedulePing(at: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1080 + this.params.echoGain * 180, at);
    osc.frequency.exponentialRampToValueAtTime(360, at + 0.34);
    filter.type = "bandpass";
    filter.frequency.value = 720;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.19, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.48);
    osc.connect(filter).connect(gain).connect(this.graph.input);
    osc.start(at);
    osc.stop(Math.min(at + 0.5, this.ctx.length / this.ctx.sampleRate));
  }

  private scheduleEcho(base: number, echo: EchoEvent, offset: number): void {
    const ctx = this.ctx;
    const profile = PROFILES[echo.kind];
    const start = base + offset;
    if (start >= ctx.length / ctx.sampleRate) return;
    const strength = clamp(echo.intensity * this.params.echoGain, 0.025, 0.62);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(echo.pan * this.params.panWidth, -1, 1);
    pan.connect(this.graph.input);
    for (let tap = 0; tap < profile.taps.length; tap += 1) {
      const tapAt = start + profile.taps[tap] * profile.decay;
      if (tapAt >= ctx.length / ctx.sampleRate) continue;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const glide = echo.kind === "rock" ? 0.75 : echo.kind === "shallow" ? 0.92 : 0.84;
      osc.type = profile.wave;
      osc.frequency.setValueAtTime(echo.frequency * (1 + tap * 0.025), tapAt);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(70, echo.frequency * glide),
        tapAt + profile.decay * 0.8,
      );
      filter.type = echo.kind === "shallow" ? "lowpass" : "bandpass";
      filter.frequency.value = echo.frequency;
      filter.Q.value = echo.kind === "rock" ? 1.8 : echo.kind === "debris" ? 0.7 : 0.5;
      gain.gain.setValueAtTime(0.0001, tapAt);
      gain.gain.exponentialRampToValueAtTime(strength * Math.pow(0.52, tap), tapAt + 0.013);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        tapAt + Math.max(0.08, profile.decay * (echo.kind === "rock" ? 1.3 : 1.8)),
      );
      osc.connect(filter).connect(gain).connect(pan);
      osc.start(tapAt);
      osc.stop(Math.min(tapAt + Math.max(0.1, profile.decay * 2), ctx.length / ctx.sampleRate));
    }
    if (echo.kind === "debris") {
      const noise = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      noise.buffer = seededNoise(ctx, 0.22, hashString(echo.contactId) + 19);
      filter.type = "bandpass";
      filter.frequency.value = 780;
      filter.Q.value = 0.55;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(strength * 0.34, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + profile.decay * 1.8);
      noise.connect(filter).connect(gain).connect(pan);
      noise.start(start);
      noise.stop(Math.min(start + profile.decay * 1.9, ctx.length / ctx.sampleRate));
    }
  }

  private scheduleBeatPulse(at: number, beat: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const accent = beat % 4 === 0;
    osc.type = "sine";
    osc.frequency.setValueAtTime(accent ? 78 : 61, at);
    osc.frequency.exponentialRampToValueAtTime(accent ? 42 : 39, at + 0.12);
    filter.type = "lowpass";
    filter.frequency.value = 180;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.055 : 0.026, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(filter).connect(gain).connect(this.graph.input);
    osc.start(at);
    osc.stop(at + 0.22);
  }
}

function defaultEchoes(tempo: number): EchoEvent[] {
  const templates: Array<{ kind: keyof typeof PROFILES; pan: number; delay: number; intensity: number }> = [
    { kind: "shallow", pan: -0.64, delay: 0.32, intensity: 0.52 },
    { kind: "rock", pan: 0.55, delay: 0.51, intensity: 0.9 },
    { kind: "debris", pan: 0.58, delay: 0.67, intensity: 0.27 },
    { kind: "exit", pan: -0.33, delay: 0.92, intensity: 0.4 },
  ];
  return templates.flatMap((template) =>
    PROFILES[template.kind].taps.map((tap, index) => ({
      contactId: `${template.kind}-${index}`,
      beat: 1 + (template.delay + tap * PROFILES[template.kind].decay * 1.8) / (60 / tempo),
      time: template.delay + tap * PROFILES[template.kind].decay * 1.8,
      kind: template.kind,
      pan: template.pan,
      delay: template.delay + tap * PROFILES[template.kind].decay * 1.8,
      intensity: template.intensity,
      frequency: PROFILES[template.kind].freq,
    })),
  );
}

function analyzeBuffer(buffer: AudioBuffer): WavAnalysis {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const leftMetric = channelMetrics(left, buffer.sampleRate);
  const rightMetric = channelMetrics(right, buffer.sampleRate);
  const tailFrames = Math.min(left.length, Math.floor(buffer.sampleRate * 0.25));
  const tailStart = left.length - tailFrames;
  let tailSum = 0;
  for (let i = tailStart; i < left.length; i += 1) {
    tailSum += left[i] * left[i] + right[i] * right[i];
  }
  return {
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    peakLeft: leftMetric.peak,
    peakRight: rightMetric.peak,
    peakTimeLeft: leftMetric.peakTime,
    peakTimeRight: rightMetric.peakTime,
    rmsLeft: leftMetric.rms,
    rmsRight: rightMetric.rms,
    peakCount: leftMetric.peakCount + rightMetric.peakCount,
    firstPeak: Math.min(leftMetric.firstPeak, rightMetric.firstPeak),
    lastPeak: Math.max(leftMetric.lastPeak, rightMetric.lastPeak),
    tailRms: Math.sqrt(tailSum / Math.max(1, tailFrames * 2)),
  };
}

function channelMetrics(samples: Float32Array, sampleRate: number) {
  let peak = 0;
  let peakTime = 0;
  let sum = 0;
  let peakCount = 0;
  let firstPeak = Infinity;
  let lastPeak = 0;
  let lastHit = -1;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i]);
    sum += samples[i] * samples[i];
    if (magnitude > peak) {
      peak = magnitude;
      peakTime = i / sampleRate;
    }
    if (magnitude > 0.075 && i - lastHit > sampleRate * 0.055) {
      peakCount += 1;
      const time = i / sampleRate;
      firstPeak = Math.min(firstPeak, time);
      lastPeak = Math.max(lastPeak, time);
      lastHit = i;
    }
  }
  return {
    peak,
    peakTime,
    rms: Math.sqrt(sum / Math.max(1, samples.length)),
    peakCount,
    firstPeak: Number.isFinite(firstPeak) ? firstPeak : 0,
    lastPeak,
  };
}

function encodeWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frameCount * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(data[channel][frame], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return bytes;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export { analyzeBuffer };

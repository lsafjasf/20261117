// Lightweight Web Audio beat synth, shared by live playback and offline export.

function playKick(ctx, destination, when, intensity = 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, when);
  osc.frequency.exponentialRampToValueAtTime(45, when + 0.14);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.5 * intensity, when + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
  osc.connect(gain).connect(destination);
  osc.start(when);
  osc.stop(when + 0.2);
}

function playHat(ctx, destination, when, intensity = 1) {
  const length = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 7000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12 * intensity, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  source.connect(highpass).connect(gain).connect(destination);
  source.start(when);
  source.stop(when + 0.06);
}

export function triggerBeat(ctx, destination, event, when) {
  if (event.kind === 'downbeat') {
    playKick(ctx, destination, when, event.intensity ?? 1);
  } else {
    playHat(ctx, destination, when, event.intensity ?? 0.6);
  }
}

// Deterministic offline render: every event placed on the same program timeline.
export async function renderOffline(events, duration, sampleRate = 48000) {
  const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtor(1, Math.ceil(duration * sampleRate), sampleRate);
  const compressor = ctx.createDynamicsCompressor();
  compressor.connect(ctx.destination);
  for (const event of events) {
    if (event.time < 0 || event.time >= duration) continue;
    triggerBeat(ctx, compressor, event, event.time);
  }
  return ctx.startRendering();
}

export class LiveBeatPlayer {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.master = audioContext.createGain();
    this.compressor = audioContext.createDynamicsCompressor();
    this.master.connect(this.compressor).connect(audioContext.destination);
    this.master.gain.value = 0.9;
    this.lookahead = 0.1;
    this.timer = null;
    this.nextIndex = 0;
  }

  // startAudioTime corresponds to program time `startProgramTime`.
  start(events, startProgramTime) {
    this.stop();
    this.events = events;
    this.baseAudioTime = this.ctx.currentTime + 0.06;
    this.baseProgramTime = startProgramTime;
    this.nextIndex = events.findIndex((e) => e.time >= startProgramTime);
    if (this.nextIndex < 0) this.nextIndex = events.length;
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
  }

  pump() {
    const horizon = this.ctx.currentTime + this.lookahead;
    while (this.nextIndex < this.events.length) {
      const event = this.events[this.nextIndex];
      const when = this.baseAudioTime + (event.time - this.baseProgramTime);
      if (when > horizon) break;
      if (when >= this.ctx.currentTime - 0.02) {
        triggerBeat(this.ctx, this.master, event, Math.max(when, this.ctx.currentTime));
      }
      this.nextIndex += 1;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

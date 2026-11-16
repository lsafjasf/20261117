export class StudioAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.streamDestination = null;
    this.ambient = null;
    this.anchor = 0;
    this.running = false;
    this.lastBeatIndex = -1;
    this.volume = 0.42;
    this.project = null;
  }

  async ensure() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("AUDIO_CONTEXT_UNAVAILABLE");
      this.context = new AudioContext({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async start(project, fromTime = 0) {
    await this.ensure();
    this.stop({ keepContext: true });
    this.project = project;
    this.volume = project.volume ?? this.volume;
    this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
    this.anchor = this.context.currentTime - fromTime;
    this.running = true;
    this.lastBeatIndex = Math.max(-1, Math.floor(fromTime / 0.5) - 1);
    this.startAmbient(project);
    this.schedule();
  }

  startAmbient(project) {
    if (!project.timeline.audio.length) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.028, now + 1.2);
    const low = ctx.createOscillator();
    low.type = "sine";
    low.frequency.value = 55;
    const fifth = ctx.createOscillator();
    fifth.type = "sine";
    fifth.frequency.value = 82.41;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    low.connect(filter);
    fifth.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    low.start(now);
    fifth.start(now);
    this.ambient = { low, fifth, gain };
  }

  schedule() {
    if (!this.running || !this.context || !this.project) return;
    const now = this.context.currentTime;
    this.scheduleBeats(now + 0.18);
    this.timer = window.setTimeout(() => this.schedule(), 80);
  }

  scheduleBeats(until) {
    if (!this.project?.metronome) return;
    const current = this.currentTime();
    const end = until - this.anchor;
    for (let index = Math.max(0, this.lastBeatIndex + 1); index * 0.5 <= end; index += 1) {
      const beatTime = index * 0.5;
      if (beatTime < current - 0.02) continue;
      this.click(beatTime, index % 4 === 0);
      this.lastBeatIndex = index;
    }
  }

  click(beatTime, accent) {
    if (!this.project?.timeline.events.some((event) => Math.abs(event.time - beatTime) < 0.02)) return;
    const ctx = this.context;
    const when = this.anchor + beatTime;
    if (when < ctx.currentTime) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(accent ? 1240 : 860, when);
    osc.frequency.exponentialRampToValueAtTime(accent ? 720 : 520, when + 0.035);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.09, when + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.055);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + 0.065);
  }

  currentTime() {
    if (!this.context || !this.running) return 0;
    return Math.max(0, this.context.currentTime - this.anchor);
  }

  seek(project, time) {
    if (!this.running || !this.context) return;
    this.anchor = this.context.currentTime - time;
    this.lastBeatIndex = Math.max(-1, Math.floor(time / 0.5) - 1);
    this.project = project;
  }

  setVolume(value) {
    this.volume = value;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.025);
    }
  }

  setMetronome(enabled) {
    if (!this.project) return;
    this.project.metronome = enabled;
  }

  async createExportDestination() {
    await this.ensure();
    if (!this.streamDestination) {
      this.streamDestination = this.context.createMediaStreamDestination();
      this.master.connect(this.streamDestination);
    }
    return this.streamDestination.stream;
  }

  stop({ keepContext = false } = {}) {
    this.running = false;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.ambient) {
      const now = this.context.currentTime;
      this.ambient.gain.gain.cancelScheduledValues(now);
      this.ambient.gain.gain.setTargetAtTime(0.0001, now, 0.025);
      try {
        this.ambient.low.stop(now + 0.15);
        this.ambient.fifth.stop(now + 0.15);
      } catch {
        // Oscillators may already have stopped after a failed playback.
      }
      this.ambient = null;
    }
    if (!keepContext && this.context?.state === "running") {
      this.context.suspend().catch(() => {});
    }
  }
}

export function beatPhase(time) {
  const interval = 0.5;
  const index = Math.floor(time / interval);
  const within = (time % interval) / interval;
  return { index, within, pulse: Math.max(0, 1 - within * 4.5) };
}

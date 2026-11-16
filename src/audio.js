import { clamp, clipEnd } from "./model.js";

function safeStop(node) {
  try {
    node.stop();
  } catch {
    // Already stopped by the browser.
  }
}

export class AudioEngine {
  constructor() {
    this.context = null;
    this.nodes = [];
    this.master = null;
    this.origin = 0;
    this.startedAt = 0;
    this.destination = null;
  }

  async ensureContext() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("当前浏览器不支持 Web Audio");
      this.context = new Context({ latencyHint: "interactive" });
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async start(project, fromTime, options = {}) {
    const context = options.context || await this.ensureContext();
    this.stop();
    this.context = context;
    this.destination = options.destination || context.destination;
    this.origin = fromTime;
    this.master = context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.destination);
    const until = options.until ?? project.timeline.outPoint;
    this.leadTime = Math.max(0, options.leadTime ?? 0);
    for (const clip of project.timeline.audioClips) {
      this.scheduleClip(context, clip, fromTime, until, this.leadTime);
    }
    for (const event of project.timeline.audioEvents) {
      if (event.at >= fromTime - 0.001 && event.at < until) {
        this.scheduleEvent(context, event, event.at - fromTime + this.leadTime);
      }
    }
    this.startedAt = context.currentTime;
    return context;
  }

  scheduleClip(context, clip, fromTime, until, leadTime = 0) {
    const start = Math.max(fromTime, clip.start);
    const end = Math.min(until, clipEnd(clip));
    if (end - start <= 0.01) return;
    const when = context.currentTime + leadTime + Math.max(0, start - fromTime);
    const duration = end - start;
    const fade = Math.min(0.14, duration / 5);
    const isBright = clip.tone === "bright";
    const frequencies = isBright ? [146.83, 220, 293.66] : [110, 164.81, 220];
    const bus = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = isBright ? 1350 : 850;
    bus.gain.setValueAtTime(0.0001, when);
    bus.gain.exponentialRampToValueAtTime(clamp(clip.gain, 0.01, 1) * 0.055, when + fade);
    bus.gain.setValueAtTime(clamp(clip.gain, 0.01, 1) * 0.055, when + Math.max(fade, duration - fade));
    bus.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    bus.connect(filter);
    filter.connect(this.master);
    this.nodes.push(bus, filter);

    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      oscillator.type = index === 1 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = (index - 1) * 4;
      voiceGain.gain.value = index === 0 ? 0.7 : 0.26;
      oscillator.connect(voiceGain);
      voiceGain.connect(bus);
      oscillator.start(when + index * 0.018);
      oscillator.stop(when + duration);
      this.nodes.push(oscillator, voiceGain);
    });
  }

  scheduleEvent(context, event, delay) {
    const when = context.currentTime + Math.max(0, delay);
    const gain = context.createGain();
    gain.connect(this.master);
    this.nodes.push(gain);
    const level = clamp(event.gain ?? 0.25, 0.02, 1);

    if (event.type === "impact") {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(92, when);
      oscillator.frequency.exponentialRampToValueAtTime(42, when + 0.32);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level * 0.65, when + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.38);
      oscillator.connect(gain);
      oscillator.start(when);
      oscillator.stop(when + 0.4);
      this.nodes.push(oscillator);
      return;
    }

    if (event.type === "tick") {
      const oscillator = context.createOscillator();
      oscillator.type = "square";
      oscillator.frequency.value = 1450;
      gain.gain.setValueAtTime(level * 0.11, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
      oscillator.connect(gain);
      oscillator.start(when);
      oscillator.stop(when + 0.05);
      this.nodes.push(oscillator);
      return;
    }

    const oscillator = context.createOscillator();
    oscillator.type = event.type === "rise" ? "sawtooth" : "sine";
    const startFrequency = event.type === "rise" ? 180 : 640;
    const endFrequency = event.type === "rise" ? 620 : 380;
    oscillator.frequency.setValueAtTime(startFrequency, when);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + 0.22);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level * 0.17, when + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    oscillator.connect(gain);
    oscillator.start(when);
    oscillator.stop(when + 0.32);
    this.nodes.push(oscillator);
  }

  currentTime() {
    if (!this.context) return this.origin;
    return this.origin + (this.context.currentTime - this.startedAt);
  }

  stop() {
    for (const node of this.nodes) {
      if (typeof node.stop === "function") safeStop(node);
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.nodes = [];
    if (this.master) {
      try {
        this.master.disconnect();
      } catch {
        // Already disconnected.
      }
      this.master = null;
    }
  }
}

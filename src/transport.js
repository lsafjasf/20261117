import {
  absoluteAudioEvents,
  serializeProject,
  deserializeProject,
  validateProject,
} from './engine.js';

const STORAGE_KEY = 'chart-video-timeline-project-v1';
const PENDING_KEY = 'chart-video-timeline-pending-export-v1';

export class Transport {
  constructor(project, { canvas, ctx, renderFrame, audioContext, livePlayer, onState } = {}) {
    this.project = project;
    this.canvas = canvas;
    this.ctx = ctx;
    this.renderFrame = renderFrame;
    this.audioContext = audioContext;
    this.livePlayer = livePlayer;
    this.onState = onState || (() => {});
    this.time = 0;
    this.playing = false;
    this.loop = project.settings?.loop ?? true;
    this.rafId = 0;
    this.lastWall = 0;
    this.audioEvents = absoluteAudioEvents(project);
    this.saveTimer = 0;
    this.hydrated = false;
  }

  replaceProject(project) {
    const wasPlaying = this.playing;
    this.pause();
    this.project = project;
    this.audioEvents = absoluteAudioEvents(project);
    this.loop = project.settings?.loop ?? this.loop;
    this.time = Math.min(this.time, project.duration);
    if (this.hydrated) this.autosave();
    if (wasPlaying) this.play();
    else this.draw();
    this.emit();
  }

  markHydrated() {
    this.hydrated = true;
  }

  get frame() {
    return Math.round(this.time * this.project.frameRate);
  }

  seek(time) {
    const clamped = Math.min(Math.max(0, time), this.project.duration);
    this.time = clamped;
    if (this.playing && this.livePlayer) {
      this.livePlayer.start(this.audioEvents, clamped);
    }
    this.draw();
    this.emit();
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.project.duration - 1e-4) this.time = 0;
    this.playing = true;
    this.lastWall = performance.now();
    if (this.audioContext && this.livePlayer) {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      this.livePlayer.start(this.audioEvents, this.time);
    }
    this.rafId = requestAnimationFrame((now) => this.tick(now));
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    if (this.livePlayer) this.livePlayer.stop();
    this.emit();
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  setLoop(value) {
    this.loop = value;
    this.emit();
  }

  tick(now) {
    if (!this.playing) return;
    const delta = Math.min(0.1, (now - this.lastWall) / 1000);
    this.lastWall = now;
    this.time += delta;
    if (this.time >= this.project.duration) {
      if (this.loop) {
        this.time %= this.project.duration;
        if (this.livePlayer) this.livePlayer.start(this.audioEvents, this.time);
      } else {
        this.time = this.project.duration;
        this.pause();
        this.draw();
        return;
      }
    }
    this.draw();
    this.emit();
    this.rafId = requestAnimationFrame((n) => this.tick(n));
  }

  draw() {
    if (this.renderFrame && this.ctx) {
      this.renderFrame(
        this.ctx,
        this.project,
        this.time,
        this.audioEvents,
        this.canvas.width,
        this.canvas.height,
      );
    }
  }

  emit() {
    this.onState({
      time: this.time,
      frame: this.frame,
      playing: this.playing,
      loop: this.loop,
      validation: validateProject(this.project),
    });
  }

  autosave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeProject(this.project));
      } catch (error) {
        console.warn('autosave failed', error);
      }
    }, 250);
  }

  saveToStorage() {
    localStorage.setItem(STORAGE_KEY, serializeProject(this.project));
  }

  markPendingExport(blob = null) {
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      at: Date.now(),
      time: this.time,
      hasBlob: Boolean(blob),
    }));
  }

  clearPendingExport() {
    localStorage.removeItem(PENDING_KEY);
  }

  static pendingExport() {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    } catch {
      return null;
    }
  }

  static loadSavedProject() {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    return deserializeProject(text);
  }

  static clearSavedProject() {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export { STORAGE_KEY, PENDING_KEY };

import { VIEW_W, VIEW_H, defaultParams, validateParams, mergeParams, PARAM_SCHEMA } from './params.js';
import { generateScene, countObjects } from './geometry.js';
import { renderScene, exportPNG, resetGrain } from './renderer.js';
import {
  loadParams, saveParams, saveViewDraft, loadViewDraft, clearViewDraft, hasStorage,
} from './storage.js';
import { AmbientAudio } from './audio.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export class PaperStreetApp {
  constructor({ canvas, onStatus, onStats }) {
    this.canvas = canvas;
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d');
    this.onStatus = onStatus || (() => {});
    this.onStats = onStats || (() => {});

    this.params = defaultParams();
    this.lastGoodParams = defaultParams();
    this.view = { viewX: 0, viewY: 0 };
    this.zoom = 1;
    this.paused = false;
    this.dragging = false;
    this.dragStart = null;
    this.frameToken = 0;
    this.storageReady = hasStorage();
    this.audio = new AmbientAudio();
    this.errorMessage = null;
  }

  init() {
    const { params, errors } = loadParams();
    this.params = params;
    this.lastGoodParams = { ...params };
    const draft = loadViewDraft();
    if (draft) this.view = { viewX: draft.viewX, viewY: draft.viewY };
    this.zoom = params.zoom;
    this.rebuildScene();
    this.draw();
    if (errors.length) this.showError(errors.join('；'));
    this.attachInput();
    return errors;
  }

  rebuildScene() {
    this.scene = generateScene(this.lastGoodParams);
    this.stats = countObjects(this.scene);
    resetGrain();
    this.onStats(this.stats);
  }

  draw() {
    renderScene(this.ctx, this.scene, this.lastGoodParams, {
      viewX: this.view.viewX,
      viewY: this.view.viewY,
      zoom: this.zoom,
    });
    this.frameToken += 1;
  }

  // Validate a full params object from the form/JSON input. On any error
  // the previous good frame stays on screen — never a white canvas.
  applyParams(rawPatch, { persist = false } = {}) {
    const result = validateParams(rawPatch);
    if (!result.ok) {
      this.showError(result.errors.join('；'));
      return { ok: false, errors: result.errors };
    }
    const merged = mergeParams(this.lastGoodParams, result.params);
    this.params = merged;
    this.lastGoodParams = { ...merged };
    this.errorMessage = null;
    this.zoom = merged.zoom;
    this.rebuildScene();
    this.draw();
    this.audio.setVolume(merged.masterVolume);
    if (persist) this.persistParams();
    this.onStatus({ type: 'ok', text: persist ? '参数已保存' : '参数已应用' });
    return { ok: true, errors: [], params: { ...merged } };
  }

  // Live field updates used by range sliders: invalid input is reported
  // but does not touch the current frame.
  applyField(key, rawValue, { persist = false } = {}) {
    return this.applyParams({ [key]: rawValue }, { persist });
  }

  showError(message) {
    this.errorMessage = message;
    this.onStatus({ type: 'error', text: message });
  }

  persistParams() {
    const ok = saveParams(this.lastGoodParams);
    if (!ok) this.showError('浏览器存储不可用，参数无法写入 localStorage');
    return ok;
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused) {
      this.audio.suspend();
    } else {
      this.audio.resume();
      this.draw();
    }
  }

  setView(viewX, viewY) {
    this.view = { viewX: clamp(viewX, -1, 1), viewY: clamp(viewY, -1, 1) };
    saveViewDraft(this.view);
    if (!this.paused) this.draw();
  }

  resetView() {
    this.setView(0, 0);
    clearViewDraft();
  }

  attachInput() {
    const el = this.canvas;
    const pointerPos = (event) => {
      const rect = el.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    };
    el.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.dragStart = { ...pointerPos(event), viewX: this.view.viewX, viewY: this.view.viewY };
      el.setPointerCapture(event.pointerId);
    });
    el.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const pos = pointerPos(event);
      const dx = (pos.x - this.dragStart.x) * 2;
      const dy = (pos.y - this.dragStart.y) * 2;
      this.setView(this.dragStart.viewX + dx, this.dragStart.viewY + dy);
    });
    const endDrag = (event) => {
      this.dragging = false;
      try { el.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      const spec = PARAM_SCHEMA.zoom;
      const next = clamp(this.zoom - Math.sign(event.deltaY) * 0.1, spec.min, spec.max);
      this.applyField('zoom', Number(next.toFixed(3)));
    }, { passive: false });
  }

  async toggleAudio() {
    if (this.audio.playing) {
      this.audio.stop();
      return { playing: false };
    }
    try {
      await this.audio.start();
      this.audio.setVolume(this.lastGoodParams.masterVolume);
      return { playing: true };
    } catch (error) {
      this.showError(error.message);
      return { playing: false, error: error.message };
    }
  }

  // Returns a PNG data URL; also triggers a browser download when asked.
  capturePNG(download = true) {
    this.draw();
    const dataUrl = exportPNG(this.ctx);
    if (download) {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `paper-street-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    return dataUrl;
  }

  // Debug/test snapshot: exact positions and ordering used by the frame.
  snapshot() {
    return {
      frameToken: this.frameToken,
      params: JSON.parse(JSON.stringify(this.lastGoodParams)),
      view: { ...this.view },
      zoom: this.zoom,
      paused: this.paused,
      stats: { ...this.stats },
      layerOrder: this.scene.layers.map((layer) => ({
        layerIndex: layer.layerIndex,
        depth: layer.depth,
        parallax: layer.parallax,
        buildingCount: layer.buildings.length,
        firstBuilding: { ...layer.buildings[0] },
      })),
    };
  }

  dispose() {
    this.audio.stop();
  }
}

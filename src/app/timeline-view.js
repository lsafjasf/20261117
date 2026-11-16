// 时间线视图：节目时间 -> 像素的唯一映射，视频/字幕/音频轨道共用，
// 因此播放头、片段与事件天然共享同一时间基准。
export class TimelineView {
  constructor(model, els, onSeek, onMoveClip) {
    this.model = model;
    this.els = els;
    this.onSeek = onSeek;
    this.onMoveClip = onMoveClip;
    this.pad = 0;
    this._bindScrub();
    this._bindDrag();
  }

  pxPerMs() {
    const width = this.els.timeline.clientWidth;
    return width / Math.max(1, this.model.durationMs);
  }

  left(ms) { return ms * this.pxPerMs(); }
  width(ms) { return ms * this.pxPerMs(); }

  render(conflictIds = new Set()) {
    const ppm = this.pxPerMs();
    const v = this.els.videoTrack;
    v.innerHTML = '';
    for (const clip of this.model.clips) {
      const el = document.createElement('div');
      el.className = `clip ${clip.source}${conflictIds.has(clip.id) ? ' conflict' : ''}`;
      el.dataset.clipId = clip.id;
      el.style.left = `${this.left(clip.inPoint)}px`;
      el.style.width = `${this.width(clip.outPoint - clip.inPoint)}px`;
      el.innerHTML = `<div>${clip.id}</div>
        <div class="meta">in ${clip.inPoint} · out ${clip.outPoint} · src ${clip.srcIn}→${clip.srcOut}</div>`;
      v.appendChild(el);
    }
    for (const tr of this.model.transitions) {
      const zone = document.createElement('div');
      zone.className = 'transition-zone';
      zone.style.left = `${this.left(tr.startMs)}px`;
      zone.style.width = `${this.width(tr.durationMs)}px`;
      zone.textContent = `转场: ${tr.type} ${tr.durationMs}ms`;
      v.appendChild(zone);
    }

    const sub = this.els.subTrack;
    sub.innerHTML = '';
    for (const s of this.model.subtitles) {
      const el = document.createElement('div');
      el.className = 'sub-item';
      el.style.left = `${this.left(s.startMs)}px`;
      el.style.width = `${this.width(s.endMs - s.startMs)}px`;
      el.textContent = s.text;
      sub.appendChild(el);
    }

    const aud = this.els.audioTrack;
    aud.innerHTML = '';
    for (const e of this.model.audioEvents) {
      const el = document.createElement('div');
      el.className = 'aud-item';
      el.style.left = `${this.left(e.atMs)}px`;
      el.style.width = `${this.width(e.durationMs)}px`;
      el.innerHTML = `<div>${e.id}</div><div class="freq">${e.freq}Hz · ${e.durationMs}ms</div>`;
      aud.appendChild(el);
    }
    this._renderRuler();
  }

  _renderRuler() {
    const ruler = this.els.ruler;
    ruler.innerHTML = '';
    const stepMs = 1000;
    for (let t = 0; t <= this.model.durationMs; t += stepMs) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = `${this.left(t)}px`;
      tick.textContent = `${t / 1000}s`;
      ruler.appendChild(tick);
    }
  }

  setPlayhead(ms) {
    this.els.playhead.style.left = `${this.left(ms)}px`;
  }

  _bindScrub() {
    const down = (e) => {
      if (e.target.closest('.clip')) return;
      this._scrubbing = true;
      this._seekFromEvent(e);
    };
    const move = (e) => { if (this._scrubbing) this._seekFromEvent(e); };
    const up = () => { this._scrubbing = false; };
    this.els.timeline.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  _seekFromEvent(e) {
    const rect = this.els.timeline.getBoundingClientRect();
    const ms = clampMs((e.clientX - rect.left) / this.pxPerMs(), this.model.durationMs);
    this.onSeek(ms);
  }

  _bindDrag() {
    let drag = null;
    this.els.videoTrack.addEventListener('mousedown', (e) => {
      const clipEl = e.target.closest('.clip');
      if (!clipEl) return;
      e.stopPropagation();
      drag = {
        id: clipEl.dataset.clipId,
        startX: e.clientX,
        origin: this.model.clips.find((c) => c.id === clipEl.dataset.clipId).inPoint,
      };
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const newIn = clampMs(drag.origin + (e.clientX - drag.startX) / this.pxPerMs(), this.model.durationMs);
      this.onMoveClip(drag.id, Math.round(newIn / 50) * 50);
    });
    window.addEventListener('mouseup', () => { drag = null; });
  }
}

const clampMs = (v, max) => Math.min(max, Math.max(0, v));

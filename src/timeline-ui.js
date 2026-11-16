import { clipDuration } from './engine.js';

const TRACK_HEIGHT = 64;
const RULER_HEIGHT = 26;

export class TimelineUI {
  constructor(container, transport, { onChange, onSelect } = {}) {
    this.container = container;
    this.transport = transport;
    this.onChange = onChange || (() => {});
    this.onSelect = onSelect || (() => {});
    this.selected = null;
    this.drag = null;
    this.conflictIds = new Set();
    this.conflictMarks = [];
    this.build();
    this.bind();
  }

  get duration() {
    return this.transport.project.duration;
  }

  pxPerSecond() {
    return (this.container.clientWidth - 24) / this.duration;
  }

  build() {
    this.container.innerHTML = `
      <div class="tl-ruler"></div>
      <div class="tl-track" data-track="video"></div>
      <div class="tl-track" data-track="subtitle"></div>
      <div class="tl-playhead"></div>
      <div class="tl-conflicts"></div>`;
    this.ruler = this.container.querySelector('.tl-ruler');
    this.playhead = this.container.querySelector('.tl-playhead');
    this.conflictLayer = this.container.querySelector('.tl-conflicts');
    this.tracks = [...this.container.querySelectorAll('.tl-track')];
    this.container.style.position = 'relative';
  }

  bind() {
    this.container.addEventListener('pointerdown', (event) => {
      const clipEl = event.target.closest('.tl-clip');
      if (clipEl) {
        const track = clipEl.closest('.tl-track').dataset.track;
        const id = clipEl.dataset.id;
        this.selected = { id, track };
        this.onSelect(this.selected);
        this.drag = {
          id, track,
          startX: event.clientX,
          originalStart: this.transport.project.tracks[track].find((c) => c.id === id).start,
          moved: false,
        };
        this.container.setPointerCapture(event.pointerId);
      } else {
        const rect = this.container.getBoundingClientRect();
        this.transport.seek(((event.clientX - rect.left - 12) / this.pxPerSecond()));
      }
    });
    this.container.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const delta = (event.clientX - this.drag.startX) / this.pxPerSecond();
      if (Math.abs(delta) > 0.02) this.drag.moved = true;
      const newStart = Math.round((this.drag.originalStart + delta) * 20) / 20;
      this.onChange({ type: 'move', id: this.drag.id, track: this.drag.track, start: Math.max(0, newStart) });
    });
    const endDrag = () => { this.drag = null; };
    this.container.addEventListener('pointerup', endDrag);
    this.container.addEventListener('pointercancel', endDrag);
  }

  setConflicts(conflicts) {
    this.conflictIds = new Set();
    this.conflictMarks = conflicts;
    for (const conflict of conflicts) {
      conflict.clipId.split(' <-> ').forEach((id) => this.conflictIds.add(id));
    }
  }

  render() {
    const pps = this.pxPerSecond();
    this.ruler.innerHTML = '';
    for (let s = 0; s <= this.duration; s += 1) {
      const tick = document.createElement('div');
      tick.className = 'tl-tick';
      tick.style.left = `${12 + s * pps}px`;
      tick.textContent = `${s}s`;
      this.ruler.appendChild(tick);
    }
    this.tracks.forEach((trackEl) => {
      const trackName = trackEl.dataset.track;
      trackEl.innerHTML = '';
      trackEl.style.height = `${TRACK_HEIGHT}px`;
      for (const clip of this.transport.project.tracks[trackName] || []) {
        const duration = clipDuration(clip);
        const el = document.createElement('div');
        el.className = 'tl-clip';
        el.dataset.id = clip.id;
        el.style.left = `${12 + clip.start * pps}px`;
        el.style.width = `${duration * pps}px`;
        el.classList.toggle('is-conflict', this.conflictIds.has(clip.id));
        el.classList.toggle('is-selected', this.selected?.id === clip.id);
        const label = clip.type === 'subtitle' ? clip.text : clip.title;
        el.innerHTML = `<span class="tl-clip-label">${label}</span>
          <span class="tl-clip-time">${clip.start.toFixed(2)}–${(clip.start + duration).toFixed(2)}s</span>`;
        if (clip.transition?.duration > 0 && trackName === 'video') {
          const overlap = document.createElement('div');
          overlap.className = 'tl-transition';
          overlap.style.width = `${clip.transition.duration * pps}px`;
          overlap.title = `转场 ${clip.transition.duration}s`;
          el.appendChild(overlap);
        }
        trackEl.appendChild(el);
      }
    });
    this.conflictLayer.innerHTML = '';
    for (const conflict of this.conflictMarks) {
      const mark = document.createElement('div');
      mark.className = 'tl-conflict-mark';
      mark.style.left = `${12 + conflict.at * pps - 8}px`;
      mark.title = conflict.reason;
      mark.textContent = '!';
      this.conflictLayer.appendChild(mark);
    }
    this.updatePlayhead();
  }

  updatePlayhead() {
    const pps = this.pxPerSecond();
    this.playhead.style.left = `${12 + this.transport.time * pps}px`;
  }
}

export { RULER_HEIGHT, TRACK_HEIGHT };

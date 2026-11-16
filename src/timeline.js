// 时间线画布：片段块、鼓点事件、播放头、入/出点、冲突区间。
// 拖动片段调用 model.moveClip（重叠会被模型拒绝），拖动播放头写入共享时钟。

import { FRAME, getVideoTrack, getAudioTrack, findOverlaps, round3 } from './model.js';

const ROW_HEIGHT = 34;
const PADDING = 12;

export class TimelineView {
  constructor(canvas, clock, getProject, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.clock = clock;
    this.getProject = getProject;
    this.onChange = onChange;
    this.drag = null;
    this.bindEvents();
  }

  duration() {
    return this.getProject().sourceDuration;
  }

  timeAt(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = (clientX - rect.left - PADDING) / (rect.width - PADDING * 2);
    return round3(Math.min(Math.max(ratio, 0), 1) * this.duration());
  }

  clipAt(timelineTime) {
    return getVideoTrack(this.getProject()).clips.find(
      (clip) => timelineTime >= clip.timelineStart && timelineTime < clip.timelineEnd,
    );
  }

  bindEvents() {
    const down = (event) => {
      const time = this.timeAt(event.clientX);
      const rect = this.canvas.getBoundingClientRect();
      const inVideoRow = event.clientY - rect.top > 46 && event.clientY - rect.top < 86;
      const clip = inVideoRow ? this.clipAt(time) : null;
      if (clip) {
        this.drag = {
          type: 'clip',
          clipId: clip.id,
          offset: round3(time - clip.timelineStart),
        };
      } else {
        this.drag = { type: 'playhead' };
        this.clock.seek(time);
      }
    };
    const move = (event) => {
      if (!this.drag) return;
      const time = this.timeAt(event.clientX);
      if (this.drag.type === 'playhead') {
        this.clock.seek(time);
      } else {
        const result = this.onChange('moveClip', {
          clipId: this.drag.clipId,
          start: round3(time - this.drag.offset),
        });
        if (!result.ok && this.canvas.parentElement) {
          this.canvas.dataset.lastError = result.reason;
        }
      }
    };
    const up = () => { this.drag = null; };
    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  x(time) {
    const width = this.canvas.width - PADDING * 2;
    return PADDING + (time / this.duration()) * width;
  }

  draw() {
    const ctx = this.ctx;
    const project = this.getProject();
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#10141d';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#2a3140';
    ctx.fillStyle = '#7d88a0';
    ctx.font = '11px monospace';
    for (let second = 0; second <= this.duration(); second += 2) {
      const x = this.x(second);
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, height - 8);
      ctx.stroke();
      ctx.fillText(`${second}s`, x + 2, 14);
    }

    this.drawInOut(project);
    this.drawClips(project);
    this.drawEvents(project);
    this.drawConflicts(project);
    this.drawPlayhead();
  }

  drawInOut(project) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,200,60,0.12)';
    ctx.fillRect(this.x(project.inPoint), 18, this.x(project.outPoint) - this.x(project.inPoint), this.canvas.height - 28);
    ctx.strokeStyle = '#ffc83c';
    ctx.lineWidth = 2;
    for (const time of [project.inPoint, project.outPoint]) {
      ctx.beginPath();
      ctx.moveTo(this.x(time), 18);
      ctx.lineTo(this.x(time), this.canvas.height - 10);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  drawClips(project) {
    const ctx = this.ctx;
    for (const clip of getVideoTrack(project).clips) {
      const x = this.x(clip.timelineStart);
      const w = Math.max(2, this.x(clip.timelineEnd) - x);
      ctx.fillStyle = '#2f6fed';
      ctx.fillRect(x, 50, w, ROW_HEIGHT);
      ctx.fillStyle = '#cfe0ff';
      ctx.font = '11px monospace';
      ctx.fillText(`${clip.sourceStart.toFixed(2)}-${clip.sourceEnd.toFixed(2)}`, x + 4, 70);
      if (clip.transitionIn) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x, 50, Math.max(4, this.x(clip.timelineStart + clip.transitionIn.duration) - x), ROW_HEIGHT);
      }
    }
  }

  drawEvents(project) {
    const ctx = this.ctx;
    const events = getAudioTrack(project).events;
    ctx.fillStyle = '#ff7a59';
    for (const event of events) {
      const x = this.x(event.sourceTime);
      ctx.beginPath();
      ctx.moveTo(x, 96);
      ctx.lineTo(x - 5, 108);
      ctx.lineTo(x + 5, 108);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#9aa6bd';
    ctx.fillText('音频事件（源时间）', PADDING, 124);
  }

  drawConflicts(project) {
    const ctx = this.ctx;
    for (const conflict of findOverlaps(project)) {
      const x = this.x(conflict.start);
      const w = Math.max(3, this.x(conflict.end) - x);
      ctx.fillStyle = 'rgba(255,60,60,0.85)';
      ctx.fillRect(x, 44, w, this.canvas.height - 52);
      ctx.fillStyle = '#ffd6d6';
      ctx.fillText(`冲突 ${conflict.start.toFixed(2)}s`, x + 2, 42);
    }
  }

  drawPlayhead() {
    const ctx = this.ctx;
    const x = this.x(this.clock.state.time);
    ctx.strokeStyle = '#e8f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, this.canvas.height - 8);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  snapToFrame(time) {
    return round3(Math.round(time / FRAME) * FRAME);
  }
}

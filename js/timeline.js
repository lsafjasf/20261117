/*
 * timeline.js — 节目时间线 UI。
 * 片段块可拖动（联动音频事件可选）、播放头可拖动、
 * 支持在播放头处分割片段、为相邻片段添加转场；
 * 校验冲突以红色区间高亮。所有操作写入操作日志（供失败回放）。
 */
(function (root) {
  "use strict";

  const PX_PER_SEC = 40;

  class Timeline {
    constructor(container, project, transport, hooks) {
      this.root = container;
      this.project = project;
      this.transport = transport;
      this.hooks = hooks; // { onEdit(opLabel), onSeek() }
      this.issues = [];
      this.selectedClipId = null;
      this._build();
    }

    setProject(project) {
      this.project = project;
      this.render();
    }

    setIssues(issues) {
      this.issues = issues;
      this.render();
    }

    _build() {
      this.root.innerHTML = "";
      this.ruler = document.createElement("div");
      this.ruler.className = "tl-ruler";
      this.videoLane = document.createElement("div");
      this.videoLane.className = "tl-lane";
      this.audioLane = document.createElement("div");
      this.audioLane.className = "tl-lane tl-audio";
      this.creditsLane = document.createElement("div");
      this.creditsLane.className = "tl-lane tl-credits";
      this.playhead = document.createElement("div");
      this.playhead.className = "tl-playhead";
      this.root.append(this.ruler, this.videoLane, this.audioLane, this.creditsLane, this.playhead);

      // 拖动播放头
      this.root.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".tl-clip")) return; // 片段拖动另处理
        this._scrubbing = true;
        this._scrubTo(e);
        const move = (ev) => this._scrubTo(ev);
        const up = () => {
          this._scrubbing = false;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      this.render();
    }

    _scrubTo(e) {
      const rect = this.root.getBoundingClientRect();
      const t = (e.clientX - rect.left + this.root.scrollLeft) / PX_PER_SEC;
      this.transport.seek(t);
      this.hooks.onSeek();
    }

    render() {
      const M = root.CreditModel;
      const dur = Math.max(M.programDuration(this.project), 1);
      this.root.style.width = (dur * PX_PER_SEC + 60) + "px";
      // 标尺
      this.ruler.innerHTML = "";
      for (let sec = 0; sec <= Math.ceil(dur); sec++) {
        const tick = document.createElement("span");
        tick.className = "tl-tick";
        tick.style.left = sec * PX_PER_SEC + "px";
        tick.textContent = sec + "s";
        this.ruler.appendChild(tick);
      }
      // 视频片段块
      this.videoLane.innerHTML = "";
      for (const clip of this.project.clips) {
        const el = document.createElement("div");
        el.className = "tl-clip" + (clip.id === this.selectedClipId ? " selected" : "");
        el.style.left = clip.start * PX_PER_SEC + "px";
        el.style.width = clip.duration * PX_PER_SEC + "px";
        el.style.background = `hsl(${clip.hue}, 45%, 38%)`;
        el.textContent = `${clip.name} [${clip.inPoint.toFixed(1)}–${clip.outPoint.toFixed(1)}]`;
        el.dataset.clipId = clip.id;
        this._makeDraggable(el, clip);
        this.videoLane.appendChild(el);
      }
      // 转场标记
      for (const tr of this.project.transitions) {
        const from = this.project.clips.find((c) => c.id === tr.from);
        if (!from) continue;
        const el = document.createElement("div");
        el.className = "tl-transition";
        el.style.left = (from.start + from.duration - tr.duration) * PX_PER_SEC + "px";
        el.style.width = tr.duration * PX_PER_SEC + "px";
        el.title = `转场 ${tr.duration}s`;
        this.videoLane.appendChild(el);
      }
      // 音频事件
      this.audioLane.innerHTML = "";
      for (const a of this.project.audioEvents) {
        const el = document.createElement("div");
        el.className = "tl-audio-event";
        el.style.left = a.start * PX_PER_SEC + "px";
        el.style.width = a.duration * PX_PER_SEC + "px";
        el.textContent = a.type;
        this.audioLane.appendChild(el);
      }
      // 字幕区间
      this.creditsLane.innerHTML = "";
      const cStart = this.project.credits.startTime;
      const cEnd = M.creditsEndTime(this.project);
      const cEl = document.createElement("div");
      cEl.className = "tl-credits-span";
      cEl.style.left = cStart * PX_PER_SEC + "px";
      cEl.style.width = (cEnd - cStart) * PX_PER_SEC + "px";
      cEl.textContent = "滚动片尾";
      this.creditsLane.appendChild(cEl);
      // 冲突高亮
      for (const issue of this.issues) {
        const el = document.createElement("div");
        el.className = "tl-conflict";
        el.style.left = issue.start * PX_PER_SEC + "px";
        el.style.width = Math.max(4, (issue.end - issue.start) * PX_PER_SEC) + "px";
        el.title = issue.message;
        this.videoLane.appendChild(el);
      }
      this.updatePlayhead();
    }

    _makeDraggable(el, clip) {
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.selectedClipId = clip.id;
        const startX = e.clientX;
        const origStart = clip.start;
        const move = (ev) => {
          const delta = (ev.clientX - startX) / PX_PER_SEC;
          root.CreditModel.moveClip(this.project, clip.id, Math.max(0, origStart + delta), true);
          this.render();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          this.hooks.onEdit(`移动片段「${clip.name}」→ ${clip.start.toFixed(2)}s`);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        this.render();
      });
    }

    /** 在播放头处分割选中的片段 */
    splitAtPlayhead() {
      if (!this.selectedClipId) return "请先选中一个片段";
      const t = this.transport.currentTime;
      try {
        const r = root.CreditModel.splitClip(this.project, this.selectedClipId, t);
        this.selectedClipId = r.second.id;
        this.hooks.onEdit(`分割片段于 ${t.toFixed(2)}s`);
        this.render();
        return null;
      } catch (err) {
        return "分割失败：" + err.message;
      }
    }

    /** 为选中片段与其后继添加 1s 交叉淡化 */
    addTransitionToNext() {
      if (!this.selectedClipId) return "请先选中一个片段";
      const sorted = [...this.project.clips].sort((a, b) => a.start - b.start);
      const idx = sorted.findIndex((c) => c.id === this.selectedClipId);
      if (idx < 0 || idx >= sorted.length - 1) return "没有后继片段";
      try {
        root.CreditModel.addTransition(this.project, sorted[idx].id, sorted[idx + 1].id, 1.0);
        this.hooks.onEdit(`添加转场 ${sorted[idx].name} ⇒ ${sorted[idx + 1].name}`);
        this.render();
        return null;
      } catch (err) {
        return "转场失败：" + err.message;
      }
    }

    updatePlayhead() {
      this.playhead.style.left = this.transport.currentTime * PX_PER_SEC + "px";
    }
  }

  root.Timeline = Timeline;
  root.TIMELINE_PX_PER_SEC = PX_PER_SEC;
})(typeof self !== "undefined" ? self : this);

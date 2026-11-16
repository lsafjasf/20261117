/* Canvas 时间线与节目画面渲染。
   所有绘制坐标均由同一时间->像素映射得出，保证播放头、波形、字幕、片段同源。 */
(function (root, factory) {
  var api = factory(
    (typeof module === "object" && module.exports) ? require("./util.js") : root.TC.util,
    (typeof module === "object" && module.exports) ? require("./audio.js") : root.TC.audio
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TC = root.TC || {};
  root.TC.renderer = api;
})(typeof self !== "undefined" ? self : this, function (util, audioApi) {
  "use strict";

  var LANE = {
    ruler: { y: 8, h: 26 },
    audio: { y: 44, h: 70 },
    clip: { y: 124, h: 78 },
    subtitles: { y: 212, h: 96 },
    loop: { y: 318, h: 30 }
  };
  var PADDING_X = 16;
  var HANDLE_PX = 7;

  function TimelineRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.peaks = null;
    this.conflictLocs = [];
  }

  TimelineRenderer.prototype.metrics = function (project) {
    var width = this.canvas ? this.canvas.width : 1200;
    var usable = width - PADDING_X * 2;
    return {
      pad: PADDING_X,
      usable: usable,
      pxPerSec: usable / project.duration,
      xOf: function (time) { return PADDING_X + time * (usable / project.duration); },
      timeOf: function (x) {
        return util.clamp((x - PADDING_X) / (usable / project.duration), 0, project.duration);
      }
    };
  };

  TimelineRenderer.prototype.setConflicts = function (locs) {
    this.conflictLocs = locs || [];
  };

  TimelineRenderer.prototype.drawRuler = function (project, m) {
    var ctx = this.ctx;
    ctx.fillStyle = "#10151d";
    ctx.fillRect(0, 0, this.canvas.width, LANE.ruler.h + LANE.ruler.y);
    ctx.strokeStyle = "#33404f";
    ctx.fillStyle = "#8b95a5";
    ctx.font = "11px monospace";
    ctx.textBaseline = "top";
    var step = project.duration > 10 ? 1 : 0.5;
    for (var t = 0; t <= project.duration + util.EPS; t += step) {
      var x = m.xOf(t);
      ctx.beginPath();
      ctx.moveTo(x, LANE.ruler.y + 12);
      ctx.lineTo(x, LANE.ruler.y + LANE.ruler.h);
      ctx.stroke();
      ctx.fillText(t.toFixed(1) + "s", x + 3, LANE.ruler.y);
    }
  };

  TimelineRenderer.prototype.drawAudioLane = function (project, m) {
    var ctx = this.ctx;
    var lane = LANE.audio;
    ctx.fillStyle = "#0d1219";
    ctx.fillRect(0, lane.y, this.canvas.width, lane.h);
    ctx.fillStyle = "#7d8796";
    ctx.font = "11px sans-serif";
    ctx.fillText("音频 · 合成节拍波形", PADDING_X, lane.y + 2);
    if (!this.peaks) this.peaks = audioApi.buildBeatPeaks(project.beats, project.duration, 0.02);
    var mid = lane.y + lane.h / 2 + 8;
    ctx.strokeStyle = "#3b4a5c";
    ctx.beginPath();
    ctx.moveTo(PADDING_X, mid);
    ctx.lineTo(this.canvas.width - PADDING_X, mid);
    ctx.stroke();
    var binWidth = m.usable / this.peaks.length;
    ctx.fillStyle = "#4c7899";
    for (var i = 0; i < this.peaks.length; i++) {
      var h = Math.max(1, this.peaks[i] * (lane.h - 20));
      var x = PADDING_X + i * binWidth;
      ctx.fillRect(x, mid - h / 2, Math.max(1, binWidth - 0.4), h);
    }
    project.beats.forEach(function (beat) {
      var bx = m.xOf(beat.time);
      ctx.strokeStyle = beat.kind === "kick" ? "#d08770" : beat.kind === "snare" ? "#ebcb8b" : "#88c0d0";
      ctx.beginPath();
      ctx.moveTo(bx, lane.y + 16);
      ctx.lineTo(bx, lane.y + lane.h - 2);
      ctx.stroke();
    });
  };

  TimelineRenderer.prototype.drawClipLane = function (project, m) {
    var ctx = this.ctx;
    var lane = LANE.clip;
    ctx.fillStyle = "#0d1219";
    ctx.fillRect(0, lane.y, this.canvas.width, lane.h);
    ctx.fillStyle = "#7d8796";
    ctx.font = "11px sans-serif";
    ctx.fillText("视频片段轨", PADDING_X, lane.y + 2);
    project.clips.forEach(function (clip) {
      var x = m.xOf(clip.start);
      var w = Math.max(4, m.xOf(clip.end) - x);
      var top = lane.y + 18;
      ctx.fillStyle = clip.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, top, w, lane.h - 24);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#e5e9f0";
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, lane.h - 25);
      if (clip.transitionIn > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(x, top, m.pxPerSec * clip.transitionIn, lane.h - 24);
      }
      if (clip.transitionOut > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(x + w - m.pxPerSec * clip.transitionOut, top,
          m.pxPerSec * clip.transitionOut, lane.h - 24);
      }
      ctx.fillStyle = "#0b0e13";
      ctx.font = "12px sans-serif";
      ctx.fillText(clip.name + "  " + (clip.end - clip.start).toFixed(2) + "s", x + 6, top + 8);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, top, HANDLE_PX, lane.h - 24);
      ctx.fillRect(x + w - HANDLE_PX, top, HANDLE_PX, lane.h - 24);
    });
    this.drawConflictMarkers(lane, "clip", m);
  };

  TimelineRenderer.prototype.drawConflictMarkers = function (lane, laneKey, m) {
    var ctx = this.ctx;
    this.conflictLocs.forEach(function (loc) {
      if (!loc) return;
      var belongs = false;
      if (laneKey === "clip") {
        belongs = loc.track === 0;
      } else if (laneKey === "subtitles") {
        belongs = loc.lane === "subtitles";
      } else if (laneKey === "audio") {
        belongs = loc.lane === "audio";
      }
      if (!belongs) return;
      var x = m.xOf(loc.time);
      ctx.strokeStyle = "#bf616a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 6, lane.y + 14);
      ctx.lineTo(x + 6, lane.y + lane.h - 4);
      ctx.moveTo(x + 6, lane.y + 14);
      ctx.lineTo(x - 6, lane.y + lane.h - 4);
      ctx.stroke();
      ctx.lineWidth = 1;
    });
  };

  TimelineRenderer.prototype.drawSubtitleLane = function (project, m) {
    var ctx = this.ctx;
    var lane = LANE.subtitles;
    ctx.fillStyle = "#0d1219";
    ctx.fillRect(0, lane.y, this.canvas.width, lane.h);
    ctx.fillStyle = "#7d8796";
    ctx.font = "11px sans-serif";
    var self = this;
    project.subtitles.forEach(function (cue) {
      var x = m.xOf(cue.start);
      var w = Math.max(8, m.xOf(cue.end) - x);
      var top = lane.y + 18;
      ctx.fillStyle = "#2e4a5e";
      ctx.fillRect(x, top, w, lane.h - 30);
      ctx.strokeStyle = "#88c0d0";
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, lane.h - 31);
      ctx.fillStyle = "#d8dee9";
      ctx.font = "12px sans-serif";
      ctx.fillText(cue.text, x + 5, top + 6);
      cue.chars.forEach(function (item) {
        var cx = m.xOf(item.t);
        ctx.strokeStyle = "#a3be8c";
        ctx.beginPath();
        ctx.moveTo(cx, top + 22);
        ctx.lineTo(cx, top + lane.h - 34);
        ctx.stroke();
        ctx.fillStyle = "#ebcb8b";
        ctx.beginPath();
        ctx.arc(cx, top + 22, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, top, HANDLE_PX, lane.h - 30);
      ctx.fillRect(x + w - HANDLE_PX, top, HANDLE_PX, lane.h - 30);
    });
    this.drawConflictMarkers(lane, "subtitles", m);
  };

  TimelineRenderer.prototype.drawLoopAndPlayhead = function (project, time, m) {
    var ctx = this.ctx;
    var lane = LANE.loop;
    ctx.fillStyle = "#0d1219";
    ctx.fillRect(0, lane.y, this.canvas.width, lane.h);
    if (project.loop.enabled) {
      var x1 = m.xOf(project.loop.start);
      var x2 = m.xOf(project.loop.end);
      ctx.fillStyle = "rgba(163,190,140,0.18)";
      ctx.fillRect(x1, lane.y, x2 - x1, lane.h);
      ctx.strokeStyle = "#a3be8c";
      ctx.strokeRect(x1, lane.y + 3, x2 - x1, lane.h - 6);
      ctx.fillStyle = "#a3be8c";
      ctx.font = "11px sans-serif";
      ctx.fillText("循环区", x1 + 4, lane.y + 9);
    }
    var px = m.xOf(time);
    ctx.strokeStyle = "#d08770";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 4);
    ctx.lineTo(px, this.canvas.height - 4);
    ctx.stroke();
    ctx.fillStyle = "#d08770";
    ctx.beginPath();
    ctx.moveTo(px - 7, 4);
    ctx.lineTo(px + 7, 4);
    ctx.lineTo(px, 14);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
  };

  TimelineRenderer.prototype.render = function (project, time) {
    if (!this.ctx) return;
    var m = this.metrics(project);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawRuler(project, m);
    this.drawAudioLane(project, m);
    this.drawClipLane(project, m);
    this.drawSubtitleLane(project, m);
    this.drawLoopAndPlayhead(project, time, m);
  };

  TimelineRenderer.prototype.invalidatePeaks = function () {
    this.peaks = null;
  };

  /* ---------- 命中测试 ---------- */

  TimelineRenderer.prototype.hitTest = function (project, x, y) {
    var m = this.metrics(project);
    var time = m.timeOf(x);
    if (y >= LANE.ruler.y && y <= LANE.ruler.y + LANE.ruler.h) {
      return { type: "ruler", time: time };
    }
    if (y >= LANE.clip.y && y <= LANE.clip.y + LANE.clip.h) {
      for (var i = project.clips.length - 1; i >= 0; i--) {
        var clip = project.clips[i];
        var cx = m.xOf(clip.start), cw = m.xOf(clip.end) - cx;
        if (x < cx || x > cx + cw) continue;
        if (x <= cx + HANDLE_PX + 2) return { type: "clip-edge", edge: "in", id: clip.id, time: time };
        if (x >= cx + cw - HANDLE_PX - 2) return { type: "clip-edge", edge: "out", id: clip.id, time: time };
        return { type: "clip-body", id: clip.id, time: time, grabOffset: time - clip.start };
      }
    }
    if (y >= LANE.subtitles.y && y <= LANE.subtitles.y + LANE.subtitles.h) {
      for (var j = project.subtitles.length - 1; j >= 0; j--) {
        var cue = project.subtitles[j];
        var qx = m.xOf(cue.start), qw = m.xOf(cue.end) - qx;
        if (x < qx || x > qx + qw) continue;
        if (x <= qx + HANDLE_PX + 2) return { type: "cue-edge", edge: "in", id: cue.id, time: time };
        if (x >= qx + qw - HANDLE_PX - 2) return { type: "cue-edge", edge: "out", id: cue.id, time: time };
        for (var k = 0; k < cue.chars.length; k++) {
          if (Math.abs(m.xOf(cue.chars[k].t) - x) <= 5) {
            return { type: "char", id: cue.id, index: k, time: time };
          }
        }
        return { type: "cue-body", id: cue.id, time: time, grabOffset: time - cue.start };
      }
    }
    return { type: "empty", time: time };
  };

  /* ---------- 节目画面 ---------- */

  function StageRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d") : null;
  }

  StageRenderer.prototype.activeClipAt = function (project, time) {
    return project.clips.filter(function (c) {
      return time >= c.start - util.EPS && time < c.end + util.EPS;
    }).sort(function (a, b) { return a.start - b.start; })[0] || null;
  };

  StageRenderer.prototype.activeCueAt = function (project, time) {
    return project.subtitles.filter(function (c) {
      return time >= c.start - util.EPS && time <= c.end + util.EPS;
    })[0] || null;
  };

  StageRenderer.prototype.render = function (project, time) {
    if (!this.ctx) return null;
    var ctx = this.ctx;
    var w = this.canvas.width, h = this.canvas.height;
    var clip = this.activeClipAt(project, time);
    /* 背景始终为非黑渐变：即使在片段间隙也不会产生黑帧。 */
    var bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#1f2a3a");
    bg.addColorStop(1, "#2b3a4d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (clip) {
      var fade = 1;
      if (clip.transitionIn > 0 && time < clip.start + clip.transitionIn) {
        fade = (time - clip.start) / clip.transitionIn;
      }
      if (clip.transitionOut > 0 && time > clip.end - clip.transitionOut) {
        fade = Math.min(fade, (clip.end - time) / clip.transitionOut);
      }
      ctx.globalAlpha = util.clamp(fade, 0.08, 1);
      ctx.fillStyle = clip.color;
      ctx.fillRect(36, 28, w - 72, h - 96);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(36, 28, w - 72, h - 96);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 26px sans-serif";
      ctx.fillText(clip.name, 56, 68);
      ctx.font = "16px monospace";
      var localTime = clip.sourceIn + (time - clip.start);
      ctx.fillText("源时间 " + localTime.toFixed(3) + "s / 时间线 " + time.toFixed(3) + "s", 56, 98);
    } else {
      ctx.fillStyle = "#8b95a5";
      ctx.font = "20px sans-serif";
      ctx.fillText("片段间隙（非黑过渡底）", 56, h / 2);
    }

    /* 节拍闪烁，与音频事件同一时间基准 */
    var beat = project.beats.filter(function (b) {
      return Math.abs(b.time - time) < 0.07;
    })[0];
    if (beat) {
      ctx.fillStyle = beat.kind === "kick" ? "#d08770" : beat.kind === "snare" ? "#ebcb8b" : "#88c0d0";
      ctx.beginPath();
      ctx.arc(w - 70, 52, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    var cue = this.activeCueAt(project, time);
    if (cue) {
      var textY = h - 42;
      ctx.font = "bold 30px sans-serif";
      var total = 0;
      cue.text.split("").forEach(function (ch) { total += ctx.measureText(ch).width; });
      var penX = (w - total) / 2;
      cue.chars.forEach(function (item, idx) {
        var lit = time >= item.t - util.EPS;
        ctx.fillStyle = lit ? "#ffffff" : "rgba(255,255,255,0.35)";
        ctx.fillText(cue.chars[idx].ch, penX, textY);
        penX += ctx.measureText(cue.chars[idx].ch).width;
      });
    }
    ctx.fillStyle = "#d08770";
    ctx.font = "15px monospace";
    ctx.fillText("播放头 " + time.toFixed(3) + "s · state.timeline.time", 14, h - 12);
    return { clip: clip ? clip.id : null, cue: cue ? cue.id : null };
  };

  /* 黑帧检测：对若干采样时刻真实光栅化并统计平均亮度。 */
  StageRenderer.prototype.sampleBlackFrames = function (project, samples, threshold) {
    var limit = threshold === undefined ? 12 : threshold;
    var findings = [];
    var self = this;
    samples.forEach(function (time) {
      self.render(project, time);
      var data;
      if (self.ctx && self.ctx.getImageData) {
        var image = self.ctx.getImageData(0, 0, self.canvas.width, self.canvas.height).data;
        var sum = 0;
        for (var i = 0; i < image.length; i += 4) {
          sum += 0.299 * image[i] + 0.587 * image[i + 1] + 0.114 * image[i + 2];
        }
        var luminance = sum / (image.length / 4);
        if (luminance < limit) findings.push({ time: time, luminance: luminance });
      }
    });
    return findings;
  };

  /* 离线（Node）版本：由调用方注入像素读取器，测试用。 */
  function isFrameBlackByPixels(pixels, threshold) {
    var limit = threshold === undefined ? 12 : threshold;
    var sum = 0;
    for (var i = 0; i < pixels.length; i += 4) {
      sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    }
    return (sum / (pixels.length / 4)) < limit;
  }

  return {
    LANE: LANE,
    PADDING_X: PADDING_X,
    HANDLE_PX: HANDLE_PX,
    TimelineRenderer: TimelineRenderer,
    StageRenderer: StageRenderer,
    isFrameBlackByPixels: isFrameBlackByPixels
  };
});

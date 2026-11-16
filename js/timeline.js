/* Canvas 时间线:标尺、四轨车道、片段(淡化手柄+音量点)、混合波形、播放头。 */
const Timeline = (() => {
  const TRACKS = [
    { type: 'footsteps',  name: '脚步', color: '#e0a458' },
    { type: 'rain',       name: '雨',   color: '#5aa9e6' },
    { type: 'wind',       name: '风',   color: '#7fc8a9' },
    { type: 'mechanical', name: '机械', color: '#d16ba5' },
  ];
  const RULER_H = 22, WAVE_H = 56, LANE_H = 62, PAD_L = 8, PAD_R = 8;
  let cv, g2d, project, cbs, dpr = 1;
  let selected = null, waveform = null, playheadT = 0;
  let drag = null;

  function init(canvas, proj, callbacks) {
    cv = canvas; project = proj; cbs = callbacks;
    g2d = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    cv.addEventListener('mousedown', onDown);
    cv.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('dblclick', onDbl);
    draw();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    draw();
  }

  const laneY = i => RULER_H + WAVE_H + i * LANE_H;
  const t2x = t => PAD_L + (t / TIMELINE_LEN) * (cv.width / dpr - PAD_L - PAD_R);
  const x2t = x => Math.max(0, Math.min(TIMELINE_LEN,
    (x - PAD_L) / (cv.width / dpr - PAD_L - PAD_R) * TIMELINE_LEN));

  function clipRect(clip) {
    const i = TRACKS.findIndex(tr => tr.type === clip.type);
    return { x: t2x(clip.start), y: laneY(i) + 6, w: t2x(clip.start + clip.duration) - t2x(clip.start), h: LANE_H - 12, i };
  }

  function draw() {
    if (!g2d) return;
    const W = cv.width / dpr, H = cv.height / dpr;
    g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2d.clearRect(0, 0, W, H);
    // 标尺
    g2d.fillStyle = '#171b22'; g2d.fillRect(0, 0, W, RULER_H);
    g2d.fillStyle = '#8fa3bd'; g2d.font = '10px Consolas'; g2d.textAlign = 'center';
    for (let s = 0; s <= TIMELINE_LEN; s++) {
      const x = t2x(s);
      g2d.fillRect(x, RULER_H - 6, 1, 6);
      if (s % 2 === 0) g2d.fillText(s + 's', x, 11);
    }
    // 波形区
    g2d.fillStyle = '#0c0f14'; g2d.fillRect(0, RULER_H, W, WAVE_H);
    if (waveform) {
      g2d.strokeStyle = '#4da3ff'; g2d.beginPath();
      const mid = RULER_H + WAVE_H / 2, n = waveform.length;
      for (let i = 0; i < n; i++) {
        const x = PAD_L + (i / n) * (W - PAD_L - PAD_R);
        const y = waveform[i] * (WAVE_H / 2 - 2);
        g2d.moveTo(x, mid - y); g2d.lineTo(x, mid + y);
      }
      g2d.stroke();
    } else {
      g2d.fillStyle = '#54627a'; g2d.textAlign = 'left';
      g2d.fillText('(导出或生成预览后显示混合波形)', PAD_L + 4, RULER_H + WAVE_H / 2);
    }
    // 车道与网格
    TRACKS.forEach((tr, i) => {
      const y = laneY(i);
      g2d.fillStyle = i % 2 ? '#12161d' : '#151a22';
      g2d.fillRect(0, y, W, LANE_H);
      g2d.fillStyle = tr.color; g2d.textAlign = 'left'; g2d.font = '11px sans-serif';
      g2d.fillText(tr.name, 4, y + 13);
    });
    g2d.strokeStyle = '#232a36';
    for (let s = 0; s <= TIMELINE_LEN; s++) {
      const x = t2x(s);
      g2d.beginPath(); g2d.moveTo(x, RULER_H); g2d.lineTo(x, H); g2d.stroke();
    }
    // 片段
    for (const clip of project.clips) drawClip(clip);
    // 播放头
    const px = t2x(playheadT);
    g2d.strokeStyle = '#ff5b5b'; g2d.lineWidth = 1.5;
    g2d.beginPath(); g2d.moveTo(px, 0); g2d.lineTo(px, H); g2d.stroke();
    g2d.lineWidth = 1;
  }

  function drawClip(clip) {
    const r = clipRect(clip);
    const tr = TRACKS[r.i];
    g2d.fillStyle = tr.color + (clip === selected ? 'e6' : '99');
    g2d.beginPath(); g2d.roundRect(r.x, r.y, r.w, r.h, 4); g2d.fill();
    if (clip === selected) { g2d.strokeStyle = '#fff'; g2d.strokeRect(r.x, r.y, r.w, r.h); }
    // 淡化三角
    g2d.fillStyle = 'rgba(0,0,0,0.45)';
    if (clip.fadeIn > 0) {
      const fw = (clip.fadeIn / clip.duration) * r.w;
      g2d.beginPath(); g2d.moveTo(r.x, r.y + r.h); g2d.lineTo(r.x + fw, r.y); g2d.lineTo(r.x, r.y); g2d.fill();
    }
    if (clip.fadeOut > 0) {
      const fw = (clip.fadeOut / clip.duration) * r.w;
      g2d.beginPath(); g2d.moveTo(r.x + r.w, r.y + r.h); g2d.lineTo(r.x + r.w - fw, r.y); g2d.lineTo(r.x + r.w, r.y); g2d.fill();
    }
    // 音量点折线
    const pts = clip.volumePoints || [];
    if (pts.length) {
      g2d.strokeStyle = '#0b1220'; g2d.beginPath();
      const vy = v => r.y + r.h - (v / 1.5) * r.h;
      g2d.moveTo(r.x, vy(1));
      for (const p of pts) g2d.lineTo(r.x + (p.t / clip.duration) * r.w, vy(p.v));
      g2d.lineTo(r.x + r.w, vy(1));
      g2d.stroke();
      g2d.fillStyle = '#fff';
      for (const p of pts) {
        g2d.beginPath();
        g2d.arc(r.x + (p.t / clip.duration) * r.w, vy(p.v), 3, 0, 7);
        g2d.fill();
      }
    }
    g2d.fillStyle = '#0b1220'; g2d.font = '10px sans-serif'; g2d.textAlign = 'left';
    g2d.fillText(`${clip.name}  g=${clip.gain.toFixed(2)}`, r.x + 4, r.y + r.h - 5);
  }

  function hitClip(x, y) {
    for (let i = project.clips.length - 1; i >= 0; i--) {
      const r = clipRect(project.clips[i]);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
        return { clip: project.clips[i], r };
    }
    return null;
  }

  function evPos(e) {
    const b = cv.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }

  function onDown(e) {
    const { x, y } = evPos(e);
    if (y < RULER_H + WAVE_H) { cbs.onSeek(x2t(x)); return; }
    const hit = hitClip(x, y);
    if (!hit) { selected = null; cbs.onSelect(null); draw(); return; }
    selected = hit.clip; cbs.onSelect(selected);
    // 音量点命中
    const pts = hit.clip.volumePoints || [];
    for (let i = 0; i < pts.length; i++) {
      const px = hit.r.x + (pts[i].t / hit.clip.duration) * hit.r.w;
      const py = hit.r.y + hit.r.h - (pts[i].v / 1.5) * hit.r.h;
      if (Math.hypot(x - px, y - py) < 7) {
        if (e.altKey) { pts.splice(i, 1); cbs.onClipChanged(); draw(); return; }
        drag = { kind: 'point', clip: hit.clip, pt: pts[i], r: hit.r };
        return;
      }
    }
    // 淡化手柄(上角 12px)
    if (y - hit.r.y < 12 && x - hit.r.x < 14) { drag = { kind: 'fadeIn', clip: hit.clip, r: hit.r }; return; }
    if (y - hit.r.y < 12 && hit.r.x + hit.r.w - x < 14) { drag = { kind: 'fadeOut', clip: hit.clip, r: hit.r }; return; }
    drag = { kind: 'move', clip: hit.clip, dx: x2t(x) - hit.clip.start };
    draw();
  }

  function onMove(e) {
    if (!drag) return;
    const { x, y } = evPos(e);
    const c = drag.clip;
    if (drag.kind === 'move') {
      c.start = Math.round(Math.max(0, Math.min(TIMELINE_LEN - c.duration, x2t(x) - drag.dx)) * 20) / 20;
    } else if (drag.kind === 'fadeIn') {
      c.fadeIn = Math.max(0, Math.min(c.duration - c.fadeOut, (x2t(x) - c.start)));
    } else if (drag.kind === 'fadeOut') {
      c.fadeOut = Math.max(0, Math.min(c.duration - c.fadeIn, (c.start + c.duration) - x2t(x)));
    } else if (drag.kind === 'point') {
      const r = clipRect(c);
      drag.pt.t = Math.max(0, Math.min(c.duration, (x2t(x) - c.start)));
      drag.pt.v = Math.max(0, Math.min(1.5, ((r.y + r.h - y) / r.h) * 1.5));
    }
    cbs.onClipChanged(); draw();
  }

  function onUp() { if (drag) { drag = null; cbs.onClipChanged(true); } }

  function onDbl(e) {
    const { x, y } = evPos(e);
    const hit = hitClip(x, y);
    if (!hit) return;
    const t = Math.max(0, Math.min(hit.clip.duration, x2t(x) - hit.clip.start));
    const v = Math.max(0, Math.min(1.5, ((hit.r.y + hit.r.h - y) / hit.r.h) * 1.5));
    (hit.clip.volumePoints = hit.clip.volumePoints || []).push({ t, v });
    cbs.onClipChanged(true); draw();
  }

  return {
    init, TRACKS,
    draw,
    setWaveform(w) { waveform = w; draw(); },
    setPlayhead(t) { playheadT = t; draw(); },
    getSelected: () => selected,
    select(c) { selected = c; draw(); },
  };
})();

import { clipEnd, findConflicts } from "../src/core/timeline.js";

const TRACKS = [
  { id: "v1", label: "视频 V1", y: 24, height: 56 },
  { id: "a1", label: "音频 A1", y: 92, height: 40 },
  { id: "s1", label: "字幕 S1", y: 144, height: 34 },
  { id: "m1", label: "动画 M1", y: 190, height: 34 }
];

export function trackGeometry() { return TRACKS; }

export function renderTimeline(canvas, state, selectedId) {
  const { timeline, view, thumbnails, clock } = state;
  const ctx = canvas.getContext("2d");
  const width = Math.max(900, timeline.duration * view.pxPerSecond + 120);
  canvas.width = width;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "11px sans-serif";

  for (const track of TRACKS) {
    ctx.fillStyle = "#141925";
    ctx.fillRect(0, track.y - 18, canvas.width, track.height + 18);
    ctx.fillStyle = "#7e8aa3";
    ctx.fillText(track.label, 6, track.y - 4);
    drawRuler(ctx, timeline.duration, view.pxPerSecond, track.y);
  }

  for (const clip of timeline.videos) drawVideoClip(ctx, clip, view, thumbnails, selectedId);
  for (const audio of timeline.audios) drawAudioClip(ctx, audio, view, selectedId);
  for (const sub of timeline.subtitles) drawEvent(ctx, sub, view, "#3b82f6", sub.text);
  for (const anim of timeline.animations) drawEvent(ctx, anim, view, "#d9a514", "动画");
  drawTransitions(ctx, timeline, view);
  drawConflicts(ctx, timeline, view);
  drawPlayhead(ctx, clock.time, view.pxPerSecond, canvas.height);
}

function drawRuler(ctx, duration, pxPerSecond, y) {
  ctx.strokeStyle = "#262d3d";
  ctx.fillStyle = "#6b7690";
  for (let t = 0; t <= duration; t += 1) {
    const x = t * pxPerSecond;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 220);
    ctx.stroke();
    if (t % 5 === 0) ctx.fillText(`${t}s`, x + 2, y + 12);
  }
}

function drawVideoClip(ctx, clip, view, thumbnails, selectedId) {
  const track = TRACKS.find((item) => item.id === clip.track);
  const x = clip.start * view.pxPerSecond;
  const w = clip.duration * view.pxPerSecond;
  ctx.fillStyle = selectedId === clip.id ? "#2f6df6" : "#2446a8";
  ctx.fillRect(x, track.y, w, track.height);
  ctx.strokeStyle = selectedId === clip.id ? "#9cc1ff" : "#3a5bbf";
  ctx.strokeRect(x + 0.5, track.y + 0.5, w - 1, track.height - 1);
  for (const [key, result] of Object.entries(thumbnails.results)) {
    if (!key.startsWith(`${clip.id}@`)) continue;
    // result.time 是源时间 srcTime，减去入点得到片段内偏移，保证缩略图对准正确帧。
    const tx = x + (result.time - clip.srcIn) * view.pxPerSecond;
    if (tx < x || tx > x + w) continue;
    ctx.drawImage(result.bitmap, tx, track.y + 4, Math.min(48, w), track.height - 20);
  }
  ctx.fillStyle = "#dbe6ff";
  ctx.fillText(`${clip.id} 入${clip.srcIn.toFixed(1)} 出${(clip.srcIn + clip.duration).toFixed(1)}`, x + 4, track.y + track.height - 4);
}

function drawAudioClip(ctx, audio, view, selectedId) {
  const track = TRACKS.find((item) => item.id === audio.track);
  const x = audio.start * view.pxPerSecond;
  const w = audio.duration * view.pxPerSecond;
  ctx.fillStyle = selectedId === audio.id ? "#0f9d76" : "#0c7a5c";
  ctx.fillRect(x, track.y, w, track.height);
  ctx.strokeStyle = "#13b386";
  for (let i = 0; i < w; i += 6) {
    const h = 6 + Math.abs(Math.sin((x + i) * 1.7)) * (track.height - 12);
    ctx.beginPath();
    ctx.moveTo(x + i, track.y + track.height / 2 - h / 2);
    ctx.lineTo(x + i, track.y + track.height / 2 + h / 2);
    ctx.stroke();
  }
}

function drawEvent(ctx, event, view, color, label) {
  const track = TRACKS.find((item) => item.id === event.track);
  const x = event.start * view.pxPerSecond;
  const w = event.duration * view.pxPerSecond;
  ctx.fillStyle = color;
  ctx.fillRect(x, track.y, w, track.height);
  ctx.fillStyle = "#10131a";
  ctx.fillText(label, x + 4, track.y + 20);
}

function drawTransitions(ctx, timeline, view) {
  for (const tr of timeline.transitions) {
    const clip = timeline.videos.find((item) => item.id === tr.toClipId);
    const x = (clip.start - tr.duration / 2) * view.pxPerSecond;
    const track = TRACKS.find((item) => item.id === clip.track);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(x, track.y, tr.duration * view.pxPerSecond, track.height);
    ctx.fillStyle = "#ffd479";
    ctx.fillText(`转场 ${tr.duration}s`, x + 2, track.y - 2);
  }
}

function drawConflicts(ctx, timeline, view) {
  for (const conflict of findConflicts(timeline)) {
    const track = TRACKS.find((item) => item.id === conflict.track);
    const x = conflict.start * view.pxPerSecond;
    const w = (conflict.end - conflict.start) * view.pxPerSecond;
    ctx.fillStyle = "rgba(255,70,70,0.45)";
    ctx.fillRect(x, track.y, w, track.height);
    ctx.strokeStyle = "#ff4646";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, track.y, w, track.height);
    ctx.lineWidth = 1;
  }
}

function drawPlayhead(ctx, time, pxPerSecond, height) {
  const x = time * pxPerSecond;
  ctx.strokeStyle = "#ff5d5d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.lineWidth = 1;
}

export function hitTestClip(state, offsetX) {
  const t = offsetX / state.view.pxPerSecond;
  return state.timeline.videos.find((clip) => t >= clip.start && t <= clipEnd(clip)) ?? null;
}

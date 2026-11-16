import { clipDuration } from './engine.js';

const TAU = Math.PI * 2;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBackground(ctx, w, h) {
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#10151f');
  gradient.addColorStop(1, '#1b2436');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  // Grid lines so a frame is never visually empty / black.
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = (h * 0.72 * i) / 4 + h * 0.1;
    ctx.beginPath();
    ctx.moveTo(70, y);
    ctx.lineTo(w - 40, y);
    ctx.stroke();
  }
}

function drawChartClip(ctx, clip, localTime, w, h, activeBeats) {
  const animation = clip.animation || { barGrow: 1.2, numberRoll: 1.2 };
  const growT = easeOutCubic(Math.min(1, localTime / animation.barGrow));
  const rollT = easeOutCubic(Math.min(1, localTime / animation.numberRoll));
  const labels = clip.data.labels;
  const series = clip.data.series[0];
  const values = series.values;
  const max = Math.max(...values) * 1.15;
  const total = values.reduce((sum, value) => sum + value, 0);

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8eefc';
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(clip.title, 48, 46);

  const chartTop = h * 0.16;
  const chartBottom = h * 0.78;
  const chartH = chartBottom - chartTop;
  const slot = (w - 120) / labels.length;
  const barW = slot * 0.52;
  const flash = activeBeats.length
    ? Math.max(...activeBeats.map((b) => b.intensity)) * 0.18
    : 0;

  labels.forEach((label, i) => {
    const value = values[i];
    const targetH = (value / max) * chartH;
    const barH = targetH * growT;
    const x = 60 + slot * i + (slot - barW) / 2;
    const y = chartBottom - barH;

    ctx.fillStyle = series.color;
    roundRect(ctx, x, y, barW, Math.max(2, barH), 8);
    ctx.fill();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash})`;
      roundRect(ctx, x, y, barW, Math.max(2, barH), 8);
      ctx.fill();
    }

    // Number roll: displayed value grows with the roll progress.
    const shown = Math.round(value * rollT);
    const ratio = ((value / total) * 100).toFixed(1);
    ctx.fillStyle = '#f4f7ff';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(shown), x + barW / 2, y - 16);
    ctx.fillStyle = '#9fb2d4';
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillText(`${ratio}%`, x + barW / 2, chartBottom + 26);
    ctx.fillStyle = '#c9d5ec';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(label, x + barW / 2, chartBottom + 48);
  });
}

function drawSubtitles(ctx, project, time, w, h) {
  const subs = project.tracks.subtitle || [];
  const active = subs.find((sub) => {
    const start = sub.start;
    const end = start + clipDuration(sub);
    return time >= start && time < end;
  });
  if (!active) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 22px system-ui, sans-serif';
  const paddingX = 24;
  const textW = ctx.measureText(active.text).width;
  const boxW = textW + paddingX * 2;
  const boxH = 44;
  const x = (w - boxW) / 2;
  const y = h - 78;
  ctx.fillStyle = 'rgba(8,12,20,0.66)';
  roundRect(ctx, x, y, boxW, boxH, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(active.text, w / 2, y + boxH / 2 + 1);
}

function activeClipPair(project, time) {
  const clips = [...project.tracks.video].sort((a, b) => a.start - b.start);
  const inside = clips.filter((clip) => {
    const start = clip.start;
    const end = start + clipDuration(clip);
    return time >= start && time < end;
  });
  if (inside.length === 0) return [];
  if (inside.length === 1) {
    return [{ clip: inside[0], alpha: 1, localTime: time - inside[0].start + (inside[0].sourceIn ?? 0) }];
  }
  const [a, b] = inside;
  const transitionDuration = b.transition?.duration || 0;
  const progress = Math.min(1, (time - b.start) / Math.max(0.001, transitionDuration));
  return [
    { clip: a, alpha: 1 - progress, localTime: time - a.start + (a.sourceIn ?? 0) },
    { clip: b, alpha: progress, localTime: time - b.start + (b.sourceIn ?? 0) },
  ];
}

export function renderFrame(ctx, project, time, audioEvents, width, height) {
  drawBackground(ctx, width, height);
  const pair = activeClipPair(project, time);
  for (const entry of pair) {
    const beats = audioEvents.filter((event) => {
      if (event.clipId !== entry.clip.id) return false;
      const local = event.time - entry.clip.start;
      return local <= entry.localTime && entry.localTime - local < 0.12;
    });
    ctx.save();
    ctx.globalAlpha = entry.alpha;
    drawChartClip(ctx, entry.clip, entry.localTime, width, height, beats);
    ctx.restore();
  }
  drawSubtitles(ctx, project, time, width, height);

  // Shared timebase readout: program time + frame index.
  const frame = Math.round(time * project.frameRate);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '600 14px ui-monospace, monospace';
  ctx.fillStyle = '#8ea3c8';
  ctx.fillText(
    `${time.toFixed(2)}s  f${String(frame).padStart(3, '0')}`,
    width - 28,
    height - 24,
  );
  void TAU;
}

// Sample luma to prove first/last rendered frames are not black.
export function frameLuma(canvas) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  return sum / (data.length / 4);
}

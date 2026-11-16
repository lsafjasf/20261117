// One render plan drives both the browser 2D canvas and the offline Node
// rasterizer, so interactive preview and exported frames cannot diverge.

import { BACKGROUND } from './constants.js';

export function buildRenderPlan({ scene, timeline, timeMs, width, height,
  frameWindowMs = 0 }) {
  const plan = { width, height, background: BACKGROUND, clips: [], shapes: [],
    activePulses: activeAudioInWindow(scene, timeMs, frameWindowMs), timeMs };

  for (const entry of timeline.activeClipsAt(timeMs)) {
    const local = timeMs - entry.clip.start;
    plan.clips.push({
      color: entry.clip.color,
      label: entry.clip.label,
      alpha: entry.alpha,
      localMs: local
    });
  }

  for (const shapeId of scene.shapeOrder) {
    const shape = scene.shapes[shapeId];
    const pulsing = timeMs < shape.pulseUntil;
    plan.shapes.push({ shape, pulsing });
  }
  return plan;
}

function activeAudioInWindow(scene, timeMs, frameWindowMs) {
  return scene.audioPulses.filter((pulse) =>
    timeMs + frameWindowMs > pulse.t &&
    timeMs < pulse.t + pulse.durationMs);
}

// ctx is any object exposing the CanvasRenderingContext2D subset implemented
// by both browsers and src/node/rasterizer.js.
export function drawPlan(ctx, plan) {
  const { width, height, background } = plan;
  ctx.setAlpha(1);
  ctx.fillRect(0, 0, width, height,
    rgb(background.r, background.g, background.b));

  // Clip backdrop bands: always opaque, so even transition boundaries and the
  // very first/last exported frame contain content (never a black frame).
  for (const clip of plan.clips) {
    ctx.setAlpha(clip.alpha);
    ctx.fillRect(0, 0, width, 44, shade(clip.color, clip.alpha));
  }
  ctx.setAlpha(1);

  for (const { shape, pulsing } of plan.shapes) {
    ctx.setAlpha(1);
    const scale = pulsing ? 1.12 : 1;
    const w = shape.w * scale;
    const h = shape.h * scale;
    const x = shape.x - (w - shape.w) / 2;
    const y = shape.y - (h - shape.h) / 2;
    ctx.fillRect(x, y, w, h, pulsing ? '#ffd166' : shape.color);
    if (shape.text) {
      ctx.fillText(shape.text, x + 10, y + h / 2 + 6, '#0b1220');
    }
  }

  // HUD: shared clock readout and audio activity indicator.
  ctx.fillText(`t=${Math.round(plan.timeMs)}ms`, 12, height - 16, '#e6edf7');
  if (plan.activePulses.length > 0) {
    ctx.fillRect(width - 34, height - 34, 22, 22, '#ff5d8f');
  }
}

function rgb(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function shade(hex, alpha) {
  // Crossfade clips toward the dark background rather than toward black.
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel, key) =>
    Math.round(channel * alpha + BACKGROUND[key] * (1 - alpha));
  return rgb(mix(r, 'r'), mix(g, 'g'), mix(b, 'b'));
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

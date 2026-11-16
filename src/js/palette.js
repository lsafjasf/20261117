import { VIEW_H } from './params.js';

function hsl(h, s, l) {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

// sunsetHue is the user anchor; viewX drag rotates the actual hue so the
// sunset visibly changes as the viewpoint moves.
export function effectiveHue(sunsetHue, viewX) {
  return Math.min(360, Math.max(0, sunsetHue + viewX * 22));
}

// Paper-tone sky gradient stops, top -> horizon.
export function skyStops(sunsetHue, viewX) {
  const hue = effectiveHue(sunsetHue, viewX);
  return [
    { pos: 0, color: hsl(hue - 18, 42, 24) },
    { pos: 0.42, color: hsl(hue - 4, 58, 46) },
    { pos: 0.72, color: hsl(hue + 12, 72, 62) },
    { pos: 1, color: hsl(hue + 26, 80, 72) },
  ];
}

export function sunColor(sunsetHue, viewX) {
  return hsl(effectiveHue(sunsetHue, viewX) + 30, 95, 78);
}

// Warm window light, slightly randomized by the window's own seed.
export function windowColor(seed) {
  return hsl(38 + seed * 14, 92, 62 + seed * 12);
}

export function beamColor() {
  return 'rgba(255, 196, 110, 0.16)';
}

export function fillSky(ctx, params, viewX) {
  const stops = skyStops(params.sunsetHue, viewX);
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  for (const stop of stops) grad.addColorStop(stop.pos, stop.color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawSun(ctx, params, viewX, viewY) {
  const sunR = 46 + params.sunSize * 42;
  const cx = 640 + viewX * 150;
  const cy = 300 + viewY * 60 - (1 - params.sunSize) * 30;
  const glow = ctx.createRadialGradient(cx, cy, sunR * 0.2, cx, cy, sunR * 3.2);
  glow.addColorStop(0, 'rgba(255, 226, 168, 0.55)');
  glow.addColorStop(1, 'rgba(255, 226, 168, 0)');
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, sunR * 3.2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = glow;
  ctx.fillRect(cx - sunR * 3.2, cy - sunR * 3.2, sunR * 6.4, sunR * 6.4);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, sunR, 0, Math.PI * 2);
  ctx.fillStyle = sunColor(params.sunsetHue, viewX);
  ctx.fill();
  return { cx, cy, r: sunR };
}

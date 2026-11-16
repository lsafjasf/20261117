// Canvas 渲染：调音指针表盘与频谱。
import { magnitudeSpectrum } from "./dsp.js";

export function drawMeter(canvas, cents, options = {}) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const tolerance = options.tolerance ?? 8;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h - 18, radius = Math.min(w / 2 - 30, h - 30);
  const start = Math.PI * 0.85, end = Math.PI * 2.15;

  // 背景弧与容差区
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#2a3546";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();

  const clampCents = Math.max(-50, Math.min(50, cents));
  const toAngle = (c) => start + ((c + 50) / 100) * (end - start);
  ctx.strokeStyle = "rgba(55,201,122,0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, toAngle(-tolerance), toAngle(tolerance));
  ctx.stroke();

  // 刻度
  ctx.strokeStyle = "#5a6b82";
  ctx.lineWidth = 2;
  for (let c = -50; c <= 50; c += 10) {
    const a = toAngle(c);
    const x1 = cx + Math.cos(a) * (radius - 12);
    const y1 = cy + Math.sin(a) * (radius - 12);
    const x2 = cx + Math.cos(a) * (radius + 12);
    const y2 = cy + Math.sin(a) * (radius + 12);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // 指针
  const needleAngle = toAngle(clampCents);
  const inTune = Math.abs(cents) <= tolerance;
  ctx.strokeStyle = inTune ? "#37c97a" : "#f0b42f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(needleAngle) * (radius - 4), cy + Math.sin(needleAngle) * (radius - 4));
  ctx.stroke();
  ctx.fillStyle = "#d8e0ea";
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#9fb0c4";
  ctx.font = "13px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${cents >= 0 ? "+" : ""}${cents.toFixed(1)} 音分`, cx, 22);
}

export function drawSpectrum(canvas, timeBuffer, sampleRate) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!timeBuffer || timeBuffer.length < 2) return;
  const size = 1 << Math.floor(Math.log2(timeBuffer.length));
  const mag = magnitudeSpectrum(timeBuffer.slice(0, size));
  ctx.strokeStyle = "#4d8dff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const bins = mag.length;
  for (let i = 1; i < bins; i++) {
    const x = (i / bins) * w;
    const db = 20 * Math.log10(mag[i] + 1e-8);
    const y = h - ((db + 80) / 80) * h;
    if (i === 1) ctx.moveTo(x, y);
    else ctx.lineTo(x, Math.max(0, Math.min(h, y)));
  }
  ctx.stroke();

  ctx.fillStyle = "#9fb0c4";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`0Hz`, 4, h - 4);
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(sampleRate / 2)}Hz`, w - 4, h - 4);
}

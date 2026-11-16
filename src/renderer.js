// Canvas 画面渲染：十二次闪光、底部波形、片段交叉淡化转场。
// 背景永远非黑，黑帧检测用于导出前后的程序化校验。

import { mappedAudioEvents, timelineToSource, getVideoTrack } from './model.js';

const FLASH_WINDOW = 0.09;

export function flashIntensity(project, sourceTime) {
  if (sourceTime === null) return 0;
  const eventTimes = mappedAudioEvents(project).map((event) => event.sourceTime);
  let intensity = 0;
  for (const eventTime of eventTimes) {
    const distance = Math.abs(sourceTime - eventTime);
    if (distance <= FLASH_WINDOW) {
      intensity = Math.max(intensity, 1 - distance / FLASH_WINDOW);
    }
  }
  return intensity;
}

function drawScene(ctx, width, height, sourceTime, intensity, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const hue = (sourceTime * 24) % 360;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${hue}, 70%, 28%)`);
  gradient.addColorStop(1, `hsl(${(hue + 90) % 360}, 70%, 20%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const orbitX = width / 2 + Math.cos(sourceTime * 1.6) * width * 0.28;
  const orbitY = height / 2 + Math.sin(sourceTime * 2.1) * height * 0.24;
  ctx.beginPath();
  ctx.arc(orbitX, orbitY, 42, 0, Math.PI * 2);
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 90%, 65%)`;
  ctx.fill();

  if (intensity > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.85 * intensity})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function drawWaveform(ctx, width, height, waveform) {
  const bars = waveform.length;
  const barWidth = width / bars;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, height - 64, width, 64);
  for (let i = 0; i < bars; i += 1) {
    const barHeight = Math.max(2, (waveform[i] / 255) * 56);
    ctx.fillStyle = `hsl(${190 + i * 2}, 90%, 60%)`;
    ctx.fillRect(i * barWidth + 1, height - 4 - barHeight, barWidth - 2, barHeight);
  }
  ctx.restore();
}

function findClipAt(project, timelineTime) {
  return getVideoTrack(project).clips.find(
    (clip) => timelineTime >= clip.timelineStart - 1e-9 &&
      timelineTime <= clip.timelineEnd + 1e-9,
  );
}

export function renderFrame(ctx, project, timelineTime, waveform, width, height) {
  ctx.clearRect(0, 0, width, height);
  const clip = findClipAt(project, timelineTime);
  if (!clip) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const fadeIn = clip.transitionIn
    ? Math.min(1, (timelineTime - clip.timelineStart) / clip.transitionIn.duration)
    : 1;
  const sourceTime = timelineToSource(project, timelineTime);

  if (fadeIn < 1) {
    const neighbor = getVideoTrack(project).clips
      .find((item) => Math.abs(item.timelineEnd - clip.timelineStart) < 1e-9);
    if (neighbor) {
      const neighborSource = timelineToSource(
        project,
        neighbor.timelineEnd - (clip.timelineStart - timelineTime),
      );
      drawScene(
        ctx, width, height, neighborSource,
        flashIntensity(project, neighborSource), 1 - fadeIn,
      );
    }
  }
  drawScene(ctx, width, height, sourceTime, flashIntensity(project, sourceTime), fadeIn);
  drawWaveform(ctx, width, height, waveform);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '16px monospace';
  ctx.fillText(`program ${timelineTime.toFixed(3)}s / source ${sourceTime?.toFixed(3) ?? '--'}s`, 12, 24);
}

// 读取画布平均亮度，阈值用于导出首尾黑帧判定。
export function averageLuminance(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const sample = ctx.getImageData(0, 0, width, height).data;
  let total = 0;
  let count = 0;
  for (let i = 0; i < sample.length; i += 4 * 37) {
    total += 0.2126 * sample[i] + 0.7152 * sample[i + 1] + 0.0722 * sample[i + 2];
    count += 1;
  }
  return total / count;
}

export const BLACK_LUMINANCE_THRESHOLD = 12;

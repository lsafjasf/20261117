// 软件合成器：把时间线在时刻 t 的画面合成为 RGBA 缓冲，把节目区间合成为 PCM。
// 视频片段、字幕、动画轨道与音频事件都通过同一 t 取数，共用时钟状态。

import { renderSourceFrame, renderSourceSamples, CROP_RATIOS } from "./synthetic.js";
import { clipEnd } from "./timeline.js";

const EPS = 1e-6;

function overlay(rgba, width, height, shape) {
  for (let y = shape.y0; y < shape.y1; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = shape.x0; x < shape.x1; x += 1) {
      if (x < 0 || x >= width) continue;
      const offset = (y * width + x) * 4;
      const alpha = shape.a / 255;
      rgba[offset] = Math.round(rgba[offset] * (1 - alpha) + shape.r * alpha);
      rgba[offset + 1] = Math.round(rgba[offset + 1] * (1 - alpha) + shape.g * alpha);
      rgba[offset + 2] = Math.round(rgba[offset + 2] * (1 - alpha) + shape.b * alpha);
      rgba[offset + 3] = 255;
    }
  }
}

function activeAt(items, t) {
  return items.filter((item) => t >= item.start - EPS && t < item.start + item.duration + EPS);
}

function transitionFor(timeline, clip, t) {
  const incoming = timeline.transitions.find((tr) => tr.toClipId === clip.id);
  if (incoming && t < clip.start + incoming.duration) {
    return { kind: "in", progress: (t - clip.start) / incoming.duration };
  }
  const outgoing = timeline.transitions.find((tr) => tr.fromClipId === clip.id);
  if (outgoing && t > clipEnd(clip) - outgoing.duration) {
    return { kind: "out", progress: (t - (clipEnd(clip) - outgoing.duration)) / outgoing.duration };
  }
  return null;
}

export function renderFrame(timeline, sources, t, crop = "16:9", outputWidth = 96, outputHeight = 54) {
  const canvas = new Uint8Array(outputWidth * outputHeight * 4);
  const clips = activeAt(timeline.videos, t).sort((a, b) => a.track.localeCompare(b.track));
  for (const clip of clips) {
    const source = sources[clip.sourceId];
    const srcTime = clip.srcIn + (t - clip.start);
    const frame = renderSourceFrame(source, srcTime, clip.crop ?? crop);
    const transition = transitionFor(timeline, clip, t);
    let alpha = 255;
    if (transition) alpha = Math.round(255 * (transition.kind === "in" ? transition.progress : 1 - transition.progress));
    blit(canvas, outputWidth, outputHeight, frame, alpha);
  }
  for (const sub of activeAt(timeline.subtitles, t)) {
    const barHeight = Math.max(6, Math.round(outputHeight * 0.16));
    overlay(canvas, outputWidth, outputHeight, {
      x0: 4, y0: outputHeight - barHeight - 3, x1: outputWidth - 4, y1: outputHeight - 3,
      r: 20, g: 20, b: 20, a: 170
    });
    overlay(canvas, outputWidth, outputHeight, {
      x0: 10, y0: outputHeight - barHeight + 2, x1: Math.min(outputWidth - 10, 10 + (sub.text.length * 6)),
      y1: outputHeight - 8, r: 255, g: 255, b: 255, a: 255
    });
  }
  for (const anim of activeAt(timeline.animations, t)) {
    const localT = (t - anim.start) / anim.duration;
    const size = 8;
    const cx = Math.round(localT * (outputWidth - size));
    const cy = Math.round(outputHeight / 2 + Math.sin(localT * Math.PI * 2) * 10);
    overlay(canvas, outputWidth, outputHeight, {
      x0: cx, y0: cy - size / 2, x1: cx + size, y1: cy + size / 2,
      r: 255, g: 210, b: 40, a: 255
    });
  }
  return canvas;
}

function blit(canvas, outW, outH, frame, alpha) {
  const scaleX = frame.width / outW;
  const scaleY = frame.height / outH;
  for (let y = 0; y < outH; y += 1) {
    const sy = Math.min(frame.height - 1, Math.floor(y * scaleY));
    for (let x = 0; x < outW; x += 1) {
      const sx = Math.min(frame.width - 1, Math.floor(x * scaleX));
      const srcOffset = (sy * frame.width + sx) * 4;
      const dstOffset = (y * outW + x) * 4;
      const a = alpha / 255;
      canvas[dstOffset] = Math.round(canvas[dstOffset] * (1 - a) + frame.rgba[srcOffset] * a);
      canvas[dstOffset + 1] = Math.round(canvas[dstOffset + 1] * (1 - a) + frame.rgba[srcOffset + 1] * a);
      canvas[dstOffset + 2] = Math.round(canvas[dstOffset + 2] * (1 - a) + frame.rgba[srcOffset + 2] * a);
      canvas[dstOffset + 3] = 255;
    }
  }
}

export function renderAudio(timeline, sources, fromTime, toTime, sampleRate = 8000) {
  const total = Math.max(1, Math.round((toTime - fromTime) * sampleRate));
  const mix = new Float32Array(total);
  for (const audio of timeline.audios) {
    const end = audio.start + audio.duration;
    const start = Math.max(audio.start, fromTime);
    const finish = Math.min(end, toTime);
    if (finish <= start) continue;
    const offsetSrc = audio.srcIn + (start - audio.start);
    const { samples } = renderSourceSamples(sources[audio.sourceId], offsetSrc, offsetSrc + (finish - start), sampleRate);
    const dstOffset = Math.round((start - fromTime) * sampleRate);
    for (let i = 0; i < samples.length && dstOffset + i < total; i += 1) {
      mix[dstOffset + i] = Math.max(-1, Math.min(1, mix[dstOffset + i] + samples[i]));
    }
  }
  return { samples: mix, sampleRate };
}

export function isBlack(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] + rgba[i + 1] + rgba[i + 2] > 18) return false;
  }
  return true;
}

export { CROP_RATIOS };

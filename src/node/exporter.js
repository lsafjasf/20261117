// Offline exporter used by Node tests and the CLI. It walks the exact same
// clock range as the browser transport, renders through the shared render
// plan, mixes the same audio events, and refuses to produce media when the
// timeline has illegal overlaps.

import { writeFileSync } from 'node:fs';
import { NodeCanvas } from './rasterizer.js';
import { encodePng } from './png.js';
import { encodeApng } from './apng.js';
import { encodeWav } from './wav.js';
import { buildRenderPlan, drawPlan } from '../core/render.js';
import { renderAudioTrack } from '../core/audio-model.js';

export function renderFrames(project, { fps = project.meta.fps } = {}) {
  const validation = project.validateForExport();
  if (!validation.ok) {
    const error = new Error('Export blocked by timeline conflicts');
    error.code = 'EXPORT_BLOCKED';
    error.errors = validation.errors;
    throw error;
  }

  const { inPoint, outPoint } = project.clock;
  const totalFrames = Math.max(1, Math.round(((outPoint - inPoint) * fps) / 1000));
  const frames = [];

  for (let index = 0; index < totalFrames; index += 1) {
    const timeMs = inPoint + Math.floor((index * 1000) / fps);
    const canvas = new NodeCanvas(project.meta.width, project.meta.height);
    const plan = buildRenderPlan({
      scene: project.scene,
      timeline: project.timeline,
      timeMs,
      width: project.meta.width,
      height: project.meta.height,
      frameWindowMs: 1000 / fps
    });
    drawPlan(canvas, plan);
    frames.push({ index, timeMs, canvas, plan, frameMs: 1000 / fps });
  }
  return frames;
}

export function checkBlackFrames(frames) {
  return frames
    .filter((frame) => frame.canvas.isBlack())
    .map((frame) => ({ index: frame.index, timeMs: frame.timeMs }));
}

// A/V alignment check: every audio pulse must have a visible pulse indicator
// on the frame covering its trigger timestamp.
export function checkAudioVisualAlignment(frames, pulses, fps = 30) {
  const mismatches = [];
  for (const pulse of pulses) {
    let frame = null;
    for (let index = 0; index < frames.length; index += 1) {
      const current = frames[index];
      const nextTime = frames[index + 1]?.timeMs ?? current.timeMs + 1000 / fps;
      if (pulse.t >= current.timeMs && pulse.t < nextTime) {
        frame = current;
        break;
      }
    }
    if (!frame) {
      mismatches.push({ pulse, reason: 'no frame covers audio trigger' });
      continue;
    }
    if (frame.plan.activePulses.length === 0) {
      mismatches.push({ pulse, frame: frame.index,
        reason: 'audio trigger has no visible pulse' });
    }
  }
  return mismatches;
}

export function exportProject(project, outputBase, { fps = project.meta.fps } = {}) {
  const frames = renderFrames(project, { fps });
  const blackFrames = checkBlackFrames(frames);
  if (blackFrames.length > 0) {
    throw new Error(`Black frames detected: ${JSON.stringify(blackFrames)}`);
  }

  const { inPoint, outPoint } = project.clock;
  const durationMs = outPoint - inPoint;
  const windowPulses = project.scene.audioPulses
    .filter((pulse) => pulse.t >= inPoint && pulse.t < outPoint)
  const mixPulses = windowPulses
    .map((pulse) => ({ ...pulse, t: pulse.t - inPoint }));
  const audio = renderAudioTrack(mixPulses, durationMs, project.meta.sampleRate);
  const alignment = checkAudioVisualAlignment(frames, windowPulses, fps);

  const apng = encodeApng(frames.map((frame) => frame.canvas), {
    frameMs: Math.round(1000 / fps)
  });
  const wav = encodeWav(audio, project.meta.sampleRate);

  writeFileSync(`${outputBase}.png`, encodePng(frames[0].canvas));
  writeFileSync(`${outputBase}.apng`, apng);
  writeFileSync(`${outputBase}.wav`, wav);
  writeFileSync(`${outputBase}.events.json`,
    JSON.stringify(project.toJSON(), null, 2));

  return {
    files: [`${outputBase}.apng`, `${outputBase}.wav`, `${outputBase}.png`,
      `${outputBase}.events.json`],
    frameCount: frames.length,
    durationMs,
    blackFrames,
    alignmentMismatches: alignment,
    firstFrame: frames[0],
    lastFrame: frames[frames.length - 1]
  };
}

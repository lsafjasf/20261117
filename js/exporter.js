// 离线渲染 -> WAV 导出。与实时引擎共用 graph.js 的拓扑与参数。
import { buildGraph, applyGraphParams, applyMode, scheduleVoice } from "./graph.js";
import { encodeWav } from "./dsp.js";
import { REGISTERS, sanitizeParams } from "./params.js";

// 渲染 bars 个节拍（每音区循环一次），返回 AudioBuffer 与通道数据。
export async function renderOffline(rawParams, options = {}) {
  const params = sanitizeParams(rawParams);
  const bars = options.bars ?? REGISTERS.length;
  const mode = options.mode ?? "main";
  const sampleRate = options.sampleRate ?? 48000;
  const beat = 60 / params.bpm;
  const totalDuration = Math.max(0.5, beat * bars + params.delayTime * (1 + params.feedback) + 0.25);
  const OfflineCtor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const ctx = new OfflineCtor(2, Math.ceil(totalDuration * sampleRate), sampleRate);
  const g = buildGraph(ctx);
  applyGraphParams(g, params, 0);
  applyMode(g, mode, 0);

  const duration = Math.min(params.holdSeconds, beat * 0.95);
  for (let step = 0; step < bars; step++) {
    const reg = REGISTERS[step % REGISTERS.length];
    const key = `detune${reg.id[0].toUpperCase()}${reg.id.slice(1)}`;
    scheduleVoice(ctx, g, params, reg, params[key] ?? 0, step * beat + 0.03, duration);
  }
  const rendered = await ctx.startRendering();
  const channelData = [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()];
  return {
    buffer: rendered,
    channelData,
    sampleRate: rendered.sampleRate,
    wav: encodeWav(channelData, rendered.sampleRate),
    params,
    mode,
    bars
  };
}

// 浏览器下载；Node 测试直接使用返回的 ArrayBuffer。
export function downloadWav(arrayBuffer, filename = "synth-tuner-export.wav") {
  const blob = new Blob([arrayBuffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

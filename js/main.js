import { AudioEngine } from "./engine.js";
import { Tuner } from "./tuner.js";
import { drawMeter, drawSpectrum } from "./renderer.js";
import { renderOffline, downloadWav } from "./exporter.js";
import {
  verifyDimensions, compareExports, beatDriftReport, tailSilence, channelBalance
} from "./verify.js";
import { DEFAULT_PARAMS, REGISTERS, sanitizeParams, saveParams, loadParams } from "./params.js";

const $ = (id) => document.getElementById(id);
let engine = null;
let tuner = null;
let params = sanitizeParams(DEFAULT_PARAMS);
let micStream = null;
let micSource = null;
let rafId = 0;
let lastExport = null;

const meterCanvas = $("meter-canvas");
const specCanvas = $("spec-canvas");

async function ensureEngine() {
  if (engine) return engine;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  engine = new AudioEngine(ctx, params);
  tuner = new Tuner(params);
  engine.onStep = (step, reg) => {
    $("beat-pos").textContent = `${step} · ${reg.name} (${reg.target}Hz)`;
  };
  return engine;
}

function syncControls() {
  const map = [
    ["p-wave", "wave", "value"], ["p-freq", "baseFreq", "number"],
    ["p-pan", "pan", "range"], ["p-gain", "masterGain", "range"],
    ["p-lows", "lowsDb", "range"], ["p-mids", "midsDb", "range"],
    ["p-highs", "highsDb", "range"], ["p-delay", "delayTime", "range"],
    ["p-fb", "feedback", "range"], ["p-bpm", "bpm", "number"],
    ["p-hold", "holdSeconds", "range"], ["in-gain", "inputGain", "range"]
  ];
  for (const [id, key, kind] of map) {
    $(id).value = params[key];
    const valEl = $(id + "-val");
    if (valEl) valEl.textContent = kind === "range" ? Number(params[key]).toFixed(2) : params[key];
  }
  const detuneMap = [["d-low", "detuneLow"], ["d-mid", "detuneMid"], ["d-high", "detuneHigh"]];
  for (const [id, key] of detuneMap) {
    $(id).value = params[key];
    $(id + "-val").textContent = params[key];
  }
}

function readControl(id, key) {
  const el = $(id);
  params[key] = el.type === "number" ? Number(el.value) : Number(el.value);
  const valEl = $(id + "-val");
  if (valEl) valEl.textContent = el.type === "range" ? Number(el.value).toFixed(2) : el.value;
}

function bindParamControls() {
  const ids = ["p-wave", "p-freq", "p-pan", "p-gain", "p-lows", "p-mids", "p-highs",
    "p-delay", "p-fb", "p-bpm", "p-hold", "in-gain"];
  const keys = ["wave", "baseFreq", "pan", "masterGain", "lowsDb", "midsDb", "highsDb",
    "delayTime", "feedback", "bpm", "holdSeconds", "inputGain"];
  ids.forEach((id, i) => {
    $(id).addEventListener("input", () => {
      readControl(id, keys[i]);
      params = sanitizeParams(params);
      if (engine) engine.updateParams(params);
      if (tuner) tuner.updateParams(params);
    });
  });
  [["d-low", "detuneLow"], ["d-mid", "detuneMid"], ["d-high", "detuneHigh"]].forEach(([id, key]) => {
    $(id).addEventListener("input", () => {
      params[key] = Number($(id).value);
      $(id + "-val").textContent = $(id).value;
      params = sanitizeParams(params);
      if (engine) engine.updateParams(params);
    });
  });
}

function bindTransport() {
  $("btn-play").addEventListener("click", async () => {
    const e = await ensureEngine();
    e.ctx.resume();
    e.play();
  });
  $("btn-pause").addEventListener("click", () => engine && engine.pause());
  $("btn-replay").addEventListener("click", async () => {
    const e = await ensureEngine();
    e.ctx.resume();
    e.replay();
  });
  $("btn-step").addEventListener("click", async () => {
    const e = await ensureEngine();
    e.ctx.resume();
    e.step();
  });
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const e = await ensureEngine();
      document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      e.setMode(btn.dataset.mode);
    });
  });
}

bindTransport();
bindParamControls();
syncControls();

// 保存/重载
$("btn-save").addEventListener("click", () => {
  saveParams(params);
  flashVerify("verify-results", "参数已保存到 localStorage（" + Object.keys(params).length + " 项）");
});
$("btn-load").addEventListener("click", () => {
  params = sanitizeParams(loadParams());
  if (engine) engine.updateParams(params);
  if (tuner) tuner.updateParams(params);
  syncControls();
  flashVerify("verify-results", "参数已重载");
});

function flashVerify(id, text) {
  $(id).textContent = text;
}

// 真实麦克风输入
async function enableMic() {
  await disableMic();
  const e = await ensureEngine();
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });
  micSource = e.ctx.createMediaStreamSource(micStream);
  const inputGain = e.ctx.createGain();
  inputGain.gain.value = params.inputGain;
  micSource.connect(inputGain);
  inputGain.connect(e.analyser);
  micSource._inputGain = inputGain;
}

async function disableMic() {
  if (micSource) {
    try {
      micSource._inputGain.disconnect();
      micSource.disconnect();
    } catch { /* ignore */ }
  }
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  micSource = null;
}

$("input-source").addEventListener("change", async (ev) => {
  if (ev.target.value === "mic") {
    try {
      await enableMic();
    } catch (err) {
      flashVerify("verify-results", "麦克风不可用，回退模拟输入：" + err.message);
      ev.target.value = "sim";
    }
  } else {
    await disableMic();
  }
});

$("in-gain").addEventListener("change", () => {
  if (micSource?._inputGain) {
    micSource._inputGain.gain.setTargetAtTime(params.inputGain, engine.ctx.currentTime, 0.02);
  }
});

// 分析循环：电平/节点监测 + 调音识别 + Canvas 绘制
function analysisLoop() {
  rafId = requestAnimationFrame(analysisLoop);
  if (!engine) return;
  const raw = engine.readLevels();
  const sampleRate = engine.ctx.sampleRate;
  const useMic = $("input-source").value === "mic" && micSource;
  let frame;
  let sim = null;
  let clipping = false;
  if (useMic) {
    frame = raw;
  } else {
    sim = Tuner.simulateMicInput(raw, sampleRate, params.inputGain, params.noiseFloor * 0.4);
    frame = sim.buffer;
    clipping = sim.clipping;
  }

  const result = tuner.processFrame(frame, sampleRate, clipping);
  drawMeter(meterCanvas, result.cents || 0, { tolerance: params.centsTolerance });
  drawSpectrum(specCanvas, frame, sampleRate);

  const half = frame.length / 2;
  let lS = 0, rS = 0;
  for (let i = 0; i < half; i++) {
    lS += frame[i] * frame[i];
    rS += frame[i + half] * frame[i + half];
  }
  const lvlL = Math.sqrt(lS / half);
  const lvlR = Math.sqrt(rS / half);
  $("level-l").value = lvlL;
  $("level-r").value = lvlR;
  $("level-l-val").textContent = lvlL.toFixed(3);
  $("level-r-val").textContent = lvlR.toFixed(3);
  $("channel-info").textContent = `stereo · pan ${params.pan.toFixed(2)}`;
  $("node-count").textContent = engine.activeNodeCount();

  $("overload").classList.toggle("hidden", !tuner.overload);
  $("pitch-readout").textContent = result.freq
    ? `${result.freq.toFixed(1)} Hz · 偏差 ${result.cents >= 0 ? "+" : ""}${result.cents.toFixed(1)} 音分 · 清晰度 ${result.clarity.toFixed(2)}`
    : `— Hz · 偏差 — 音分（电平 ${result.level.toFixed(3)}）`;

  const snap = tuner.snapshot();
  snap.registers.forEach((reg) => {
    const el = document.querySelector(`.reg[data-reg="${reg.id}"] .reg-state`);
    const box = document.querySelector(`.reg[data-reg="${reg.id}"]`);
    box.classList.toggle("ok", reg.ok);
    el.textContent = reg.ok ? "✓ 已校准" : reg.lastCents !== null
      ? `${reg.lastCents >= 0 ? "+" : ""}${reg.lastCents.toFixed(1)} 音分`
      : "待校准";
  });
  $("tune-complete").classList.toggle("hidden", !snap.complete);
}
requestAnimationFrame(analysisLoop);

// 导出 WAV
$("btn-export").addEventListener("click", async () => {
  const mode = document.querySelector(".mode-btn.active").dataset.mode;
  const out = await renderOffline(params, { mode, bars: REGISTERS.length });
  lastExport = out;
  downloadWav(out.wav, `synth-${mode}-${Date.now()}.wav`);
  const bal = channelBalance(out.channelData);
  const dur = out.channelData[0].length / out.sampleRate;
  $("export-compare").innerHTML =
    `已导出 ${mode} 模式 WAV\n时长 ${dur.toFixed(3)}s · 声道 ${out.channelData.length} · ` +
    `峰值 L=${bal.lPeak.toFixed(4)} R=${bal.rPeak.toFixed(4)}`;
});

function line(text, pass) {
  const cls = pass === undefined ? "" : pass ? "pass" : "fail";
  return `<div class="${cls}">${pass === undefined ? "" : pass ? "✓ " : "✗ "}${text}</div>`;
}

// 完整验证：四维 + 导出比较 + 保存/重载再导出 + 静音/尾音/漂移 + 节点泄漏
$("btn-verify").addEventListener("click", async () => {
  const box = $("verify-results");
  box.innerHTML = "验证运行中…";
  let html = "";

  const dims = await verifyDimensions();
  html += line(`四维参数变化：${dims.passCount}/4 通过（要求≥3）`, dims.ok);
  dims.results.forEach((r) => { html += line(`${r.dim}：${r.detail}`, r.pass); });

  const first = await renderOffline(params, { bars: REGISTERS.length });
  saveParams(params);
  const reloaded = sanitizeParams(loadParams());
  const second = await renderOffline(reloaded, { bars: REGISTERS.length });
  const cmp = compareExports(first.wav, second.wav);
  const reloadOk = cmp.duration.equal && cmp.channels.equal &&
    Math.abs(cmp.peak.a.l - cmp.peak.b.l) < 1e-4 && Math.abs(cmp.peak.a.r - cmp.peak.b.r) < 1e-4;
  html += line(
    `保存→重载→再导出：时长 ${cmp.duration.a.toFixed(3)}s/${cmp.duration.b.toFixed(3)}s，` +
    `声道 ${cmp.channels.a}/${cmp.channels.b}，峰值 L ${cmp.peak.a.l.toFixed(4)}/${cmp.peak.b.l.toFixed(4)}`,
    reloadOk
  );

  const drift = beatDriftReport(first.channelData, first.sampleRate, params.bpm, REGISTERS.length);
  html += line(
    `节拍漂移：最大间隔误差 ${drift.maxErr.toFixed(4)}s（理论 ${drift.expected.toFixed(3)}s，${drift.onsets.length} 个起音）`,
    drift.ok
  );

  // 尾音检查用无延迟渲染，区分“有意的效果尾”与“音符包络泄漏的尾音”。
  const dry = await renderOffline({ ...params, delayTime: 0, feedback: 0 }, { bars: REGISTERS.length });
  const tail = tailSilence(dry.channelData, dry.sampleRate, 0.12);
  html += line(`尾音检查（干声）：末端 120ms RMS=${tail.toFixed(5)}（要求 <0.003）`, tail < 0.003);

  const muted = await renderOffline(params, { mode: "mute", bars: REGISTERS.length });
  const mBal = channelBalance(muted.channelData);
  const muteOk = mBal.lPeak < 0.001 && mBal.rPeak < 0.001;
  html += line(`静音状态导出峰值 L=${mBal.lPeak.toExponential(1)} R=${mBal.rPeak.toExponential(1)}`, muteOk);

  const e = await ensureEngine();
  const baselineCount = e.activeNodeCount();   // 固定拓扑节点数（无音符时）
  e.pause();
  const pausedBuf = e.readLevels();
  let pausedEnergy = 0;
  for (let i = 0; i < pausedBuf.length; i++) pausedEnergy += pausedBuf[i] * pausedBuf[i];
  const pauseOk = Math.sqrt(pausedEnergy / pausedBuf.length) < 0.002;
  html += line(`暂停后声音停止：RMS=${Math.sqrt(pausedEnergy / pausedBuf.length).toExponential(1)}`, pauseOk);
  e.play();
  e.pause();
  const leaked = e.activeNodeCount();
  // 暂停后活动节点应回到固定拓扑基线，且不存在待发音符、无定时器。
  const leakOk = leaked === baselineCount && e.scheduled.length === 0 && e.timer === null;
  html += line(`无未关闭节点：暂停后活动节点 ${leaked}，待发音符 ${e.scheduled.length}`, leakOk);

  const allOk = dims.ok && reloadOk && drift.ok && tail < 0.003 && muteOk && pauseOk && leakOk;
  html = line(`总体验证 ${allOk ? "全部通过" : "存在失败项"}`, allOk) + html;
  box.innerHTML = html;
});

// 页面关闭/隐藏时彻底停止，避免节点与声音残留
window.addEventListener("pagehide", async () => {
  cancelAnimationFrame(rafId);
  await disableMic();
  if (engine) engine.teardown();
});

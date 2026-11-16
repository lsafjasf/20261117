// 可复用音频图构建：实时 AudioContext 与离线 OfflineAudioContext 共用同一拓扑。

// 返回音频图所有节点与入口引用；register 负责节点登记。
export function buildGraph(ctx, register = (n) => n) {
  const g = {};
  const make = (node) => register(node) ?? node;

  g.mainBus = make(ctx.createGain());
  g.bypassBus = make(ctx.createGain());
  g.muteGain = make(ctx.createGain());
  g.analyser = ctx.createAnalyser ? make(ctx.createAnalyser()) : null;
  if (g.analyser) g.analyser.fftSize = 2048;

  g.voiceBus = make(ctx.createGain());
  g.lowShelf = make(ctx.createBiquadFilter());
  g.lowShelf.type = "lowshelf";
  g.lowShelf.frequency.value = 200;
  g.midPeak = make(ctx.createBiquadFilter());
  g.midPeak.type = "peaking";
  g.midPeak.frequency.value = 1000;
  g.midPeak.Q.value = 0.8;
  g.highShelf = make(ctx.createBiquadFilter());
  g.highShelf.type = "highshelf";
  g.highShelf.frequency.value = 4000;
  g.filter = make(ctx.createBiquadFilter());
  g.filter.type = "peaking";
  g.filter.frequency.value = 1000;
  g.filter.Q.value = 0.7;

  g.delay = make(ctx.createDelay(1.0));
  g.feedback = make(ctx.createGain());
  g.delayWet = make(ctx.createGain());
  g.delayWet.gain.value = 0.5;
  g.panner = make(ctx.createStereoPanner());
  g.master = make(ctx.createGain());

  g.splitter = make(ctx.createChannelSplitter(2));
  g.merger = make(ctx.createChannelMerger(2));
  g.levelL = make(ctx.createGain());
  g.levelR = make(ctx.createGain());

  // 主输出（含效果）路径
  g.voiceBus.connect(g.lowShelf);
  g.lowShelf.connect(g.midPeak);
  g.midPeak.connect(g.highShelf);
  g.highShelf.connect(g.filter);
  g.filter.connect(g.delay);
  g.delay.connect(g.feedback);
  g.feedback.connect(g.delay);
  g.delay.connect(g.delayWet);
  g.filter.connect(g.panner);
  g.delayWet.connect(g.panner);
  g.panner.connect(g.master);
  g.master.connect(g.mainBus);

  // 旁路（干声）路径
  g.voiceBus.connect(g.bypassBus);

  g.mainBus.connect(g.muteGain);
  g.bypassBus.connect(g.muteGain);
  if (g.analyser) {
    g.muteGain.connect(g.analyser);
    g.analyser.connect(g.splitter);
  } else {
    g.muteGain.connect(g.splitter);
  }
  g.splitter.connect(g.levelL, 0);
  g.splitter.connect(g.levelR, 1);
  g.levelL.connect(g.merger, 0, 0);
  g.levelR.connect(g.merger, 0, 1);
  g.merger.connect(ctx.destination);

  return g;
}

export function applyGraphParams(g, params, time) {
  const t = time;
  g.lowShelf.gain.setTargetAtTime(params.lowsDb, t, 0.02);
  g.midPeak.gain.setTargetAtTime(params.midsDb, t, 0.02);
  g.highShelf.gain.setTargetAtTime(params.highsDb, t, 0.02);
  g.delay.delayTime.setTargetAtTime(params.delayTime, t, 0.02);
  g.feedback.gain.setTargetAtTime(params.feedback, t, 0.02);
  g.panner.pan.setTargetAtTime(params.pan, t, 0.02);
  g.master.gain.setTargetAtTime(params.masterGain, t, 0.02);
}

export function applyMode(g, mode, time) {
  const quick = 0.02;
  g.mainBus.gain.cancelScheduledValues(time);
  g.bypassBus.gain.cancelScheduledValues(time);
  g.muteGain.gain.cancelScheduledValues(time);
  if (mode === "mute") {
    // 静音为硬门：立即归零，保证数字静音、无任何尾音。
    g.mainBus.gain.setValueAtTime(0, time);
    g.bypassBus.gain.setValueAtTime(0, time);
    g.muteGain.gain.setValueAtTime(0, time);
  } else if (mode === "bypass") {
    g.mainBus.gain.setTargetAtTime(0, time, quick);
    g.bypassBus.gain.setTargetAtTime(1, time, quick);
    g.muteGain.gain.setTargetAtTime(1, time, quick);
  } else {
    g.mainBus.gain.setTargetAtTime(1, time, quick);
    g.bypassBus.gain.setTargetAtTime(0, time, quick);
    g.muteGain.gain.setTargetAtTime(1, time, quick);
  }
}

// 在给定图上创建一个带包络的音符（离线/实时通用）。
export function scheduleVoice(ctx, g, params, reg, detuneCents, startTime, duration) {
  const osc = ctx.createOscillator();
  osc.type = params.wave;
  osc.frequency.value = reg.target;
  osc.detune.value = detuneCents;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startTime);
  const attack = 0.01;
  const release = Math.min(0.08, duration * 0.3);
  env.gain.linearRampToValueAtTime(0.9, startTime + attack);
  env.gain.setValueAtTime(0.9, startTime + Math.max(attack, duration - release));
  env.gain.linearRampToValueAtTime(0, startTime + duration);
  osc.connect(env);
  env.connect(g.voiceBus);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
  return { osc, env };
}

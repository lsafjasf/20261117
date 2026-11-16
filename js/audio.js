/* 程序化音效：发动机（锯齿波+低通）与蜂鸣（失谐正弦群），随仿真状态变化 */
(function (G) {
  function BeeAudio() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    // ---- 发动机：锯齿波经低通，频率随车速 ----
    const engineOsc = ctx.createOscillator();
    const engineFilter = ctx.createBiquadFilter();
    const engineGain = ctx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 300;
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter).connect(engineGain).connect(master);
    engineOsc.start();

    // ---- 蜂鸣：三只失谐振荡器，频率随箱温升高 ----
    const beeGain = ctx.createGain();
    beeGain.gain.value = 0;
    beeGain.connect(master);
    const beeOscs = [];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 180 + i * 12;
      const g = ctx.createGain();
      g.gain.value = 0.33;
      o.connect(g).connect(beeGain);
      o.start();
      beeOscs.push(o);
    }

    // ---- 告警蜂鸣器 ----
    const alarmOsc = ctx.createOscillator();
    const alarmGain = ctx.createGain();
    alarmOsc.type = 'square';
    alarmOsc.frequency.value = 880;
    alarmGain.gain.value = 0;
    alarmOsc.connect(alarmGain).connect(master);
    alarmOsc.start();

    let muted = false;
    let alarmOn = false;

    function update(sim) {
      if (muted) return;
      const now = ctx.currentTime;
      const moving = sim.phase === 'transport';
      const speedMap = { slow: 48, normal: 68, fast: 95 };
      const targetEngineFreq = moving ? speedMap[sim.speedMode] || 68 : 30;
      engineOsc.frequency.setTargetAtTime(targetEngineFreq, now, 0.15);
      engineFilter.frequency.setTargetAtTime(moving ? 320 : 120, now, 0.2);
      engineGain.gain.setTargetAtTime(moving ? 0.10 : 0.02, now, 0.2);

      // 蜂鸣音高随平均实际箱温上升；死亡蜂箱静音
      const alive = sim.hives.filter((h) => h.alive);
      const avgTemp = alive.length
        ? alive.reduce((s, h) => s + h.temp, 0) / alive.length : 20;
      const beeBase = 150 + (avgTemp - 28) * 9;
      beeOscs.forEach((o, i) => {
        o.frequency.setTargetAtTime(beeBase + i * 11, now, 0.25);
      });
      const beeTarget = sim.phase === 'idle' ? 0.015
        : alive.length ? 0.05 + (avgTemp - 30) * 0.004 : 0;
      beeGain.gain.setTargetAtTime(Math.max(0, beeTarget), now, 0.3);

      // 告警：alert 连续，warn 间歇（用 LFO 风格的定时切换）
      const hasAlert = Object.values(sim.alarms).includes('alert');
      const hasWarn = Object.values(sim.alarms).includes('warn');
      if (hasAlert) alarmOn = true;
      else if (hasWarn) alarmOn = Math.floor(sim.t * 2) % 2 === 0;
      else alarmOn = false;
      alarmGain.gain.setTargetAtTime(alarmOn ? 0.045 : 0, now, 0.05);
    }

    function blip(freq) {
      if (muted) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      o.connect(g).connect(master);
      o.start();
      o.stop(ctx.currentTime + 0.2);
    }

    return {
      resume() { if (ctx.state === 'suspended') ctx.resume(); },
      update,
      click() { blip(520); },
      success() { blip(660); setTimeout(() => blip(880), 120); setTimeout(() => blip(1100), 260); },
      fail() { blip(300); setTimeout(() => blip(180), 180); },
      toggleMute() {
        muted = !muted;
        if (muted) {
          engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
          beeGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
          alarmGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        }
        return muted;
      },
      get muted() { return muted; }
    };
  }

  G.BeeAudio = BeeAudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);

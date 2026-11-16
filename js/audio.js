// WebAudio:引擎声随航速变化,压缩机声随运行/过载变化
export function createAudio() {
  let ctx = null, engineOsc, engineGain, compOsc, compGain, strainOsc, strainGain;

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineGain).connect(ctx.destination);
    engineOsc.start();
    compOsc = ctx.createOscillator();
    compOsc.type = 'square';
    compOsc.frequency.value = 110;
    compGain = ctx.createGain();
    compGain.gain.value = 0;
    compOsc.connect(compGain).connect(ctx.destination);
    compOsc.start();
    strainOsc = ctx.createOscillator();
    strainOsc.type = 'triangle';
    strainOsc.frequency.value = 620;
    strainGain = ctx.createGain();
    strainGain.gain.value = 0;
    strainOsc.connect(strainGain).connect(ctx.destination);
    strainOsc.start();
  }

  return {
    unlock() { ensure(); if (ctx.state === 'suspended') ctx.resume(); },
    update(state) {
      if (!ctx) return;
      const s = state.ship.speed;
      // 引擎:航速越快音调越高、越响
      engineOsc.frequency.value = 45 + s * 14;
      engineGain.gain.value = state.paused || state.status !== 'playing' ? 0 : Math.min(0.08, s * 0.014);
      // 压缩机:运行时低频嗡鸣,接近过载时加入高频啸叫
      const c = state.compressor;
      const running = c.on && !c.overloaded && state.status === 'playing' && !state.paused;
      compGain.gain.value = running ? 0.03 + c.power * 0.008 : 0;
      compOsc.frequency.value = 100 + c.power * 15;
      strainGain.gain.value = running && c.heat > 75 ? 0.02 : 0;
    },
  };
}

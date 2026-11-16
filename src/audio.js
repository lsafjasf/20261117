// 所有音效懒初始化，浏览器要求用户交互后才能启动 AudioContext。
export function createAudio() {
  const audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    muted: false,
  };

  function ensure() {
    if (audio.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio.ctx = new Ctx();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = audio.muted ? 0 : 0.5;

    const delay = audio.ctx.createDelay(1);
    delay.delayTime.value = 0.32;
    const feedback = audio.ctx.createGain();
    feedback.gain.value = 0.35;
    const echoGain = audio.ctx.createGain();
    echoGain.gain.value = 0.4;
    audio.master.connect(audio.ctx.destination);
    audio.master.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(echoGain);
    echoGain.connect(audio.ctx.destination);

    audio.engineOsc = audio.ctx.createOscillator();
    audio.engineOsc.type = 'sawtooth';
    audio.engineGain = audio.ctx.createGain();
    audio.engineGain.gain.value = 0.0;
    audio.engineOsc.connect(audio.engineGain);
    audio.engineGain.connect(audio.master);
    audio.engineOsc.start();
  }

  return {
    unlock() {
      ensure();
      if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    },
    setMuted(muted) {
      audio.muted = muted;
      if (audio.master) audio.master.gain.value = muted ? 0 : 0.5;
    },
    isMuted() {
      return audio.muted;
    },
    updateEngine(speedRatio, running) {
      if (!audio.ctx || !audio.engineOsc) return;
      const now = audio.ctx.currentTime;
      const target = running ? 0.025 + speedRatio * 0.05 : 0;
      audio.engineGain.gain.setTargetAtTime(target, now, 0.1);
      audio.engineOsc.frequency.setTargetAtTime(48 + speedRatio * 90, now, 0.08);
    },
    blip(freq, duration, gainValue, type = 'sine') {
      if (!audio.ctx) return;
      const osc = audio.ctx.createOscillator();
      const gain = audio.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(gainValue, audio.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audio.master);
      osc.start();
      osc.stop(audio.ctx.currentTime + duration);
    },
    collision() {
      this.blip(90, 0.45, 0.35, 'square');
      this.blip(55, 0.6, 0.22, 'triangle');
    },
    delivery() {
      this.blip(660, 0.16, 0.25, 'sine');
      this.blip(880, 0.24, 0.2, 'sine');
    },
    checkpoint() {
      this.blip(520, 0.18, 0.2, 'triangle');
    },
    fail() {
      this.blip(160, 0.8, 0.3, 'sawtooth');
    },
    win() {
      this.blip(523, 0.2, 0.25);
      this.blip(659, 0.2, 0.25);
      this.blip(784, 0.4, 0.25);
    },
  };
}

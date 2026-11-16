/* WebAudio 程序化声音：电机负载、碰撞、失败与成功提示。 */
(function (G) {
  'use strict';

  function TowAudio() {
    let ctx = null;
    let master = null;
    let motor = null;
    let motorGain = null;
    let filter = null;
    let muted = false;
    let lastCollisions = 0;
    let lastPhase = 'playing';
    let lastWarn = 0;

    function ensure() {
      if (ctx) return ctx;
      const AudioCtx = G.AudioContext || G.webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.7;
        master.connect(ctx.destination);
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.8;
        motor = ctx.createOscillator();
        motor.type = 'sawtooth';
        motor.frequency.value = 46;
        motorGain = ctx.createGain();
        motorGain.gain.value = 0;
        motor.connect(filter);
        filter.connect(motorGain);
        motorGain.connect(master);
        motor.start();
      } catch (err) {
        ctx = null;
      }
      return ctx;
    }

    function resume() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume().catch(function () {});
      return c;
    }

    function tone(freq, duration, type, volume, delay) {
      const c = resume();
      if (!c || muted) return;
      const start = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.05, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    }

    function update(sim, active) {
      if (!ctx || !motor) return;
      const speed = Math.abs(sim.truck.speed || 0);
      const load = sim.stats.motorWork || 0;
      const pitch = 43 + speed * 1.55 + load * 63;
      const now = ctx.currentTime;
      motor.frequency.setTargetAtTime(pitch, now, 0.06);
      filter.frequency.setTargetAtTime(260 + speed * 5.4 + load * 220, now, 0.08);
      const gain = active ? Math.min(0.085, 0.012 + load * 0.045 + speed * 0.00018) : 0;
      motorGain.gain.setTargetAtTime(gain, now, 0.08);

      if (sim.stats.collisions > lastCollisions) {
        tone(92, 0.22, 'square', 0.12);
        tone(57, 0.3, 'sawtooth', 0.075, 0.03);
      }
      lastCollisions = sim.stats.collisions;

      if (sim.phase !== lastPhase) {
        if (sim.phase === 'won') {
          tone(523, 0.18, 'sine', 0.08);
          tone(659, 0.18, 'sine', 0.08, 0.17);
          tone(784, 0.36, 'sine', 0.1, 0.34);
        } else if (sim.phase === 'failed') {
          tone(220, 0.25, 'sawtooth', 0.08);
          tone(164, 0.28, 'sawtooth', 0.08, 0.22);
          tone(110, 0.5, 'sawtooth', 0.09, 0.45);
        }
        lastPhase = sim.phase;
      }
      if (sim.phase === 'playing' && sim.resources.drawbar < 30 &&
          sim.t - lastWarn > 1.8) {
        tone(420, 0.08, 'square', 0.035);
        lastWarn = sim.t;
      }
    }

    function click() {
      tone(680, 0.035, 'square', 0.025);
    }

    function toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.02);
      return muted;
    }

    function isMuted() { return muted; }

    return { resume, update, click, toggleMute, isMuted };
  }

  G.TowAudio = TowAudio;
  if (typeof module !== 'undefined' && module.exports) module.exports = { TowAudio };
})(typeof globalThis !== 'undefined' ? globalThis : this);

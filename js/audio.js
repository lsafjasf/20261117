// 声音反馈：振荡器频率随磁场强度 B 变化，暂停/故障时静音
(function () {
  const S = window.CONFIG.sound;

  function AudioFeedback() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.enabled = false;
  }

  AudioFeedback.prototype.ensure = function () {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.osc = this.ctx.createOscillator();
    this.gain = this.ctx.createGain();
    this.osc.type = 'triangle';
    this.osc.frequency.value = S.baseFreq;
    this.gain.gain.value = 0.0001;
    this.osc.connect(this.gain).connect(this.ctx.destination);
    this.osc.start();
  };

  // 必须由用户手势触发
  AudioFeedback.prototype.toggle = function () {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.enabled = !this.enabled;
    this.gain.gain.setTargetAtTime(this.enabled ? 0.06 : 0.0001,
      this.ctx.currentTime, 0.05);
    return this.enabled;
  };

  AudioFeedback.prototype.update = function (B, active) {
    if (!this.ctx || !this.enabled) return;
    const norm = Math.min(1, Math.max(0, B / 6000));
    const freq = S.baseFreq + (S.maxFreq - S.baseFreq) * norm;
    this.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.03);
    this.gain.gain.setTargetAtTime(active ? 0.06 : 0.0001,
      this.ctx.currentTime, 0.05);
  };

  AudioFeedback.prototype.stop = function () {
    if (!this.ctx) return;
    this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
  };

  window.AudioFeedback = AudioFeedback;
})();

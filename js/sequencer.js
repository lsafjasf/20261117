// 音序器：lookahead 调度，支持播放/暂停/重播/单步
export class Sequencer {
  constructor(engine, pattern) {
    this.engine = engine;
    this.pattern = pattern; // 数组元素: null | 'success' | 'warning' | 'error'
    this.step = 0;
    this.playing = false;
    this.timer = null;
    this.nextTime = 0;
    this.onStep = null; // (stepIndex, audioTime) => void
    this.stepLog = []; // 已调度步骤记录，用于节拍漂移检查
  }

  get intervalSec() {
    return this.engine.params.stepInterval / 1000;
  }

  start() {
    this.engine.ensure();
    this.engine.ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.stepLog = [];
    this.nextTime = this.engine.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.tick(), 25);
  }

  tick() {
    if (!this.playing || !this.engine.ctx) return;
    const ahead = this.engine.ctx.currentTime + 0.12;
    while (this.nextTime < ahead) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += this.intervalSec;
      this.step = (this.step + 1) % this.pattern.length;
    }
  }

  scheduleStep(i, t) {
    const type = this.pattern[i];
    if (type) this.engine.trigger(type, t);
    this.stepLog.push({ step: i, time: t });
    if (this.stepLog.length > 256) this.stepLog.shift();
    if (this.onStep) this.onStep(i, t);
  }

  // 暂停：立即停声并挂起上下文，保留步进位置
  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.engine.stopAll();
    if (this.engine.ctx && this.engine.ctx.state === 'running') {
      setTimeout(() => {
        if (!this.playing && this.engine.ctx && this.engine.ctx.state === 'running') {
          this.engine.ctx.suspend();
        }
      }, 80);
    }
  }

  // 重播：从头开始
  replay() {
    this.pause();
    this.step = 0;
    this.start();
  }

  stop() {
    this.pause();
    this.step = 0;
  }

  // 单步：立即触发当前步并前进
  stepOnce() {
    this.engine.ensure();
    this.engine.ctx.resume();
    const t = this.engine.ctx.currentTime + 0.05;
    this.scheduleStep(this.step, t);
    this.step = (this.step + 1) % this.pattern.length;
  }

  // 节拍漂移：已调度步时间与理论网格的最大偏差
  beatDrift() {
    if (this.stepLog.length < 2) return 0;
    const t0 = this.stepLog[0].time;
    let max = 0;
    for (let i = 1; i < this.stepLog.length; i++) {
      const expected = t0 + i * this.intervalSec;
      max = Math.max(max, Math.abs(this.stepLog[i].time - expected));
    }
    return max;
  }
}

(function () {
  'use strict';

  const Sim = window.StackingSim;
  if (!Sim) throw new Error('仿真内核未加载');

  const engine = new Sim.StackingSimulator({ seed: 71 });
  const ui = {};
  const ids = [
    'simClock', 'globalStatus', 'globalStatusText', 'soundToggle', 'soundIcon', 'soundLabel',
    'exportJson', 'exportCsv', 'paramHealth', 'pressureRange', 'pressureValue', 'offsetRange',
    'offsetValue', 'speedRange', 'speedValue', 'startBtn', 'pauseBtn', 'stepBtn', 'recoverBtn',
    'estopBtn', 'resetBtn', 'riskCard', 'riskTitle', 'riskText', 'batchTitle', 'groupProgressText',
    'groupProgressBar', 'machineCanvas', 'faultOverlay', 'faultOverlayReason', 'armStateText',
    'layerStateText', 'goodCount', 'defectCount', 'cacheValue', 'powerValue', 'energyValue',
    'yieldRing', 'yieldValue', 'yieldGood', 'yieldTotal', 'yieldHint', 'cacheMeterText',
    'cacheMeterBar', 'cacheTargetText', 'peakPressure', 'peakCache', 'peakPower', 'peakSpeed',
    'stopBox', 'stopReason', 'stopLocation', 'runValidationBtn', 'runValidationLabel',
    'validationSummary', 'validationStamp', 'validationBody', 'validationEvidence', 'logCount',
    'eventLog', 'toast'
  ];
  ids.forEach((id) => { ui[id] = document.getElementById(id); });

  const STATUS_TEXT = {
    idle: '待机',
    running: '生产中',
    paused: '已暂停',
    fault: '故障停机',
    stopped: '急停停机',
    complete: '批次完成'
  };
  const KIND_TEXT = {
    equipment_start: '启动',
    equipment_stop: '停机',
    equipment_pause: '暂停',
    parameter_change: '参数',
    group_result: '判定',
    batch_result: '批次',
    anomaly: '异常',
    recovery: '复位',
    batch_reset: '重置',
    batch_start: '启动',
    single_step: '单步',
    system: '系统'
  };
  const EQUIPMENT_CLASS = {
    '待机': '',
    '运行中': 'running',
    '暂停': 'paused',
    '停机': 'stopped',
    '故障': 'fault',
    '完成': 'complete'
  };

  let soundEnabled = false;
  let lastValidation = null;
  let validationRunning = false;
  let lastLogId = 0;
  let lastUiAt = 0;
  let toastTimer = 0;
  let previousStatus = engine.status;
  let previousGood = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fmt(value, digits) {
    return Number(value || 0).toFixed(digits === undefined ? 1 : digits);
  }

  function toast(message, isError) {
    window.clearTimeout(toastTimer);
    ui.toast.textContent = message;
    ui.toast.className = `toast show${isError ? ' error' : ''}`;
    toastTimer = window.setTimeout(() => {
      ui.toast.className = 'toast';
    }, 3200);
  }

  class MachineAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.servo = null;
      this.servoGain = null;
      this.harmonic = null;
      this.harmonicGain = null;
      this.lastUpdate = 0;
    }

    async enable() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('当前浏览器不支持 Web Audio');
      if (!this.context) {
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.context.destination);

        this.servo = this.context.createOscillator();
        this.servo.type = 'sawtooth';
        this.servo.frequency.value = 150;
        this.servoGain = this.context.createGain();
        this.servoGain.gain.value = 0;
        this.servo.connect(this.servoGain).connect(this.master);
        this.servo.start();

        this.harmonic = this.context.createOscillator();
        this.harmonic.type = 'triangle';
        this.harmonic.frequency.value = 300;
        this.harmonicGain = this.context.createGain();
        this.harmonicGain.gain.value = 0;
        this.harmonic.connect(this.harmonicGain).connect(this.master);
        this.harmonic.start();
      }
      if (this.context.state === 'suspended') await this.context.resume();
    }

    disable() {
      if (!this.context) return;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.04);
    }

    update(snapshot) {
      if (!soundEnabled || !this.context) return;
      const now = this.context.currentTime;
      if (now - this.lastUpdate < 0.04) return;
      this.lastUpdate = now;
      const active = snapshot.status === 'running';
      const phase = snapshot.phase || 0;
      const pulse = Math.sin(phase * Math.PI * 2);
      const motion = active ? (0.5 + 0.5 * Math.abs(pulse)) : 0;
      const frequency = 92 + snapshot.params.speed * 1.25 + pulse * 24 + motion * 16;
      this.servo.frequency.setTargetAtTime(frequency, now, 0.08);
      this.harmonic.frequency.setTargetAtTime(frequency * 2.02, now, 0.08);
      const gain = active ? 0.026 + motion * 0.017 : 0;
      this.servoGain.gain.setTargetAtTime(gain, now, 0.09);
      this.harmonicGain.gain.setTargetAtTime(active ? 0.008 : 0, now, 0.09);
      if (this.master.gain.value < 0.01) this.master.gain.setTargetAtTime(0.55, now, 0.04);
    }

    tone(frequency, duration, type, volume) {
      if (!soundEnabled || !this.context) return;
      const now = this.context.currentTime;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume || 0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    }

    eventTone(kind) {
      if (kind === 'group_result') this.tone(720, 0.07, 'sine', 0.035);
      if (kind === 'anomaly') {
        this.tone(180, 0.28, 'square', 0.055);
        window.setTimeout(() => this.tone(150, 0.28, 'square', 0.045), 220);
      }
      if (kind === 'recovery') this.tone(520, 0.11, 'triangle', 0.04);
    }
  }

  const audio = new MachineAudio();

  class CanvasRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (width !== this.canvas.width || height !== this.canvas.height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.width = width;
        this.height = height;
        this.dpr = dpr;
      }
    }

    roundedRect(x, y, width, height, radius) {
      const ctx = this.ctx;
      const r = Math.min(radius, width / 2, height / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + width, y, x + width, y + height, r);
      ctx.arcTo(x + width, y + height, x, y + height, r);
      ctx.arcTo(x, y + height, x, y, r);
      ctx.arcTo(x, y, x + width, y, r);
      ctx.closePath();
    }

    label(text, x, y, color, size, align, weight) {
      const ctx = this.ctx;
      ctx.fillStyle = color;
      ctx.font = `${weight || 500} ${size || 10}px "SFMono-Regular", Consolas, "Stackguard Sans", monospace`;
      ctx.textAlign = align || 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
    }

    drawGrid(snapshot) {
      const ctx = this.ctx;
      const sim = snapshot.simTime;
      const bg = ctx.createLinearGradient(0, 0, 1000, 600);
      bg.addColorStop(0, '#07131b');
      bg.addColorStop(0.55, '#081018');
      bg.addColorStop(1, '#090e15');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1000, 600);

      const glow = ctx.createRadialGradient(530, 350, 20, 530, 350, 390);
      glow.addColorStop(0, 'rgba(49, 148, 141, 0.09)');
      glow.addColorStop(0.5, 'rgba(22, 76, 82, 0.035)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 1000, 600);

      ctx.strokeStyle = 'rgba(119, 168, 175, 0.045)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= 1000; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 600);
        ctx.stroke();
      }
      for (let y = 0; y <= 600; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(1000, y);
        ctx.stroke();
      }

      const scanX = (sim * 80) % 1100 - 50;
      const scan = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
      scan.addColorStop(0, 'rgba(91, 227, 210, 0)');
      scan.addColorStop(0.5, 'rgba(91, 227, 210, 0.022)');
      scan.addColorStop(1, 'rgba(91, 227, 210, 0)');
      ctx.fillStyle = scan;
      ctx.fillRect(scanX - 40, 0, 80, 600);

      ctx.strokeStyle = 'rgba(112, 168, 173, 0.16)';
      ctx.strokeRect(0.5, 0.5, 999, 599);
      this.label('STG-10 / STACKER CELL', 24, 26, 'rgba(152, 194, 199, 0.5)', 9);
      this.label(`T+${fmt(sim, 1)} s`, 976, 26,
        snapshot.status === 'running' ? '#5be3d2' : 'rgba(152, 194, 199, 0.45)', 9, 'right');
    }

    drawFrame(snapshot) {
      const ctx = this.ctx;
      const fault = snapshot.status === 'fault' || snapshot.status === 'stopped';
      ctx.strokeStyle = fault ? 'rgba(255, 107, 107, 0.23)' : 'rgba(115, 169, 174, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(40, 92);
      ctx.lineTo(960, 92);
      ctx.moveTo(64, 92);
      ctx.lineTo(64, 525);
      ctx.lineTo(936, 525);
      ctx.lineTo(936, 92);
      ctx.stroke();

      ctx.fillStyle = 'rgba(7, 14, 20, 0.75)';
      ctx.fillRect(65, 93, 870, 28);
      ctx.strokeStyle = 'rgba(122, 174, 178, 0.13)';
      ctx.strokeRect(65.5, 93.5, 869, 27);
      this.label('G A N T R Y   A X I S', 480, 107, 'rgba(137, 182, 187, 0.48)', 8, 'center');
      for (let x = 82; x < 930; x += 22) {
        ctx.fillStyle = 'rgba(122, 174, 178, 0.12)';
        ctx.fillRect(x, 111, 8, 2);
      }
    }

    drawSources(snapshot) {
      const ctx = this.ctx;
      const sources = [
        { type: 'positive', label: '正极卷', x: 84, y: 252, color: '#e9a15d' },
        { type: 'separator', label: '隔膜卷', x: 84, y: 334, color: '#5ad7cb' },
        { type: 'negative', label: '负极卷', x: 84, y: 416, color: '#6e9de8' }
      ];
      sources.forEach((source, index) => {
        this.roundedRect(source.x, source.y, 126, 62, 9);
        ctx.fillStyle = 'rgba(12, 22, 30, 0.92)';
        ctx.fill();
        ctx.strokeStyle = `${source.color}38`;
        ctx.lineWidth = 1;
        ctx.stroke();
        const cx = source.x + 28;
        const cy = source.y + 31;
        const angle = snapshot.simTime * (source.type === 'separator' ? 0.7 : 1.1) + index;
        ctx.beginPath();
        ctx.arc(cx, cy, 19, 0, Math.PI * 2);
        ctx.fillStyle = `${source.color}20`;
        ctx.fill();
        ctx.strokeStyle = `${source.color}88`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 16, angle, angle + Math.PI * 1.55);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fillStyle = `${source.color}55`;
        ctx.fill();
        this.label(source.label, source.x + 55, source.y + 22, 'rgba(222, 238, 239, 0.8)', 9);
        this.label(index === 0 ? 'CATHODE' : index === 1 ? 'SEPARATOR' : 'ANODE',
          source.x + 55, source.y + 38, `${source.color}aa`, 7);
        const level = index === 1 ? 82 - snapshot.progress * 12 : 72 - snapshot.progress * 20;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(source.x + 55, source.y + 49, 54, 3);
        ctx.fillStyle = source.color;
        ctx.fillRect(source.x + 55, source.y + 49, 54 * level / 100, 3);
      });
    }

    armPose(snapshot) {
      const layerType = Sim.GROUP_LAYERS[snapshot.stack.length % 3];
      const sourceY = layerType === 'positive' ? 283 : layerType === 'separator' ? 365 : 447;
      const sourceX = 170;
      const stackX = 534 + snapshot.params.offset * 13;
      const stackY = 454;
      const phase = snapshot.phase;
      let x = sourceX;
      let y = sourceY - 24;
      let travel = 0;
      if (phase < 0.2) {
        y = sourceY - 24;
        travel = phase / 0.2;
      } else if (phase < 0.47) {
        const t = (phase - 0.2) / 0.27;
        x = sourceX + (stackX - sourceX) * t;
        y = sourceY - 24 - Math.sin(t * Math.PI) * 72;
        travel = 1;
      } else if (phase < 0.66) {
        const t = (phase - 0.47) / 0.19;
        x = stackX;
        y = stackY - Math.sin(Math.min(1, t) * Math.PI / 2) * 18;
        travel = 0.2;
      } else if (phase < 0.79) {
        x = stackX;
        y = stackY - 18 + (phase - 0.66) / 0.13 * 18;
        travel = 0.3;
      } else {
        const t = (phase - 0.79) / 0.21;
        x = stackX + (sourceX - stackX) * t;
        y = stackY - 76 - Math.sin(t * Math.PI) * 18;
        travel = 1 - t;
      }
      return { x, y, sourceX, sourceY, stackX, stackY, layerType, travel };
    }

    drawArm(snapshot) {
      const ctx = this.ctx;
      const pose = this.armPose(snapshot);
      const fault = snapshot.status === 'fault' || snapshot.status === 'stopped';
      const active = snapshot.status === 'running';
      const color = fault ? '#ff6b6b' : active ? '#5be3d2' : '#6d8490';

      ctx.save();
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = 'rgba(91, 227, 210, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pose.sourceX, 125);
      ctx.lineTo(pose.stackX, 125);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(18, 31, 40, 0.98)';
      this.roundedRect(pose.x - 31, 101, 62, 27, 6);
      ctx.fill();
      ctx.strokeStyle = `${color}66`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(pose.x - 14, 116, 28, 3);
      ctx.fillStyle = `${color}66`;
      ctx.fillRect(pose.x - 5, 127, 10, Math.max(15, pose.y - 127));

      ctx.strokeStyle = `${color}99`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pose.x, pose.y - 15);
      ctx.lineTo(pose.x, pose.y);
      ctx.stroke();

      const sheetColor = pose.layerType === 'positive' ? '#e9a15d' :
        pose.layerType === 'separator' ? '#5ad7cb' : '#6e9de8';
      ctx.fillStyle = `${sheetColor}${snapshot.phase > 0.6 ? 'ee' : '88'}`;
      this.roundedRect(pose.x - 27, pose.y + 1, 54, 5, 2);
      ctx.fill();
      ctx.strokeStyle = sheetColor;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pose.x - 20, pose.y + 7, 5, 0, Math.PI * 2);
      ctx.arc(pose.x + 20, pose.y + 7, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 14, 18, 0.9)';
      ctx.fill();
      ctx.strokeStyle = `${sheetColor}aa`;
      ctx.stroke();

      if (active && snapshot.phase > 0.52 && snapshot.phase < 0.65) {
        ctx.beginPath();
        ctx.arc(pose.stackX, pose.stackY + 3, 15 + (snapshot.phase - 0.52) * 80, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(91, 227, 210, 0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    drawStack(snapshot) {
      const ctx = this.ctx;
      const baseX = 480;
      const baseY = 486;
      const width = 112;
      ctx.fillStyle = 'rgba(15, 26, 34, 0.95)';
      this.roundedRect(baseX, baseY, width, 34, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(121, 174, 179, 0.2)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(91, 227, 210, 0.16)';
      ctx.fillRect(baseX + 13, baseY + 5, width - 26, 2);
      this.label('STACK TABLE', baseX + width / 2, baseY + 22, 'rgba(147, 185, 189, 0.5)', 7, 'center');

      const colors = { positive: '#e9a15d', separator: '#5ad7cb', negative: '#6e9de8' };
      const layerGap = 4.05;
      snapshot.stack.forEach((layer, index) => {
        const y = baseY - 7 - index * layerGap;
        const offset = layer.offset * 15;
        ctx.fillStyle = `${colors[layer.type]}d9`;
        this.roundedRect(baseX + 8 + offset, y, width - 16, 4.4, 1.5);
        ctx.fill();
        ctx.strokeStyle = `${colors[layer.type]}ff`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      });

      const nextLayer = snapshot.stack.length;
      if (snapshot.status === 'running' && snapshot.phase > 0.5 && nextLayer < 30) {
        const type = Sim.GROUP_LAYERS[nextLayer % 3];
        ctx.globalAlpha = clamp((snapshot.phase - 0.5) * 2.2, 0, 0.65);
        ctx.fillStyle = colors[type];
        this.roundedRect(baseX + 8 + snapshot.params.offset * 15,
          baseY - 7 - nextLayer * layerGap, width - 16, 4.4, 1.5);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      const risk = Math.abs(snapshot.params.offset) > 0.3;
      const stackHeight = Math.max(4, snapshot.stack.length * layerGap);
      const stackTop = baseY - 7 - stackHeight;
      ctx.strokeStyle = risk ? 'rgba(255, 107, 107, 0.65)' : 'rgba(91, 227, 210, 0.22)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(baseX + 6, stackTop, width - 12, stackHeight + 4);
      ctx.setLineDash([]);
      this.label(`${snapshot.stack.length} / 30 LAYERS`, baseX + width / 2, baseY + 44,
        risk ? '#ff9b91' : 'rgba(157, 195, 199, 0.58)', 7, 'center');
      if (risk) {
        this.label('ALIGNMENT RISK', baseX + width / 2, stackTop - 10,
          'rgba(255, 143, 135, 0.85)', 7, 'center', 700);
      }
    }

    drawCache(snapshot) {
      const ctx = this.ctx;
      const x = 718;
      const y = 177;
      const width = 202;
      const height = 306;
      const cache = snapshot.cache;
      const critical = cache > 88 || snapshot.status === 'fault' || snapshot.status === 'stopped';
      this.roundedRect(x, y, width, height, 11);
      ctx.fillStyle = 'rgba(12, 22, 29, 0.92)';
      ctx.fill();
      ctx.strokeStyle = critical ? 'rgba(255, 107, 107, 0.34)' : 'rgba(212, 184, 104, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
      this.label('BUFFER / CACHE', x + 14, y + 18, 'rgba(206, 191, 148, 0.68)', 8);
      this.label(`${fmt(cache)}%`, x + width - 14, y + 18,
        critical ? '#ff8078' : '#d4b868', 11, 'right', 700);

      const columns = 6;
      const rows = 8;
      const gap = 4;
      const cellW = (width - 28 - gap * (columns - 1)) / columns;
      const cellH = 13;
      const baseY = y + height - 46;
      const lit = Math.round(cache / 100 * columns * rows);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const index = row * columns + col;
          const active = index < lit;
          const cx = x + 14 + col * (cellW + gap);
          const cy = baseY - row * (cellH + gap);
          ctx.fillStyle = active
            ? (critical ? 'rgba(255, 107, 107, 0.78)' : 'rgba(212, 184, 104, 0.76)')
            : 'rgba(255, 255, 255, 0.035)';
          this.roundedRect(cx, cy, cellW, cellH, 2);
          ctx.fill();
          if (active) {
            ctx.fillStyle = critical ? 'rgba(255, 181, 168, 0.35)' : 'rgba(255, 233, 166, 0.3)';
            ctx.fillRect(cx + 2, cy + 2, cellW - 4, 1.5);
          }
        }
      }

      ctx.strokeStyle = 'rgba(212, 184, 104, 0.18)';
      ctx.beginPath();
      ctx.moveTo(x + 14, y + height - 27);
      ctx.lineTo(x + width - 14, y + height - 27);
      ctx.stroke();
      const move = (snapshot.simTime * (snapshot.params.speed / 100) * 23) % 18;
      for (let stripX = x + 15 + move; stripX < x + width - 12; stripX += 18) {
        ctx.fillStyle = 'rgba(212, 184, 104, 0.34)';
        ctx.fillRect(stripX, y + height - 24, 9, 3);
      }
      this.label(critical ? 'FLOW BLOCKED' : 'FLOW STABLE', x + 14, y + height - 12,
        critical ? '#ff746a' : 'rgba(212, 184, 104, 0.62)', 7);
      this.label(`TARGET ${fmt(8 + Math.max(0, snapshot.params.speed - 66) * 2.3)}%`,
        x + width - 14, y + height - 12, 'rgba(136, 159, 166, 0.58)', 7, 'right');
    }

    drawEnergy(snapshot) {
      const ctx = this.ctx;
      const active = snapshot.status === 'running';
      const energyX = 292;
      const energyY = 548;
      const energyW = 398;
      ctx.strokeStyle = 'rgba(91, 227, 210, 0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(energyX, energyY);
      ctx.lineTo(energyX + energyW, energyY);
      ctx.stroke();
      const markers = 10;
      for (let index = 0; index < markers; index += 1) {
        const offset = active
          ? ((snapshot.simTime * 42 + index * 40) % (energyW + 20)) - 10
          : 0;
        ctx.beginPath();
        ctx.arc(energyX + offset, energyY, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = active ? 'rgba(91, 227, 210, 0.65)' : 'rgba(91, 227, 210, 0.13)';
        ctx.fill();
      }
      this.label('POWER BUS', energyX, energyY - 12, 'rgba(138, 180, 183, 0.44)', 7);
      this.label(`${fmt(snapshot.powerKw)} kW`, energyX + energyW, energyY - 12,
        active ? 'rgba(91, 227, 210, 0.75)' : 'rgba(138, 180, 183, 0.44)', 8, 'right');
    }

    drawSafety(snapshot) {
      const ctx = this.ctx;
      const fault = snapshot.status === 'fault' || snapshot.status === 'stopped';
      if (!fault) return;
      const pulse = 0.32 + Math.sin(snapshot.simTime * 7) * 0.1;
      const glow = ctx.createRadialGradient(538, 340, 30, 538, 340, 300);
      glow.addColorStop(0, `rgba(255, 73, 73, ${pulse * 0.18})`);
      glow.addColorStop(1, 'rgba(255, 73, 73, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 1000, 600);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 107, 107, 0.38)';
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 8]);
      ctx.strokeRect(20, 48, 960, 504);
      ctx.restore();
      const station = snapshot.lastStop ? snapshot.lastStop.station : '整机';
      this.label(`SAFETY STOP · ${station}`, 500, 80, 'rgba(255, 145, 140, 0.85)', 9, 'center', 700);
    }

    draw(snapshot) {
      this.resize();
      const ctx = this.ctx;
      if (!this.width || !this.height) return;
      const sx = this.width / 1000;
      const sy = this.height / 600;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.clearRect(0, 0, 1000, 600);
      this.drawGrid(snapshot);
      this.drawFrame(snapshot);
      this.drawEnergy(snapshot);
      this.drawSources(snapshot);
      this.drawCache(snapshot);
      this.drawStack(snapshot);
      this.drawArm(snapshot);
      this.drawSafety(snapshot);
    }
  }

  const renderer = new CanvasRenderer(ui.machineCanvas);

  function formatSafetyIssues(snapshot) {
    const issues = snapshot.safety.filter((item) => !item.safe);
    if (!issues.length) {
      return {
        level: 'ok',
        title: '参数处于安全区',
        text: '压力、对位与节拍均在推荐范围内。'
      };
    }
    const critical = issues.some((item) => item.level === 'critical');
    const text = issues.map((item) => {
      if (item.key === 'pressure' && item.value > 65) return `压力 ${fmt(item.value, 0)} kPa 将压伤隔膜`;
      if (item.key === 'speed' && item.value > 108) return `节拍 ${fmt(item.value, 0)}% 存在缓存堵塞风险`;
      if (item.key === 'offset' && Math.abs(item.value) > 0.75) return `偏移 ${fmt(item.value, 2)} mm 存在短路风险`;
      return `${item.label} ${fmt(item.value, item.key === 'offset' ? 2 : 0)} ${item.unit} 超出安全区`;
    }).join('；');
    return {
      level: critical ? 'critical' : 'warning',
      title: critical ? '危险参数，保护即将介入' : '参数偏离推荐区',
      text
    };
  }

  function renderLogs(logs) {
    if (!logs.length) return;
    const latest = logs[logs.length - 1];
    if (latest.id === lastLogId) return;
    const fresh = logs.filter((entry) => entry.id > lastLogId);
    lastLogId = latest.id;
    ui.logCount.textContent = `${logs.length} 条`;
    ui.eventLog.replaceChildren();
    logs.slice(-90).reverse().forEach((entry) => {
      const row = document.createElement('div');
      row.className = `log-row kind-${entry.kind} severity-${entry.severity}`;
      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = entry.clock;
      const kind = document.createElement('span');
      kind.className = 'log-kind';
      kind.textContent = KIND_TEXT[entry.kind] || entry.kind;
      const station = document.createElement('span');
      station.className = 'log-station';
      station.textContent = entry.station;
      const message = document.createElement('span');
      message.className = 'log-message';
      message.textContent = entry.message;
      row.append(time, kind, station, message);
      ui.eventLog.append(row);
    });
    fresh.filter((entry) => ['anomaly', 'recovery'].includes(entry.kind)).slice(-2)
      .forEach((entry) => audio.eventTone(entry.kind));
  }

  function shortValues(result) {
    const values = result.values || {};
    if (result.id === 'normal') {
      return `良品 ${values.good}/10 · 缓存 ${fmt(values.cache)}% · ${fmt(values.powerKw)} kW`;
    }
    return `P ${fmt(values.pressure, 0)} kPa · O ${fmt(values.offset, 2)} mm · S ${fmt(values.speed, 0)}% · C ${fmt(values.cache)}%`;
  }

  function renderValidation() {
    if (!lastValidation) return;
    const results = lastValidation.results;
    ui.validationBody.replaceChildren();
    results.forEach((result) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      name.className = 'flow-name';
      name.textContent = result.title;
      const category = document.createElement('small');
      category.textContent = `${result.category}流程 · ${result.simulationSteps} 步`;
      name.append(category);

      const trigger = document.createElement('td');
      trigger.className = 'mono';
      trigger.textContent = result.triggerClock;

      const values = document.createElement('td');
      values.textContent = shortValues(result);

      const recovery = document.createElement('td');
      recovery.textContent = result.recovery.label;
      const detail = document.createElement('div');
      detail.textContent = result.recovery.detail;
      detail.style.color = 'var(--muted)';
      detail.style.marginTop = '2px';
      recovery.append(detail);

      const location = document.createElement('td');
      location.textContent = result.abnormalStation;
      const position = document.createElement('div');
      position.textContent = result.abnormalPosition;
      position.style.color = 'var(--muted)';
      position.style.marginTop = '2px';
      location.append(position);

      const outcome = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `result-badge ${result.passed ? 'pass' : 'fail'}`;
      badge.textContent = result.passed ? '通过' : '失败';
      badge.title = result.checks.map((check) => `${check.pass ? '✓' : '×'} ${check.label}`).join('\n');
      outcome.append(badge);
      row.append(name, trigger, values, recovery, location, outcome);
      ui.validationBody.append(row);
    });

    const allPassed = lastValidation.passed === lastValidation.total;
    const orb = ui.validationSummary.querySelector('.summary-orb');
    orb.className = `summary-orb ${allPassed ? 'pass' : 'fail'}`;
    ui.validationSummary.querySelector('strong').textContent =
      allPassed ? '三类流程均通过实测' : '存在未通过的验证流程';
    ui.validationSummary.querySelector('p').textContent =
      `正常生产、参数越限、设备停机均使用独立仿真实例；实际推进 ${results.reduce((sum, item) =>
        sum + item.simulationSteps, 0)} 步。`;
    ui.validationStamp.textContent = `${lastValidation.passed}/${lastValidation.total} 通过`;
    const totalLogs = results.reduce((sum, item) => sum + (item.logs || 0), 0);
    ui.validationEvidence.textContent =
      `证据：${results.reduce((sum, item) => sum + item.simulationSteps, 0)} 个仿真步 · ${totalLogs} 条事件`;
  }

  function updateUI(snapshot) {
    const status = snapshot.status;
    ui.simClock.textContent = snapshot.clock;
    ui.globalStatus.className = `status-pill is-${status}`;
    ui.globalStatusText.textContent = STATUS_TEXT[status] || status;

    ui.batchTitle.innerHTML = `${snapshot.batchId} <span>· 十组目标</span>`;
    ui.groupProgressText.textContent = `${snapshot.groupsDone} / 10 组`;
    ui.groupProgressBar.style.width = `${clamp(snapshot.progress * 100, 0, 100)}%`;
    ui.goodCount.textContent = String(snapshot.good);
    ui.defectCount.textContent = String(snapshot.defects);
    ui.cacheValue.textContent = `${fmt(snapshot.cache)}%`;
    ui.powerValue.textContent = `${fmt(snapshot.powerKw)} kW`;
    ui.energyValue.textContent = `${fmt(snapshot.energyKwh, 4)} kWh`;

    ui.yieldValue.textContent = snapshot.groupsDone
      ? `${Math.round(snapshot.yieldRate * 100)}%` : '—';
    ui.yieldGood.textContent = String(snapshot.good);
    ui.yieldTotal.textContent = String(snapshot.groupsDone);
    ui.yieldRing.style.setProperty('--yield', `${snapshot.yieldRate * 360}deg`);
    ui.yieldHint.textContent = snapshot.groupsDone
      ? `${snapshot.good} 组良品，${snapshot.defects} 组短路风险。`
      : '完成组数达到 10 组后自动判定批次。';

    const cacheTarget = clamp(8 + Math.max(0, snapshot.params.speed - 66) * 2.3, 0, 100);
    ui.cacheMeterText.textContent = `${fmt(snapshot.cache)}%`;
    ui.cacheMeterBar.style.width = `${clamp(snapshot.cache, 0, 100)}%`;
    ui.cacheTargetText.textContent = `${Math.round(cacheTarget)}%`;

    ui.peakPressure.textContent = `${fmt(snapshot.peak.pressure, 0)} kPa`;
    ui.peakCache.textContent = `${fmt(snapshot.peak.cache)}%`;
    ui.peakPower.textContent = `${fmt(snapshot.peak.power)} kW`;
    ui.peakSpeed.textContent = `${fmt(snapshot.peak.speed, 0)}%`;

    const issues = formatSafetyIssues(snapshot);
    ui.paramHealth.className = `tiny-badge ${issues.level === 'ok' ? '' : issues.level}`;
    ui.paramHealth.textContent = issues.level === 'ok' ? '安全' : issues.level === 'critical' ? '危险' : '越限';
    ui.riskCard.className = `risk-card ${issues.level === 'ok' ? '' : issues.level}`;
    ui.riskTitle.textContent = issues.title;
    ui.riskText.textContent = issues.text;

    Object.keys(snapshot.equipment).forEach((key) => {
      const state = snapshot.equipment[key];
      const label = document.getElementById(`state-${key}`);
      const dot = document.getElementById(`equip-${key}`);
      if (label) label.textContent = state;
      if (dot) dot.className = `equip-dot ${EQUIPMENT_CLASS[state] || ''}`;
    });

    const isFault = status === 'fault' || status === 'stopped';
    ui.faultOverlay.hidden = !isFault;
    if (isFault) {
      ui.faultOverlayReason.textContent = snapshot.lastStop
        ? `${snapshot.lastStop.station} · ${snapshot.lastStop.reason}`
        : snapshot.stopReason || '设备停机';
    }

    const stop = snapshot.lastStop;
    ui.stopBox.className = `stop-box${stop ? ' active' : ''}`;
    if (stop) {
      ui.stopReason.textContent = stop.reason;
      ui.stopLocation.textContent = `${stop.clock} · ${stop.station}`;
    } else if (status === 'complete') {
      ui.stopReason.textContent = '批次完成';
      ui.stopLocation.textContent = `${snapshot.clock} · 十组生产完成`;
    } else {
      ui.stopReason.textContent = '无停机';
      ui.stopLocation.textContent = '设备状态正常';
    }

    const type = Sim.GROUP_LAYERS[snapshot.stack.length % 3];
    const typeName = Sim.LAYER_LABELS[type];
    let armState = '机械臂待机';
    if (status === 'running') {
      armState = snapshot.phase < 0.2 ? `吸取${typeName}` :
        snapshot.phase < 0.52 ? `搬运${typeName}` :
          snapshot.phase < 0.68 ? `压合${typeName}` : '吸盘回程';
    } else if (status === 'paused') armState = '机械臂暂停';
    else if (isFault) armState = '机械臂安全锁定';
    else if (status === 'complete') armState = '机械臂归位';
    ui.armStateText.textContent = armState;
    ui.layerStateText.textContent = `叠层 ${snapshot.stack.length} / 30`;

    ui.startBtn.disabled = !(status === 'idle' || status === 'paused');
    ui.pauseBtn.disabled = status !== 'running';
    ui.stepBtn.disabled = status !== 'paused';
    ui.recoverBtn.disabled = !isFault;
    ui.estopBtn.disabled = !(status === 'running' || status === 'paused');

    if (status === 'complete' && previousStatus !== 'complete') {
      toast(`批次完成：${snapshot.good}/${snapshot.groupsDone} 良品，可导出结果`);
    }
    if (snapshot.good > previousGood && status === 'running') {
      audio.eventTone('group_result');
    }
    previousStatus = status;
    previousGood = snapshot.good;
    renderLogs(snapshot.logs);
  }

  function syncParameterPreview() {
    ui.pressureRange.value = String(engine.params.pressure);
    ui.offsetRange.value = String(engine.params.offset);
    ui.speedRange.value = String(engine.params.speed);
    ui.pressureValue.textContent = `${fmt(engine.params.pressure, 0)} kPa`;
    ui.offsetValue.textContent = `${engine.params.offset > 0 ? '+' : ''}${fmt(engine.params.offset, 2)} mm`;
    ui.speedValue.textContent = `${fmt(engine.params.speed, 0)}%`;
  }

  function commitParameter(key, input, output, unit, digits) {
    const value = Number(input.value);
    engine.setParams({ [key]: value }, 'operator');
    output.textContent = `${value > 0 && key === 'offset' ? '+' : ''}${fmt(value, digits)} ${unit}`;
    updateUI(engine.getSnapshot());
  }

  function executeValidation() {
    lastValidation = Sim.runValidationSuite();
    renderValidation();
    return lastValidation;
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildExportReport() {
    if (!lastValidation) executeValidation();
    const snapshot = engine.getSnapshot();
    const current = engine._buildBatchResult(
      snapshot.status === 'complete' ? 'complete' : 'in_progress'
    );
    return {
      schema: 'stackguard-batch-export/v1',
      generatedAt: new Date().toISOString(),
      simulationClock: {
        seconds: snapshot.simTime,
        display: snapshot.clock,
        sharedBy: ['production', 'energy', 'cache']
      },
      currentBatch: current,
      batchResults: snapshot.batchResults,
      anomalies: snapshot.anomalies,
      eventLog: snapshot.logs,
      validation: lastValidation,
      resetPolicy: {
        cacheClearedOnBatchReset: true,
        browserPersistence: false
      }
    };
  }

  function exportJson() {
    const report = buildExportReport();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `stackguard_${date}_${report.currentBatch.batchId}.json`;
    downloadFile(filename, JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
    toast(`已导出 ${report.currentBatch.batchId}：良品 ${report.currentBatch.good}，峰值与停机原因已包含`);
  }

  function csvCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const report = buildExportReport();
    const headers = [
      'section', 'record_id', 'time', 'batch', 'status', 'groups_done', 'good',
      'yield_rate', 'peak_power_kw', 'peak_cache_pct', 'peak_pressure_kpa',
      'peak_offset_mm', 'peak_speed_pct', 'pressure_kpa', 'offset_mm', 'speed_pct',
      'cache_pct', 'energy_kwh', 'stop_reason', 'anomaly_station',
      'anomaly_position', 'recovery', 'event_type', 'station', 'message'
    ];
    const rows = [];
    const current = report.currentBatch;
    rows.push([
      'summary', current.batchId, report.simulationClock.display, current.batchId,
      report.currentBatch.reason, current.groupsDone, current.good, current.yieldRate,
      current.peak.power, current.peak.cache, current.peak.pressure, current.peak.offset,
      current.peak.speed, engine.params.pressure, engine.params.offset, engine.params.speed,
      current.cacheAtEnd, current.energyKwh, current.stopReason,
      current.anomalies[0] ? current.anomalies[0].station : '',
      current.anomalies[0] ? current.anomalies[0].position : '',
      '', '', '', ''
    ]);
    report.batchResults.forEach((batch) => {
      rows.push([
        'batch_result', batch.batchId, batch.endedAt, batch.batchId, batch.reason,
        batch.groupsDone, batch.good, batch.yieldRate, batch.peak.power, batch.peak.cache,
        batch.peak.pressure, batch.peak.offset, batch.peak.speed, '', '', '', batch.cacheAtEnd,
        batch.energyKwh, batch.stopReason, '', '', '', '', '', ''
      ]);
    });
    report.validation.results.forEach((result) => {
      rows.push([
        'validation', result.id, result.triggerClock, report.currentBatch.batchId,
        result.passed ? 'passed' : 'failed', result.values.groupsDone, result.values.good,
        result.values.groupsDone ? result.values.good / result.values.groupsDone : 0,
        result.values.powerKw, result.values.cache, result.values.pressure,
        result.values.offset, result.values.speed, result.values.pressure, result.values.offset,
        result.values.speed, result.values.cache, result.values.energyKwh, result.stopReason,
        result.abnormalStation, result.abnormalPosition, result.recovery.detail,
        '', '', result.details
      ]);
    });
    report.anomalies.forEach((anomaly, index) => {
      rows.push([
        'anomaly', `A-${index + 1}`, anomaly.clock, report.currentBatch.batchId,
        'anomaly', anomaly.values.groupsDone, anomaly.values.good, '', anomaly.values.powerKw,
        anomaly.values.cache, anomaly.values.pressure, anomaly.values.offset,
        anomaly.values.speed, anomaly.values.pressure, anomaly.values.offset,
        anomaly.values.speed, anomaly.values.cache, anomaly.values.energyKwh,
        anomaly.reason, anomaly.station, anomaly.position, '', anomaly.code, '', anomaly.reason
      ]);
    });
    report.eventLog.forEach((entry) => {
      rows.push([
        'event', entry.id, entry.clock, entry.batchId, entry.severity, entry.values.groupsDone,
        entry.values.good, '', entry.values.powerKw, entry.values.cache, entry.values.pressure,
        entry.values.offset, entry.values.speed, entry.values.pressure, entry.values.offset,
        entry.values.speed, entry.values.cache, entry.values.energyKwh, '',
        entry.station, '', '', entry.kind, entry.station, entry.message
      ]);
    });
    const content = '\ufeff' + [headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadFile(`stackguard_${date}_${report.currentBatch.batchId}.csv`, content, 'text/csv;charset=utf-8');
    toast(`已导出 CSV：${report.currentBatch.good} 组良品，含 ${report.eventLog.length} 条事件`);
  }

  function handleStart() {
    const result = engine.start('操作员启动');
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    toast(`批次 ${engine._batchId()} 已启动，十组目标`);
    updateUI(engine.getSnapshot());
  }

  function handlePause() {
    const result = engine.pause();
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    toast('仿真时钟已冻结；可检查参数后单步或恢复');
    updateUI(engine.getSnapshot());
  }

  function handleStep() {
    const result = engine.singleStep(0.25);
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    updateUI(engine.getSnapshot());
  }

  function handleRecover() {
    const result = engine.recover({ autoResume: true });
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    toast('停机已复位，当前批次、叠层和缓存继续运行');
    updateUI(engine.getSnapshot());
  }

  function handleEstop() {
    const result = engine.emergencyStop('操作员急停');
    if (!result.ok) {
      toast(result.message, true);
      return;
    }
    toast('急停已触发，缓存与当前批次已冻结', true);
    updateUI(engine.getSnapshot());
  }

  function handleReset() {
    const oldBatch = engine._batchId();
    engine.resetBatch();
    lastLogId = 0;
    previousGood = 0;
    previousStatus = 'idle';
    syncParameterPreview();
    updateUI(engine.getSnapshot());
    toast(`${oldBatch} 已断开；新批次缓存归零，旧叠层不再保留`);
  }

  function handleValidation() {
    if (validationRunning) return;
    validationRunning = true;
    ui.runValidationBtn.disabled = true;
    ui.runValidationLabel.textContent = '实测中…';
    const orb = ui.validationSummary.querySelector('.summary-orb');
    orb.className = 'summary-orb running';
    ui.validationSummary.querySelector('strong').textContent = '正在运行独立场景仿真';
    ui.validationSummary.querySelector('p').textContent =
      '依次推进正常生产、参数越限与设备停机，采集触发时刻和恢复结果。';
    window.setTimeout(() => {
      try {
        const report = executeValidation();
        toast(report.passed === report.total
          ? `实测完成：${report.passed}/${report.total} 类流程通过`
          : `实测完成：${report.passed}/${report.total} 通过，请查看失败项`, report.passed !== report.total);
        if (soundEnabled) audio.tone(report.passed === report.total ? 880 : 220, 0.15, 'sine', 0.04);
      } finally {
        validationRunning = false;
        ui.runValidationBtn.disabled = false;
        ui.runValidationLabel.textContent = '重新实测';
      }
    }, 40);
  }

  ui.startBtn.addEventListener('click', handleStart);
  ui.pauseBtn.addEventListener('click', handlePause);
  ui.stepBtn.addEventListener('click', handleStep);
  ui.recoverBtn.addEventListener('click', handleRecover);
  ui.estopBtn.addEventListener('click', handleEstop);
  ui.resetBtn.addEventListener('click', handleReset);
  ui.runValidationBtn.addEventListener('click', handleValidation);
  ui.exportJson.addEventListener('click', exportJson);
  ui.exportCsv.addEventListener('click', exportCsv);

  ui.soundToggle.addEventListener('click', async () => {
    if (!soundEnabled) {
      try {
        await audio.enable();
        soundEnabled = true;
        ui.soundToggle.setAttribute('aria-pressed', 'true');
        ui.soundIcon.textContent = '◉';
        ui.soundLabel.textContent = '声音开';
        audio.tone(440, 0.08, 'sine', 0.04);
        toast('机械臂声音已启用，音高随动作变化');
      } catch (error) {
        toast(error.message, true);
      }
    } else {
      audio.disable();
      soundEnabled = false;
      ui.soundToggle.setAttribute('aria-pressed', 'false');
      ui.soundIcon.textContent = '◌';
      ui.soundLabel.textContent = '声音关';
    }
  });

  ui.pressureRange.addEventListener('input', () => {
    ui.pressureValue.textContent = `${fmt(ui.pressureRange.value, 0)} kPa`;
  });
  ui.offsetRange.addEventListener('input', () => {
    const value = Number(ui.offsetRange.value);
    ui.offsetValue.textContent = `${value > 0 ? '+' : ''}${fmt(value, 2)} mm`;
  });
  ui.speedRange.addEventListener('input', () => {
    ui.speedValue.textContent = `${fmt(ui.speedRange.value, 0)}%`;
  });
  ui.pressureRange.addEventListener('change', () => {
    commitParameter('pressure', ui.pressureRange, ui.pressureValue, 'kPa', 0);
  });
  ui.offsetRange.addEventListener('change', () => {
    commitParameter('offset', ui.offsetRange, ui.offsetValue, 'mm', 2);
  });
  ui.speedRange.addEventListener('change', () => {
    commitParameter('speed', ui.speedRange, ui.speedValue, '%', 0);
  });

  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (engine.status === 'running') handlePause();
      else if (engine.status === 'idle' || engine.status === 'paused') handleStart();
    }
  });

  syncParameterPreview();
  updateUI(engine.getSnapshot());

  let lastFrameAt = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    if (engine.status === 'running') engine.advance(dt);
    const snapshot = engine.getSnapshot();
    renderer.draw(snapshot);
    audio.update(snapshot);
    if (now - lastUiAt > 100) {
      updateUI(snapshot);
      lastUiAt = now;
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
})();

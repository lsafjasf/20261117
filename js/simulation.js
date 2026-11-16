(function (global) {
  'use strict';

  const PIECE_TYPES = Object.freeze([
    {
      id: 'cup', name: '白瓷杯', short: '杯', coat: 0.78, target: 0.68,
      tolerance: 0.10, rpm: 42, volume: 0.24,
      color: '#d7d3c4', glaze: '#b8c69a'
    },
    {
      id: 'jar', name: '青釉罐', short: '罐', coat: 1.10, target: 0.94,
      tolerance: 0.12, rpm: 34, volume: 0.38,
      color: '#c6b49b', glaze: '#7fa08f'
    },
    {
      id: 'vase', name: '月白瓶', short: '瓶', coat: 1.38, target: 1.20,
      tolerance: 0.14, rpm: 50, volume: 0.30,
      color: '#d7cbb7', glaze: '#9db8b1'
    }
  ]);

  const LIMITS = Object.freeze({
    soakTime: { min: 1, max: 9, unit: 's', label: '浸釉时长' },
    rotation: { min: 0, max: 80, unit: 'RPM', label: '旋转速度' },
    dripSpeed: { min: 0, max: 3, unit: 'mm/s', label: '滴釉速度' }
  });

  const DEFAULTS = Object.freeze({ soakTime: 3.2, rotation: 32, dripSpeed: 0.6 });
  const SPIN_DURATION = 1.6;
  const CACHE_INTERVAL = 0.25;
  const CACHE_LIMIT = 160;
  const BASE_POWER_W = 4;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, places = 3) => Number(value.toFixed(places));

  function typeFor(index) {
    return PIECE_TYPES[clamp(index, 0, PIECE_TYPES.length - 1)];
  }

  function targetWindow(type) {
    return {
      min: round(type.target - type.tolerance),
      max: round(type.target + type.tolerance)
    };
  }

  class GlazeSimulation {
    constructor(options = {}) {
      this.id = options.id || `sim-${Math.random().toString(36).slice(2, 8)}`;
      this.listeners = new Set();
      this.batchSequence = 0;
      this.eventSequence = 0;
      this.cacheSequence = 0;
      this.history = [];
      this.validation = null;
      this._initialize(true);
    }

    _initialize(silent) {
      this.simTime = 0;
      this.paused = false;
      this.phase = 'idle';
      this.phaseElapsed = 0;
      this.phaseStartedAt = 0;
      this.batch = null;
      this.currentIndex = 0;
      this.thickness = 0;
      this.level = 100;
      this.energyKWh = 0;
      this.peakPowerW = 0;
      this.peakThickness = 0;
      this.currentPowerW = BASE_POWER_W;
      this.devices = { pump: false, motor: false, drainValve: false };
      this.fault = null;
      this.anomalies = [];
      this.events = [];
      this.cache = [];
      this.lastCacheAt = -Infinity;
      this.params = { ...DEFAULTS };
      this.started = false;
      this.lastTransition = null;
      if (!silent) this.emit();
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    emit() {
      for (const listener of this.listeners) listener(this);
    }

    get currentType() {
      return typeFor(this.currentIndex);
    }

    get target() {
      return this.currentType.target;
    }

    get window() {
      return targetWindow(this.currentType);
    }

    get status() {
      if (this.fault) return 'fault';
      if (this.paused) return 'paused';
      if (this.phase === 'complete') return 'complete';
      if (this.batch && !this.batch.complete) return 'running';
      return 'idle';
    }

    get goodCount() {
      if (!this.batch) return 0;
      return this.batch.pieces.filter((piece) => piece && piece.status === 'good').length;
    }

    get finishedCount() {
      if (!this.batch) return 0;
      return this.batch.pieces.filter(Boolean).length;
    }

    get yieldRate() {
      const finished = this.finishedCount;
      return finished ? this.goodCount / finished : 0;
    }

    _powerForDevices() {
      let watts = BASE_POWER_W;
      if (this.devices.motor) watts += 18 + this.params.rotation * 2.2;
      if (this.devices.pump) watts += 55;
      if (this.devices.drainValve) watts += 8;
      return Math.round(watts);
    }

    _setDevice(name, on, detail = '') {
      const key = name === 'drain' ? 'drainValve' : name;
      const labels = { pump: '釉泵', motor: '旋转电机', drainValve: '滴釉阀' };
      if (this.devices[key] === Boolean(on)) return;
      this.devices[key] = Boolean(on);
      this.currentPowerW = this._powerForDevices();
      this.peakPowerW = Math.max(this.peakPowerW, this.currentPowerW);
      this.log(
        on ? 'device-start' : 'device-stop',
        `${labels[key]}${on ? '启动' : '停止'}${detail ? ` · ${detail}` : ''}`,
        { level: on ? 'info' : 'warn', device: labels[key] }
      );
    }

    _stopAllDevices(detail = '') {
      this._setDevice('pump', false, detail);
      this._setDevice('motor', false, detail);
      this._setDevice('drain', false, detail);
    }

    log(type, message, options = {}) {
      const entry = {
        seq: ++this.eventSequence,
        simTime: round(this.simTime, 2),
        type,
        message,
        level: options.level || 'info',
        device: options.device || '—',
        data: options.data || null
      };
      this.events.push(entry);
      if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
      this.emit();
      return entry;
    }

    _snapshot(reason = 'tick') {
      const snapshot = {
        seq: ++this.cacheSequence,
        reason,
        simTime: round(this.simTime, 2),
        phase: this.phase,
        pieceIndex: this.currentIndex,
        thickness: round(this.thickness),
        level: round(this.level, 2),
        energyKWh: round(this.energyKWh, 5),
        powerW: this.currentPowerW,
        paused: this.paused,
        fault: this.fault ? this.fault.reason : null
      };
      this.cache.push(snapshot);
      if (this.cache.length > CACHE_LIMIT) this.cache.shift();
      this.lastCacheAt = this.simTime;
      return snapshot;
    }

    _recordAnomaly(location, value, expected, source) {
      const item = {
        simTime: round(this.simTime, 2),
        location,
        value,
        expected,
        source
      };
      this.anomalies.push(item);
      return item;
    }

    setParameter(key, value, options = {}) {
      const limit = LIMITS[key];
      if (!limit) throw new Error(`未知参数：${key}`);
      const numeric = Number(value);
      const source = options.source || 'operator';
      const outside = !Number.isFinite(numeric) || numeric < limit.min || numeric > limit.max;

      if (outside) {
        const display = Number.isFinite(numeric) ? numeric : 'NaN';
        const expected = `${limit.min}–${limit.max} ${limit.unit}`;
        const location = `参数 / ${limit.label}`;
        const anomaly = this._recordAnomaly(location, `${display} ${limit.unit}`, expected, source);
        this.log(
          'param-limit',
          `${limit.label}越限：${display} ${limit.unit}，允许 ${expected}；当前值保持 ${this.params[key]} ${limit.unit}`,
          { level: 'error', device: location, data: anomaly }
        );
        if (this.phase === 'dip' || this.phase === 'spin' || this.phase === 'drip') {
          this.emergencyStop(`参数越限：${location} = ${display} ${limit.unit}`, source);
        }
        return { ok: false, reason: 'out-of-range', value: this.params[key], anomaly };
      }

      const before = this.params[key];
      const next = round(numeric, 2);
      if (before === next) return { ok: true, value: next, changed: false };
      this.params[key] = next;
      this.log(
        'param-change',
        `${limit.label} ${before} → ${next} ${limit.unit}`,
        {
          device: limit.label,
          data: { key, before, after: next, unit: limit.unit, source }
        }
      );

      if (key === 'rotation') this._syncRotationDevice();
      this.emit();
      return { ok: true, value: next, changed: true };
    }

    _syncRotationDevice() {
      const active = this.phase === 'dip' || this.phase === 'spin';
      this._setDevice('motor', active && this.params.rotation > 0, `${this.params.rotation} RPM`);
    }

    startBatch(options = {}) {
      if (this.batch && !this.batch.complete) {
        return { ok: false, reason: 'batch-in-progress' };
      }
      if (this.fault) return { ok: false, reason: 'fault' };
      this.batchSequence += 1;
      const now = new Date();
      const stamp = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
      ].join('');
      this.batch = {
        id: options.id || `GL-${String(this.batchSequence).padStart(2, '0')}-${stamp}`,
        startedAt: round(this.simTime, 2),
        completedAt: null,
        complete: false,
        success: null,
        pieces: [],
        goodCount: 0,
        yieldRate: 0,
        peakThickness: 0,
        peakPowerW: 0,
        stopReasons: []
      };
      this.currentIndex = 0;
      this.phase = 'idle';
      this.thickness = 0;
      this.energyKWh = 0;
      this.peakPowerW = BASE_POWER_W;
      this.peakThickness = 0;
      this.anomalies = [];
      this.cache = [];
      this.cacheSequence = 0;
      this.lastCacheAt = -Infinity;
      this.started = true;
      this.log(
        'batch-start',
        `批次 ${this.batch.id} 开始，目标为 3 件不同釉厚陶器`,
        { level: 'success', data: { batchId: this.batch.id, targets: PIECE_TYPES.map((p) => p.target) } }
      );
      this._snapshot('batch-start');
      this.emit();
      return { ok: true, batchId: this.batch.id };
    }

    beginDip() {
      if (this.fault) return { ok: false, reason: 'fault' };
      if (this.paused) return { ok: false, reason: 'paused' };
      if (this.phase === 'complete') return { ok: false, reason: 'complete' };
      if (!this.batch) {
        const started = this.startBatch();
        if (!started.ok) return started;
      }
      if (this.phase !== 'idle') return { ok: false, reason: 'busy' };
      this.phase = 'dip';
      this.phaseElapsed = 0;
      this.phaseStartedAt = this.simTime;
      this.thickness = 0;
      this._setDevice('pump', true, `浸釉 ${this.params.soakTime}s`);
      this._setDevice('motor', this.params.rotation > 0, `${this.params.rotation} RPM`);
      this.log(
        'phase-change',
        `${this.currentType.name} 入池浸釉，计划浸釉 ${this.params.soakTime}s，液位 ${round(this.level, 1)}%`,
        { device: `工位 ${this.currentIndex + 1}`, data: { phase: 'dip', thickness: 0, level: round(this.level, 1) } }
      );
      this._snapshot('dip-start');
      this.emit();
      return { ok: true, phase: 'dip' };
    }

    liftEarly() {
      if (this.phase !== 'dip') return { ok: false, reason: 'not-dipping' };
      this._beginSpin('操作员提前提起');
      return { ok: true, phase: this.phase };
    }

    _beginSpin(reason) {
      this.phase = 'spin';
      this.phaseElapsed = 0;
      this.phaseStartedAt = this.simTime;
      this._setDevice('pump', false, '离开釉池');
      this._setDevice('motor', this.params.rotation > 0, `${this.params.rotation} RPM`);
      this.log(
        'phase-change',
        `${this.currentType.name} ${reason}，旋转排釉 ${SPIN_DURATION}s；当前釉厚 ${round(this.thickness)} mm`,
        { device: `工位 ${this.currentIndex + 1}`, data: { phase: 'spin', thickness: round(this.thickness) } }
      );
      this._snapshot('spin-start');
      this.emit();
    }

    _beginDrip() {
      this.phase = 'drip';
      this.phaseElapsed = 0;
      this.phaseStartedAt = this.simTime;
      this._setDevice('motor', false, '旋转结束');
      this._setDevice('drain', true, `滴釉 ${this.params.dripSpeed} mm/s`);
      this.log(
        'phase-change',
        `${this.currentType.name} 进入滴釉，目标 ${this.window.min}–${this.window.max} mm；当前 ${round(this.thickness)} mm`,
        {
          device: `工位 ${this.currentIndex + 1}`,
          data: { phase: 'drip', thickness: round(this.thickness), target: this.window }
        }
      );
      this._snapshot('drip-start');
      this.emit();
    }

    finishPiece(options = {}) {
      if (this.phase !== 'drip') return { ok: false, reason: 'not-dripping' };
      if (this.fault) return { ok: false, reason: 'fault' };
      const type = this.currentType;
      const range = this.window;
      const thickness = round(this.thickness);
      let status = 'good';
      let defect = null;
      let anomalyLocation = null;
      if (thickness < range.min) {
        status = 'bad';
        defect = '露底（釉层过薄）';
        anomalyLocation = `陶器表面 / ${type.name} 下腹露底`;
      } else if (thickness > range.max) {
        status = 'bad';
        defect = '流挂（釉层过厚）';
        anomalyLocation = `陶器表面 / ${type.name} 底缘流挂`;
      }

      const rpmDelta = Math.abs(this.params.rotation - type.rpm) / Math.max(type.rpm, 1);
      const uniformity = clamp(1 - rpmDelta * 0.42 - (this.params.rotation < 8 ? 0.32 : 0), 0, 1);
      if (uniformity < 0.55) {
        const previous = anomalyLocation;
        anomalyLocation = previous || `釉面 / ${type.name} 旋转纹`;
        this._recordAnomaly(
          anomalyLocation,
          `均匀度 ${round(uniformity, 2)}`,
          `相近 ${type.rpm} RPM`,
          options.source || 'operator'
        );
      }

      const result = {
        index: this.currentIndex,
        typeId: type.id,
        name: type.name,
        target: type.target,
        tolerance: type.tolerance,
        range,
        thickness,
        status,
        defect,
        anomalyLocation,
        uniformity: round(uniformity, 3),
        rotation: this.params.rotation,
        dripSpeed: this.params.dripSpeed,
        levelAtFinish: round(this.level, 2),
        finishedAt: round(this.simTime, 2),
        recoveredFromFault: Boolean(options.recoveredFromFault)
      };
      this.batch.pieces.push(result);
      this.batch.peakThickness = Math.max(this.batch.peakThickness, thickness);
      this._stopAllDevices('完成当前件');
      this.log(
        'piece-result',
        `${type.name} 完成：${thickness} mm，${status === 'good' ? '合格' : defect}`,
        {
          level: status === 'good' ? 'success' : 'error',
          device: `工位 ${this.currentIndex + 1}`,
          data: result
        }
      );
      this._snapshot('piece-finished');

      if (this.batch.pieces.length >= PIECE_TYPES.length) {
        this._completeBatch();
      } else {
        this.currentIndex += 1;
        this.phase = 'idle';
        this.thickness = 0;
        this.phaseElapsed = 0;
        this.log(
          'queue-next',
          `装载 ${this.currentType.name}，目标 ${this.currentType.target} ± ${this.currentType.tolerance} mm`,
          { device: `工位 ${this.currentIndex + 1}` }
        );
      }
      this.emit();
      return { ok: true, result, batchComplete: this.batch.complete };
    }

    _completeBatch() {
      const goodCount = this.goodCount;
      const finished = this.finishedCount;
      const yieldRate = finished ? goodCount / finished : 0;
      const stopReasons = this.batch.stopReasons.slice();
      this.batch.complete = true;
      this.batch.success = goodCount === PIECE_TYPES.length;
      this.batch.completedAt = round(this.simTime, 2);
      this.batch.goodCount = goodCount;
      this.batch.yieldRate = round(yieldRate, 4);
      this.batch.peakThickness = round(this.peakThickness, 3);
      this.batch.peakPowerW = this.peakPowerW;
      this.phase = 'complete';
      this.thickness = 0;
      this._stopAllDevices('批次结束');
      this.log(
        'batch-result',
        `批次 ${this.batch.id} 完成：良品 ${goodCount}/${finished}，良品率 ${round(yieldRate * 100, 1)}%，峰值釉厚 ${round(this.peakThickness)} mm，峰值功率 ${this.peakPowerW} W`,
        {
          level: this.batch.success ? 'success' : 'error',
          device: '批次',
          data: {
            goodCount,
            yieldRate: round(yieldRate, 4),
            peakThickness: round(this.peakThickness),
            peakPowerW: this.peakPowerW,
            stopReasons
          }
        }
      );
      this.history.push({ ...this.batch, pieces: this.batch.pieces.map((piece) => ({ ...piece })) });
      if (this.history.length > 50) this.history.shift();
      this._snapshot('batch-complete');
    }

    emergencyStop(reason = '人工设备急停', source = 'operator') {
      if (this.fault) return { ok: false, reason: 'already-stopped', fault: this.fault };
      const deviceSnapshot = { ...this.devices };
      const fault = {
        at: round(this.simTime, 2),
        reason,
        source,
        phase: this.phase,
        pieceIndex: this.currentIndex,
        pieceName: this.currentType.name,
        thickness: round(this.thickness),
        level: round(this.level, 2),
        energyKWh: round(this.energyKWh, 5),
        powerW: this.currentPowerW,
        devices: deviceSnapshot,
        recovery: null
      };
      this.fault = fault;
      if (this.batch) this.batch.stopReasons.push(reason);
      this._stopAllDevices(`急停：${reason}`);
      this.log(
        'emergency-stop',
        `${reason}；触发于 ${fault.phase}，釉厚 ${fault.thickness} mm，液位 ${fault.level}%，功率 ${fault.powerW} W`,
        {
          level: 'error',
          device: '安全联锁',
          data: { fault, source }
        }
      );
      this._snapshot('emergency-stop');
      this.emit();
      return { ok: true, fault };
    }

    recoverEquipment(options = {}) {
      if (!this.fault) return { ok: false, reason: 'not-stopped' };
      const fault = this.fault;
      const recovery = {
        at: round(this.simTime, 2),
        thickness: round(this.thickness),
        level: round(this.level, 2),
        phase: this.phase,
        source: options.source || 'operator',
        result: 'resumed-current-batch'
      };
      fault.recovery = recovery;
      this.fault = null;
      if (this.phase === 'dip') {
        this._setDevice('pump', true, '故障恢复');
        this._setDevice('motor', this.params.rotation > 0, '故障恢复');
      } else if (this.phase === 'spin') {
        this._setDevice('motor', this.params.rotation > 0, '故障恢复');
      } else if (this.phase === 'drip') {
        this._setDevice('drain', true, '故障恢复');
      }
      this.log(
        'equipment-recover',
        `设备恢复：从 ${recovery.phase} 继续当前批次；恢复时釉厚 ${recovery.thickness} mm，液位 ${recovery.level}%`,
        {
          level: 'success',
          device: '安全联锁',
          data: { faultAt: fault.at, recovery }
        }
      );
      this._snapshot('equipment-recover');
      this.emit();
      return { ok: true, recovery, fault };
    }

    pause(reason = '操作员检查') {
      if (this.paused) return { ok: false, reason: 'already-paused' };
      this.paused = true;
      this.log('pause', `共享时钟暂停 · ${reason}`, {
        level: 'warn',
        data: { snapshot: this.cache[this.cache.length - 1] || null }
      });
      this.emit();
      return { ok: true, cache: this.cache[this.cache.length - 1] || null };
    }

    resume() {
      if (!this.paused) return { ok: false, reason: 'not-paused' };
      this.paused = false;
      this.log('resume', '共享时钟恢复，当前批次继续', { level: 'success' });
      this.emit();
      return { ok: true };
    }

    togglePause() {
      return this.paused ? this.resume() : this.pause();
    }

    step(seconds = 0.1) {
      if (!this.paused) return { ok: false, reason: 'pause-required' };
      const dt = clamp(Number(seconds) || 0.1, 0.01, 1);
      this._advance(dt, { force: true, source: 'single-step' });
      this.log('single-step', `单步推进 +${dt.toFixed(1)}s，当前釉厚 ${round(this.thickness)} mm`, {
        device: `工位 ${this.currentIndex + 1}`,
        data: { dt, thickness: round(this.thickness), level: round(this.level, 2), simTime: round(this.simTime, 2) }
      });
      this.emit();
      return { ok: true, dt, snapshot: this.cache[this.cache.length - 1] };
    }

    refill(amount = 4) {
      const before = this.level;
      this.level = clamp(this.level + Math.max(0, Number(amount) || 0), 0, 100);
      const actual = round(this.level - before, 2);
      if (actual <= 0) return { ok: false, reason: 'full' };
      this.log(
        'refill',
        `补充釉液 +${actual}%，当前液位 ${round(this.level, 1)}%`,
        { level: 'success', device: '补液泵', data: { before: round(before, 2), after: round(this.level, 2) } }
      );
      this._snapshot('refill');
      this.emit();
      return { ok: true, amount: actual, level: this.level };
    }

    resetBatch(options = {}) {
      const hadBatch = Boolean(this.batch);
      const oldId = this.batch ? this.batch.id : null;
      this._stopAllDevices('批次重置');
      this._initialize(true);
      this.log(
        'batch-reset',
        `${hadBatch ? `批次 ${oldId} 已重置` : '批次状态已重置'}；釉池、能耗、厚度与内存缓存归零`,
        {
          level: 'warn',
          device: '控制系统',
          data: { cacheCleared: true, source: options.source || 'operator' }
        }
      );
      this.emit();
      return { ok: true, cacheCount: this.cache.length, level: this.level };
    }

    clearAudit() {
      this.events = [];
      this.eventSequence = 0;
      this.history = [];
      this.validation = null;
      this.log('audit-clear', '事件日志、批次历史与验收记录已清空', {
        level: 'warn',
        device: '审计缓存',
        data: { cacheKept: this.cache.length }
      });
      this.emit();
      return { ok: true };
    }

    advance(realDt) {
      if (this.paused) return false;
      const dt = clamp(Number(realDt) || 0, 0, 0.25);
      this._advance(dt, { force: false, source: 'animation-frame' });
      return true;
    }

    _advance(dt, options = {}) {
      if (dt <= 0) return;
      if (this.paused && !options.force) return;
      this.simTime += dt;
      this.energyKWh += (this.currentPowerW * dt) / 3600000;
      this.peakPowerW = Math.max(this.peakPowerW, this.currentPowerW);
      if (this.batch) this.batch.peakPowerW = Math.max(this.batch.peakPowerW, this.currentPowerW);

      if (!this.fault) {
        if (this.phase === 'dip') {
          this.phaseElapsed += dt;
          const levelFactor = 0.72 + 0.28 * (this.level / 100);
          const pickupRate = 0.19 * this.currentType.coat * levelFactor;
          this.thickness += pickupRate * dt;
          this.level = Math.max(0, this.level - (0.42 + this.currentType.volume * 0.18) * dt);
          this.peakThickness = Math.max(this.peakThickness, this.thickness);
          if (this.phaseElapsed >= this.params.soakTime) {
            this._beginSpin(`自动提起，已浸釉 ${round(this.phaseElapsed, 1)}s`);
          }
        } else if (this.phase === 'spin') {
          this.phaseElapsed += dt;
          const centrifugalLoss = Math.max(0, this.params.rotation - 58) * 0.00055;
          this.thickness = Math.max(0, this.thickness - centrifugalLoss * dt);
          this.peakThickness = Math.max(this.peakThickness, this.thickness);
          if (this.phaseElapsed >= SPIN_DURATION) this._beginDrip();
        } else if (this.phase === 'drip') {
          this.phaseElapsed += dt;
          this.thickness = Math.max(0, this.thickness - this.params.dripSpeed * 0.012 * dt);
        }
      }

      this.currentPowerW = this._powerForDevices();
      this.peakPowerW = Math.max(this.peakPowerW, this.currentPowerW);
      if (this.batch && this.simTime - this.lastCacheAt >= CACHE_INTERVAL) this._snapshot('tick');
    }

    getSummary() {
      const latest = this.cache.length ? this.cache[this.cache.length - 1] : null;
      return {
        simTime: round(this.simTime, 2),
        status: this.status,
        paused: this.paused,
        batchId: this.batch ? this.batch.id : null,
        batchComplete: Boolean(this.batch && this.batch.complete),
        batchSuccess: this.batch ? this.batch.success : null,
        currentIndex: this.currentIndex,
        currentName: this.currentType.name,
        phase: this.phase,
        thickness: round(this.thickness),
        target: this.currentType.target,
        window: this.window,
        level: round(this.level, 2),
        energyKWh: round(this.energyKWh, 5),
        powerW: this.currentPowerW,
        peakPowerW: this.peakPowerW,
        peakThickness: round(this.peakThickness),
        goodCount: this.goodCount,
        finishedCount: this.finishedCount,
        yieldRate: round(this.yieldRate, 4),
        cacheCount: this.cache.length,
        latestCache: latest,
        fault: this.fault,
        params: { ...this.params },
        devices: { ...this.devices },
        anomalies: this.anomalies.slice(),
        pieces: this.batch ? this.batch.pieces.map((piece) => ({ ...piece })) : []
      };
    }

    buildExport(extra = {}) {
      const batch = this.batch
        ? {
            id: this.batch.id,
            startedAt: this.batch.startedAt,
            completedAt: this.batch.completedAt,
            complete: this.batch.complete,
            success: this.batch.success,
            goodCount: this.goodCount,
            finishedCount: this.finishedCount,
            yieldRate: round(this.yieldRate, 4),
            peakThickness: round(this.peakThickness),
            peakPowerW: this.peakPowerW,
            stopReasons: this.batch.stopReasons.slice(),
            pieces: this.batch.pieces.map((piece) => ({ ...piece }))
          }
        : null;
      const latestCache = this.cache.length ? this.cache[this.cache.length - 1] : null;
      return {
        schema: 'glaze-process-report/v1',
        generatedAt: new Date().toISOString(),
        simulationId: this.id,
        simulatedSeconds: round(this.simTime, 2),
        batch,
        summary: {
          goodCount: this.goodCount,
          finishedCount: this.finishedCount,
          yieldRate: round(this.yieldRate, 4),
          peakThickness: round(this.peakThickness),
          peakPowerW: this.peakPowerW,
          energyKWh: round(this.energyKWh, 5),
          level: round(this.level, 2),
          stopReasons: this.batch ? this.batch.stopReasons.slice() : [],
          status: this.status
        },
        anomalyLocations: this.anomalies.slice(),
        cache: {
          storage: 'memory-only',
          clearedOnReload: true,
          count: this.cache.length,
          limit: CACHE_LIMIT,
          latest: latestCache
        },
        devices: { ...this.devices },
        validation: this.validation || extra.validation || null,
        events: this.events.map((entry) => ({ ...entry })),
        batchHistory: this.history.map((item) => ({
          id: item.id,
          complete: item.complete,
          success: item.success,
          goodCount: item.goodCount,
          yieldRate: item.yieldRate,
          pieces: item.pieces.length,
          stopReasons: item.stopReasons.slice()
        }))
      };
    }
  }

  GlazeSimulation.PIECE_TYPES = PIECE_TYPES;
  GlazeSimulation.LIMITS = LIMITS;
  GlazeSimulation.DEFAULTS = DEFAULTS;
  GlazeSimulation.SPIN_DURATION = SPIN_DURATION;
  GlazeSimulation.targetWindow = targetWindow;
  GlazeSimulation.round = round;
  GlazeSimulation.clamp = clamp;
  global.GlazeSimulation = GlazeSimulation;
})(window);

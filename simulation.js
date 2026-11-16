(function (global) {
  'use strict';

  const TARGET_GROUPS = 10;
  const GROUP_LAYERS = ['positive', 'separator', 'negative'];
  const LAYER_LABELS = {
    positive: '正极片',
    separator: '隔膜',
    negative: '负极片'
  };
  const DEFAULT_PARAMS = { pressure: 52, offset: 0, speed: 78 };
  const SAFE_BANDS = {
    pressure: { label: '吸盘压力', min: 38, max: 60, unit: 'kPa', step: 1 },
    offset: { label: '对位偏移', min: -0.3, max: 0.3, unit: 'mm', step: 0.05 },
    speed: { label: '节拍速度', min: 55, max: 95, unit: '%', step: 1 }
  };
  const LIMITS = {
    pressure: { min: 20, max: 90 },
    offset: { min: -1, max: 1 },
    speed: { min: 40, max: 130 }
  };
  const EQUIPMENT = [
    { key: 'feeder', label: '送料机构' },
    { key: 'robot', label: '机械臂' },
    { key: 'stacker', label: '叠片台' },
    { key: 'cache', label: '缓存线' }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function formatSimTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const totalTenths = Math.floor(safe * 10 + 0.000001);
    const minutes = Math.floor(totalTenths / 600);
    const secs = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
  }

  function roundedPeak(peak) {
    return {
      power: round(peak.power, 2),
      cache: round(peak.cache, 2),
      pressure: round(peak.pressure, 1),
      offset: round(peak.offset, 3),
      speed: round(peak.speed, 1)
    };
  }

  class StackingSimulator {
    constructor(options) {
      const config = options || {};
      this.seed = Number.isFinite(config.seed) ? config.seed : 7;
      this.simTime = 0;
      this.status = 'idle';
      this.params = Object.assign({}, DEFAULT_PARAMS);
      this.batchNo = 1;
      this.equipment = { feeder: '待机', robot: '待机', stacker: '待机', cache: '待机' };
      this.logs = [];
      this.batchResults = [];
      this.groupHistory = [];
      this.batch = this._emptyBatch();
      this._eventSeq = 0;
      this._phase = 0;
      this._batchStarted = false;
      this._batchFinalized = false;
      this._lastGroup = null;
      this._lastStop = null;
      this._log('system', '仿真内核', '批次 B-001 已装载，叠层与缓存归零', 'info', {
        code: 'BATCH_LOADED'
      });
    }

    _emptyBatch() {
      return {
        groupsDone: 0,
        good: 0,
        defects: 0,
        stack: [],
        cache: 0,
        energyKwh: 0,
        powerKw: 0,
        peak: { power: 0, cache: 0, pressure: 0, offset: 0, speed: 0 },
        anomalies: [],
        stopReason: '',
        startedAt: this.simTime,
        endedAt: null
      };
    }

    _batchId() {
      return `B-${String(this.batchNo).padStart(3, '0')}`;
    }

    _currentValues() {
      return {
        pressure: round(this.params.pressure, 1),
        offset: round(this.params.offset, 2),
        speed: round(this.params.speed, 0),
        cache: round(this.batch.cache, 1),
        powerKw: round(this.batch.powerKw, 1),
        energyKwh: round(this.batch.energyKwh, 4),
        groupsDone: this.batch.groupsDone,
        good: this.batch.good,
        layers: this.batch.stack.length
      };
    }

    _log(kind, station, message, severity, extra) {
      const entry = {
        id: ++this._eventSeq,
        time: round(this.simTime, 2),
        clock: formatSimTime(this.simTime),
        kind,
        station,
        message,
        severity: severity || 'info',
        batchId: this._batchId(),
        values: this._currentValues()
      };
      if (extra) Object.assign(entry, extra);
      this.logs.push(entry);
      if (this.logs.length > 600) this.logs.shift();
      return entry;
    }

    getSafety() {
      return Object.keys(SAFE_BANDS).map((key) => {
        const band = SAFE_BANDS[key];
        const value = this.params[key];
        const safe = value >= band.min && value <= band.max;
        let level = safe ? 'ok' : 'warning';
        if ((key === 'pressure' && value > 65) ||
            (key === 'speed' && value > 108) ||
            (key === 'offset' && Math.abs(value) > 0.75)) {
          level = 'critical';
        }
        return Object.assign({}, band, { key, value, safe, level });
      });
    }

    setParams(changes, source) {
      const changed = [];
      Object.keys(changes || {}).forEach((key) => {
        if (!LIMITS[key] || !Number.isFinite(Number(changes[key]))) return;
        const next = round(clamp(Number(changes[key]), LIMITS[key].min, LIMITS[key].max), 2);
        const previous = this.params[key];
        if (next === previous) return;
        this.params[key] = next;
        const band = SAFE_BANDS[key];
        const safe = next >= band.min && next <= band.max;
        this._log(
          'parameter_change',
          '参数面板',
          `${band.label} ${previous} → ${next} ${band.unit}`,
          safe ? 'info' : 'warning',
          { code: 'PARAM_CHANGE', parameter: key, previous, next, source: source || 'manual' }
        );
        changed.push({ key, previous, next });
      });
      return changed;
    }

    _setEquipment(state, reason) {
      EQUIPMENT.forEach((item) => {
        this.equipment[item.key] = state;
        if (state === '运行中') {
          this._log('equipment_start', item.label, `${item.label}启动`, 'info', {
            code: 'EQUIPMENT_START', equipment: item.key
          });
        } else {
          this._log('equipment_stop', item.label, `${item.label}${state}${reason ? `：${reason}` : ''}`,
            state === '故障' ? 'critical' : 'warning', {
              code: state === '故障' ? 'EQUIPMENT_FAULT' : 'EQUIPMENT_STOP',
              equipment: item.key,
              state
            });
        }
      });
    }

    start(reason) {
      if (this.status === 'running') return { ok: false, message: '设备已经在运行' };
      if (this.status === 'complete') return { ok: false, message: '本批次已完成，请重置批次' };
      if (this.status === 'fault' || this.status === 'stopped') {
        return { ok: false, message: '设备处于停机状态，请先复位' };
      }

      const wasPaused = this.status === 'paused';
      if (this.status === 'idle' && !this._batchStarted) {
        this._batchStarted = true;
        this.batch.startedAt = this.simTime;
        this._log('batch_start', '整机', `批次 ${this._batchId()} 开始生产`, 'info', {
          code: 'BATCH_START'
        });
      }

      this.status = 'running';
      this._setEquipment('运行中', reason || '启动');
      this._log('equipment_start', '整机',
        wasPaused ? '整机恢复运行' : (reason || '操作员启动整机'),
        'info', { code: 'MACHINE_START' });
      return { ok: true };
    }

    pause() {
      if (this.status !== 'running') return { ok: false, message: '当前没有运行中的设备' };
      this.status = 'paused';
      this._setEquipment('暂停', '操作员检查');
      this._log('equipment_pause', '整机', '仿真时钟冻结，当前批次与缓存保留', 'warning', {
        code: 'MACHINE_PAUSE'
      });
      return { ok: true };
    }

    _fault(reason, station, code) {
      if (this.status !== 'running' && this.status !== 'paused') return false;
      this.status = 'fault';
      this.batch.stopReason = reason;
      this._lastStop = {
        time: this.simTime,
        clock: formatSimTime(this.simTime),
        reason,
        station,
        code,
        values: this._currentValues()
      };
      this.batch.anomalies.push({
        time: round(this.simTime, 2),
        clock: formatSimTime(this.simTime),
        station,
        position: this.batch.groupsDone + 1,
        group: this.batch.groupsDone + 1,
        layer: this.batch.stack.length % 3,
        code,
        reason,
        values: this._currentValues()
      });
      this._setEquipment('停机', reason);
      this.equipment.cache = station === '缓存线' ? '故障' : this.equipment.cache;
      this._log('anomaly', station, reason, 'critical', { code, fault: true });
      this._log('equipment_stop', '整机', `设备停机：${reason}`, 'critical', {
        code: 'MACHINE_FAULT', faultStation: station
      });
      return true;
    }

    emergencyStop(reason) {
      if (this.status !== 'running' && this.status !== 'paused') {
        return { ok: false, message: '当前没有可停机的运行状态' };
      }
      const stopReason = reason || '人工急停';
      this.status = 'stopped';
      this.batch.stopReason = stopReason;
      this._lastStop = {
        time: this.simTime,
        clock: formatSimTime(this.simTime),
        reason: stopReason,
        station: '整机 · 操作台',
        code: 'ESTOP',
        values: this._currentValues()
      };
      this.batch.anomalies.push({
        time: round(this.simTime, 2),
        clock: formatSimTime(this.simTime),
        station: '整机 · 操作台',
        position: this.batch.groupsDone + 1,
        group: this.batch.groupsDone + 1,
        code: 'ESTOP',
        reason: stopReason,
        values: this._currentValues()
      });
      this._setEquipment('停机', stopReason);
      this._log('anomaly', '整机 · 操作台', stopReason, 'critical', { code: 'ESTOP' });
      this._log('equipment_stop', '整机', `设备停机：${stopReason}`, 'critical', {
        code: 'MACHINE_ESTOP'
      });
      return { ok: true };
    }

    recover(options) {
      const config = options || {};
      if (this.status !== 'fault' && this.status !== 'stopped') {
        return { ok: false, message: '当前没有待复位的停机' };
      }
      const previous = this._lastStop;
      this.status = 'paused';
      this._log('recovery', previous ? previous.station : '整机',
        '停机原因已复位，批次、叠层和缓存保持原状', 'info', {
          code: 'RECOVERY',
          recoveredFrom: previous ? previous.code : '',
          recoveredAt: round(this.simTime, 2)
        });
      if (config.autoResume !== false) this.start('故障复位后恢复');
      return { ok: true, previous };
    }

    singleStep(seconds) {
      if (this.status !== 'paused') {
        return { ok: false, message: '请先暂停，再执行单步' };
      }
      const dt = clamp(Number(seconds) || 0.25, 0.05, 1);
      this._advanceBy(dt, true);
      this._log('single_step', '整机', `单步推进 ${dt.toFixed(2)} 仿真秒`, 'info', {
        code: 'SINGLE_STEP', stepSeconds: dt
      });
      return { ok: true };
    }

    advance(seconds) {
      if (this.status !== 'running') return false;
      this._advanceBy(seconds, false);
      return true;
    }

    _advanceBy(seconds, allowPaused) {
      let remaining = clamp(Number(seconds) || 0, 0, 10);
      while (remaining > 0 && (this.status === 'running' ||
        (allowPaused && this.status === 'paused'))) {
        const step = Math.min(remaining, 0.1);
        this._step(step);
        remaining -= step;
      }
    }

    _step(dt) {
      this.simTime += dt;
      const power = 20 + this.params.speed * 0.2 + this.params.pressure * 0.1 +
        Math.abs(this.params.offset) * 8 + (this.batch.cache > 80 ? 2 : 0);
      this.batch.powerKw = power;
      this.batch.energyKwh += power * dt / 3600;

      const cacheTarget = clamp(8 + Math.max(0, this.params.speed - 66) * 2.3 +
        Math.abs(this.params.offset) * 9, 0, 100);
      this.batch.cache += (cacheTarget - this.batch.cache) * Math.min(1, dt * 0.85);
      if (this.params.speed > 108) {
        this.batch.cache += (this.params.speed - 108) * 0.05 * dt;
      }
      this.batch.cache = clamp(this.batch.cache, 0, 100);

      this.batch.peak.power = Math.max(this.batch.peak.power, power);
      this.batch.peak.cache = Math.max(this.batch.peak.cache, this.batch.cache);
      this.batch.peak.pressure = Math.max(this.batch.peak.pressure, this.params.pressure);
      this.batch.peak.offset = Math.max(this.batch.peak.offset, Math.abs(this.params.offset));
      this.batch.peak.speed = Math.max(this.batch.peak.speed, this.params.speed);

      if (this.batch.cache >= 99.2 && this.params.speed > 100) {
        this._fault('节拍过快导致缓存堵塞', '缓存线', 'CACHE_JAM');
        return;
      }

      const layerDuration = 1.15 * (80 / this.params.speed);
      this._phase += dt / layerDuration;
      while (this._phase >= 1 && this.status === 'running') {
        this._phase -= 1;
        this._placeLayer();
      }
      if (this.status !== 'running') this._phase = clamp(this._phase, 0, 0.999);
    }

    _placeLayer() {
      const type = GROUP_LAYERS[this.batch.stack.length % 3];
      const group = Math.floor(this.batch.stack.length / 3) + 1;
      const wobble = Math.sin((this.batch.stack.length + 1) * 1.91 + this.seed) * 0.012;
      const layerOffset = round(this.params.offset + wobble, 3);
      this.batch.stack.push({
        type,
        label: LAYER_LABELS[type],
        offset: layerOffset,
        group,
        placedAt: round(this.simTime, 2)
      });

      if (type === 'separator' && this.params.pressure > 65) {
        this._fault('吸盘压力过高，隔膜压伤', '隔膜工位', 'SEPARATOR_CRUSH');
        return;
      }

      if (type === 'negative') {
        this.batch.groupsDone += 1;
        this._completeGroup(group);
      }
    }

    _completeGroup(groupNo) {
      const offsetRisk = Math.abs(this.params.offset) > 0.3
        ? clamp((Math.abs(this.params.offset) - 0.25) / 0.5, 0, 1) * 0.9
        : 0;
      const pressureRisk = this.params.pressure > 60
        ? clamp((this.params.pressure - 58) / 12, 0, 1) * 0.35
        : 0;
      const speedRisk = this.params.speed > 95
        ? clamp((this.params.speed - 92) / 30, 0, 1) * 0.3
        : 0;
      const risk = clamp(offsetRisk + pressureRisk + speedRisk, 0, 0.95);
      const sample = ((this.batchNo * 19 + groupNo * 23 + this.seed * 11) % 100) / 100;
      const severeOffset = Math.abs(this.params.offset) > 0.75;
      const defective = risk > 0 && (sample < risk || severeOffset);
      if (defective) {
        this.batch.defects += 1;
        this.batch.anomalies.push({
          time: round(this.simTime, 2),
          clock: formatSimTime(this.simTime),
          station: '叠片台',
          position: `第 ${groupNo} 组叠片`,
          group: groupNo,
          layer: 2,
          code: 'SHORT_RISK',
          reason: '薄片错位，形成短路风险',
          values: this._currentValues()
        });
      } else {
        this.batch.good += 1;
      }

      const record = {
        batchId: this._batchId(),
        group: groupNo,
        good: !defective,
        risk: round(risk, 3),
        offset: round(this.params.offset, 2),
        time: round(this.simTime, 2),
        clock: formatSimTime(this.simTime)
      };
      this.groupHistory.push(record);
      this._lastGroup = record;
      this._log('group_result', '叠片台',
        `第 ${groupNo} 组${defective ? '判废：短路风险' : '完成，判定良品'}`,
        defective ? 'critical' : 'success', {
          code: defective ? 'GROUP_DEFECT' : 'GROUP_GOOD',
          group: groupNo,
          risk: round(risk, 3),
          offset: round(this.params.offset, 2)
        });

      if (this.batch.groupsDone >= TARGET_GROUPS) this._completeBatch();
    }

    _completeBatch() {
      this.status = 'complete';
      this.batch.endedAt = this.simTime;
      this._setEquipment('完成', '批次完成');
      this._log('equipment_stop', '整机', '十组叠片完成，设备自动停止', 'success', {
        code: 'BATCH_COMPLETE'
      });
      const result = this._buildBatchResult('complete');
      this.batchResults.push(result);
      this._batchFinalized = true;
      this._log('batch_result', '整机',
        `批次完成：${result.good}/${result.groupsDone} 良品，良品率 ${(result.yieldRate * 100).toFixed(1)}%`,
        result.defects > 0 ? 'warning' : 'success', {
          code: 'BATCH_RESULT',
          good: result.good,
          defects: result.defects,
          peakPower: result.peak.power,
          peakCache: result.peak.cache,
          stopReason: result.stopReason
        });
    }

    _buildBatchResult(reason) {
      const groupsDone = this.batch.groupsDone;
      return {
        batchId: this._batchId(),
        reason,
        target: TARGET_GROUPS,
        groupsDone,
        good: this.batch.good,
        defects: this.batch.defects,
        yieldRate: groupsDone ? this.batch.good / groupsDone : 0,
        peak: roundedPeak(this.batch.peak),
        energyKwh: round(this.batch.energyKwh, 4),
        stopReason: this.batch.stopReason || (reason === 'complete' ? '批次完成' : ''),
        anomalies: this.batch.anomalies.slice(),
        startedAt: round(this.batch.startedAt, 2),
        endedAt: round(this.simTime, 2),
        cacheAtEnd: round(this.batch.cache, 1),
        stackLayers: this.batch.stack.length,
        eventCount: this.logs.length
      };
    }

    resetBatch() {
      if (this.status === 'running' || this.status === 'paused') {
        this._setEquipment('停机', '批次重置');
      }
      if (!this._batchFinalized && this.batch.stack.length > 0) {
        const aborted = this._buildBatchResult('aborted');
        this.batchResults.push(aborted);
        this._log('batch_result', '整机',
          `批次中止：保留 ${aborted.good} 组良品记录，开始新批次`,
          'warning', { code: 'BATCH_ABORTED', good: aborted.good });
      }

      this.batchNo += 1;
      this.status = 'idle';
      this.batch = this._emptyBatch();
      this._phase = 0;
      this._batchStarted = false;
      this._batchFinalized = false;
      this._lastGroup = null;
      this._lastStop = null;
      EQUIPMENT.forEach((item) => { this.equipment[item.key] = '待机'; });
      this._log('batch_reset', '整机', '新批次已建立：叠层清空，缓存归零', 'success', {
        code: 'BATCH_RESET',
        cacheAfterReset: 0
      });
      return { ok: true, batchId: this._batchId(), cache: 0 };
    }

    getSnapshot() {
      const groupsDone = this.batch.groupsDone;
      return {
        simTime: this.simTime,
        clock: formatSimTime(this.simTime),
        status: this.status,
        params: Object.assign({}, this.params),
        safety: this.getSafety(),
        equipment: Object.assign({}, this.equipment),
        batchId: this._batchId(),
        groupsDone,
        good: this.batch.good,
        defects: this.batch.defects,
        yieldRate: groupsDone ? this.batch.good / groupsDone : 0,
        cache: round(this.batch.cache, 1),
        energyKwh: round(this.batch.energyKwh, 4),
        powerKw: round(this.batch.powerKw, 1),
        peak: Object.assign({}, this.batch.peak),
        anomalies: this.batch.anomalies.slice(),
        stopReason: this._lastStop ? this._lastStop.reason : this.batch.stopReason,
        lastStop: this._lastStop ? Object.assign({}, this._lastStop) : null,
        stack: this.batch.stack.slice(),
        phase: this._phase,
        progress: this.batch.stack.length / (TARGET_GROUPS * GROUP_LAYERS.length),
        logs: this.logs,
        batchResults: this.batchResults,
        lastGroup: this._lastGroup
      };
    }
  }

  function advanceUntil(sim, predicate, maxSeconds, stepSeconds) {
    const step = stepSeconds || 0.05;
    const limit = maxSeconds || 90;
    let elapsed = 0;
    let steps = 0;
    while (elapsed < limit && predicate(sim)) {
      sim.advance(step);
      elapsed += step;
      steps += 1;
    }
    return steps;
  }

  function validationValues(sim) {
    const values = sim._currentValues();
    return Object.assign(values, {
      clock: formatSimTime(sim.simTime),
      status: sim.status,
      groupsDone: sim.batch.groupsDone,
      good: sim.batch.good
    });
  }

  function normalScenario() {
    const sim = new StackingSimulator({ seed: 11 });
    sim.start('验证流程：正常生产');
    const steps = advanceUntil(sim, (machine) => machine.status === 'running', 80, 0.05);
    const checks = [
      { label: '达到十组', pass: sim.batch.groupsDone === TARGET_GROUPS },
      { label: '十组良品', pass: sim.batch.good === TARGET_GROUPS && sim.batch.defects === 0 },
      { label: '批次自动完成', pass: sim.status === 'complete' },
      { label: '缓存无堵塞', pass: sim.batch.peak.cache < 99.2 },
      { label: '仿真钟推进', pass: sim.simTime > 20 }
    ];
    return {
      id: 'normal',
      title: '正常生产',
      category: '正常',
      passed: checks.every((check) => check.pass),
      simulationSteps: steps,
      triggerClock: formatSimTime(sim.simTime),
      triggerSeconds: round(sim.simTime, 2),
      values: validationValues(sim),
      recovery: {
        passed: true,
        label: '无需干预',
        detail: '安全参数下连续完成 10 组，设备自动停机'
      },
      abnormalStation: '无',
      abnormalPosition: '无异常',
      stopReason: '批次完成',
      details: `完成 ${sim.batch.groupsDone} 组，良品 ${sim.batch.good} 组，短路风险 ${sim.batch.defects} 组`,
      checks,
      peak: roundedPeak(sim.batch.peak),
      logs: sim.logs.length,
      batchResult: sim.batchResults[0] || sim._buildBatchResult('complete')
    };
  }

  function limitScenario() {
    const sim = new StackingSimulator({ seed: 23 });
    sim.setParams({ pressure: 72, offset: 0.48, speed: 122 }, 'validation');
    sim.start('验证流程：参数越限');
    const stepsBeforeFault = advanceUntil(sim,
      (machine) => machine.status === 'running' && !machine._lastStop, 20, 0.05);
    const halted = sim.status === 'fault';
    const captured = validationValues(sim);
    const fault = sim._lastStop;
    const groupsBefore = sim.batch.groupsDone;
    const goodBefore = sim.batch.good;
    sim.setParams({ pressure: 52, offset: 0, speed: 78 }, 'validation-recovery');
    const recoveryResult = sim.recover({ autoResume: true });
    const stepsAfterRecovery = advanceUntil(sim,
      (machine) => machine.status === 'running' && machine.batch.groupsDone <= groupsBefore,
      20, 0.05);
    const after = validationValues(sim);
    const recovered = recoveryResult.ok && sim.status === 'running' &&
      sim.batch.groupsDone > groupsBefore;
    const checks = [
      { label: '越限参数生效', pass: sim.logs.some((entry) =>
        entry.kind === 'parameter_change' && entry.parameter === 'pressure' && entry.next === 72) },
      { label: '隔膜工位停机', pass: halted && fault && fault.station === '隔膜工位' },
      { label: '压力触发值越限', pass: Boolean(fault && fault.values.pressure > 65) },
      { label: '复位后继续当前批次', pass: recovered },
      { label: '恢复后良品增加', pass: sim.batch.good > goodBefore }
    ];
    return {
      id: 'limit',
      title: '参数越限',
      category: '极限',
      passed: checks.every((check) => check.pass),
      simulationSteps: stepsBeforeFault + stepsAfterRecovery,
      triggerClock: fault ? fault.clock : formatSimTime(sim.simTime),
      triggerSeconds: fault ? round(fault.time, 2) : round(sim.simTime, 2),
      values: captured,
      recovery: {
        passed: recovered,
        label: recovered ? '已恢复并续产' : '恢复未通过',
        detail: `安全参数复位；当前批次推进至 ${sim.batch.groupsDone} 组，良品 ${sim.batch.good} 组`
      },
      abnormalStation: fault ? fault.station : '未触发',
      abnormalPosition: fault
        ? `叠片台 · 第 ${captured.groupsDone + 1} 组隔膜层`
        : '未定位',
      stopReason: fault ? fault.reason : '未停机',
      details: `${captured.clock} 检测到吸盘压力 ${captured.pressure} kPa；复位后续产并完成 ${after.groupsDone} 组`,
      checks,
      peak: roundedPeak(sim.batch.peak),
      logs: sim.logs.length,
      batchResult: sim._buildBatchResult('validation-recovered')
    };
  }

  function equipmentStopScenario() {
    const sim = new StackingSimulator({ seed: 37 });
    sim.start('验证流程：设备停机');
    const stepsBeforeStop = advanceUntil(sim,
      (machine) => machine.status === 'running' && machine.simTime < 4.2, 6, 0.05);
    const groupsBefore = sim.batch.groupsDone;
    const goodBefore = sim.batch.good;
    sim.emergencyStop('验证：操作员急停');
    const stopped = sim.status === 'stopped';
    const captured = validationValues(sim);
    const stop = sim._lastStop;
    const recoveryResult = sim.recover({ autoResume: true });
    const stepsAfterRecovery = advanceUntil(sim,
      (machine) => machine.status === 'running' && machine.batch.groupsDone <= groupsBefore,
      20, 0.05);
    const recovered = recoveryResult.ok &&
      (sim.batch.groupsDone > groupsBefore || sim.batch.good > goodBefore);
    const checks = [
      { label: '急停实际生效', pass: stopped && stop && stop.code === 'ESTOP' },
      { label: '停机时缓存保留', pass: Boolean(stop && stop.values.cache >= 0) },
      { label: '停机事件已记录', pass: sim.logs.some((entry) => entry.code === 'MACHINE_ESTOP') },
      { label: '复位后恢复当前批次', pass: recovered && sim.status === 'running' },
      { label: '设备重新启动', pass: sim.logs.some((entry) =>
        entry.code === 'EQUIPMENT_START' && entry.time > (stop ? stop.time : 0)) }
    ];
    return {
      id: 'stop',
      title: '设备停机',
      category: '故障',
      passed: checks.every((check) => check.pass),
      simulationSteps: stepsBeforeStop + stepsAfterRecovery,
      triggerClock: stop ? stop.clock : formatSimTime(sim.simTime),
      triggerSeconds: stop ? round(stop.time, 2) : round(sim.simTime, 2),
      values: captured,
      recovery: {
        passed: recovered,
        label: recovered ? '已复位并续产' : '恢复未通过',
        detail: `保留当前叠层；续产至 ${sim.batch.groupsDone} 组，良品 ${sim.batch.good} 组`
      },
      abnormalStation: stop ? stop.station : '未触发',
      abnormalPosition: '操作台 · 整机停机回路',
      stopReason: stop ? stop.reason : '未停机',
      details: `${captured.clock} 急停时缓存 ${captured.cache}%，功率 ${captured.powerKw} kW`,
      checks,
      peak: roundedPeak(sim.batch.peak),
      logs: sim.logs.length,
      batchResult: sim._buildBatchResult('validation-recovered')
    };
  }

  function runValidationSuite() {
    const started = Date.now();
    const runners = [normalScenario, limitScenario, equipmentStopScenario];
    const results = runners.map((runner) => {
      try {
        return runner();
      } catch (error) {
        return {
          id: 'error',
          title: '验证异常',
          category: '故障',
          passed: false,
          simulationSteps: 0,
          triggerClock: '--:--.-',
          values: {},
          recovery: { passed: false, label: '执行失败', detail: String(error.message || error) },
          abnormalStation: '验证器',
          abnormalPosition: '--',
          stopReason: '验证未执行',
          details: String(error.message || error),
          checks: [{ label: '执行验证', pass: false }]
        };
      }
    });
    return {
      schema: 'stackguard-validation/v1',
      source: 'StackingSimulator',
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      passed: results.filter((result) => result.passed).length,
      total: results.length,
      results
    };
  }

  const api = {
    StackingSimulator,
    TARGET_GROUPS,
    GROUP_LAYERS,
    LAYER_LABELS,
    DEFAULT_PARAMS,
    SAFE_BANDS,
    LIMITS,
    EQUIPMENT,
    formatSimTime,
    runValidationSuite
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.StackingSim = api;
})(typeof window !== 'undefined' ? window : globalThis);

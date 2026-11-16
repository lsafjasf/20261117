/*
 * 板材压制离散事件仿真引擎（无 DOM 依赖，可在浏览器与 Node 中运行）
 * 生产节拍、能耗、缓存全部由同一个 tick() 仿真时钟驱动。
 */
(function (global) {
  'use strict';

  var TICK_S = 0.25;                 // 单个仿真步长（秒）
  var BATCH_SIZE = 3;                // 每批次板材数量
  var BUFFER_CAP = { forming: 2, preheat: 2 };
  var FORM_TICKS = 4;                // 铺装耗时 1.0s
  var PREHEAT_TICKS = 4;             // 预热耗时 1.0s
  var DENSITY_MIN = 0.65;            // 合格密度下限 g/cm3

  // 工艺参数安全窗口
  var LIMITS = {
    moisture: { min: 6, max: 12, unit: '%', label: '含水率' },
    pressure: { min: 2.5, max: 4.0, unit: 'MPa', label: '压力' },
    holdTime: { min: 6, max: 12, unit: 's', label: '保温时间' }
  };

  var DEFAULTS = { moisture: 8, pressure: 3.2, holdTime: 8 };

  // 设备额定功率（kW），泵功率随设定压力升高
  var POWER = { former: 4.0, heater: 9.0, pumpBase: 5.5, pumpPerMPa: 3.0 };

  var DEFECT_LABELS = {
    CRACK_DRY: '含水率过低干裂纹',
    LOOSE_WET: '含水率过高疏松',
    GLUE_UNCURED: '蒸汽不足胶层未固化',
    LOOSE_PRESSURE: '压力不足板材疏松',
    CRACK_OVERPRESSURE: '压力过大开裂',
    UNDERHOLD: '保温时间不足',
    OVERHOLD: '保温时间过长老化开裂'
  };

  function nowTs() {
    return new Date().toISOString();
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function round(v, d) {
    var k = Math.pow(10, d || 2);
    return Math.round(v * k) / k;
  }

  function Simulation() {
    this.reset();
  }

  Simulation.prototype.reset = function () {
    this.simTime = 0;
    this.tickCount = 0;
    this.params = { moisture: DEFAULTS.moisture, pressure: DEFAULTS.pressure, holdTime: DEFAULTS.holdTime };
    this.equipment = {
      former: { running: true, name: '铺装机' },
      heater: { running: true, name: '蒸汽预热器' },
      pump: { running: true, name: '液压泵' }
    };
    this.rawRemaining = BATCH_SIZE;
    this.nextBoardId = 1;
    this.stations = { forming: null, preheat: null, press: null };
    this.buffers = { forming: [], preheat: [] };
    this.finished = [];
    this.events = [];
    this.downtime = [];
    this.energyKWh = 0;
    this.peakPowerKW = 0;
    this.peakPressure = 0;
    this.goodCount = 0;
    this.rejectCount = 0;
    this._pumpPowerKW = 0;
    this._log('BATCH_RESET', 'system', { batchSize: BATCH_SIZE });
    return this.getSnapshot();
  };

  Simulation.prototype._log = function (type, source, detail, values) {
    this.events.push({
      t: round(this.simTime, 3),
      type: type,
      source: source,
      detail: detail || {},
      values: values || this._currentValues(),
      wall: nowTs()
    });
  };

  Simulation.prototype._currentValues = function () {
    return {
      moisture: this.params.moisture,
      pressure: this.params.pressure,
      holdTime: this.params.holdTime,
      pumpOn: this.equipment.pump.running,
      heaterOn: this.equipment.heater.running,
      formerOn: this.equipment.former.running
    };
  };

  Simulation.prototype.setParam = function (name, value) {
    if (!Object.prototype.hasOwnProperty.call(LIMITS, name)) {
      throw new Error('未知参数: ' + name);
    }
    var old = this.params[name];
    var v = Number(value);
    if (!isFinite(v)) {
      throw new Error('参数必须为数字: ' + name);
    }
    var lim = LIMITS[name];
    var outOfRange = v < lim.min || v > lim.max;
    this.params[name] = round(clamp(v, lim.min - 2, lim.max + 2), 2);
    this._log('PARAM_CHANGE', name, { name: name, old: old, next: this.params[name], outOfRange: outOfRange });
    if (outOfRange) {
      this._log('PARAM_OUT_OF_LIMIT', name, {
        name: name, value: this.params[name], safeMin: lim.min, safeMax: lim.max
      });
    }
    return this.getSnapshot();
  };

  Simulation.prototype.setEquipment = function (key, running, reason) {
    var eq = this.equipment[key];
    if (!eq) {
      throw new Error('未知设备: ' + key);
    }
    if (eq.running === !!running) {
      return this.getSnapshot();
    }
    eq.running = !!running;
    var rec;
    if (!eq.running) {
      rec = {
        equipment: key, name: eq.name, startAt: round(this.simTime, 3),
        reason: reason || '手动停机', endAt: null, downTicks: 0, recovered: false
      };
      this.downtime.push(rec);
      this._log('EQUIPMENT_STOP', key, { reason: rec.reason });
    } else {
      var open = null;
      for (var i = this.downtime.length - 1; i >= 0; i--) {
        if (this.downtime[i].equipment === key && this.downtime[i].endAt === null) {
          open = this.downtime[i];
          break;
        }
      }
      if (open) {
        open.endAt = round(this.simTime, 3);
        open.downTicks = this.tickCount - Math.round(open.startAt / TICK_S);
        open.recovered = true;
        rec = open;
      }
      this._log('EQUIPMENT_START', key, { recoveredAt: round(this.simTime, 3) });
    }
    return this.getSnapshot();
  };

  Simulation.prototype._addDefect = function (board, code) {
    if (board.defects.indexOf(code) === -1) {
      board.defects.push(code);
      this._log('DEFECT', 'board-' + board.id, { boardId: board.id, code: code, label: DEFECT_LABELS[code] });
    }
  };

  Simulation.prototype._pumpPower = function (pressLoaded) {
    if (!this.equipment.pump.running) {
      return 0;
    }
    if (pressLoaded) {
      return POWER.pumpBase + POWER.pumpPerMPa * this.params.pressure;
    }
    return POWER.pumpBase * 0.4; // 空载怠速
  };

  Simulation.prototype._accrueEnergy = function () {
    var pressLoaded = !!this.stations.press;
    var kw = 0;
    if (this.equipment.former.running) {
      kw += POWER.former;
    }
    if (this.equipment.heater.running) {
      kw += POWER.heater;
    }
    var pumpKW = this._pumpPower(pressLoaded);
    this._pumpPowerKW = round(pumpKW, 2);
    kw += pumpKW;
    this.energyKWh += (kw * TICK_S) / 3600;
    this.energyKWh = round(this.energyKWh, 5);
    if (kw > this.peakPowerKW) {
      this.peakPowerKW = round(kw, 2);
    }
    if (pressLoaded && pumpKW > 0 && this.params.pressure > this.peakPressure) {
      this.peakPressure = this.params.pressure;
    }
  };

  Simulation.prototype.tick = function () {
    if (this.isBatchComplete()) {
      return this.getSnapshot();
    }
    this.simTime = round(this.simTime + TICK_S, 3);
    this.tickCount += 1;
    this._accrueEnergy();
    this._tickPress();
    this._tickPreheat();
    this._tickForming();
    if (this.rawRemaining === 0 && !this.stations.forming && !this.stations.preheat &&
        !this.stations.press && this.buffers.forming.length === 0 && this.buffers.preheat.length === 0) {
      this._finalizeBatch();
    }
    return this.getSnapshot();
  };

  Simulation.prototype._tickPress = function () {
    var board = this.stations.press;
    if (!board) {
      if (this.buffers.preheat.length > 0) {
        var next = this.buffers.preheat.shift();
        next.stage = 'press';
        next.enteredPressAt = this.simTime;
        next.holdTarget = this.params.holdTime;
        next.holdTicks = 0;
        next.starvedTicks = 0;
        next.pressureSum = 0;
        next.pressureSamples = 0;
        if (next.holdTarget < LIMITS.holdTime.min) {
          this._addDefect(next, 'UNDERHOLD');
        } else if (next.holdTarget > LIMITS.holdTime.max) {
          this._addDefect(next, 'OVERHOLD');
        }
        this.stations.press = next;
        this._log('PRESS_ENTER', 'press', { boardId: next.id, holdTarget: next.holdTarget });
      }
      return;
    }
    var pressure = this.equipment.pump.running ? this.params.pressure : 0;
    board.holdTicks += 1;
    board.pressureSum += pressure;
    board.pressureSamples += 1;
    if (pressure === 0) {
      board.starvedTicks += 1;
      if (board.starvedTicks >= 2) {
        this._addDefect(board, 'LOOSE_PRESSURE');
      }
    }
    if (pressure > LIMITS.pressure.max) {
      this._addDefect(board, 'CRACK_OVERPRESSURE');
    }
    if (pressure < LIMITS.pressure.min && pressure > 0) {
      this._addDefect(board, 'LOOSE_PRESSURE');
    }
    if (board.holdTicks * TICK_S >= board.holdTarget) {
      this._releaseBoard(board);
    }
  };

  Simulation.prototype._releaseBoard = function (board) {
    var avgPressure = board.pressureSamples ? board.pressureSum / board.pressureSamples : 0;
    var density = round(0.35 + 0.1 * avgPressure, 3);
    if (this.params.moisture > LIMITS.moisture.max) {
      density = round(density - 0.04, 3);
    }
    if (this.params.moisture < LIMITS.moisture.min) {
      this._addDefect(board, 'CRACK_DRY');
    } else if (this.params.moisture > LIMITS.moisture.max) {
      this._addDefect(board, 'LOOSE_WET');
    }
    if (board.glueCured === false) {
      this._addDefect(board, 'GLUE_UNCURED');
    }
    board.density = density;
    board.densityOk = density >= DENSITY_MIN;
    board.passed = board.densityOk && board.defects.length === 0;
    board.stage = 'finished';
    board.finishedAt = this.simTime;
    if (board.passed) {
      this.goodCount += 1;
    } else {
      this.rejectCount += 1;
    }
    this.finished.push(board);
    this.stations.press = null;
    this._log('PRESS_RELEASE', 'press', {
      boardId: board.id, density: density, densityOk: board.densityOk,
      defects: board.defects.slice(), passed: board.passed
    });
  };

  Simulation.prototype._tickPreheat = function () {
    var board = this.stations.preheat;
    if (!board) {
      if (this.buffers.forming.length > 0) {
        var next = this.buffers.forming.shift();
        next.stage = 'preheat';
        next.preheatTicks = 0;
        next.steamLostTicks = 0;
        next.glueCured = null;
        this.stations.preheat = next;
        this._log('PREHEAT_ENTER', 'heater', { boardId: next.id });
      }
      return;
    }
    if (!this.equipment.heater.running) {
      board.steamLostTicks += 1;
      if (board.steamLostTicks >= 2) {
        board.glueCured = false;
        this._addDefect(board, 'GLUE_UNCURED');
      }
    }
    board.preheatTicks += 1;
    if (board.preheatTicks >= PREHEAT_TICKS) {
      if (board.glueCured === null) {
        board.glueCured = true;
      }
      if (this.buffers.preheat.length < BUFFER_CAP.preheat) {
        board.stage = 'bufferPreheat';
        this.buffers.preheat.push(board);
        this.stations.preheat = null;
        this._log('BUFFER_IN', 'preheat-buffer', { boardId: board.id, size: this.buffers.preheat.length });
      }
    }
  };

  Simulation.prototype._tickForming = function () {
    var board = this.stations.forming;
    if (!board) {
      if (this.rawRemaining > 0 && this.equipment.former.running &&
          this.buffers.forming.length < BUFFER_CAP.forming) {
        var id = this.nextBoardId++;
        var newBoard = {
          id: id,
          stage: 'forming',
          formedTicks: 0,
          preheatTicks: 0,
          defects: [],
          glueCured: null,
          density: null,
          densityOk: null,
          passed: null
        };
        this.rawRemaining -= 1;
        this.stations.forming = newBoard;
        this._log('FORM_START', 'former', { boardId: id });
      }
      return;
    }
    if (this.equipment.former.running) {
      board.formedTicks += 1;
      if (board.formedTicks >= FORM_TICKS) {
        if (this.buffers.forming.length < BUFFER_CAP.forming) {
          board.stage = 'bufferForming';
          this.buffers.forming.push(board);
          this.stations.forming = null;
          this._log('BUFFER_IN', 'forming-buffer', { boardId: board.id, size: this.buffers.forming.length });
        }
      }
    }
  };

  Simulation.prototype._finalizeBatch = function () {
    var yieldRate = this.finished.length ? round((this.goodCount / this.finished.length) * 100, 1) : 0;
    this._log('BATCH_COMPLETE', 'system', {
      good: this.goodCount, reject: this.rejectCount, yieldRate: yieldRate
    });
  };

  Simulation.prototype.isBatchComplete = function () {
    return this.finished.length >= BATCH_SIZE;
  };

  Simulation.prototype.getSnapshot = function () {
    return {
      simTime: this.simTime,
      tickCount: this.tickCount,
      params: Object.assign({}, this.params),
      limits: JSON.parse(JSON.stringify(LIMITS)),
      equipment: {
        former: Object.assign({}, this.equipment.former),
        heater: Object.assign({}, this.equipment.heater),
        pump: Object.assign({}, this.equipment.pump)
      },
      rawRemaining: this.rawRemaining,
      stations: {
        forming: this.stations.forming ? this._boardView(this.stations.forming) : null,
        preheat: this.stations.preheat ? this._boardView(this.stations.preheat) : null,
        press: this.stations.press ? this._boardView(this.stations.press) : null
      },
      buffers: {
        forming: this.buffers.forming.map(this._boardView, this),
        preheat: this.buffers.preheat.map(this._boardView, this)
      },
      finished: this.finished.map(this._boardView, this),
      pumpPowerKW: this._pumpPowerKW,
      energyKWh: this.energyKWh,
      peakPowerKW: this.peakPowerKW,
      peakPressure: this.peakPressure,
      goodCount: this.goodCount,
      rejectCount: this.rejectCount,
      yieldRate: this.finished.length ? round((this.goodCount / this.finished.length) * 100, 1) : 0,
      batchComplete: this.isBatchComplete(),
      downtime: this.downtime.map(function (d) { return Object.assign({}, d); }),
      eventCount: this.events.length
    };
  };

  Simulation.prototype._boardView = function (board) {
    return {
      id: board.id,
      stage: board.stage,
      progress: this._boardProgress(board),
      defects: board.defects.slice(),
      defectLabels: board.defects.map(function (c) { return DEFECT_LABELS[c]; }),
      glueCured: board.glueCured,
      density: board.density,
      densityOk: board.densityOk,
      passed: board.passed,
      finishedAt: board.finishedAt || null
    };
  };

  Simulation.prototype._boardProgress = function (board) {
    if (board.stage === 'forming') {
      return round(board.formedTicks / FORM_TICKS, 3);
    }
    if (board.stage === 'preheat') {
      return round(board.preheatTicks / PREHEAT_TICKS, 3);
    }
    if (board.stage === 'press') {
      return round(Math.min(1, (board.holdTicks * TICK_S) / board.holdTarget), 3);
    }
    if (board.stage === 'finished') {
      return 1;
    }
    return 0;
  };

  Simulation.prototype.runToComplete = function (maxTicks) {
    var guard = maxTicks || 100000;
    while (!this.isBatchComplete() && guard-- > 0) {
      this.tick();
    }
    if (guard <= 0) {
      throw new Error('仿真未在限定步数内结束');
    }
    return this.getSnapshot();
  };

  Simulation.prototype.exportReport = function () {
    var openDowntime = this.downtime.filter(function (d) { return !d.recovered; });
    return {
      generatedAt: nowTs(),
      batchSize: BATCH_SIZE,
      goodCount: this.goodCount,
      rejectCount: this.rejectCount,
      yieldRate: this.finished.length ? round((this.goodCount / this.finished.length) * 100, 1) : 0,
      peakPowerKW: this.peakPowerKW,
      peakPressure: this.peakPressure,
      energyKWh: this.energyKWh,
      downtime: this.downtime.map(function (d) { return Object.assign({}, d); }),
      openDowntime: openDowntime.map(function (d) {
        return { equipment: d.equipment, name: d.name, reason: d.reason, startAt: d.startAt };
      }),
      boards: this.finished.map(function (b) {
        return {
          boardId: b.id,
          density: b.density,
          densityOk: b.densityOk,
          passed: b.passed,
          defects: b.defects,
          defectLabels: b.defects.map(function (c) { return DEFECT_LABELS[c]; }),
          finishedAt: b.finishedAt
        };
      }),
      events: this.events.slice()
    };
  };

  Simulation.prototype.getEvents = function () {
    return this.events.slice();
  };

  var api = {
    Simulation: Simulation,
    TICK_S: TICK_S,
    BATCH_SIZE: BATCH_SIZE,
    LIMITS: LIMITS,
    DEFAULTS: DEFAULTS,
    DEFECT_LABELS: DEFECT_LABELS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.PressSim = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

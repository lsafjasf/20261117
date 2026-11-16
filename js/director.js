/* 验证导演：固定时刻表的临界事件与脚本化处置，自由模式仅注入干旱 */
(function (root) {
  'use strict';

  const U = root.WetlandUtil || require('./util.js');
  const CFG = U.CFG;
  const D = 24;

  function ScenarioDirector() {
    this.schedule = [
      { at: 45 * D, done: false, fn: 'startDrought' },
      { at: 150 * D, done: false, fn: 'forceHarvest', validationOnly: true },
    ];
  }

  ScenarioDirector.prototype.beforeStep = function (sim) {
    const h = sim.hour;
    this.schedule.forEach((item) => {
      if (!item.done && h === item.at) {
        if (item.validationOnly && sim.mode !== 'validation') return;
        item.done = true;
        this[item.fn](sim);
      }
    });
  };

  ScenarioDirector.prototype.startDrought = function (sim) {
    sim.triggerDrought(18 * D, 1.0);
  };

  ScenarioDirector.prototype.forceHarvest = function (sim) {
    sim.harvest();
  };

  // 验证模式自动处置：只按当前实际水位决定档位，干旱期 + 恢复 40 天管理
  ScenarioDirector.prototype.afterStep = function (sim) {
    if (sim.mode !== 'validation' || sim.finished) return;
    const s = sim.state;
    const iv = sim.interventions;
    const droughtActive = sim.drought &&
      sim.hour >= sim.drought.start && sim.hour < sim.drought.end;
    const postDrought = sim.drought && sim.hour >= sim.drought.end &&
      sim.hour < sim.drought.end + 200 * D;
    if (!droughtActive && !postDrought) {
      if (iv.pumpRate !== 0) sim.setPump(0);
      if (iv.gateOpen) sim.setGate(false);
      return;
    }
    const alarmActive = sim.alarms.level.status !== 'ok';
    if (s.levelCm > 42) {
      if (!iv.gateOpen) {
        sim.setGate(true);
        sim._log('info', '自动处置：水位过高，开排水闸防淹没');
      }
      if (iv.pumpRate !== 0) sim.setPump(0);
    } else if (s.levelCm <= -11.9) {
      sim.setGate(false);
      if (iv.pumpRate !== 2) {
        sim.setPump(2);
        sim._log('info', '自动处置：水位逼近临界，补水泵调至高档（2 cm/h）');
      }
    } else if (postDrought && s.levelCm < 8) {
      sim.setGate(false);
      if (iv.pumpRate !== 1) {
        sim.setPump(1);
        sim._log('info', '自动处置：水位低于浅水区，低档补水维持厌氧固碳环境');
      }
    } else if (s.levelCm >= 26) {
      sim.setGate(false);
      if (iv.pumpRate !== 0) {
        sim.setPump(0);
        sim._log('info', '自动处置：水位回到理想区，停泵防止淹没');
      }
    } else {
      sim.setGate(false);
    }
  };

  ScenarioDirector.prototype.reset = function () {
    this.schedule.forEach((item) => { item.done = false; });
  };

  ScenarioDirector.CFG = CFG;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScenarioDirector: ScenarioDirector };
  }
  root.WetlandDirector = { ScenarioDirector: ScenarioDirector };
})(typeof self !== 'undefined' ? self : this);

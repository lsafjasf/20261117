/* global module, window */
/**
 * 潜水钟双人协作游戏 —— 全局配置常量。
 * 引擎以固定步长推进，保证回放与 Node 测试可复现。
 */
(function (root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = config;
  } else {
    root.DBConfig = config;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TICK_HZ = 30;
  const DT = 1 / TICK_HZ;

  const CONFIG = {
    TICK_HZ,
    DT,

    // —— 钟体 / 深度 ——
    SURFACE_Y: 0,
    MAX_DEPTH: 130,
    BALLAST_RATE: 8,          // 压载舱注/排水速率 (单位/s)
    BALLAST_MAX: 100,
    BUOYANCY_PER_UNIT: 0.115, // 每单位净浮力对应的加速度
    DRAG: 0.42,               // 垂直水阻系数
    MAX_VSPEED: 7,
    RISE_SAFE_SPEED: 3.2,     // 上浮安全速度

    // —— 海流 / 水平漂移 ——
    CURRENT_BASE: 1.6,
    CURRENT_SWAY: 1.1,
    CURRENT_PERIOD: 26,       // 海流变化周期 (s)
    DRAG_H: 0.55,
    MAX_DRIFT: 14,
    STATION_DRIFT_TOL: 3.0,   // 取样点水平容差 (m)

    // —— 脐带缆绳 ——
    CABLE_RATE: 3.2,          // 收/放缆速度 (m/s)
    CABLE_MIN_SLACK: 2.2,     // 低于此值视为过紧
    CABLE_MAX_SLACK: 6.5,     // 高于此值视为松弛
    STRESS_PER_SEC: 4,        // 张力过高时应力累积
    STRESS_MAX: 100,
    STRESS_RELAX: 6,          // 张力正常时应力消解
    STRESS_FAIL: 100,

    // —— 供气 / 氧气 ——
    AIR_RATE: 14,             // 阀门调节速率 (%/s)
    O2_CONSUME: 0.085,        // 基础含氧量消耗 (%/s)
    O2_GAIN_PER_VALVE: 0.052, // 每单位阀门开度的补充
    O2_MIN: 18.5,             // 缺氧阈值
    O2_MAX: 23.5,
    O2_LOW_WARN: 19.5,
    O2_HIGH_WARN: 23.0,
    HYPOXIA_LIMIT: 15,        // 缺氧倒计时 (s)
    RESERVE_DRAIN: 0.16,      // 储气量消耗 (/s，按阀门开度加权)

    // —— 温度 ——
    TEMP_SURFACE: 26,
    TEMP_GRADIENT: 0.075,     // 每米降温
    TEMP_COLD_WARN: 15,

    // —— 取样点 ——
    STATIONS: [
      { id: 1, depth: 30, depthTol: 2.5 },
      { id: 2, depth: 68, depthTol: 2.5 },
      { id: 3, depth: 105, depthTol: 3.0 }
    ],
    SAMPLE_TIME: 6,           // 取样保持时长 (s)

    // —— 保护状态 ——
    IDLE_TIMEOUT: 30,         // 单侧无输入超时 (s)

    // —— 初始状态 ——
    INITIAL: {
      depth: 0,
      vSpeed: 0,
      drift: 0,
      ballast: 50,
      cablePaid: 4,
      cableValve: 35,
      o2: 20.9,
      reserve: 100,
      stress: 0,
      temp: 26
    },

    // 每个玩家可调用的动作白名单（职责隔离，禁止越权）
    PLAYER_ACTIONS: {
      p1: ['ballast_up', 'ballast_down', 'ballast_off'],
      p2: ['air_up', 'air_down', 'air_off', 'cable_pay', 'cable_reel', 'cable_off', 'sample']
    },
    // 键位：两侧完全不重叠
    KEYMAP: {
      KeyW: { player: 'p1', action: 'ballast_up' },
      KeyS: { player: 'p1', action: 'ballast_down' },
      ArrowUp: { player: 'p2', action: 'cable_pay' },
      ArrowDown: { player: 'p2', action: 'cable_reel' },
      ArrowLeft: { player: 'p2', action: 'air_down' },
      ArrowRight: { player: 'p2', action: 'air_up' },
      Enter: { player: 'p2', action: 'sample' }
    }
  };

  return CONFIG;
});

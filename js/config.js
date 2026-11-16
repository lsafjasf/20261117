/* 全局配置：几何（像素）+ SI 物理常数 + 安全限值。挂到 window.CRANE_CFG。 */
(function (global) {
  'use strict';

  const PX_PER_M = 50; // 1 m = 50 px

  const CFG = {
    DT: 1 / 120,          // 固定物理步长（秒），保证确定性
    PX_PER_M,
    G: 9.81,
    DAMP: 0.5,            // 摆角线性阻尼系数（1/s），模拟空气阻力使摆动收敛

    view: { w: 960, h: 560 },
    beam: { x0: 40, x1: 920, y: 64, thickness: 10 },
    groundY: 520,
    track: { xMin: 90, xMax: 880 },

    trolley: {
      startX: 170,
      width: 34, height: 20,
      vMax: 0.8,          // m/s
      accel: 0.45         // m/s^2
    },

    winch: {
      rMin: 0.5, rMax: 9.2, // 绳长范围（m）
      vMax: 0.2,            // m/s
      accel: 0.9
    },

    // 两次吊装任务：箱初始位置、目标平台、越障所需最小起升高度（像素 y）
    lifts: [
      {
        id: 0,
        box: { x: 170, w: 50, h: 50, mass: 800, color: '#c9742f' },
        platform: { x: 790, w: 110, top: 440 },
        clearY: 332 // 箱底必须高于该 y 才允许越过中间障碍
      },
      {
        id: 1,
        box: { x: 150, w: 60, h: 56, mass: 1200, color: '#8a4fb0' },
        platform: { x: 250, w: 180, top: 300 },
        clearY: 332
      }
    ],

    // 中间障碍墙（横移时碰撞即失败）
    wall: { x: 470, w: 26, top: 340, bottom: 520 },

    counterweightChoices: [400, 800, 1200],

    // 安全限值（超出即触发故障并停机）
    limits: {
      tension: { min: 100, max: 12000, unit: 'N', label: '绳张力' },
      speed:   { min: 0,   max: 1.1,   unit: 'm/s', label: '货箱速度' },
      temp:    { min: 20,  max: 120,   unit: '℃', label: '刹车温度' },
      pressure:{ min: 40,  max: 200,   unit: 'bar', label: '液压压力' }
    },

    // 压力映射：P = p0 + kp*(重力-配重*g)，单位 bar
    pressure: { p0: 75, kp: 0.016 },
    // 刹车温升：dT/dt = kb*制动功率，环境温度自然冷却
    brake: { kb: 0.05, cool: 0.04, ambient: 20 },

    settle: {
      maxPlaceSpeed: 0.6,  // 放置时速度上限（m/s）
      maxPlaceSwing: 0.15, // 放置时摆角上限（rad ≈ 8.6°）
      placeTolerance: 18   // 箱底与平台面像素容差
    },

    historySeconds: 90
  };

  global.CRANE_CFG = CFG;
})(typeof window !== 'undefined' ? window : globalThis);

/* 全局物理常量、安全边界与输入上下限（单位均为 SI） */
window.CONFIG = {
  sim: {
    dt: 0.0002,           // 固定物理步长 0.2 ms，保证刚性悬浮系统数值稳定
    maxRunTime: 120,      // 单次运行最长时间 s
    lapsToWin: 3,         // 稳定运行三圈即成功
    replayEvery: 0.02,    // 每 20 ms 记录一帧回放
    historySeconds: 6     // 趋势图保留时长
  },
  car: {
    m0: 120,              // 车体净质量 kg
    area: 0.35,           // 迎风面积 m^2
    Cd: 1.1,
    rhoAir: 1.225,
    g: 9.81,
    gap0: 0.020,          // 初始悬浮间隙 20 mm
    // 磁吸力模型 Fm = kI * I * g0 / gap
    kI: 40,
    // 被动限位弹簧（机械兜底，提供刚度使系统可镇定）
    kSpring: 90000,       // N/m，以 gap0 为零力点；净刚度为正保证工作点稳定
    driveK: 0.9,          // 纵向直线驱动力系数 Fd = driveK * I
    eddyK: 1.6            // 磁滞/涡流阻力 Feddy = eddyK * v（低速失速来源）
  },
  input: {
    current: { min: 10, max: 80, step: 0.5, unit: 'A', label: '线圈电流' },
    damping: { min: 200, max: 4000, step: 50, unit: 'N·s/m', label: '悬浮阻尼' },
    v0: { min: 2, max: 20, step: 0.5, unit: 'm/s', label: '初始速度' },
    load: { min: 0, max: 160, step: 5, unit: 'kg', label: '负载质量' }
  },
  limits: {
    // 受监控物理量的安全上下限（超出即触发故障并停机）
    gap: {
      min: 0.003, max: 0.040, unit: 'm',
      label: '悬浮间隙', lowName: '吸轨碰撞', highName: '触轨（间隙过大）'
    },
    speed: {
      min: 1.8, max: 22, unit: 'm/s',
      label: '运行速度', lowName: '失速停车', highName: '超速'
    },
    temp: {
      min: -50, max: 120, unit: '°C',
      label: '线圈温度', lowName: '温度异常', highName: '线圈过热'
    },
    pressure: {
      min: 3000, max: 120000, unit: 'Pa',
      label: '支撑压力', lowName: '支撑失压', highName: '支撑压力超限'
    },
    osc: {
      max: 0.8, unit: 'm/s²', label: '车体竖向振动加速度(RMS,1s)',
      highName: '车体剧烈震荡'
    }
  },
  temp: {
    ambient: 25,          // 环境温度 °C
    heatK: 0.0009,        // 焦耳热系数：40A 三圈内安全，47A 约 70s 过热
    coolK: 0.012          // 散热系数（热时间常数约 83 s）
  },
  track: {
    radii: [14, 8, 22],       // 三段不同曲率半径 m（曲率 1/R 各不同）
    signs: [-1, 1, 1],        // 首段反向弯曲，使三段圆弧可精确闭合
    initBeta: [2.57766, 2.26167], // 牛顿求解初值（b1、b3，弧度）
    samplesPerArc: 240,       // 每段圆弧采样数
    rotate: -Math.PI / 2      // 整体旋转为横向布局
  },
  sound: {
    baseFreq: 70,
    maxFreq: 320
  }
};

/* 全局配置常量与由 seed 决定的世界生成 */
(function (G) {
  const CFG = {
    DT: 0.2,                 // 固定仿真步长（秒），保证可复现
    HIVE_COUNT: 3,           // 蜂箱数量
    BLOOM_WINDOW: 180,       // 花期窗口（秒）：必须在此之前到达
    POLLINATE_TIME: 20,      // 到场后授粉观察时长（秒）
    POST_RUN_TIME: 30,       // 恢复/结束后继续运行的固定确认时长（秒）

    ROUTES: {
      A: { name: '平缓主路', length: 100, bump: 0.045 },
      B: { name: '颠簸近路', length: 70,  bump: 0.22  }
    },
    SPEED_MODES: {
      // 车速档：速度 / 发动机发热修正 / 颠簸修正
      slow:   { name: '低速', speed: 0.55, heat: -1.0, bump: 0.8 },
      normal: { name: '正常', speed: 0.8,  heat: 0,     bump: 1.0 },
      fast:   { name: '加速', speed: 1.1,  heat: 1.5,   bump: 1.35 }
    },

    AMBIENT_BASE: 30,        // 环境基准温度 °C
    HEAT_AMBIENT: 8,         // 热浪叠加温度
    RAIN_COOL: -4,           // 降雨降温
    HEAT_GAIN_BASE: 2.4,     // 蜂群自身发热（紧装/通风差时更高，见 sim）
    VENT_COOL: 4.5,          // 强通风散热系数
    WIND_COOL: 2.0,          // 大风增强散热
    SPRAY_COOL: 4.5,         // 喷淋降温（每秒近似作用）

    TEMP_WARN: 35,           // 温度告警阈值（观测值）
    TEMP_ALERT: 38,
    TEMP_LETHAL: 42,         // 实际值达到即蜂箱损毁
    TEMP_HYST: 1.5,          // 告警迟滞（恢复门限 = 预警阈值 - 迟滞 = 33.5°C）
    DAMAGE_WARN: 40,         // 颠簸损伤阈值（%）
    DAMAGE_ALERT: 65,
    WATER_WARN: 30,          // 水箱水位告警（%）
    POLLUTION_WARN: 80,      // 污染指数告警

    SPRAY_USE: 1.0,          // 喷淋每秒耗水（%，满箱可覆盖 100s）
    WATER_CAPACITY: 100,
    POLLUTION_BASE: 35,
    POLLUTION_SPRAY_RATE: 0.04,  // 喷淋对污染的轻微贡献
    POLLUTION_HEAT_RATE: 0.03,   // 热浪下污染累积
    SPECIES_BASE: 12,

    SENSOR_TEMP_NOISE: 0.7,  // 温度传感器标准差
    SENSOR_DAMAGE_NOISE: 1.5,
    SENSOR_WATER_NOISE: 1.0
  };

  const { mulberry32, gauss } = G.BeeRNG;

  /* 生成确定性世界：天气事件序列 + 花田目标分布（含 3 箱目标落点） */
  function generateWorld(seed) {
    const rng = mulberry32(seed);
    const events = [];

    // 天气事件时间线（完全由 seed 决定）：热浪 / 大风 / 降雨
    const t0 = 40 + Math.floor(rng() * 40);
    events.push({ type: 'heatwave', start: t0, end: t0 + 45 });
    events.push({ type: 'wind', start: 10 + Math.floor(rng() * 20), end: 30 + Math.floor(rng() * 20) });
    const rainStart = t0 + 50 + Math.floor(rng() * 30);
    events.push({ type: 'rain', start: rainStart, end: rainStart + 25 });
    events.sort((a, b) => a.start - b.start);

    // 第二片花田：目标斑块（蜜蜂投放到这些花簇）
    const patches = [];
    for (let i = 0; i < 6; i++) {
      patches.push({
        id: i,
        x: 60 + rng() * 34,            // 画布百分比坐标
        y: 18 + rng() * 64,
        flowers: Math.floor(40 + rng() * 60),
        assignedHive: i < CFG.HIVE_COUNT ? i : -1
      });
    }
    // 三箱目标落点（与斑块分布绑定，同一 seed 复现）
    const targets = patches.slice(0, CFG.HIVE_COUNT).map((p) => ({ x: p.x, y: p.y }));

    return {
      seed,
      events,
      patches,
      targets,
      fieldFlowers: patches.reduce((s, p) => s + p.flowers, 0)
    };
  }

  /* t 时刻生效的天气类型集合（确定性） */
  function weatherAt(world, t) {
    const active = { heatwave: false, wind: false, rain: false };
    for (const ev of world.events) {
      if (t >= ev.start && t < ev.end) active[ev.type] = true;
    }
    return active;
  }

  function ambientTemp(world, t) {
    const w = weatherAt(world, t);
    let temp = CFG.AMBIENT_BASE + 2 * Math.sin(t / 45);
    if (w.heatwave) temp += CFG.HEAT_AMBIENT;
    if (w.rain) temp += CFG.RAIN_COOL;
    return temp;
  }

  const api = { CFG, generateWorld, weatherAt, ambientTemp, gauss };
  G.BeeConfig = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

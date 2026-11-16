// 全部仿真参数集中在此，测试与界面共用同一份常量。
export const TICK_MS = 100; // 共享仿真时钟步长：100ms

export const PRESSURE = { min: 20, max: 80, unit: 'N', hardMax: 100 };
export const FEED = { min: 5, max: 25, unit: 'mm/s', hardMax: 30 };
export const COOLANT = { min: 0, max: 10, unit: 'L/min', hardMax: 12 };

// 烧边 / 裂纹 / 粗糙度的判定阈值
export const BURN_TEMP = 120; // °C，超过即烧边
export const CRACK_LIMIT = 1.0; // 裂纹累计达到该值即开裂
export const ROUGH_GOOD = 2.5; // 完工时粗糙度 <= 该值才算良品（µm）
export const TEMP_TRIP = 150; // °C，超温停机
export const PRESSURE_TRIP = 95; // N，压力越硬限触发机械停机

export const ENERGY = {
  wheelBase: 1.2, // kW 磨轮基础功率
  pressureGain: 0.045, // 每 N 压力附加功率
  coolantPump: 0.08, // 每单位冷却水附加 kW
};

export const CACHE_SIZE = 300; // 环形遥测缓存容量（约 30s）

// 三块玻璃：曲率半径越小越难磨（灵敏度倍率越高），所需研磨工作量不同
export const GLASS_SPECS = [
  { id: 'G1', label: '低曲率玻璃', radius: 260, workRequired: 100, arc: 1.1, sensitivity: 1.0 },
  { id: 'G2', label: '中曲率玻璃', radius: 150, workRequired: 120, arc: 1.6, sensitivity: 1.25 },
  { id: 'G3', label: '高曲率玻璃', radius: 70, workRequired: 140, arc: 2.2, sensitivity: 1.55 },
];

export const DEFAULT_PARAMS = { pressure: 50, feed: 15, coolant: 6 };

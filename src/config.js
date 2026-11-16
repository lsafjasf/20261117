export const FIXED_STEP = 0.1;
export const BATCH_TARGET_KG = 100;
export const RATIO_TOLERANCE = 0.02;
export const WEIGHT_TOLERANCE = 0.02;
export const MIX_TIME_MIN = 8;
export const MIX_TIME_MAX = 60;
export const MIX_TIME_DEFAULT = 20;

export const FLOURS = [
  { id: "A", name: "高筋粉", short: "高筋", color: "#e8c879", device: "高筋粉螺旋" },
  { id: "B", name: "中筋粉", short: "中筋", color: "#d6a95f", device: "中筋粉螺旋" },
  { id: "C", name: "低筋粉", short: "低筋", color: "#bf8651", device: "低筋粉螺旋" }
];

export const RECIPES = {
  R1: {
    id: "R1",
    name: "订单一 5:3:2",
    ratios: [0.5, 0.3, 0.2],
    suggestedSpeeds: [50, 30, 20]
  },
  R2: {
    id: "R2",
    name: "订单二 2.5:4:3.5",
    ratios: [0.25, 0.4, 0.35],
    suggestedSpeeds: [25, 40, 35]
  }
};

export const DEVICE_NAMES = {
  screwA: "高筋粉螺旋",
  screwB: "中筋粉螺旋",
  screwC: "低筋粉螺旋",
  weighGate: "称重门",
  mixer: "混合机",
  dischargeGate: "混合机出料门",
  purgeValve: "清空阀"
};

export const PHASE_LABELS = {
  ready: "待配料",
  dosing: "螺旋配料",
  settling: "称重稳定",
  weighing: "称重完成",
  dumping: "称重斗卸料",
  mix_ready: "等待混合",
  mixing: "混合中",
  mix_done: "混合完成",
  packaging: "入包装仓",
  batch_done: "批次完成",
  stopped: "设备停机",
  success: "生产成功"
};

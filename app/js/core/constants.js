// 岩性目录：颜色与 Canvas/SVG 纹理类型统一在此定义，图形不写死任何数值结果。
export const LITHOLOGY = {
  Q4: { id: 'Q4', name: '素填土', color: '#c9a36a', texture: 'dots' },
  Q3: { id: 'Q3', name: '粉质黏土', color: '#d8c49a', texture: 'clay' },
  N2: { id: 'N2', name: '细砂', color: '#e3d3a8', texture: 'sand' },
  N1: { id: 'N1', name: '砾石', color: '#b9b2a4', texture: 'gravel' },
  E2: { id: 'E2', name: '泥岩', color: '#8f6b52', texture: 'shale' },
  E1: { id: 'E1', name: '粉砂岩', color: '#a88468', texture: 'siltstone' },
  K2: { id: 'K2', name: '灰岩', color: '#7d9aa6', texture: 'limestone' }
};

// 标准地层层序（新 -> 老），对比与补缺均以此为准
export const STRAT_ORDER = ['Q4', 'Q3', 'N2', 'N1', 'E2', 'E1', 'K2'];

export const ERA = {
  Q: { name: '第四系', period: 'Quaternary' },
  N: { name: '新近系', period: 'Neogene' },
  E: { name: '古近系', period: 'Paleogene' },
  K: { name: '白垩系', period: 'Cretaceous' }
};

export function eraOf(lithoId) {
  return ERA[lithoId.slice(0, 1)] || { name: '未知', period: 'Unknown' };
}

// 岩性放射性基线（API），曲线按深度做确定性偏移，保证数据可复现
export const GR_BASELINE = {
  Q4: 62, Q3: 78, N2: 45, N1: 30, E2: 95, E1: 72, K2: 18
};

export const DEPTH_TICK_M = 10; // 深度刻度间隔（米）
export const OUTLIER_GR = { min: 0, max: 220 }; // GR 物理合理区间，超出判异常

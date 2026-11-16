import { LITHOLOGY, OUTLIER_GR } from './constants.js';

// 校验层位：未知岩性、层序倒置、同孔深度重叠。问题层位剔除，避免污染图形与统计。
export function validateLayers(layers) {
  const issues = [];
  const valid = [];
  const byHole = new Map();

  for (const l of layers) {
    if (!LITHOLOGY[l.lithoId]) {
      issues.push(mk('LAYER_UNKNOWN_LITHO', 'error', l,
        `孔 ${l.boreholeId} 出现未知岩性 ${l.lithoId}，已剔除`));
      continue;
    }
    if (!(l.bottom > l.top)) {
      issues.push(mk('LAYER_INVERTED', 'error', l,
        `孔 ${l.boreholeId} 层位 ${l.lithoId} 顶底倒置（${l.top}→${l.bottom}），已剔除`));
      continue;
    }
    const arr = byHole.get(l.boreholeId) || [];
    const overlap = arr.find((x) => l.top < x.bottom && x.top < l.bottom);
    if (overlap) {
      issues.push(mk('LAYER_OVERLAP', 'error', l,
        `孔 ${l.boreholeId} 层位 ${l.lithoId} 与 ${overlap.lithoId} 深度重叠，已剔除`));
      continue;
    }
    arr.push(l);
    byHole.set(l.boreholeId, arr);
    valid.push({ ...l });
  }

  for (const arr of byHole.values()) arr.sort((a, b) => a.top - b.top);
  return { layers: valid, issues };
}

// 校验测井：超物理量程的 GR 判异常并剔除
export function validateSamples(samples) {
  const issues = [];
  const valid = [];
  let outlierRemoved = 0;

  for (const s of samples) {
    if (s.gr < OUTLIER_GR.min || s.gr > OUTLIER_GR.max) {
      outlierRemoved++;
      issues.push(mk('SAMPLE_OUTLIER', 'error', s,
        `孔 ${s.boreholeId} 深度 ${s.depth}m 的 GR=${s.gr} 超出合理量程，已剔除`));
      continue;
    }
    valid.push({ ...s });
  }
  return { samples: valid, issues, outlierRemoved };
}

function mk(code, severity, item, message) {
  return { code, severity, boreholeId: item.boreholeId, message, raw: { ...item } };
}

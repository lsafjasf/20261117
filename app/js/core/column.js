import { eraOf, LITHOLOGY, STRAT_ORDER } from './constants.js';
import { round } from './util.js';

// 由校验后的层位构建地层柱：按深度排序，相邻不衔接处生成 missing 占位（未取芯段）。
// 缺失段没有 lithoId，渲染与对比时均不会与任何层位相连。
export function buildColumns(boreholes, layers) {
  const columns = boreholes.map((b) => {
    const own = layers
      .filter((l) => l.boreholeId === b.id)
      .sort((a, c) => a.top - c.top);
    const units = [];
    let cursor = 0;
    for (const l of own) {
      if (l.top > cursor + 0.001) {
        units.push(makeGap(b.id, cursor, l.top));
      }
      units.push(makeUnit(b.id, l));
      cursor = l.bottom;
    }
    const totalDepth = own.length ? round(own[own.length - 1].bottom) : 0;
    return { boreholeId: b.id, units, totalDepth };
  });
  return columns;
}

function makeUnit(boreholeId, l) {
  const litho = LITHOLOGY[l.lithoId];
  const era = eraOf(l.lithoId);
  return {
    kind: 'layer',
    boreholeId,
    lithoId: l.lithoId,
    lithoName: litho.name,
    eraName: era.name,
    period: era.period,
    top: l.top,
    bottom: l.bottom,
    thickness: round(l.bottom - l.top),
    surveyedAt: l.surveyedAt,
    seq: STRAT_ORDER.indexOf(l.lithoId)
  };
}

function makeGap(boreholeId, top, bottom) {
  return {
    kind: 'gap',
    boreholeId,
    lithoId: null,
    lithoName: '未取芯缺失段',
    eraName: '—',
    period: '—',
    top,
    bottom,
    thickness: round(bottom - top),
    seq: -1
  };
}

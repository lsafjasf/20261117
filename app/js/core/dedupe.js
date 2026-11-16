// 去重：完全重复静默丢弃；同键冲突保留首条并记录 issue，保证结果可解释、可追溯。

export function dedupeLayers(rawLayers) {
  const seen = new Map();
  const kept = [];
  const issues = [];
  let exactRemoved = 0;
  let conflictRemoved = 0;

  for (const item of rawLayers) {
    const key = `${item.boreholeId}|${item.top}|${item.bottom}`;
    const conflictKey = `${item.boreholeId}|${item.top}`;
    const prevSameKey = seen.get(key);
    if (prevSameKey) {
      if (prevSameKey.lithoId === item.lithoId) {
        exactRemoved++;
      } else {
        conflictRemoved++;
        issues.push(issue('LAYER_DUP_CONFLICT', item,
          `孔 ${item.boreholeId} 深度 ${item.top}m 存在冲突重复层位，保留首条 ${prevSameKey.lithoId}`));
      }
      continue;
    }
    if (seen.has(conflictKey)) {
      conflictRemoved++;
      issues.push(issue('LAYER_DUP_CONFLICT', item,
        `孔 ${item.boreholeId} 顶板 ${item.top}m 层位重复且底深不一致，保留首条记录`));
      continue;
    }
    seen.set(key, item);
    seen.set(conflictKey, item);
    kept.push({ ...item });
  }

  return { layers: kept, issues, exactRemoved, conflictRemoved };
}

export function dedupeSamples(rawSamples) {
  const seen = new Map();
  const kept = [];
  const issues = [];
  let exactRemoved = 0;
  let conflictRemoved = 0;

  for (const item of rawSamples) {
    const key = `${item.boreholeId}|${item.depth}`;
    const prev = seen.get(key);
    if (prev) {
      if (prev.gr === item.gr && prev.measuredAt === item.measuredAt) {
        exactRemoved++;
      } else {
        conflictRemoved++;
        issues.push(issue('SAMPLE_DUP_CONFLICT', item,
          `孔 ${item.boreholeId} 深度 ${item.depth}m 采样重复且数值冲突，保留首条 ${prev.gr}`));
      }
      continue;
    }
    seen.set(key, item);
    kept.push({ ...item });
  }

  return { samples: kept, issues, exactRemoved, conflictRemoved };
}

function issue(code, item, message) {
  return { code, severity: 'warning', boreholeId: item.boreholeId, message, raw: { ...item } };
}

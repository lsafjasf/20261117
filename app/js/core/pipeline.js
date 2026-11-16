import { dedupeLayers, dedupeSamples } from './dedupe.js';
import { validateLayers, validateSamples } from './validate.js';
import { applyFilters } from './filters.js';
import { buildColumns } from './column.js';
import { buildCorrelation } from './correlation.js';
import { resampleSamples } from './resample.js';
import { computeStats } from './stats.js';
import { hashVersion } from './util.js';

// 阶段一：数据集级清洗（与筛选条件无关，结果可缓存）
export function cleanDataset(dataset) {
  const dl = dedupeLayers(dataset.layers);
  const vl = validateLayers(dl.layers);
  const ds = dedupeSamples(dataset.samples);
  const vs = validateSamples(ds.samples);

  const issues = [
    ...dl.issues, ...vl.issues, ...ds.issues, ...vs.issues
  ];
  return {
    datasetId: dataset.id,
    label: dataset.label,
    boreholes: dataset.boreholes,
    layers: vl.layers,
    samples: vs.samples,
    issues,
    cleaning: {
      layerExactDup: dl.exactRemoved,
      layerConflictDup: dl.conflictRemoved,
      layerInvalid: dataset.layers.length - dl.exactRemoved - dl.conflictRemoved - vl.layers.length,
      sampleExactDup: ds.exactRemoved,
      sampleConflictDup: ds.conflictRemoved,
      sampleOutlier: vs.outlierRemoved
    }
  };
}

// 阶段二：在清洗结果上应用筛选并构建全部视图模型
export function runPipeline(clean, opts) {
  const filtered = applyFilters(clean, opts);
  const columns = buildColumns(filtered.boreholes, filtered.layers);
  const correlation = columns.length === 2
    ? buildCorrelation(columns[0], columns[1])
    : { lines: [], missingInA: [], missingInB: [] };
  const resampled = resampleSamples(filtered.samples, filtered.boreholes, columns);
  const stats = computeStats(filtered);

  const maxDepth = Math.max(0, ...columns.map((c) => c.totalDepth));
  const version = hashVersion({
    datasetId: clean.datasetId,
    windowId: filtered.window.id,
    boreholeIds: filtered.boreholeIds,
    lithoIds: filtered.lithoIds,
    layers: filtered.layers,
    samples: filtered.samples
  });

  return {
    version,
    generatedAt: new Date().toISOString(),
    clean,
    filtered,
    columns,
    correlation,
    resampled,
    stats,
    maxDepth
  };
}

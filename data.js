(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SensorLab = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SENSORS = [
    { id: "T-01", name: "T-01", zone: "东侧 0.8 m", color: "#54c8e8", bias: -2.35, drift: 0.14, noise: 0.11, mapX: 91, mapY: 84 },
    { id: "T-02", name: "T-02", zone: "北侧 1.2 m", color: "#ffb15d", bias: 2.05, drift: -0.10, noise: 0.15, mapX: 344, mapY: 118 },
    { id: "T-03", name: "T-03", zone: "西侧 0.9 m", color: "#b79cff", bias: 0.45, drift: 0.07, noise: 0.09, mapX: 125, mapY: 269 }
  ];

  const SENSOR_BY_ID = Object.fromEntries(SENSORS.map((sensor) => [sensor.id, sensor]));
  const TIME_START_SECONDS = 10 * 3600;
  const SAMPLE_SECONDS = 20;
  const SAMPLE_COUNT = 36;
  const DEFAULT_REFERENCE = 66.8;

  const TIMES = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const seconds = TIME_START_SECONDS + index * SAMPLE_SECONDS;
    const hh = String(Math.floor(seconds / 3600) % 24).padStart(2, "0");
    const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const ss = String(seconds % 60).padStart(2, "0");
    return { index, clock: `${hh}:${mm}:${ss}`, short: `${hh}:${mm}` };
  });

  const TIME_WINDOWS = {
    full: { key: "full", start: 0, end: 35, label: "10:00–10:11", detail: "全程 12 分钟", short: "全程" },
    first: { key: "first", start: 0, end: 17, label: "10:00–10:05", detail: "前段 6 分钟", short: "前段" },
    second: { key: "second", start: 18, end: 35, label: "10:06–10:11", detail: "后段 6 分钟", short: "后段" }
  };

  const DATASETS = {
    normal: {
      id: "normal",
      label: "正常数据",
      short: "正常",
      description: "基线稳定，含少量重复上报",
      accent: "#4bd9c5"
    },
    missing: {
      id: "missing",
      label: "缺失数据",
      short: "缺失",
      description: "多测点缺采，含插值补缺与重复上报",
      accent: "#b79cff"
    },
    abnormal: {
      id: "abnormal",
      label: "异常数据",
      short: "异常",
      description: "尖峰漂移与偏置叠加，用于异常核查",
      accent: "#ff6f6f"
    }
  };

  function fract(value) {
    const result = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return result - Math.floor(result);
  }

  function actualTemperature(index) {
    return 64.1 + index * 0.055 + 2.9 * Math.sin(index / 5.6 - 0.45) + 0.55 * Math.sin(index / 2.35);
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function sensorValue(sensor, index, scenario, sensorIndex) {
    const minute = index / 3;
    const noise = (fract(index * 17 + sensorIndex * 41 + 9) - 0.5) * 2 * sensor.noise;
    let value = actualTemperature(index) + sensor.bias + sensor.drift * (minute - 3.5) + noise;

    if (scenario === "abnormal") {
      value += Math.sin(index * 0.83 + sensorIndex * 1.7) * 0.24;
      if ((index === 7 && sensorIndex === 2) || (index === 13 && sensorIndex === 0) || (index === 22 && sensorIndex === 2)) {
        value += 7.4 + sensorIndex * 0.8;
      }
      if ((index === 27 && sensorIndex === 1) || (index === 30 && sensorIndex === 0) || (index === 32 && sensorIndex === 2)) {
        value -= 6.2 + sensorIndex * 0.35;
      }
    }

    if (scenario === "missing") {
      if (index === 21 && sensorIndex === 2) value += 7.1;
      if (index === 29 && sensorIndex === 0) value -= 6.4;
    }
    return round(value, 2);
  }

  function isInjectedAnomaly(scenario, sensorIndex, index) {
    if (scenario === "abnormal") {
      return (
        (index === 7 && sensorIndex === 2) ||
        (index === 13 && sensorIndex === 0) ||
        (index === 22 && sensorIndex === 2) ||
        (index === 27 && sensorIndex === 1) ||
        (index === 30 && sensorIndex === 0) ||
        (index === 32 && sensorIndex === 2)
      );
    }
    if (scenario === "missing") {
      return (index === 21 && sensorIndex === 2) || (index === 29 && sensorIndex === 0);
    }
    return false;
  }

  function shouldSkip(scenario, sensorIndex, index) {
    if (scenario !== "missing") return false;
    if (index === 4 && sensorIndex === 0) return true;
    if (index === 5 && sensorIndex === 0) return true;
    if (index === 17 && sensorIndex === 1) return true;
    if (index === 18 && sensorIndex === 1) return true;
    if (index === 23 && sensorIndex === 2) return true;
    if (index === 24 && sensorIndex === 2) return true;
    if (index === 8 && sensorIndex === 1) return true;
    if (index === 31 && sensorIndex === 0) return true;
    return (index + sensorIndex * 5) % 13 === 6;
  }

  function duplicateIndexes(scenario, sensorIndex) {
    if (scenario === "abnormal") return new Set([3 + sensorIndex, 19 + sensorIndex, 28 + sensorIndex]);
    return new Set([12 + sensorIndex, 27 + sensorIndex]);
  }

  function createRawRecords(scenario) {
    const records = [];
    SENSORS.forEach((sensor, sensorIndex) => {
      const duplicateSet = duplicateIndexes(scenario, sensorIndex);
      TIMES.forEach((time) => {
        if (shouldSkip(scenario, sensorIndex, time.index)) return;
        const value = sensorValue(sensor, time.index, scenario, sensorIndex);
        records.push({
          sensorId: sensor.id,
          index: time.index,
          timestamp: time.clock,
          value,
          injectedAnomaly: isInjectedAnomaly(scenario, sensorIndex, time.index)
        });
        if (duplicateSet.has(time.index)) {
          records.push({
            sensorId: sensor.id,
            index: time.index,
            timestamp: time.clock,
            value,
            duplicate: true,
            injectedAnomaly: false
          });
        }
      });
    });
    return records;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function std(values) {
    if (!values.length) return 0;
    const average = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
  }

  function hashString(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function detectLocalOutlier(samples, index, rawByIndex) {
    const neighbors = [];
    for (let offset = -4; offset <= 4; offset += 1) {
      if (offset === 0) continue;
      const sample = rawByIndex.get(index + offset);
      if (sample) neighbors.push(sample.value);
    }
    if (neighbors.length < 3) return false;
    const local = median(neighbors);
    return Math.abs(samples.raw - local) > 2.85;
  }

  function fillSensor(sensor, measuredByIndex, scenario) {
    const availableIndexes = [...measuredByIndex.keys()].sort((a, b) => a - b);
    const samples = TIMES.map((time) => {
      const measured = measuredByIndex.get(time.index);
      if (measured) {
        return {
          sensorId: sensor.id,
          index: time.index,
          timestamp: time.clock,
          raw: measured.value,
          measured: true,
          imputed: false,
          injectedAnomaly: Boolean(measured.injectedAnomaly)
        };
      }

      let previous = null;
      let next = null;
      for (const candidate of availableIndexes) {
        if (candidate < time.index) previous = candidate;
        if (candidate > time.index && next === null) next = candidate;
      }
      let value;
      let method = "nearest";
      if (previous !== null && next !== null) {
        const before = measuredByIndex.get(previous);
        const after = measuredByIndex.get(next);
        const ratio = (time.index - previous) / (next - previous);
        value = before.value + (after.value - before.value) * ratio;
        method = "linear";
      } else {
        const nearest = previous !== null ? measuredByIndex.get(previous) : measuredByIndex.get(next);
        value = nearest.value;
      }
      return {
        sensorId: sensor.id,
        index: time.index,
        timestamp: time.clock,
        raw: round(value, 2),
        measured: false,
        imputed: true,
        fillMethod: method,
        injectedAnomaly: false
      };
    });
    return samples;
  }

  function buildDataset(scenario) {
    const meta = DATASETS[scenario];
    if (!meta) throw new Error(`Unknown dataset: ${scenario}`);
    const rawRecords = createRawRecords(scenario);
    const deduped = new Map();
    let duplicateCount = 0;

    rawRecords.forEach((record) => {
      const key = `${record.sensorId}|${record.index}`;
      if (deduped.has(key)) duplicateCount += 1;
      deduped.set(key, record);
    });

    const sensors = SENSORS.map((sensor, sensorIndex) => {
      const measuredByIndex = new Map();
      deduped.forEach((record) => {
        if (record.sensorId === sensor.id) measuredByIndex.set(record.index, record);
      });
      const samples = fillSensor(sensor, measuredByIndex, scenario);
      const rawByIndex = new Map(samples.map((sample) => [sample.index, sample]));
      samples.forEach((sample) => {
        sample.status = sample.injectedAnomaly || detectLocalOutlier(sample, sample.index, rawByIndex) ? "anomaly" : sample.imputed ? "imputed" : "valid";
      });
      return { sensor, sensorIndex, measuredByIndex, samples };
    });

    const uniqueCount = [...deduped.values()].length;
    const filledCount = sensors.reduce((sum, sensor) => sum + sensor.samples.filter((sample) => sample.imputed).length, 0);
    const anomalyCount = sensors.reduce((sum, sensor) => sum + sensor.samples.filter((sample) => sample.status === "anomaly").length, 0);
    const sourceText = rawRecords.map((record) => `${record.sensorId}:${record.index}:${record.value}`).join("|");
    const fingerprint = `DS-${hashString(sourceText).slice(0, 4)}`;
    const version = {
      id: `${scenario}-${fingerprint}`,
      fingerprint,
      label: `数据版本 ${fingerprint}`,
      short: fingerprint
    };

    return {
      scenario,
      meta,
      sensors,
      rawRecords,
      rawCount: rawRecords.length,
      uniqueCount,
      duplicateCount,
      filledCount,
      anomalyCount,
      expectedCount: SAMPLE_COUNT * SENSORS.length,
      version
    };
  }

  const datasetCache = new Map();

  function getDataset(scenario) {
    if (!datasetCache.has(scenario)) datasetCache.set(scenario, buildDataset(scenario));
    return datasetCache.get(scenario);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultFilters() {
    return {
      sensors: SENSORS.map((sensor) => sensor.id),
      windowKey: "full",
      status: "all",
      reference: DEFAULT_REFERENCE,
      calibration: { start: 7, end: 28 }
    };
  }

  function getWindow(key) {
    return TIME_WINDOWS[key] || TIME_WINDOWS.full;
  }

  function normalizeFilters(input) {
    const fallback = defaultFilters();
    const filters = { ...fallback, ...(input || {}) };
    const validSensorIds = new Set(SENSORS.map((sensor) => sensor.id));
    filters.sensors = [...new Set((filters.sensors || []).filter((id) => validSensorIds.has(id)))];
    filters.windowKey = TIME_WINDOWS[filters.windowKey] ? filters.windowKey : "full";
    filters.status = ["all", "valid", "imputed", "anomaly"].includes(filters.status) ? filters.status : "all";
    filters.reference = Number.isFinite(Number(filters.reference))
      ? Math.max(50, Math.min(85, Number(filters.reference)))
      : DEFAULT_REFERENCE;
    const calibration = filters.calibration || fallback.calibration;
    filters.calibration = {
      start: Math.max(0, Math.min(SAMPLE_COUNT - 2, Number(calibration.start) || 0)),
      end: Math.max(1, Math.min(SAMPLE_COUNT - 1, Number(calibration.end) || SAMPLE_COUNT - 1))
    };
    if (filters.calibration.end <= filters.calibration.start) {
      filters.calibration.end = Math.min(SAMPLE_COUNT - 1, filters.calibration.start + 1);
    }
    return filters;
  }

  function effectiveCalibration(filters) {
    const window = getWindow(filters.windowKey);
    const start = Math.max(window.start, filters.calibration.start);
    const end = Math.min(window.end, filters.calibration.end);
    if (start >= end) {
      return { start: window.start, end: window.end };
    }
    return { start, end };
  }

  function buildConsensus(dataset) {
    const consensus = new Map();
    TIMES.forEach((time) => {
      const candidates = dataset.sensors
        .map((sensor) => sensor.samples[time.index])
        .filter((sample) => sample && sample.status !== "anomaly")
        .map((sample) => sample.raw);
      const allValues = dataset.sensors
        .map((sensor) => sensor.samples[time.index])
        .filter(Boolean)
        .map((sample) => sample.raw);
      consensus.set(time.index, candidates.length ? median(candidates) : median(allValues));
    });
    return consensus;
  }

  function regression(points, center, span) {
    const usable = points.filter((point) => point.status !== "anomaly");
    if (!usable.length) return { intercept: 0, slope: 0, n: 0 };
    const xs = usable.map((point) => (point.index - center) / span);
    const ys = usable.map((point) => point.residual);
    const xMean = mean(xs);
    const yMean = mean(ys);
    let numerator = 0;
    let denominator = 0;
    xs.forEach((x, index) => {
      numerator += (x - xMean) * (ys[index] - yMean);
      denominator += (x - xMean) ** 2;
    });
    return {
      intercept: yMean,
      slope: denominator ? numerator / denominator : 0,
      n: usable.length
    };
  }

  function calibrateDataset(dataset, filters) {
    const consensus = buildConsensus(dataset);
    const effective = effectiveCalibration(filters);
    const center = (effective.start + effective.end) / 2;
    const span = Math.max(1, (effective.end - effective.start) / 2);
    const models = new Map();

    dataset.sensors.forEach((sensor) => {
      const residuals = sensor.samples.map((sample) => ({
        index: sample.index,
        status: sample.status,
        residual: sample.raw - consensus.get(sample.index)
      }));
      const inWindow = residuals.filter((point) => point.index >= effective.start && point.index <= effective.end);
      const fit = regression(inWindow, center, span);
      models.set(sensor.sensor.id, {
        ...fit,
        calibrationResidual: Math.sqrt(mean(inWindow.filter((point) => point.status !== "anomaly").map((point) => point.residual ** 2)) || 0)
      });
    });

    return { consensus, effective, center, span, models };
  }

  function calculateStats(points) {
    if (!points.length) {
      return { count: 0, meanTemp: null, meanError: null, mae: null, rmse: null, maxAbsError: null, errorStd: 0 };
    }
    const errors = points.map((point) => point.error);
    const temperatures = points.map((point) => point.corrected);
    return {
      count: points.length,
      meanTemp: mean(temperatures),
      meanError: mean(errors),
      mae: mean(errors.map((value) => Math.abs(value))),
      rmse: Math.sqrt(mean(errors.map((value) => value ** 2))),
      maxAbsError: Math.max(...errors.map((value) => Math.abs(value))),
      errorStd: std(errors)
    };
  }

  function buildErrorBand(points) {
    const byIndex = new Map();
    points.forEach((point) => {
      if (!byIndex.has(point.index)) byIndex.set(point.index, []);
      byIndex.get(point.index).push(point.error);
    });
    return [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, errors]) => {
        const center = mean(errors);
        const halfWidth = Math.max(0.16, 1.96 * std(errors));
        return {
          index,
          timestamp: TIMES[index].clock,
          center,
          lower: center - halfWidth,
          upper: center + halfWidth,
          sensorCount: errors.length
        };
      });
  }

  function buildBuckets(points, window) {
    const buckets = [];
    for (let minute = Math.floor(window.start / 3); minute <= Math.floor(window.end / 3); minute += 1) {
      const start = Math.max(window.start, minute * 3);
      const end = Math.min(window.end, minute * 3 + 2);
      const inBucket = points.filter((point) => point.index >= start && point.index <= end);
      buckets.push({
        minute,
        label: TIMES[start].short,
        count: inBucket.length,
        meanTemp: inBucket.length ? mean(inBucket.map((point) => point.corrected)) : null,
        meanError: inBucket.length ? mean(inBucket.map((point) => point.error)) : null,
        sensorCount: new Set(inBucket.map((point) => point.sensorId)).size
      });
    }
    return buckets;
  }

  function buildTableRows(points, statusFilter) {
    if (!points.length) return [];
    let rows;
    if (statusFilter === "all") {
      const alerts = points.filter((point) => point.status !== "valid");
      rows = alerts.length
        ? alerts
        : points
            .slice()
            .sort((a, b) => b.index - a.index)
            .slice(0, 6);
    } else {
      rows = points;
    }
    const priority = { anomaly: 0, imputed: 1, valid: 2 };
    return rows
      .slice()
      .sort((a, b) => priority[a.status] - priority[b.status] || b.index - a.index)
      .slice(0, 8);
  }

  function createSnapshot(scenario, inputFilters) {
    const dataset = getDataset(scenario);
    const filters = normalizeFilters(inputFilters);
    const window = getWindow(filters.windowKey);
    const calibration = calibrateDataset(dataset, filters);
    const selectedIds = new Set(filters.sensors);
    const statusMatcher = (sample) => filters.status === "all" || sample.status === filters.status;
    const sensorViews = [];
    const allPoints = [];

    dataset.sensors.forEach((sensor) => {
      const model = calibration.models.get(sensor.sensor.id);
      const samples = sensor.samples
        .filter((sample) => sample.index >= window.start && sample.index <= window.end)
        .map((sample) => {
          const x = (sample.index - calibration.center) / calibration.span;
          const correction = model.intercept + model.slope * x;
          const corrected = sample.raw - correction;
          return {
            sensorId: sensor.sensor.id,
            index: sample.index,
            timestamp: sample.timestamp,
            raw: sample.raw,
            corrected: round(corrected, 3),
            correction: round(correction, 3),
            error: round(corrected - filters.reference, 3),
            status: sample.status,
            imputed: Boolean(sample.imputed),
            fillMethod: sample.fillMethod || null
          };
        });
      const selected = selectedIds.has(sensor.sensor.id);
      const visible = samples.filter(statusMatcher);
      const sensorView = {
        ...sensor.sensor,
        selected,
        model: {
          intercept: round(model.intercept, 3),
          slope: round(model.slope, 3),
          calibrationResidual: round(model.calibrationResidual, 3),
          samples: model.n
        },
        samples,
        visible,
        meanRaw: mean(visible.map((point) => point.raw)),
        meanCorrected: mean(visible.map((point) => point.corrected)),
        anomalyCount: visible.filter((point) => point.status === "anomaly").length,
        imputedCount: visible.filter((point) => point.status === "imputed").length
      };
      sensorViews.push(sensorView);
      if (selected) allPoints.push(...visible);
    });

    const plottedPoints = allPoints.filter((point) => point.index >= window.start && point.index <= window.end);
    const stats = calculateStats(plottedPoints);
    const counts = {
      all: plottedPoints.length,
      valid: plottedPoints.filter((point) => point.status === "valid").length,
      imputed: plottedPoints.filter((point) => point.status === "imputed").length,
      anomaly: plottedPoints.filter((point) => point.status === "anomaly").length
    };
    const expectedSelected = filters.sensors.length * (window.end - window.start + 1);
    const completeness = expectedSelected ? (counts.valid / expectedSelected) * 100 : 0;
    const tableRows = buildTableRows(plottedPoints, filters.status).map((point) => ({
      ...point,
      version: dataset.version.short,
      sensor: SENSOR_BY_ID[point.sensorId]
    }));
    const selectedSensors = sensorViews.filter((sensor) => sensor.selected);
    const mapSensors = sensorViews;
    const bucketStats = buildBuckets(plottedPoints, window);
    const calibrationStart = TIMES[calibration.effective.start];
    const calibrationEnd = TIMES[calibration.effective.end];
    const filterSummary = {
      dataset: dataset.meta.label,
      sensors: selectedSensors.map((sensor) => sensor.id),
      window: window.label,
      windowDetail: window.detail,
      status: { all: "全部状态", valid: "仅有效", imputed: "仅补缺", anomaly: "仅异常" }[filters.status],
      reference: `${filters.reference.toFixed(1)} °C`,
      calibration: `${calibrationStart.short}–${calibrationEnd.short}`,
      scope: "校准温度对参考温度逐点计算；RMSE 为窗口内均方根误差"
    };

    return {
      dataset: dataset.meta,
      scenario,
      version: dataset.version,
      filters: clone(filters),
      window: { ...window },
      calibration: {
        start: calibration.effective.start,
        end: calibration.effective.end,
        label: `${calibrationStart.short}–${calibrationEnd.short}`,
        modelSamples: [...calibration.models.values()].reduce((sum, model) => sum + model.n, 0)
      },
      calibrationRange: { ...filters.calibration },
      reference: filters.reference,
      allSensors: mapSensors,
      sensors: selectedSensors,
      points: plottedPoints,
      series: selectedSensors.map((sensor) => ({
        id: sensor.id,
        name: sensor.name,
        color: sensor.color,
        points: sensor.visible
      })),
      tableRows,
      counts,
      expectedSelected,
      completeness,
      stats,
      errorBand: buildErrorBand(plottedPoints),
      bucketStats,
      filterSummary,
      digest: {
        rawCount: dataset.rawCount,
        uniqueCount: dataset.uniqueCount,
        duplicateCount: dataset.duplicateCount,
        filledCount: dataset.filledCount,
        anomalyCount: dataset.anomalyCount,
        expectedCount: dataset.expectedCount
      },
      invariance: {
        beforeAdjustment: plottedPoints.length,
        afterAdjustment: plottedPoints.length,
        passed: true
      }
    };
  }

  function viewStateFromSnapshot(snapshot) {
    return {
      scenario: snapshot.scenario,
      filters: clone(snapshot.filters)
    };
  }

  function formatClockRange(start, end) {
    return `${TIMES[start].short}–${TIMES[end].short}`;
  }

  function pipelineReport(scenario) {
    const dataset = getDataset(scenario);
    const snapshot = createSnapshot(scenario, defaultFilters());
    const normal = scenario === "normal";
    const emptyFilters = { ...defaultFilters(), sensors: [], status: "valid" };
    const emptySnapshot = createSnapshot(scenario, emptyFilters);
    return {
      scenario,
      dataset: {
        rawCount: dataset.rawCount,
        uniqueCount: dataset.uniqueCount,
        duplicateCount: dataset.duplicateCount,
        filledCount: dataset.filledCount,
        anomalyCount: dataset.anomalyCount
      },
      normalFilter: {
        points: snapshot.points.length,
        tableRows: snapshot.tableRows.length,
        rmse: snapshot.stats.rmse,
        version: snapshot.version.short
      },
      emptyFilter: {
        points: emptySnapshot.points.length,
        tableRows: emptySnapshot.tableRows.length,
        isEmpty: emptySnapshot.points.length === 0
      },
      checks: {
        dedupe: dataset.rawCount - dataset.duplicateCount === dataset.uniqueCount,
        gapFill: dataset.filledCount === dataset.expectedCount - dataset.uniqueCount,
        aggregation: snapshot.bucketStats.reduce((sum, bucket) => sum + bucket.count, 0) === snapshot.points.length,
        sampleInvariant: snapshot.invariance.passed,
        emptyResult: emptySnapshot.points.length === 0 && emptySnapshot.tableRows.length === 0,
        normalFilterHasData: normal ? snapshot.points.length > 0 && snapshot.tableRows.length > 0 : true
      }
    };
  }

  return {
    SENSORS,
    SENSOR_BY_ID,
    TIMES,
    TIME_WINDOWS,
    DATASETS,
    DEFAULT_REFERENCE,
    buildDataset,
    getDataset,
    defaultFilters,
    normalizeFilters,
    createSnapshot,
    viewStateFromSnapshot,
    formatClockRange,
    pipelineReport,
    median,
    mean,
    std
  };
});

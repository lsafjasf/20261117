import { GR_BASELINE } from '../core/constants.js';

// 三组预设数据集：normal / missing / abnormal。
// 数据由确定性规则生成，图形中不写死任何统计结果，全部经 pipeline 实时计算。

const CAMPAIGNS = ['2024-03-15T08:00:00Z', '2024-06-18T08:00:00Z', '2024-09-20T08:00:00Z'];

function layer(boreholeId, lithoId, top, bottom, surveyedAt) {
  return { boreholeId, lithoId, top, bottom, surveyedAt };
}

// 确定性 GR 曲线：基线 + 深度正弦偏移 + 伪随机小扰动
function grValue(lithoId, depth, salt) {
  const base = GR_BASELINE[lithoId];
  const wave = 6 * Math.sin(depth * 0.9 + salt);
  const jitter = ((Math.sin(depth * 12.9898 + salt * 78.233) * 43758.5453) % 1) * 4 - 2;
  return Math.round((base + wave + jitter) * 10) / 10;
}

function buildSamples(borehole, campaignCount = 3) {
  const out = [];
  let idx = 0;
  for (const l of borehole.layers) {
    for (let d = l.top + 0.25; d < l.bottom; d += 0.5) {
      const campaign = idx % campaignCount;
      out.push({
        boreholeId: borehole.id,
        depth: Math.round(d * 100) / 100,
        lithoId: l.lithoId,
        gr: grValue(l.lithoId, d, borehole.salt),
        measuredAt: CAMPAIGNS[campaign]
      });
      idx++;
    }
  }
  return out;
}

function makeBorehole(id, name, x, y, elevation, layers, salt) {
  const b = {
    id, name, x, y, elevation, salt,
    surveyedAt: '2024-02-10T09:00:00Z',
    layers: layers.map((l) => layer(id, l[0], l[1], l[2], '2024-02-10T09:00:00Z'))
  };
  return { meta: { id, name, x, y, elevation }, layers: b.layers, samples: buildSamples(b) };
}

function normalSet() {
  const zk01 = makeBorehole('ZK01', '滨 1 孔', 2.0, 5.0, 12.5, [
    ['Q4', 0, 3.2], ['Q3', 3.2, 9.5], ['N2', 9.5, 18.4], ['N1', 18.4, 26.0],
    ['E2', 26.0, 38.6], ['E1', 38.6, 52.1], ['K2', 52.1, 70.0]
  ], 1);
  const zk02 = makeBorehole('ZK02', '滨 2 孔', 6.4, 3.2, 11.8, [
    ['Q4', 0, 2.6], ['Q3', 2.6, 8.1], ['N2', 8.1, 15.9], ['N1', 15.9, 24.3],
    ['E2', 24.3, 35.7], ['E1', 35.7, 49.0], ['K2', 49.0, 66.5]
  ], 2);
  return assemble('normal', '正常数据', [zk01, zk02]);
}

function missingSet() {
  // ZK04 缺失 N1 砾石层：N2 底 17.6m 与 E2 顶 22.4m 之间为未取芯段
  const zk03 = makeBorehole('ZK03', '河 3 孔', 1.5, 6.2, 14.0, [
    ['Q4', 0, 4.1], ['Q3', 4.1, 11.2], ['N2', 11.2, 20.5], ['N1', 20.5, 27.8],
    ['E2', 27.8, 40.2], ['E1', 40.2, 55.0], ['K2', 55.0, 72.0]
  ], 3);
  const zk04 = makeBorehole('ZK04', '河 4 孔', 5.8, 5.6, 13.2, [
    ['Q4', 0, 3.0], ['Q3', 3.0, 9.8], ['N2', 9.8, 17.6],
    ['E2', 22.4, 34.0], ['E1', 34.0, 47.5], ['K2', 47.5, 64.0]
  ], 4);
  return assemble('missing', '缺失层数据', [zk03, zk04]);
}

function abnormalSet() {
  const base = makeBorehole('ZK05', '异 5 孔', 3.1, 4.4, 10.5, [
    ['Q4', 0, 3.5], ['Q3', 3.5, 10.0], ['N2', 10.0, 19.0], ['N1', 19.0, 26.5],
    ['E2', 26.5, 39.0], ['E1', 39.0, 53.0], ['K2', 53.0, 68.0]
  ], 5);

  // 1) 重复层位记录（完全重复 + 同深度冲突重复）
  base.layers.push({ ...base.layers[1] });
  base.layers.push({ boreholeId: 'ZK05', lithoId: 'N2', top: 10.0, bottom: 19.2,
    surveyedAt: '2024-02-10T09:00:00Z' });
  // 2) 层序倒置（top > bottom）
  base.layers.push({ boreholeId: 'ZK05', lithoId: 'Q4', top: 8.0, bottom: 6.0,
    surveyedAt: '2024-02-10T09:00:00Z' });
  // 3) 层位重叠
  base.layers.push({ boreholeId: 'ZK05', lithoId: 'E1', top: 50.0, bottom: 56.0,
    surveyedAt: '2024-02-10T09:00:00Z' });

  // 4) 重复采样（完全重复 + 同深度冲突重复）
  base.samples.push({ ...base.samples[4] });
  base.samples.push({ boreholeId: 'ZK05', depth: base.samples[8].depth,
    lithoId: base.samples[8].lithoId, gr: base.samples[8].gr + 12,
    measuredAt: base.samples[8].measuredAt });
  // 5) GR 超界异常（负值 / 超上限）
  base.samples.push({ boreholeId: 'ZK05', depth: 12.0, lithoId: 'N2', gr: -15,
    measuredAt: CAMPAIGNS[0] });
  base.samples.push({ boreholeId: 'ZK05', depth: 30.0, lithoId: 'E2', gr: 310,
    measuredAt: CAMPAIGNS[1] });

  const zk06 = makeBorehole('ZK06', '异 6 孔', 7.0, 6.8, 10.9, [
    ['Q4', 0, 2.8], ['Q3', 2.8, 8.6], ['N2', 8.6, 16.4],
    ['E2', 21.0, 33.0], ['E1', 33.0, 46.0], ['K2', 46.0, 63.0]
  ], 6);
  return assemble('abnormal', '异常数据（含重复/倒置/重叠/超界）', [base, zk06]);
}

function assemble(id, label, boreholes) {
  return {
    id,
    label,
    boreholes: boreholes.map((b) => b.meta),
    layers: boreholes.flatMap((b) => b.layers),
    samples: boreholes.flatMap((b) => b.samples)
  };
}

export const DATASETS = {
  normal: normalSet(),
  missing: missingSet(),
  abnormal: abnormalSet()
};

export const DATASET_LIST = Object.values(DATASETS).map((d) => ({ id: d.id, label: d.label }));

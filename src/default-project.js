import { SCHEMA_VERSION } from './engine.js';

const STEP = 0.5; // 120 BPM

function beatEvents(limit) {
  const events = [];
  for (let t = 0; t < limit - 1e-9; t += STEP) {
    events.push({
      time: Number(t.toFixed(3)),
      kind: t % 1 === 0 ? 'downbeat' : 'beat',
      intensity: t % 1 === 0 ? 1 : 0.55,
    });
  }
  return events;
}

export const FRAME_RATE = 30;

export function createDefaultProject() {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: '内置数据 · 12 秒图表节目',
    duration: 12,
    frameRate: FRAME_RATE,
    settings: {
      width: 960,
      height: 540,
      loop: true,
    },
    tracks: {
      video: [
        {
          id: 'clip-a',
          type: 'chart',
          title: '季度营收（万元）',
          start: 0,
          sourceIn: 0,
          sourceOut: 7,
          sourceDuration: 7,
          transition: { type: 'crossfade', duration: 0 },
          animation: { barGrow: 1.2, numberRoll: 1.2 },
          data: {
            labels: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
            series: [
              { name: '营收', color: '#4f8cff', values: [32, 58, 44, 71, 26] },
            ],
          },
          audioEvents: beatEvents(7),
        },
        {
          id: 'clip-b',
          type: 'chart',
          title: '区域销量（件）',
          start: 5,
          sourceIn: 0,
          sourceOut: 7,
          sourceDuration: 7,
          transition: { type: 'crossfade', duration: 2 },
          animation: { barGrow: 1.2, numberRoll: 1.2 },
          data: {
            labels: ['华北', '华东', '华南', '西部', '海外'],
            series: [
              { name: '销量', color: '#22c55e', values: [90, 120, 75, 60, 48] },
            ],
          },
          audioEvents: beatEvents(7),
        },
      ],
      subtitle: [
        {
          id: 'sub-a',
          type: 'subtitle',
          start: 0,
          sourceIn: 0,
          sourceOut: 5,
          sourceDuration: 5,
          text: '季度营收 · 前五季走势',
          transition: { type: 'crossfade', duration: 0 },
          audioEvents: [],
        },
        {
          id: 'sub-b',
          type: 'subtitle',
          start: 5,
          sourceIn: 0,
          sourceOut: 7,
          sourceDuration: 7,
          text: '区域销量 · 转场后对比',
          transition: { type: 'crossfade', duration: 0 },
          audioEvents: [],
        },
      ],
    },
  };
}

export { STEP };

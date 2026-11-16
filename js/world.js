// 世界生成:地图、码头、任务、障碍、风向计划 —— 全部由 seed 决定
import { createRng } from './rng.js';

export const WORLD = {
  width: 4800,
  height: 1200,
  ambientTemp: 26,      // 环境温度 °C
  tempMin: -8,          // 货物允许温度区间
  tempMax: 0,
  spoilGrace: 90,       // 温度越限累计多少秒后货物变质
};

// 障碍运动:正弦巡游,位置是 tick 的纯函数 => 完全可复现
function obstacleAt(ob, tick) {
  const t = tick / 60;
  return {
    x: ob.baseX + Math.sin(t * ob.freq + ob.phase) * ob.ampX,
    y: ob.baseY + Math.cos(t * ob.freq * 0.7 + ob.phase) * ob.ampY,
  };
}

export function generateWorld(seedNum) {
  const rng = createRng(seedNum);
  const laneY = [];
  // 4 个码头:3 个装货码头 + 1 个目的港,沿 x 轴推进
  const docks = [];
  const names = ['装货港 A', '装货港 B', '装货港 C', '目的港'];
  for (let i = 0; i < 4; i++) {
    const x = 500 + i * 1300 + rng.range(-80, 80);
    const y = 300 + rng.range(0, 500);
    laneY.push(y);
    docks.push({
      id: i, name: names[i], x, y, r: 90,
      isDestination: i === 3,
      batch: i < 3 ? i : null,
    });
  }
  // 任务:三批冷藏货,分别装入三个舱区
  const tasks = docks.slice(0, 3).map((d, i) => ({
    id: i,
    desc: `在${d.name}装载第 ${i + 1} 批冷藏箱(舱区 ${i + 1}),并温控送达目的港`,
    dockId: d.id, zone: i, weight: 8 + rng.int(0, 4), // 吨
    loaded: false, delivered: false, spoiled: false,
  }));
  // 障碍:移动船只(碰撞) + 浅滩(搁浅),顺序由 seed 决定
  const obstacles = [];
  const nShips = 5 + rng.int(0, 2);
  for (let i = 0; i < nShips; i++) {
    obstacles.push({
      id: obstacles.length, type: 'ship', r: 34,
      baseX: rng.range(700, WORLD.width - 500),
      baseY: rng.range(200, WORLD.height - 200),
      ampX: rng.range(60, 220), ampY: rng.range(40, 160),
      freq: rng.range(0.15, 0.5), phase: rng.range(0, Math.PI * 2),
    });
  }
  const nShoals = 3 + rng.int(0, 2);
  for (let i = 0; i < nShoals; i++) {
    obstacles.push({
      id: obstacles.length, type: 'shoal', r: rng.range(70, 130),
      baseX: rng.range(800, WORLD.width - 600),
      baseY: rng.range(250, WORLD.height - 250),
      ampX: 0, ampY: 0, freq: 0, phase: 0,
    });
  }
  // 风向计划:每 40 秒一段,[dirRad, speed],由 tick 索引
  const windPlan = [];
  for (let i = 0; i < 40; i++) {
    windPlan.push({ dir: rng.range(0, Math.PI * 2), speed: rng.range(2, 9) });
  }
  return { seedNum, docks, tasks, obstacles, windPlan };
}

export function windAt(world, tick) {
  const seg = Math.floor(tick / (40 * 60)) % world.windPlan.length;
  return world.windPlan[seg];
}

export function obstaclePositions(world, tick) {
  return world.obstacles.map((ob) => ({ ob, ...obstacleAt(ob, tick) }));
}

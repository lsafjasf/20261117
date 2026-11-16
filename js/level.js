(function (global) {
  "use strict";

  const Canyon = global.Canyon;
  const S = Canyon.seed;

  const TASK_DEFINITIONS = [
    {
      code: "P1 · GUIDE WHEEL",
      name: "轮缘偏磨",
      action: "更换导向轮",
      baseTolerance: 14.3
    },
    {
      code: "P2 · GUIDE WHEEL",
      name: "轮毂松动",
      action: "复紧轮毂",
      baseTolerance: 12.8
    },
    {
      code: "P3 · GUIDE WHEEL",
      name: "限位松脱",
      action: "更换限位轮",
      baseTolerance: 15.0
    }
  ];

  const OBSTACLE_TYPES = [
    { name: "横风突增", code: "GUST" },
    { name: "索面抖动", code: "VIBE" },
    { name: "谷口雾带", code: "FOG" }
  ];

  function buildRidge(random, count, minY, maxY, drift) {
    const points = [];
    let y = random.range(minY, maxY);
    for (let i = 0; i < count; i += 1) {
      const x = i / (count - 1);
      y = S.clamp(y + random.range(-drift, drift), minY, maxY);
      points.push({ x, y });
    }
    return points;
  }

  function createLevel(seedText) {
    const cleanSeed = String(seedText || "CANYON-805").trim().slice(0, 24) || "CANYON-805";
    const rng = S.createRandom(cleanSeed);
    const jitter = (amount) => rng.range(-amount, amount);

    const stationXs = [
      0.055,
      S.clamp(0.306 + jitter(0.008), 0.29, 0.32),
      S.clamp(0.535 + jitter(0.009), 0.52, 0.55),
      S.clamp(0.766 + jitter(0.008), 0.75, 0.78)
    ];

    const stations = [
      {
        id: "L0",
        code: "L0 · LEFT BANK",
        x: stationXs[0],
        label: "左岸锚站",
        task: "归站",
        tolerance: 18
      },
      ...TASK_DEFINITIONS.map((task, index) => ({
        id: `P${index + 1}`,
        code: task.code,
        x: stationXs[index + 1],
        label: `${index + 1} 号导向轮组`,
        task: task.name,
        action: task.action,
        tolerance: Number((task.baseTolerance + jitter(0.7)).toFixed(1))
      }))
    ];

    const obstacleOrder = rng.shuffle(OBSTACLE_TYPES).map((obstacle, index) => ({
      ...obstacle,
      station: `P${index + 1}`,
      strength: Number(rng.range(0.72, 1.18).toFixed(2))
    }));

    const windPhase = rng.range(0, Math.PI * 2);
    const cycleLength = 42;
    const gusts = [];
    let gustAt = rng.range(2.3, 4.2);
    while (gustAt < cycleLength - 2) {
      const obstacle = obstacleOrder[gusts.length % obstacleOrder.length];
      gusts.push({
        at: Number(gustAt.toFixed(2)),
        duration: Number(rng.range(2.0, 3.7).toFixed(2)),
        direction: rng.random() < 0.5 ? -1 : 1,
        strength: Number((rng.range(0.65, 1.75) * obstacle.strength).toFixed(2)),
        source: obstacle.code
      });
      gustAt += rng.range(3.8, 6.4);
    }

    const stars = Array.from({ length: 54 }, () => ({
      x: rng.range(0.02, 0.98),
      y: rng.range(0.03, 0.48),
      size: rng.range(0.4, 1.35),
      alpha: rng.range(0.2, 0.8)
    }));

    const canyon = {
      farRidge: buildRidge(rng, 17, 0.32, 0.58, 0.065),
      midRidge: buildRidge(rng, 13, 0.46, 0.7, 0.08),
      leftCliff: buildRidge(rng, 10, 0.34, 0.67, 0.05),
      rightCliff: buildRidge(rng, 10, 0.34, 0.67, 0.05),
      moonX: rng.range(0.61, 0.7),
      moonY: rng.range(0.22, 0.28),
      haze: rng.range(0.42, 0.54),
      stars,
      windPhase
    };

    const signature = {
      seed: cleanSeed,
      stations: stations.map((station) => [station.id, station.x.toFixed(5), station.tolerance]),
      tasks: stations.slice(1).map((station) => station.task),
      obstacles: obstacleOrder.map((obstacle) => [obstacle.code, obstacle.station, obstacle.strength]),
      gusts: gusts.map((gust) => [gust.at, gust.duration, gust.direction, gust.strength])
    };
    const fingerprint = S.hex(S.hashString(JSON.stringify(signature)), 8);

    return {
      seedText: cleanSeed,
      fingerprint,
      stations,
      obstacleOrder,
      gusts,
      windPhase,
      cycleLength,
      canyon,
      signature,
      pathLabel: "L0 → P1 → P2 → P3 → L0"
    };
  }

  function getWind(level, time, offset) {
    const phaseTime = S.mod(time + (offset || 0), level.cycleLength);
    const base = Math.sin((phaseTime / level.cycleLength) * Math.PI * 2 + level.windPhase) * 0.36;
    let gust = 0;
    let activeSource = null;
    for (const item of level.gusts) {
      const local = phaseTime - item.at;
      if (local >= 0 && local <= item.duration) {
        const envelope = Math.sin((local / item.duration) * Math.PI);
        gust += item.direction * item.strength * envelope;
        activeSource = item.source;
      }
    }
    return {
      value: Number((base + gust).toFixed(2)),
      gust,
      base,
      activeSource,
      phaseTime
    };
  }

  function getNextGust(level, time, offset) {
    const phaseTime = S.mod(time + (offset || 0), level.cycleLength);
    let next = level.gusts.find((gust) => gust.at > phaseTime);
    let delta = next ? next.at - phaseTime : level.cycleLength - phaseTime + level.gusts[0].at;
    if (!next) {
      next = level.gusts[0];
    }
    return {
      in: Number(delta.toFixed(1)),
      duration: next.duration,
      strength: next.strength
    };
  }

  function getAdjacentStation(level, x) {
    let best = level.stations[0];
    let distance = Math.abs(x - best.x);
    for (const station of level.stations) {
      const nextDistance = Math.abs(x - station.x);
      if (nextDistance < distance) {
        best = station;
        distance = nextDistance;
      }
    }
    return best;
  }

  Canyon.level = {
    createLevel,
    getWind,
    getNextGust,
    getAdjacentStation,
    TASK_DEFINITIONS,
    OBSTACLE_TYPES
  };
})(window);

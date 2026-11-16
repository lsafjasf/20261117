/* 蜂箱转场运输仿真内核：固定步长、确定性、区分实际值/观测值/告警 */
(function (G) {
  const { CFG, generateWorld, weatherAt, ambientTemp, gauss } = G.BeeConfig;

  function makeHives(rng) {
    const hives = [];
    for (let i = 0; i < CFG.HIVE_COUNT; i++) {
      hives.push({
        id: i,
        temp: CFG.AMBIENT_BASE - 1 + rng() * 0.6, // 实际箱温
        damage: 0,                                // 实际颠簸损伤 %
        alive: true,
        lethalAt: null
      });
    }
    return hives;
  }

  function createSimulation(seed) {
    const world = generateWorld(seed);
    const rng = G.BeeRNG.mulberry32((seed * 2654435761) >>> 0);

    const sim = {
      seed,
      world,
      t: 0,
      phase: 'idle',           // idle | transport | arrived | pollinated | failed
      failReason: null,
      route: 'A',
      speedMode: 'normal',
      arrangement: 'loose',    // loose 松装（散热好/颠簸大） | tight 紧装
      vent: true,              // 强通风
      spray: false,            // 水箱喷淋
      hives: makeHives(rng),
      distance: 0,
      arrivalTime: null,
      pollinateLeft: CFG.POLLINATE_TIME,
      water: CFG.WATER_CAPACITY,
      pollution: CFG.POLLUTION_BASE,
      species: CFG.SPECIES_BASE,
      observed: { temp: [], damage: [], water: CFG.WATER_CAPACITY, eta: null },
      alarms: { temp: 'ok', damage: 'ok', water: 'ok', window: 'ok', pollution: 'ok' },
      log: [],
      alarmHistory: [],  // 告警状态跃迁轨迹（含触发时刻）
      snapshotStart: null,
      snapshotEnd: null,
      postRunLeft: 0,
      rng
    };

    for (let i = 0; i < CFG.HIVE_COUNT; i++) sim.observed.temp.push(sim.hives[i].temp);
    sim.observed.damage = sim.hives.map((h) => h.damage);
    log(sim, '系统就绪：蜂箱装载于果园，等待出发指令（seed=' + seed + '）');
    return sim;
  }

  function log(sim, msg, level) {
    sim.log.push({ t: sim.t, msg, level: level || 'info' });
    if (sim.log.length > 200) sim.log.shift();
  }

  function fmt(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function snapshot(sim) {
    return {
      t: sim.t,
      phase: sim.phase,
      species: sim.species,
      water: Number(sim.water.toFixed(1)),
      pollution: Number(sim.pollution.toFixed(1)),
      alive: sim.hives.filter((h) => h.alive).length,
      avgTemp: Number((sim.hives.reduce((s, h) => s + h.temp, 0) / sim.hives.length).toFixed(2)),
      avgDamage: Number((sim.hives.reduce((s, h) => s + h.damage, 0) / sim.hives.length).toFixed(1))
    };
  }

  function setAlarm(sim, key, level, why) {
    if (sim.alarms[key] !== level) {
      const prev = sim.alarms[key];
      sim.alarms[key] = level;
      sim.alarmHistory.push({ t: sim.t, key, from: prev, to: level });
      if (level !== 'ok') log(sim, '【告警/' + level + '】' + why + ' @ ' + fmt(sim.t), 'alarm');
      else log(sim, '【告警解除】' + key + '（' + prev + '→ok） @ ' + fmt(sim.t), 'ok');
    }
  }

  function tempLevel(prev, obs) {
    if (prev === 'alert' && obs >= CFG.TEMP_ALERT - CFG.TEMP_HYST) return 'alert';
    if (obs >= CFG.TEMP_ALERT) return 'alert';
    if (prev === 'warn' && obs < CFG.TEMP_WARN - CFG.TEMP_HYST) return 'ok';
    if (obs >= CFG.TEMP_WARN) return 'warn';
    return 'ok';
  }

  function damageLevel(prev, obs) {
    if (prev === 'alert' && obs >= CFG.DAMAGE_ALERT - 2) return 'alert';
    if (obs >= CFG.DAMAGE_ALERT) return 'alert';
    if (obs >= CFG.DAMAGE_WARN) return 'warn';
    return 'ok';
  }

  function updateSensorsAndAlarms(sim) {
    let worstTemp = 'ok';
    let worstDamage = 'ok';
    sim.hives.forEach((h, i) => {
      // 观测值 = 实际值 + 高斯噪声（传感器不完美）
      sim.observed.temp[i] = h.alive
        ? h.temp + gauss(sim.rng) * CFG.SENSOR_TEMP_NOISE
        : null;
      sim.observed.damage[i] = Math.max(0, h.damage + gauss(sim.rng) * CFG.SENSOR_DAMAGE_NOISE);
      // 告警按实际值做迟滞判定，避免传感器噪声导致状态抖动
      if (h.alive) worstTemp = worse(worstTemp, tempLevel(sim.alarms.temp, h.temp));
      worstDamage = worse(worstDamage, damageLevel(sim.alarms.damage, h.damage));
    });
    sim.observed.water = Math.max(0, sim.water + gauss(sim.rng) * CFG.SENSOR_WATER_NOISE);
    // 蜂箱全部损毁后温度告警保持（设备已失效，不自动解除）
    const anyAlive = sim.hives.some((h) => h.alive);
    const tempAlarm = anyAlive ? worstTemp : (sim.alarms.temp === 'ok' ? 'alert' : sim.alarms.temp);
    setAlarm(sim, 'temp', tempAlarm, '箱温实际值越限（阈值 ' + CFG.TEMP_WARN + '/' + CFG.TEMP_ALERT + '°C，致死 ' + CFG.TEMP_LETHAL + '°C）');
    setAlarm(sim, 'damage', worstDamage, '蜂巢颠簸损伤越限（实际值阈值 ' + CFG.DAMAGE_WARN + '/' + CFG.DAMAGE_ALERT + '%）');
    setAlarm(sim, 'water', sim.observed.water < CFG.WATER_WARN ? 'warn' : 'ok', '水箱水位偏低（< ' + CFG.WATER_WARN + '%）');
    setAlarm(sim, 'pollution', sim.pollution >= CFG.POLLUTION_WARN ? 'warn' : 'ok', '污染指数偏高（≥ ' + CFG.POLLUTION_WARN + '）');
    const remain = CFG.BLOOM_WINDOW - sim.t;
    const eta = sim.observed.eta;
    if (eta !== null && eta > remain) setAlarm(sim, 'window', 'alert', '预计到达晚于花期窗口');
    else if (eta !== null && eta > remain * 0.55) setAlarm(sim, 'window', 'warn', '花期窗口剩余时间紧张');
    else if (sim.phase === 'transport') setAlarm(sim, 'window', 'ok');
  }

  function worse(a, b) {
    const rank = { ok: 0, warn: 1, alert: 2 };
    return rank[b] > rank[a] ? b : a;
  }

  // 事件函数：出发与干预切换
  const actions = {
    depart(sim) {
      if (sim.phase !== 'idle') return;
      sim.phase = 'transport';
      sim.snapshotStart = snapshot(sim);
      log(sim, '车辆出发：路线' + sim.route + '，' + (sim.arrangement === 'loose' ? '松装' : '紧装') +
        '，通风' + (sim.vent ? '开' : '关') + '，花期窗口 ' + CFG.BLOOM_WINDOW + 's');
    },
    setRoute(sim, r) { if (sim.phase === 'idle') sim.route = r; },
    setSpeed(sim, m) {
      if (sim.phase === 'idle' || sim.phase === 'transport') sim.speedMode = m;
    },
    setArrangement(sim, a) {
      if (sim.phase !== 'idle') return;
      sim.arrangement = a;
      log(sim, '装载方式改为' + (a === 'loose' ? '松装（散热好、颠簸损伤大）' : '紧装（颠簸小、易积热）'));
    },
    toggleVent(sim) {
      if (sim.phase !== 'transport' && sim.phase !== 'arrived') return;
      sim.vent = !sim.vent;
      log(sim, '强通风已' + (sim.vent ? '开启' : '关闭'));
    },
    toggleSpray(sim) {
      if (sim.phase !== 'transport') return;
      if (!sim.spray && sim.water <= 0) { log(sim, '喷淋失败：水箱已空', 'alarm'); return; }
      sim.spray = !sim.spray;
      log(sim, '水箱喷淋已' + (sim.spray ? '开启' : '关闭'));
    }
  };

  function step(sim, dt) {
    dt = dt || CFG.DT;
    sim.t += dt;
    const weather = weatherAt(sim.world, sim.t);

    if (sim.phase === 'transport') stepTransport(sim, dt, weather);
    else if (sim.phase === 'arrived') stepArrived(sim, dt);
    else if (sim.phase === 'pollinated' || sim.phase === 'failed') sim.postRunLeft = Math.max(0, sim.postRunLeft - dt);

    updateSensorsAndAlarms(sim);
  }

  function stepTransport(sim, dt, weather) {
    const route = CFG.ROUTES[sim.route];
    const mode = CFG.SPEED_MODES[sim.speedMode];
    sim.distance += mode.speed * dt;

    // 实际箱温：向热平衡温度收敛
    const heatGain = (sim.arrangement === 'tight' ? 3.6 : 2.2) + mode.heat;
    const equil = ambientTemp(sim.world, sim.t) + heatGain
      - (sim.vent ? CFG.VENT_COOL : 0)
      - (weather.wind ? CFG.WIND_COOL : 0)
      - (sim.spray && sim.water > 0 ? CFG.SPRAY_COOL : 0);

    // 实际颠簸损伤：路线颠簸 × 装载系数 × 确定性抖动
    const arrFactor = sim.arrangement === 'tight' ? 0.55 : 1.15;
    const bumpRate = route.bump * 6 * arrFactor * mode.bump;

    for (const h of sim.hives) {
      if (!h.alive) continue;
      h.temp += (equil - h.temp) * Math.min(1, 0.25 * dt);
      h.damage += bumpRate * dt * (0.85 + sim.rng() * 0.3);
      if (h.damage >= 100) h.damage = 100;
      if (h.alive && h.damage >= 100) {
        h.alive = false;
        h.lethalAt = sim.t;
        log(sim, '蜂箱#' + (h.id + 1) + ' 因剧烈颠簸蜂巢损毁 @ ' + fmt(sim.t), 'alarm');
      }
      if (h.temp >= CFG.TEMP_LETHAL) {
        h.alive = false;
        h.lethalAt = sim.t;
        log(sim, '蜂箱#' + (h.id + 1) + ' 过热损毁：实际箱温达 ' + h.temp.toFixed(1) + '°C @ ' + fmt(sim.t), 'alarm');
      }
    }

    // 水箱与污染
    if (sim.spray && sim.water > 0) {
      sim.water = Math.max(0, sim.water - CFG.SPRAY_USE * dt);
      sim.pollution += CFG.POLLUTION_SPRAY_RATE * dt;
      if (sim.water === 0) { sim.spray = false; log(sim, '水箱用尽，喷淋自动停止 @ ' + fmt(sim.t), 'alarm'); }
    }
    if (weather.heatwave) sim.pollution += CFG.POLLUTION_HEAT_RATE * dt;

    // ETA 观测值（含噪声）
    const remainDist = Math.max(0, route.length - sim.distance);
    sim.observed.eta = remainDist / mode.speed + gauss(sim.rng) * 1.2;

    // 花期窗口错过即失败
    if (sim.t > CFG.BLOOM_WINDOW && sim.distance < route.length) {
      fail(sim, '错过花期窗口（> ' + CFG.BLOOM_WINDOW + 's）');
      return;
    }
    if (sim.distance >= route.length) arrive(sim);
  }

  function arrive(sim) {
    sim.phase = 'arrived';
    sim.arrivalTime = sim.t;
    sim.spray = false;
    sim.distance = CFG.ROUTES[sim.route].length;
    const alive = sim.hives.filter((h) => h.alive).length;
    log(sim, '抵达第二片花田，用时 ' + fmt(sim.t) + '，存活蜂箱 ' + alive + '/' + CFG.HIVE_COUNT);
    if (alive < CFG.HIVE_COUNT) { fail(sim, '仅 ' + alive + ' 箱存活，无法完成三箱授粉'); return; }
    log(sim, '三箱安全到场，开始授粉（' + CFG.POLLINATE_TIME + 's）');
  }

  function stepArrived(sim, dt) {
    // 到场后通风散热，箱温向环境回归
    const equil = ambientTemp(sim.world, sim.t) - (sim.vent ? 1.5 : 0);
    for (const h of sim.hives) {
      if (h.alive) h.temp += (equil - h.temp) * Math.min(1, 0.15 * dt);
    }
    sim.pollinateLeft -= dt;
    if (sim.pollinateLeft <= 0) {
      sim.phase = 'pollinated';
      sim.species = CFG.SPECIES_BASE + 6; // 新花田蜜源支撑物种增加
      sim.snapshotEnd = snapshot(sim);
      sim.postRunLeft = CFG.POST_RUN_TIME;
      log(sim, '授粉完成：三箱全部安全授粉，任务成功 @ ' + fmt(sim.t), 'ok');
    }
  }

  function fail(sim, reason) {
    sim.phase = 'failed';
    sim.failReason = reason;
    sim.spray = false;
    sim.snapshotEnd = snapshot(sim);
    sim.postRunLeft = CFG.POST_RUN_TIME;
    log(sim, '任务失败：' + reason + ' @ ' + fmt(sim.t), 'alarm');
  }

  G.BeeSim = { createSimulation, step, actions, snapshot, log, fmt, CFG };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = G.BeeSim;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FluidPhysics = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DT = 0.1;
  const MISSION_TIME = 60;
  const RATED_RPM = 1480;
  const RATED_HEAD = 88;
  const PUMP_CURVE = 0.00048;
  const HEADER_LOSS = 0.00012;
  const TANK_AREA = 1.15;
  const TOLERANCE = 0.06;
  const MAX_STROKE_RATE = 38;
  const WATER_DENSITY = 998;
  const GRAVITY = 9.81;

  const CONTROL_DEFAULTS = Object.freeze({
    load: 78,
    valveA: 72,
    valveB: 64
  });

  const TANK_SPECS = Object.freeze([
    { id: "T-01", name: "T1", initial: 0.38, target: 2.10 },
    { id: "T-02", name: "T2", initial: 0.60, target: 1.40 },
    { id: "T-03", name: "T3", initial: 0.30, target: 1.90 }
  ]);

  const PIPE_SPECS = Object.freeze([
    { id: "M-01", label: "主管", dn: 80, length: 8, conductance: 1 },
    { id: "A-01", label: "V1 → T1", dn: 65, length: 17, conductance: 10.8 },
    { id: "A-02", label: "V1 → T2", dn: 50, length: 25, conductance: 4.9 },
    { id: "B-01", label: "V2 → T3", dn: 65, length: 12, conductance: 10.8 }
  ]);

  const LIMITS = Object.freeze({
    load: { min: 0, max: 100, unit: "%", label: "驱动负载" },
    speed: { min: 0, max: 1550, unit: "rpm", label: "泵转速" },
    pressure: { min: 0, max: 1.05, unit: "MPa", label: "分配器压力" },
    temperature: { min: 5, max: 80, unit: "°C", label: "泵体温度" },
    hammer: { min: 0, max: 1.4, unit: "kN", label: "水锤冲击" }
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function round(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function createInitialControls() {
    return { ...CONTROL_DEFAULTS };
  }

  function pipeDropMPa(pipe, flow) {
    const diameterRatio = 65 / pipe.dn;
    const lengthRatio = pipe.length / 17;
    return 0.00062 * Math.pow(diameterRatio, 5) * lengthRatio * Math.pow(flow / 35, 2);
  }

  function createInitialState(controls) {
    const input = { ...CONTROL_DEFAULTS, ...(controls || {}) };
    return {
      time: 0,
      status: "idle",
      tanks: TANK_SPECS.map(function (tank) {
        return {
          id: tank.id,
          name: tank.name,
          level: tank.initial,
          initial: tank.initial,
          target: tank.target,
          area: TANK_AREA,
          flow: 0,
          inBand: false
        };
      }),
      pump: {
        demandLoad: input.load,
        load: 0,
        speed: 0,
        flow: 0,
        head: 0,
        pressure: 0,
        power: 0,
        temperature: 38,
        reliefOpen: false
      },
      valves: [
        {
          id: "V-01",
          name: "V1",
          target: input.valveA,
          opening: input.valveA,
          strokeRate: 0,
          flow: 0,
          hammerPressure: 0,
          hammerForce: 0
        },
        {
          id: "V-02",
          name: "V2",
          target: input.valveB,
          opening: input.valveB,
          strokeRate: 0,
          flow: 0,
          hammerPressure: 0,
          hammerForce: 0
        }
      ],
      pipes: PIPE_SPECS.map(function (pipe) {
        return { id: pipe.id, label: pipe.label, dn: pipe.dn, length: pipe.length, flow: 0, drop: 0 };
      }),
      metrics: {
        totalFlow: 0,
        branchAFlow: 0,
        branchBFlow: 0,
        headerPressure: 0,
        hammerForce: 0,
        hammerPressure: 0
      },
      peaks: {
        load: 0,
        speed: 0,
        pressure: 0,
        temperature: 38,
        hammer: 0,
        flow: 0
      },
      fault: null,
      success: false,
      elapsed: 0
    };
  }

  function tankIsReady(tank) {
    return Math.abs(tank.level - tank.target) <= TOLERANCE;
  }

  function calculateHydraulics(state) {
    const speedRatio = state.pump.speed / RATED_RPM;
    const shutoffHead = RATED_HEAD * speedRatio * speedRatio;
    const openings = state.valves.map(function (valve) {
      return valve.opening / 100;
    });
    const branchPipes = PIPE_SPECS.slice(1);
    let headerHead = shutoffHead;
    let flows = [0, 0, 0];

    for (let iteration = 0; iteration < 14; iteration += 1) {
      flows = state.tanks.map(function (tank, index) {
        const availableHead = Math.max(0, headerHead - tank.level);
        return branchPipes[index].conductance * openings[index === 2 ? 1 : 0] *
          Math.sqrt(availableHead);
      });
      const total = flows[0] + flows[1] + flows[2];
      headerHead = Math.max(0, shutoffHead - (PUMP_CURVE + HEADER_LOSS) * total * total);
    }

    flows = state.tanks.map(function (tank, index) {
      const availableHead = Math.max(0, headerHead - tank.level);
      const pipe = branchPipes[index];
      const opening = openings[index === 2 ? 1 : 0];
      return Math.max(0, pipe.conductance * opening * Math.sqrt(availableHead));
    });

    const totalFlow = flows[0] + flows[1] + flows[2];
    const pressure = headerHead * WATER_DENSITY * GRAVITY / 1000000;
    const hydraulicPower = WATER_DENSITY * GRAVITY * (totalFlow / 1000) * headerHead / 1000;

    state.tanks.forEach(function (tank, index) {
      tank.flow = flows[index];
    });
    state.valves[0].flow = flows[0] + flows[1];
    state.valves[1].flow = flows[2];
    state.pump.flow = totalFlow;
    state.pump.head = headerHead;
    state.pump.pressure = pressure;
    state.pump.power = hydraulicPower / 0.74;
    state.metrics.totalFlow = totalFlow;
    state.metrics.branchAFlow = flows[0] + flows[1];
    state.metrics.branchBFlow = flows[2];
    state.metrics.headerPressure = pressure;

    state.pipes.forEach(function (pipeState) {
      const spec = PIPE_SPECS.find(function (pipe) { return pipe.id === pipeState.id; });
      let flow = totalFlow;
      if (spec.id === "A-01") flow = flows[0];
      if (spec.id === "A-02") flow = flows[1];
      if (spec.id === "B-01") flow = flows[2];
      pipeState.flow = flow;
      pipeState.drop = pipeDropMPa(spec, flow);
    });
  }

  function updateValves(state, controls) {
    state.valves[0].target = clamp(controls.valveA, 0, 100);
    state.valves[1].target = clamp(controls.valveB, 0, 100);

    state.valves.forEach(function (valve, index) {
      const error = valve.target - valve.opening;
      const desiredRate = Math.min(MAX_STROKE_RATE, Math.abs(error) * 5.2);
      const delta = Math.sign(error) * Math.min(Math.abs(error), desiredRate * DT);
      valve.opening = clamp(valve.opening + delta, 0, 100);
      valve.strokeRate = delta / DT;

      const closingRate = Math.max(0, -valve.strokeRate);
      const upstreamHead = Math.max(0, state.pump.head - 0.00012 * state.pump.flow * state.pump.flow);
      const pulse = closingRate > 4
        ? Math.pow(closingRate / MAX_STROKE_RATE, 1.55) * (upstreamHead / 58) * 0.66
        : 0;
      const area = Math.PI * Math.pow(0.065 / 2, 2);
      valve.hammerPressure = pulse;
      valve.hammerForce = pulse * 1000 * area * (index === 1 ? 1.06 : 1);
    });
  }

  function updateTanks(state) {
    state.tanks.forEach(function (tank) {
      const deltaLevel = (tank.flow / 1000 / tank.area) * DT;
      tank.level = clamp(tank.level + deltaLevel, 0, 2.7);
      tank.inBand = tankIsReady(tank);
    });
  }

  function updatePump(state, controls) {
    const demandLoad = clamp(controls.load, 45, 115);
    state.pump.demandLoad = demandLoad;
    const loadError = demandLoad - state.pump.load;
    state.pump.load = clamp(state.pump.load + Math.sign(loadError) * Math.min(Math.abs(loadError), 22 * DT), 0, 115);

    const targetSpeed = RATED_RPM * state.pump.demandLoad / 100;
    const speedError = targetSpeed - state.pump.speed;
    state.pump.speed = clamp(
      state.pump.speed + Math.sign(speedError) * Math.min(Math.abs(speedError), 720 * DT),
      0,
      1750
    );

    const flowRatio = clamp(state.pump.flow / 150, 0, 1);
    const heat = 0.62 * Math.pow(state.pump.load / 100, 2) + 0.5 * (1 - flowRatio);
    const cooling = 0.018 * (state.pump.temperature - 30);
    state.pump.temperature += (heat - cooling) * DT;
    state.pump.temperature = clamp(state.pump.temperature, 5, 140);
  }

  function buildFault(state, key, value, limit, component, code, location) {
    return {
      type: "limit",
      key: key,
      code: code,
      component: component,
      metric: LIMITS[key].label,
      value: value,
      limit: limit,
      unit: LIMITS[key].unit,
      time: round(state.time, 1),
      location: location,
      message: component + " 的" + LIMITS[key].label + "首次越过上限"
    };
  }

  function detectSafetyFault(state) {
    const candidates = [];
    const valveA = state.valves[0];
    const valveB = state.valves[1];

    if (state.pump.load > LIMITS.load.max) {
      candidates.push(buildFault(
        state, "load", state.pump.load, LIMITS.load.max,
        "泵 P-01", "P-01", { x: 0.09, y: 0.62 }
      ));
    }
    if (state.pump.speed > LIMITS.speed.max) {
      candidates.push(buildFault(
        state, "speed", state.pump.speed, LIMITS.speed.max,
        "泵 P-01", "P-01", { x: 0.09, y: 0.62 }
      ));
    }
    if (state.pump.pressure > LIMITS.pressure.max) {
      candidates.push(buildFault(
        state, "pressure", state.pump.pressure, LIMITS.pressure.max,
        "分配器 H-01", "H-01", { x: 0.2, y: 0.62 }
      ));
    }
    if (state.pump.temperature > LIMITS.temperature.max) {
      candidates.push(buildFault(
        state, "temperature", state.pump.temperature, LIMITS.temperature.max,
        "泵轴承 P-01", "P-01", { x: 0.09, y: 0.62 }
      ));
    }

    [valveA, valveB].forEach(function (valve) {
      if (valve.hammerForce > LIMITS.hammer.max) {
        candidates.push(buildFault(
          state, "hammer", valve.hammerForce, LIMITS.hammer.max,
          "阀门 " + valve.id, valve.id, { x: 0.3, y: valve === valveA ? 0.34 : 0.84 }
        ));
      }
    });

    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      const ratioA = Math.abs(a.value - a.limit) / Math.max(1, Math.abs(a.limit));
      const ratioB = Math.abs(b.value - b.limit) / Math.max(1, Math.abs(b.limit));
      return ratioB - ratioA;
    });
    return candidates[0];
  }

  function updatePeaks(state) {
    state.peaks.load = Math.max(state.peaks.load, state.pump.load);
    state.peaks.speed = Math.max(state.peaks.speed, state.pump.speed);
    state.peaks.pressure = Math.max(state.peaks.pressure, state.pump.pressure);
    state.peaks.temperature = Math.max(state.peaks.temperature, state.pump.temperature);
    state.peaks.hammer = Math.max(
      state.peaks.hammer,
      state.valves[0].hammerForce,
      state.valves[1].hammerForce
    );
    state.peaks.flow = Math.max(state.peaks.flow, state.pump.flow);
    state.metrics.hammerForce = Math.max(state.valves[0].hammerForce, state.valves[1].hammerForce);
    state.metrics.hammerPressure = Math.max(state.valves[0].hammerPressure, state.valves[1].hammerPressure);
  }

  function finishMission(state) {
    if (state.tanks.every(tankIsReady)) {
      state.status = "success";
      state.success = true;
      state.fault = null;
      return { type: "success", time: state.time };
    }
    if (state.time >= MISSION_TIME - 0.0001) {
      state.time = MISSION_TIME;
      state.status = "failed";
      state.fault = {
        type: "deadline",
        key: "deadline",
        code: "M-07",
        component: "任务时钟",
        metric: "任务时限",
        value: MISSION_TIME,
        limit: MISSION_TIME,
        unit: "s",
        time: MISSION_TIME,
        location: null,
        message: "任务达到 60.0 s 时限，仍有储罐未进入目标带"
      };
      return { type: "deadline", time: state.time };
    }
    return null;
  }

  function step(state, controls) {
    if (state.status === "success" || state.status === "failed") {
      return { state: state, events: [] };
    }

    const events = [];
    state.time = round(state.time + DT, 1);
    state.elapsed = state.time;
    state.pump.demandLoad = clamp(controls.load, 45, 115);
    if (state.pump.demandLoad > LIMITS.load.max) {
      state.pump.load = Math.max(state.pump.load, state.pump.demandLoad);
      state.peaks.load = Math.max(state.peaks.load, state.pump.demandLoad);
      const fault = buildFault(
        state, "load", state.pump.demandLoad, LIMITS.load.max,
        "泵 P-01", "P-01", { x: 0.1, y: 0.54 }
      );
      state.status = "failed";
      state.fault = fault;
      events.push({ type: "fault", fault: fault });
      return { state: state, events: events };
    }
    updateValves(state, controls);
    updatePump(state, controls);
    calculateHydraulics(state);
    updateTanks(state);
    updatePeaks(state);

    const fault = detectSafetyFault(state);
    if (fault) {
      state.status = "failed";
      state.fault = fault;
      events.push({ type: "fault", fault: fault });
      return { state: state, events: events };
    }

    const ended = finishMission(state);
    if (ended) events.push(ended);
    return { state: state, events: events };
  }

  function snapshot(state) {
    return {
      time: state.time,
      status: state.status,
      tanks: state.tanks.map(function (tank) {
        return {
          id: tank.id,
          name: tank.name,
          level: tank.level,
          target: tank.target,
          flow: tank.flow,
          inBand: tank.inBand
        };
      }),
      pump: {
        load: state.pump.load,
        speed: state.pump.speed,
        flow: state.pump.flow,
        pressure: state.pump.pressure,
        temperature: state.pump.temperature,
        power: state.pump.power
      },
      valves: state.valves.map(function (valve) {
        return {
          opening: valve.opening,
          target: valve.target,
          flow: valve.flow,
          hammerPressure: valve.hammerPressure,
          hammerForce: valve.hammerForce
        };
      }),
      pipes: state.pipes.map(function (pipe) {
        return { ...pipe };
      }),
      metrics: { ...state.metrics },
      peaks: { ...state.peaks },
      fault: state.fault ? { ...state.fault } : null
    };
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = safe - minutes * 60;
    return String(minutes).padStart(2, "0") + ":" + rest.toFixed(1).padStart(4, "0");
  }

  function runSimulation(controls, steps) {
    const state = createInitialState(controls);
    const trajectory = [snapshot(state)];
    for (let index = 0; index < steps; index += 1) {
      step(state, controls);
      trajectory.push(snapshot(state));
      if (state.status === "failed" || state.status === "success") break;
    }
    return { state: state, trajectory: trajectory };
  }

  return Object.freeze({
    DT: DT,
    MISSION_TIME: MISSION_TIME,
    TOLERANCE: TOLERANCE,
    LIMITS: LIMITS,
    CONTROL_DEFAULTS: CONTROL_DEFAULTS,
    TANK_SPECS: TANK_SPECS,
    PIPE_SPECS: PIPE_SPECS,
    createInitialControls: createInitialControls,
    createInitialState: createInitialState,
    step: step,
    snapshot: snapshot,
    formatTime: formatTime,
    runSimulation: runSimulation
  });
});

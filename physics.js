(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PendulumPhysics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIMITS = Object.freeze({
    tilt: { min: -35, max: 35, unit: "°", label: "摆角", part: "摆杆铰点" },
    speed: { min: -4.2, max: 4.2, unit: "m/s", label: "车速", part: "驱动轮" },
    rail: { min: -3.8, max: 3.8, unit: "m", label: "导轨行程", part: "导轨末端" },
    temp: { min: 20, max: 95, unit: "°C", label: "电机温度", part: "驱动电机" },
    load: { min: 0.4, max: 3.2, unit: "kg", label: "负载质量", part: "摆杆负载" }
  });

  const BASE_CONFIG = Object.freeze({
    dt: 1 / 120,
    gravity: 9.81,
    cartMass: 1.7,
    halfPoleLength: 0.52,
    forceLimit: 32,
    commandLimit: 3,
    tiltLimitRad: 35 * Math.PI / 180,
    speedLimit: 4.2,
    railLimit: 3.8,
    tempAmbient: 31,
    tempLimit: 95,
    targetTolerance: 0.3,
    angleTolerance: 7 * Math.PI / 180,
    speedTolerance: 0.22,
    dwellRequired: 1.2,
    initialTheta: 0.025,
    rollingDamping: 0.018,
    brakeGain: 0.92,
    heatGain: 0.0028,
    coolingGain: 0.032
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value) => Number.isFinite(value);

  class PendulumSim {
    constructor(options = {}) {
      this.config = Object.assign({}, BASE_CONFIG, options);
      this.payload = clamp(finite(options.payload) ? options.payload : 0.9, LIMITS.load.min, LIMITS.load.max);
      this.target = clamp(finite(options.target) ? options.target : 1.8, -2.6, 2.6);
      this.assist = options.assist !== false;
      this.reset();
    }

    createInitialState() {
      return {
        t: 0,
        x: 0,
        v: 0,
        theta: this.config.initialTheta,
        omega: 0,
        force: 0,
        temperature: this.config.tempAmbient
      };
    }

    reset(extra = {}) {
      if (finite(extra.payload)) this.payload = clamp(extra.payload, LIMITS.load.min, LIMITS.load.max);
      if (finite(extra.target)) this.target = clamp(extra.target, -2.6, 2.6);
      if (typeof extra.assist === "boolean") this.assist = extra.assist;

      this.state = this.createInitialState();
      this.command = 0;
      this.status = "ready";
      this.endedAt = null;
      this.fault = null;
      this.successAt = null;
      this.dwell = 0;
      this.tripEpisode = false;
      this.peaks = {
        angle: 0,
        speed: 0,
        force: 0,
        temp: this.state.temperature,
        error: Math.abs(this.target - this.state.x)
      };
      this.trace = [this.sample(this.state)];
      this.events = [];
      this.logEvent("系统初始化 · 初始条件已锁定", "info");
      return this.state;
    }

    sample(state = this.state) {
      const tipX = state.x + Math.sin(state.theta) * this.config.halfPoleLength * 2;
      const tipY = Math.cos(state.theta) * this.config.halfPoleLength * 2;
      return {
        t: state.t,
        x: state.x,
        v: state.v,
        theta: state.theta,
        omega: state.omega,
        force: state.force,
        temperature: state.temperature,
        target: this.target,
        command: this.command,
        tipX,
        tipY,
        error: this.target - state.x,
        status: this.status
      };
    }

    logEvent(text, kind = "info", t = this.state.t) {
      const event = { t, text, kind };
      this.events.push(event);
      if (this.events.length > 80) this.events.shift();
      return event;
    }

    setCommand(value) {
      if (!finite(value) || this.status === "failure" || this.status === "success") return;
      this.command = clamp(value, -this.config.commandLimit, this.config.commandLimit);
    }

    setAssist(enabled) {
      this.assist = Boolean(enabled);
    }

    setTarget(value) {
      if (finite(value) && this.status === "ready") {
        this.target = clamp(value, -2.6, 2.6);
        this.trace[0].target = this.target;
        this.peaks.error = Math.abs(this.target);
      }
    }

    setPayload(value) {
      if (finite(value) && this.status === "ready") {
        this.payload = clamp(value, LIMITS.load.min, LIMITS.load.max);
      }
    }

    controlForce(state) {
      const totalMass = this.config.cartMass + this.payload;
      const length = this.config.halfPoleLength;
      let desiredAccel = this.command;
      if (this.assist && Math.abs(this.command) < 0.02) {
        desiredAccel -= this.config.brakeGain * state.v;
      }
      if (!this.assist) {
        return clamp(totalMass * desiredAccel, -this.config.forceLimit, this.config.forceLimit);
      }

      const sin = Math.sin(state.theta);
      const cos = Math.max(0.3, Math.cos(state.theta));
      const inertiaTerm = length * (4 / 3 - this.payload * cos * cos / totalMass);
      const angleReference = clamp(desiredAccel / this.config.gravity, -0.24, 0.24);
      const angleAccel = -25 * (state.theta - angleReference) - 10 * state.omega;
      const force = totalMass * (this.config.gravity * sin - inertiaTerm * angleAccel) / cos -
        this.payload * length * state.omega * state.omega * sin;
      return clamp(force, -this.config.forceLimit, this.config.forceLimit);
    }

    derivatives(state, force) {
      const { gravity, cartMass, halfPoleLength: length } = this.config;
      const mass = this.payload;
      const totalMass = cartMass + mass;
      const sin = Math.sin(state.theta);
      const cos = Math.cos(state.theta);
      const temp = (force + mass * length * state.omega * state.omega * sin) / totalMass;
      const denominator = length * (4 / 3 - (mass * cos * cos) / totalMass);
      const thetaAccel = (gravity * sin - cos * temp) / denominator;
      let xAccel = temp - (mass * length * thetaAccel * cos) / totalMass;
      xAccel -= this.config.rollingDamping * state.v;

      return { x: state.v, v: xAccel, theta: state.omega, omega: thetaAccel };
    }

    integrate(state, force, dt) {
      const k1 = this.derivatives(state, force);
      const s2 = {
        x: state.x + k1.x * dt / 2,
        v: state.v + k1.v * dt / 2,
        theta: state.theta + k1.theta * dt / 2,
        omega: state.omega + k1.omega * dt / 2
      };
      const k2 = this.derivatives(s2, force);
      const s3 = {
        x: state.x + k2.x * dt / 2,
        v: state.v + k2.v * dt / 2,
        theta: state.theta + k2.theta * dt / 2,
        omega: state.omega + k2.omega * dt / 2
      };
      const k3 = this.derivatives(s3, force);
      const s4 = {
        x: state.x + k3.x * dt,
        v: state.v + k3.v * dt,
        theta: state.theta + k3.theta * dt,
        omega: state.omega + k3.omega * dt
      };
      const k4 = this.derivatives(s4, force);

      return {
        t: state.t + dt,
        x: state.x + dt * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
        v: state.v + dt * (k1.v + 2 * k2.v + 2 * k3.v + k4.v) / 6,
        theta: state.theta + dt * (k1.theta + 2 * k2.theta + 2 * k3.theta + k4.theta) / 6,
        omega: state.omega + dt * (k1.omega + 2 * k2.omega + 2 * k3.omega + k4.omega) / 6,
        force,
        temperature: state.temperature
      };
    }

    temperatureStep(previous, next, force, dt) {
      const heat = this.config.heatGain * force * force;
      const cooling = this.config.coolingGain * (previous.temperature - this.config.tempAmbient);
      next.temperature = Math.max(
        this.config.tempAmbient,
        previous.temperature + (heat - cooling) * dt
      );
      return next.temperature;
    }

    angleDegrees(state = this.state) {
      return state.theta * 180 / Math.PI;
    }

    isLocked() {
      return this.status === "failure" || this.status === "success";
    }

    advance(dt = this.config.dt) {
      if (this.isLocked()) return { advanced: false, status: this.status };
      const previous = Object.assign({}, this.state);
      const force = this.controlForce(previous);
      const next = this.integrate(previous, force, dt);
      this.temperatureStep(previous, next, force, dt);
      next.force = force;
      this.status = "running";
      this.tripEpisode = false;

      const trip = this.findFirstTrip(previous, next);
      if (trip) {
        this.applyTrip(previous, next, trip);
        return { advanced: true, status: this.status, fault: this.fault, stepped: true };
      }

      this.state = next;
      this.trace.push(this.sample(next));
      this.updatePeaks();
      this.evaluateSuccess(dt);
      return { advanced: true, status: this.status, stepped: true };
    }

    interpolate(previous, next, ratio) {
      const lerp = (a, b) => a + (b - a) * ratio;
      return {
        t: lerp(previous.t, next.t, ratio),
        x: lerp(previous.x, next.x, ratio),
        v: lerp(previous.v, next.v, ratio),
        theta: lerp(previous.theta, next.theta, ratio),
        omega: lerp(previous.omega, next.omega, ratio),
        force: next.force,
        temperature: lerp(previous.temperature, next.temperature, ratio)
      };
    }

    findFirstTrip(previous, next) {
      const candidates = [];
      const ratioFor = (before, after, limit) => {
        if (before === after) return 0;
        const ratio = (limit - before) / (after - before);
        return clamp(ratio, 0, 1);
      };

      const angleDeg = next.theta * 180 / Math.PI;
      if (Math.abs(angleDeg) > LIMITS.tilt.max) {
        const limit = next.theta >= 0 ? this.config.tiltLimitRad : -this.config.tiltLimitRad;
        candidates.push({
          key: "tilt",
          ratio: ratioFor(previous.theta, next.theta, limit),
          value: angleDeg,
          limit: angleDeg >= 0 ? LIMITS.tilt.max : LIMITS.tilt.min,
          part: "摆杆铰点",
          message: "摆角越过安全姿态上限"
        });
      }
      if (Math.abs(next.v) > this.config.speedLimit) {
        const limit = next.v >= 0 ? this.config.speedLimit : -this.config.speedLimit;
        candidates.push({
          key: "speed",
          ratio: ratioFor(previous.v, next.v, limit),
          value: next.v,
          limit,
          part: "驱动轮",
          message: "驱动轮超过安全转速"
        });
      }
      if (Math.abs(next.x) > this.config.railLimit) {
        const limit = next.x >= 0 ? this.config.railLimit : -this.config.railLimit;
        candidates.push({
          key: "rail",
          ratio: ratioFor(previous.x, next.x, limit),
          value: next.x,
          limit,
          part: "导轨末端",
          message: "小车抵达导轨安全止挡"
        });
      }
      if (next.temperature > this.config.tempLimit) {
        candidates.push({
          key: "temp",
          ratio: ratioFor(previous.temperature, next.temperature, this.config.tempLimit),
          value: next.temperature,
          limit: this.config.tempLimit,
          part: "驱动电机",
          message: "电机温度超过绝缘安全阈值"
        });
      }
      if (!candidates.length) return null;
      candidates.sort((a, b) => a.ratio - b.ratio);
      return candidates[0];
    }

    applyTrip(previous, next, trip) {
      this.state = this.interpolate(previous, next, trip.ratio);
      this.force = next.force;
      this.status = "failure";
      this.tripEpisode = true;
      this.endedAt = this.state.t;
      this.fault = {
        part: trip.part,
        key: trip.key,
        t: this.state.t,
        value: trip.value,
        limit: trip.limit,
        x: this.state.x,
        theta: this.angleDegrees(this.state),
        message: trip.message
      };
      this.trace.push(this.sample(this.state));
      this.updatePeaks();
      this.logEvent(`${trip.part}首次越限 · ${trip.message}`, "danger", this.state.t);
    }

    evaluateSuccess(dt) {
      const error = Math.abs(this.target - this.state.x);
      const inside = error <= this.config.targetTolerance &&
        Math.abs(this.state.theta) <= this.config.angleTolerance &&
        Math.abs(this.state.v) <= this.config.speedTolerance;

      this.dwell = inside ? this.dwell + dt : 0;
      if (this.dwell >= this.config.dwellRequired) {
        this.status = "success";
        this.successAt = this.state.t;
        this.endedAt = this.state.t;
        this.trace[this.trace.length - 1].status = "success";
        this.logEvent("目标区稳定驻留完成 · 任务成功", "success");
      }
    }

    updatePeaks() {
      const s = this.state;
      this.peaks.angle = Math.max(this.peaks.angle, Math.abs(this.angleDegrees(s)));
      this.peaks.speed = Math.max(this.peaks.speed, Math.abs(s.v));
      this.peaks.force = Math.max(this.peaks.force, Math.abs(s.force));
      this.peaks.temp = Math.max(this.peaks.temp, s.temperature);
      this.peaks.error = Math.max(this.peaks.error, Math.abs(this.target - s.x));
    }

    getReport() {
      const failurePosition = this.fault ? {
        component: this.fault.part,
        t: this.fault.t,
        x: this.fault.x,
        thetaDeg: this.fault.theta,
        limit: this.fault.limit,
        value: this.fault.value
      } : null;
      return {
        status: this.status,
        duration: this.endedAt == null ? this.state.t : this.endedAt,
        target: this.target,
        payload: this.payload,
        peaks: Object.assign({}, this.peaks),
        dwell: this.dwell,
        fault: this.fault ? Object.assign({}, this.fault) : null,
        faultPosition: failurePosition,
        samples: this.trace.length,
        config: {
          payload: this.payload,
          target: this.target,
          forceLimit: this.config.forceLimit,
          tiltLimit: LIMITS.tilt.max,
          speedLimit: this.config.speedLimit,
          railLimit: this.config.railLimit,
          tempLimit: this.config.tempLimit
        }
      };
    }
  }

  return { PendulumSim, LIMITS, BASE_CONFIG };
});

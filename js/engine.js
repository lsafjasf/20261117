/* 单一模拟核心：双席输入合并、共享资源、冲突记录、任务判定与单侧保护。
   双端仪表只读这一个引擎的快照，因此两侧永远同源、不会分叉。 */
(function (global) {
  "use strict";
  var MC = global.MC || (global.MC = {});
  var T = MC.Track;
  var DT = 1 / 60;
  var MISSION_SECONDS = 180;
  var WATCHDOG_SECONDS = 30;
  var RESYNC_SECONDS = 2;

  function emptyInput() {
    return {
      p1: { accelHeld: false, decelHeld: false },
      p2: { brakeUp: false, brakeDown: false, switchInner: false, switchOuter: false, emergency: false }
    };
  }

  function Engine() { this.reset(); }

  Engine.prototype.reset = function () {
    this.phase = "ARM";                 // ARM / RUN / PROTECT / SUCCESS / FAILED
    this.failReason = "";
    this.simTime = 0;                   // 模拟总时长
    this.missionTime = MISSION_SECONDS; // 共享倒计时（ARM 与 PROTECT 冻结）
    this.distance = 0;                  // 当前圈进度（米）
    this.totalDistance = 0;
    this.speed = 0;
    this.throttle = 0;                  // P1 牵引加速度 m/s²（0..4.2）
    this.brakePct = 0;                  // P2 制动压力 %（0..100）
    this.traction = 100;                // 牵引储能 %
    this.airTank = 100;                 // 制动风缸 %
    this.lap = 1;
    this.lapCrossings = 0;
    this.switchPos = "inner";
    this.switchAligned = false;         // 当前圈道岔是否与要求一致
    this.flags = {
      p1Linked: true, p2Linked: true,
      conflictActive: false, conflictTimer: 0,
      autoBrake: false, watchdog: 0, resync: 0,
      protectedSide: null
    };
    this.input = emptyInput();
    this.conflictCount = 0;
    this.events = [];                   // 输入/冲突/链路事件（回放）
    this.snapshots = [];
    this.logs = [];
    this.frameCount = 0;
    this._lastHazard = null;
    this._lastSwitchCheck = -1;
    this.log("SYS", "双人链路待命，等待发车授权");
    this.snapshot(true);
  };

  Engine.prototype.log = function (tag, msg) {
    this.logs.unshift({ t: this.simTime, tag: tag, msg: msg });
    if (this.logs.length > 200) this.logs.pop();
  };

  Engine.prototype.arm = function () {
    if (this.phase !== "ARM") return;
    if (!this.flags.p1Linked || !this.flags.p2Linked) {
      this.log("WARN", "发车授权被拒：存在失联席位");
      return;
    }
    this.phase = "RUN";
    this.log("SYS", "发车授权确认，倒计时开始");
  };

  // ---- 链路管理：失联只允许本席恢复，健康席无法代替 ----
  Engine.prototype.disconnect = function (side) {
    if (this.phase !== "RUN" && this.phase !== "PROTECT") return;
    var f = this.flags;
    if (side === "p1" && !f.p1Linked) return;
    if (side === "p2" && !f.p2Linked) return;
    if (side === "p1") f.p1Linked = false;
    else f.p2Linked = false;
    this.input[side] = emptyInput()[side];
    f.protectedSide = side;
    f.autoBrake = true;
    f.watchdog = 0;
    f.conflictActive = false;
    this.phase = "PROTECT";
    this.log(side === "p1" ? "P1" : "P2",
      (side === "p1" ? "P1 加速席" : "P2 制动席") + "失联，保护制动已接管");
    this.recordEvent("link", { side: side, state: "offline" });
  };

  Engine.prototype.reconnect = function (side) {
    var f = this.flags;
    if (side === "p1" && f.p1Linked) return;
    if (side === "p2" && f.p2Linked) return;
    if (f.protectedSide !== side) return;   // 仅本席可恢复本席
    if (side === "p1") f.p1Linked = true;
    else f.p2Linked = true;
    f.resync = RESYNC_SECONDS;
    f.autoBrake = false;
    f.protectedSide = null;
    this.log("SYS", (side === "p1" ? "P1 加速席" : "P2 制动席") + "链路恢复，双端状态对齐中");
    this.recordEvent("link", { side: side, state: "online" });
  };

  Engine.prototype.recordEvent = function (type, data) {
    var ev = { t: this.simTime, type: type, data: data || {} };
    this.events.push(ev);
    if (this.events.length > 1200) this.events.shift();
  };

  // ---- 前瞻信息：中央画布与仪表提示 ----
  Engine.prototype.preview = function () {
    var path = T.paths[this.routeChoice()];
    var remaining = T.branchM - this.distance;
    var next = null;
    if (remaining > -1) {
      next = {
        kind: "switch", id: "J1",
        dist: Math.max(0, remaining),
        required: T.requiredRoutes[(this.lap - 1) % 3],
        aligned: this.switchPos === T.requiredRoutes[(this.lap - 1) % 3]
      };
    } else {
      var zones = T.hazardZones(path);
      for (var i = 0; i < zones.length; i++) {
        if (zones[i].toM > this.distance && zones[i].fromM > this.distance) {
          next = { kind: "curve", id: zones[i].name, dist: zones[i].fromM - this.distance, limit: zones[i].limit };
          break;
        }
      }
      if (!next) next = { kind: "open", id: "OPEN", dist: 0, limit: T.curveLimit };
    }
    return next;
  };

  Engine.prototype.routeChoice = function () {
    // 过 J1 后当圈路径即被锁定
    return this.distance >= T.branchM ? this.switchPos : this.switchPos;
  };

  Engine.prototype.snapshot = function (force) {
    if (!force && this.frameCount % 5 !== 0) return null;  // 12Hz 快照
    var snap = {
      t: this.simTime, phase: this.phase, speed: this.speed,
      distance: this.distance, totalDistance: this.totalDistance,
      lap: this.lap, throttle: this.throttle, brakePct: this.brakePct,
      traction: this.traction, airTank: this.airTank,
      switchPos: this.switchPos, switchAligned: this.switchAligned,
      missionTime: this.missionTime, conflict: this.conflictCount,
      flags: JSON.parse(JSON.stringify(this.flags)),
      route: this.routeChoice()
    };
    this.snapshots.push(snap);
    if (this.snapshots.length > 3600) this.snapshots.shift();
    return snap;
  };

  // ---- 单帧推进（固定步长 1/60）----
  Engine.prototype.step = function (input) {
    this.frameCount++;
    this.input = input || emptyInput();
    var f = this.flags;

    if (this.phase === "ARM" || this.phase === "SUCCESS" || this.phase === "FAILED") {
      this.simTime += DT;
      this.snapshot();
      return;
    }

    this.simTime += DT;
    var p1 = f.p1Linked ? this.input.p1 : emptyInput().p1;
    var p2 = f.p2Linked ? this.input.p2 : emptyInput().p2;

    // P1：只调加速度（4.2 m/s² 上限），耗能
    if (p1.accelHeld && this.traction > 0) this.throttle = Math.min(4.2, this.throttle + 2.6 * DT);
    else if (p1.decelHeld) this.throttle = Math.max(0, this.throttle - 3.4 * DT);
    else this.throttle += (0 - this.throttle) * Math.min(1, 2.2 * DT);
    if (this.traction <= 0) this.throttle = 0;

    // P2：只调制動压力，风缸耗气 / 空闲回充
    if (p2.emergency) this.brakePct = 100;
    else if (p2.brakeUp && this.airTank > 0) this.brakePct = Math.min(100, this.brakePct + 55 * DT);
    else if (p2.brakeDown) this.brakePct = Math.max(0, this.brakePct - 70 * DT);
    else this.brakePct += (0 - this.brakePct) * Math.min(1, 1.6 * DT);
    if (this.airTank <= 0) this.brakePct = 0;

    // 道岔（J1 之前可调，之后锁定）
    if (this.distance < T.branchM) {
      if (p2.switchInner && this.switchPos !== "inner") {
        this.switchPos = "inner";
        this.log("P2", "道岔 J1 切至内环");
        this.recordEvent("switch", { pos: "inner" });
      }
      if (p2.switchOuter && this.switchPos !== "outer") {
        this.switchPos = "outer";
        this.log("P2", "道岔 J1 切至外环");
        this.recordEvent("switch", { pos: "outer" });
      }
    }
    var required = T.requiredRoutes[(this.lap - 1) % 3];
    this.switchAligned = this.switchPos === required;

    // 共享资源收支
    var braking = f.autoBrake || this.brakePct > 1;
    if (this.throttle > 0.05) this.traction = Math.max(0, this.traction - this.throttle * 1.15 * DT);
    if (braking) {
      this.airTank = Math.max(0, this.airTank - 2.2 * DT);
      this.traction = Math.min(100, this.traction + this.brakePct * 0.012 * DT); // 制动回馈
    } else {
      this.airTank = Math.min(100, this.airTank + 3.0 * DT);
    }

    // 冲突：牵引与制动同时作用（1.2s 节流，写入回放与输入缓冲）
    var conflictNow = this.throttle > 0.4 && braking;
    if (conflictNow && f.conflictTimer <= 0) {
      this.conflictCount++;
      f.conflictTimer = 1.2;
      this.log("SYS", "牵引 " + this.throttle.toFixed(1) + " m/s² 与制动 " +
        Math.round(this.brakePct) + "% 同时作用");
      this.recordEvent("conflict", { throttle: +this.throttle.toFixed(2), brake: Math.round(this.brakePct) });
    }
    if (f.conflictTimer > 0) f.conflictTimer -= DT;
    f.conflictActive = conflictNow;

    // 无摩擦匀速；牵引加速，制动减速（保护制动为 AUTO 100%）
    var brakeEff = f.autoBrake ? 100 : this.brakePct;
    var accel = this.throttle - brakeEff * 0.065;
    this.speed = Math.max(0, this.speed + accel * DT);
    var prevDist = this.distance;
    this.distance += this.speed * DT;
    this.totalDistance += this.speed * DT;

    this.checkHazards(prevDist);
    this.checkLap(prevDist);

    if (this.phase === "RUN") {
      this.missionTime -= DT;
      if (this.missionTime <= 0) return this.fail("倒计时耗尽，未能完成三圈停车");
    }
    this.updateProtection(DT);
    this.snapshot();
  };

  Engine.prototype.checkHazards = function (prevDist) {
    if (this.phase !== "RUN" && this.phase !== "PROTECT") return;
    var path = T.paths[this.switchPos];

    // 道岔：经过 J1 时位置必须与本圈要求一致
    if (prevDist < T.branchM && this.distance >= T.branchM) {
      var required = T.requiredRoutes[(this.lap - 1) % 3];
      if (this.switchPos !== required) {
        return this.fail("J1 道岔位置错误（要求" + (required === "inner" ? "内环" : "外环") + "），车辆脱轨");
      }
      this.log("SYS", "J1 道岔已对齐，进入" + (required === "inner" ? "内环" : "外环"));
    }

    // 曲线超速
    var zones = T.hazardZones(path);
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      if (this.distance >= z.fromM && this.distance <= z.toM && this._lastHazard !== z.name) {
        this._lastHazard = z.name;
        if (this.speed > z.limit + 0.5) {
          return this.fail(z.name + " 弯超速 " + this.speed.toFixed(1) + " m/s（限速 " + z.limit + "），车辆冲出弯道");
        }
      }
      if (this.distance > z.toM && this._lastHazard === z.name) this._lastHazard = null;
    }

    // 第三圈通过起点后进入终点缓冲停车区：区内速度达标即对标停车成功
    if (this.lapCrossings >= 3 && this.distance > 2 && this.speed <= T.stopSpeed) {
      return this.succeed();
    }
    if (this.lapCrossings >= 3 && this.distance > T.stopZoneM) {
      return this.fail("制动过晚，撞上终点缓冲挡墙（速度 " + this.speed.toFixed(1) + " m/s）");
    }
  };

  Engine.prototype.checkLap = function (prevDist) {
    var lapLen = T.paths[this.switchPos].totalM;
    if (prevDist < lapLen && this.distance >= lapLen) {
      this.lapCrossings++;
      if (this.lapCrossings < 3) {
        this.lap = this.lapCrossings + 1;
        this.distance -= lapLen;
        this._lastHazard = null;
        this.log("SYS", "通过起点，完成第 " + this.lapCrossings + " 圈");
      } else {
        this.distance = this.distance - lapLen;
        this.log("SYS", "三圈完成，进入终点停车区，须 ≤ " + T.stopSpeed + " m/s");
      }
    }
  };

  Engine.prototype.updateProtection = function (dt) {
    var f = this.flags;
    if (this.phase !== "PROTECT") {
      if (f.resync > 0) {
        f.resync -= dt;
        if (f.resync <= 0 && this.phase === "RUN") this.log("SYS", "双端状态对齐完成，协同恢复");
      }
      return;
    }
    f.watchdog += dt;
    if (f.watchdog >= WATCHDOG_SECONDS) {
      return this.fail((f.protectedSide === "p1" ? "P1 加速席" : "P2 制动席") + "链路超时 30 秒，任务中止");
    }
    if (f.p1Linked && f.p2Linked) {
      this.phase = "RUN";
      f.autoBrake = false;
      this.log("SYS", "链路恢复，保护制动解除");
    }
  };

  Engine.prototype.succeed = function () {
    this.phase = "SUCCESS";
    this.speed = 0;
    this.log("SYS", "停车达标，三圈协同试车成功");
    this.recordEvent("result", { ok: true });
  };

  Engine.prototype.fail = function (reason) {
    this.phase = "FAILED";
    this.failReason = reason;
    this.log("WARN", reason);
    this.recordEvent("result", { ok: false, reason: reason });
  };

  if (typeof module !== "undefined" && module.exports) module.exports = { Engine: Engine, DT: DT, MISSION_SECONDS: MISSION_SECONDS, WATCHDOG_SECONDS: WATCHDOG_SECONDS };
  MC.Engine = Engine;
  MC.EngineConst = { DT: DT, MISSION_SECONDS: MISSION_SECONDS, WATCHDOG_SECONDS: WATCHDOG_SECONDS };
})(typeof window !== "undefined" ? window : globalThis);

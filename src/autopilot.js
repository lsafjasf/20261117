/* global DBEngine */
/** 单人调试托管：每个托管侧仍只能调用本侧白名单动作。 */
(function () {
  'use strict';
  const C = window.DBEngine.config;

  const Autopilot = {
    p1: false,
    p2: false,

    driveP1(engine) {
      const s = engine.state;
      const st = s.activeStation
        ? C.STATIONS.find((x) => x.id === s.activeStation)
        : null;
      const target = st ? st.depth
        : (s.completed.length === C.STATIONS.length ? 0 : s.depth);
      const u = target - s.depth - 6 * s.vSpeed;
      let want = 'ballast_off';
      if (u > 1.2) want = 'ballast_down';
      else if (u < -1.2) want = 'ballast_up';
      const cur = s.ballastDir === 1 ? 'ballast_down'
        : s.ballastDir === -1 ? 'ballast_up' : 'ballast_off';
      if (want !== cur) engine.applyAction('p1', want);
    },

    driveP2(engine) {
      const s = engine.state;
      const slack = s.cablePaid - s.depth;
      if (Math.abs(s.vSpeed) > 1.0 && slack < 4.5) engine.applyAction('p2', 'cable_pay');
      else if (slack < 2.4) engine.applyAction('p2', 'cable_pay');
      else if (s.drift > 2.4 && slack > 3.0) engine.applyAction('p2', 'cable_reel');
      else if (slack > 5.5) engine.applyAction('p2', 'cable_reel');
      else if (s.cableDir !== 0) engine.applyAction('p2', 'cable_off');

      if (s.o2 < 20.2 && s.valveDir !== 1) engine.applyAction('p2', 'air_up');
      else if (s.o2 > 21.6 && s.valveDir !== -1) engine.applyAction('p2', 'air_down');
      else if (s.o2 >= 20.2 && s.o2 <= 21.6 && s.valveDir !== 0) {
        engine.applyAction('p2', 'air_off');
      }

      const st = s.activeStation
        ? C.STATIONS.find((x) => x.id === s.activeStation)
        : null;
      if (st && !s.sample) {
        const inDepth = Math.abs(s.depth - st.depth) <= st.depthTol;
        if (inDepth && Math.abs(s.drift) <= C.STATION_DRIFT_TOL &&
            s.tensionState !== 'tight') {
          engine.applyAction('p2', 'sample');
        }
      }
    },

    tick(engine) {
      if (this.p1) this.driveP1(engine);
      if (this.p2) this.driveP2(engine);
    }
  };

  window.DBAutopilot = Autopilot;
})();

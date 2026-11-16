/*
 * 预设处置策略：稳态达标 / 临界事件应对 / 处置失败
 * 每个策略按 tick 返回 {aeration, diversion, buoys}
 */
(function (global) {
  'use strict';
  var RT = global.RT;
  if (typeof require === 'function' && typeof RT === 'undefined') RT = require('./engine.js');

  function hotspotBuoys(sim) {
    return sim.hotspots.map(function (h) { return { x: h.x, y: h.y }; });
  }

  var Scenarios = {
    // 稳态：温和曝气 + 适度引水，浮标覆盖全部热点
    steady: {
      label: '稳态处置（推荐基线）',
      deploy: function (sim) {
        hotspotBuoys(sim).forEach(function (b) { RT.placeBuoy(sim, b.x, b.y); });
      },
      policy: function (sim) {
        return { aeration: 0.42, diversion: 0.45 };
      }
    },

    // 临界事件：脉冲期出现越限后提高曝气与引水，事件后回退
    critical: {
      label: '临界事件应对',
      deploy: function (sim) {
        hotspotBuoys(sim).forEach(function (b) { RT.placeBuoy(sim, b.x, b.y); });
      },
      policy: function (sim) {
        var agg = RT.aggregate(sim);
        if (agg.hotspotAlgae >= RT.TH.algae || agg.avgDo < RT.TH.doLow + 0.5) {
          return { aeration: 0.68, diversion: 0.72 }; // 接近但不超过 0.75 扰动线
        }
        // 前期干预不足，让营养盐脉冲推高藻密度，制造真实临界事件
        return { aeration: 0.12, diversion: 0.15 };
      }
    },

    // 处置失败：曝气过强扰动底泥 + 不设浮标（漏热点），鱼类死亡
    failure: {
      label: '处置失败（曝气过强/监测缺失）',
      deploy: function (sim) {
        // 故意只在下游放 1 个浮标，热点全部无观测
        RT.placeBuoy(sim, RT.GRID_W - 2, RT.GRID_H - 2);
      },
      policy: function () {
        return { aeration: 0.98, diversion: 0.05 };
      }
    }
  };

  RT.Scenarios = Scenarios;
  if (typeof module !== 'undefined' && module.exports) module.exports = RT;
})(typeof window !== 'undefined' ? window : globalThis);

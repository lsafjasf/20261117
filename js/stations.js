/* 站点元数据与地图投影（归一化坐标 0..1，模拟区域地图） */
(function (root) {
  'use strict';
  var RF = root.RF;

  // nx/ny 为归一化平面坐标；地图上叠加简单的河流与边界轮廓
  var STATIONS = [
    { id: 'S01', name: '北岭',   nx: 0.18, ny: 0.16, elev: 320 },
    { id: 'S02', name: '云顶',   nx: 0.42, ny: 0.12, elev: 510 },
    { id: 'S03', name: '东港',   nx: 0.78, ny: 0.20, elev: 12 },
    { id: 'S04', name: '西泉',   nx: 0.12, ny: 0.46, elev: 180 },
    { id: 'S05', name: '中部平原', nx: 0.44, ny: 0.44, elev: 45 },
    { id: 'S06', name: '临江',   nx: 0.66, ny: 0.48, elev: 28 },
    { id: 'S07', name: '东湖',   nx: 0.86, ny: 0.52, elev: 9 },
    { id: 'S08', name: '南山',   nx: 0.24, ny: 0.74, elev: 265 },
    { id: 'S09', name: '河谷',   nx: 0.50, ny: 0.72, elev: 60 },
    { id: 'S10', name: '南岭',   nx: 0.74, ny: 0.78, elev: 388 },
    { id: 'S11', name: '海角',   nx: 0.90, ny: 0.86, elev: 6 },
    { id: 'S12', name: '西南坳', nx: 0.08, ny: 0.88, elev: 140 }
  ];

  // 背景轮廓（归一化坐标）：区域边界与一条贯穿河流
  var BOUNDARY = [
    [0.05, 0.05], [0.95, 0.06], [0.97, 0.45], [0.94, 0.94],
    [0.55, 0.96], [0.06, 0.95], [0.03, 0.55]
  ];
  var RIVER = [
    [0.30, 0.02], [0.36, 0.25], [0.47, 0.40], [0.52, 0.58],
    [0.48, 0.74], [0.58, 0.98]
  ];

  function project(st, box) {
    return {
      x: box.x + st.nx * box.w,
      y: box.y + st.ny * box.h
    };
  }

  function projectPoint(nx, ny, box) {
    return { x: box.x + nx * box.w, y: box.y + ny * box.h };
  }

  RF.stations = {
    STATIONS: STATIONS,
    BOUNDARY: BOUNDARY,
    RIVER: RIVER,
    project: project,
    projectPoint: projectPoint,
    byId: function (id) {
      for (var i = 0; i < STATIONS.length; i++) {
        if (STATIONS[i].id === id) return STATIONS[i];
      }
      return null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

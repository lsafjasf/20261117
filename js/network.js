/* 线网静态配置：站点坐标、线路、时间窗口、换乘类型。浏览器与 Node 共用。 */
(function (global) {
  const App = (global.App = global.App || {});

  const WORLD = { width: 1000, height: 620 };
  const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

  // 16 个站点；带 transfer 的为两线换乘站
  const STATIONS = [
    { id: 'L1S1', name: '西山口', x: 70, y: 300 },
    { id: 'L1S2', name: '文化宫', x: 175, y: 300 },
    { id: 'L1S3', name: '人民广场', x: 285, y: 300, transfer: true },
    { id: 'L1S4', name: '市政府', x: 395, y: 300 },
    { id: 'L1S5', name: '中心医院', x: 505, y: 300 },
    { id: 'L1S6', name: '体育公园', x: 615, y: 300 },
    { id: 'L1S7', name: '科技园区', x: 725, y: 300 },
    { id: 'L1S8', name: '会展中心', x: 835, y: 300, transfer: true },
    { id: 'L1S9', name: '滨江路', x: 925, y: 300 },
    { id: 'L1S10', name: '东港', x: 975, y: 300 },
    { id: 'L2S1', name: '大学城', x: 120, y: 560 },
    { id: 'L2S2', name: '图书馆', x: 200, y: 435 },
    { id: 'L2S3', name: '人民广场', x: 285, y: 300, transfer: true, aliasOf: 'L1S3' },
    { id: 'L2S4', name: '火车站', x: 420, y: 470 },
    { id: 'L2S5', name: '汽车南站', x: 560, y: 560 },
    { id: 'L2S6', name: '金融街', x: 700, y: 430 },
    { id: 'L2S7', name: '会展中心', x: 835, y: 300, transfer: true, aliasOf: 'L1S8' },
    { id: 'L2S8', name: '机场', x: 940, y: 110 },
  ];

  const LINES = [
    { id: 'L1', name: '1 路（东西干线）', color: '#2563eb', stationIds: STATIONS.filter((s) => s.id.startsWith('L1')).map((s) => s.id) },
    { id: 'L2', name: '2 路（斜向联络线）', color: '#dc2626', stationIds: ['L2S1', 'L2S2', 'L2S3', 'L2S4', 'L2S5', 'L2S6', 'L2S7', 'L2S8'] },
  ];

  // 时间窗口（开始小时，结束小时，左闭右开）
  const WINDOWS = [
    { id: 'w_morning', name: '早高峰', startHour: 7, endHour: 9 },
    { id: 'w_midday', name: '午间平峰', startHour: 11, endHour: 14 },
    { id: 'w_evening', name: '晚高峰', startHour: 17, endHour: 19 },
    // 单小时窗口：缺失数据中 L1S4 在 8 点整桶缺失，配合该数据集可演示确定性空结果
    { id: 'w_h8', name: '单小时 08:00', startHour: 8, endHour: 9 },
    { id: 'w_all', name: '全天', startHour: 6, endHour: 22 },
    // 运营时间为 6–21 点，22 点窗口对任何数据集必然为空结果
    { id: 'w_night', name: '收班后 22:00', startHour: 22, endHour: 23 },
  ];

  const TRANSFER_TYPES = [
    { id: 'none', name: '非换乘', eventType: 'regular' },
    { id: 'transfer', name: '换乘', eventType: 'transfer' },
  ];

  // 每站每小时刷卡量上限，超过视为异常并截断
  const STATION_HOUR_CAP = 120;

  const stationById = {};
  STATIONS.forEach((s) => {
    stationById[s.id] = s;
  });

  function hoursOfWindow(win) {
    const out = [];
    for (let h = win.startHour; h < win.endHour; h++) out.push(h);
    return out;
  }

  App.network = {
    WORLD,
    HOURS,
    STATIONS,
    LINES,
    WINDOWS,
    TRANSFER_TYPES,
    STATION_HOUR_CAP,
    stationById,
    hoursOfWindow,
  };
})(typeof window !== 'undefined' ? window : globalThis);

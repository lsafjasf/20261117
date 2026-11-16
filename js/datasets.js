/* 三组可复现的原始逐小时雨量记录（含重复、缺失、异常） */
(function (root) {
  'use strict';
  var RF = root.RF;
  var H = RF.util.HOURS;

  // 物理上限：小时雨强超过 200 mm/h 视为异常（仪器故障/越界）
  var MAX_VALID = 200;

  function baseRain(stIndex, hour, rand) {
    // 日周期 + 两场系统性降雨过程 + 随机对流
    var diurnal = 1.2 + 1.1 * Math.sin((hour % 24 - 7) / 24 * Math.PI * 2);
    var storm1 = 14 * Math.exp(-Math.pow((hour - 36) / 7, 2));
    var storm2 = 22 * Math.exp(-Math.pow((hour - 108) / 9, 2)) *
      (0.7 + 0.3 * stIndex);
    var convection = Math.max(0, RF.util.gaussian(rand) * 1.8 + 1.2);
    var terrain = 0.4 + stIndex * 0.05;
    return Math.max(0, (diurnal + storm1 + storm2 + convection) * terrain);
  }

  function buildRecords(variant) {
    var rand = RF.util.rng(20261109 + variant.seed);
    var records = [];
    var missingKeys = {};

    if (variant.id === 'missing') {
      // 结构性缺失：3 段连续缺测 + 若干单点缺失
      var runs = [
        ['S03', 20, 27], ['S07', 70, 78], ['S11', 140, 151],
        ['S05', 96, 100]
      ];
      runs.forEach(function (r) {
        for (var h = r[1]; h <= r[2]; h++) missingKeys[r[0] + '#' + h] = true;
      });
      for (var i = 0; i < 26; i++) {
        var sid = RF.stations.STATIONS[Math.floor(rand() * 12)].id;
        missingKeys[sid + '#' + Math.floor(rand() * H)] = true;
      }
    }

    RF.stations.STATIONS.forEach(function (st, si) {
      for (var h = 0; h < H; h++) {
        if (missingKeys[st.id + '#' + h]) continue;
        var v = baseRain(si, h, rand);
        if (variant.id === 'anomaly') {
          // 注入异常：负值与超量程尖峰
          if ((h * 12 + si * 7) % 97 === 0) v = -(2 + rand() * 6);
          if ((h * 5 + si * 11) % 131 === 0) v = 220 + rand() * 180;
        }
        records.push({ stationId: st.id, hour: h, rain: round3(v) });
      }
    });

    // 重复记录：同一站点同一小时出现多条，去重时保留最后一条
    var dupCount = variant.id === 'normal' ? 16 : 12;
    for (var d = 0; d < dupCount; d++) {
      var st2 = RF.stations.STATIONS[Math.floor(rand() * 12)];
      var hh = Math.floor(rand() * H);
      if (missingKeys[st2.id + '#' + hh]) continue;
      records.push({
        stationId: st2.id,
        hour: hh,
        rain: round3(baseRain(RF.stations.STATIONS.indexOf(st2), hh, rand) +
          (rand() - 0.5) * 4)
      });
    }
    return records;
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  var VARIANTS = [
    { id: 'normal', name: '正常数据', seed: 1 },
    { id: 'missing', name: '缺失数据', seed: 2 },
    { id: 'anomaly', name: '异常数据', seed: 3 }
  ];

  var DATASETS = {};
  VARIANTS.forEach(function (v) {
    var records = buildRecords(v);
    DATASETS[v.id] = {
      id: v.id,
      name: v.name,
      records: records,
      rawCount: records.length,
      maxValid: MAX_VALID
    };
  });

  RF.datasets = {
    DATASETS: DATASETS,
    MAX_VALID: MAX_VALID,
    buildRecords: buildRecords
  };
})(typeof window !== 'undefined' ? window : globalThis);

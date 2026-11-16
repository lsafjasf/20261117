/* Node 冒烟测试：以最小浏览器垫片加载数据/管线/状态/导出/验证模块 */
'use strict';
const path = require('path');
const FS = require('fs');

global.window = global;
global.devicePixelRatio = 1;

function load(rel) {
  const code = FS.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(code).call(global);
}

[
  'js/util.js',
  'js/stations.js',
  'js/datasets.js',
  'js/pipeline.js',
  'js/state.js',
  'js/export.js',
  'js/tests.js'
].forEach(load);

const RF = global.RF;
const results = RF.tests.runAll();
let failed = 0;
results.forEach((r) => {
  console.log((r.pass ? 'PASS' : 'FAIL') + ' - ' + r.name +
    (r.pass ? '' : ' :: ' + r.error));
  if (!r.pass) failed++;
});

// 额外的管线体检：三组数据的网格完整性
Object.keys(RF.datasets.DATASETS).forEach((id) => {
  const p = RF.pipeline.process(RF.datasets.DATASETS[id]);
  const cells = RF.stations.STATIONS.length * RF.util.HOURS;
  const t = p.totals;
  const accounted = t.validCells + t.filledCells + t.missingCells;
  console.log(`[grid ${id}] cells=${cells} valid=${t.validCells} filled=${t.filledCells} ` +
    `missing=${t.missingCells} anomaly=${t.anomalyCells} dupRemoved=${t.dupRemoved} ` +
    `version=${p.version}`);
  if (accounted !== cells) {
    console.error('FAIL - 网格单元计数不平: ' + accounted + ' != ' + cells);
    failed++;
  }
});

process.exit(failed ? 1 : 0);

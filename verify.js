/* 一键验证:运行正常/越限/停机三类流程,导出 tablet-line-report/v1 报告 */
var fs = require('fs');
var path = require('path');
var BS = require('./sim.js');

var sim = new BS.Sim();
var normal = sim.runScenario('normal');
var over = sim.runScenario('overlimit');
var shut = sim.runScenario('shutdown');

var report = sim.buildReport();
var out = path.join(__dirname, 'artifacts', 'verification-report.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));

var ok = true;
function check(cond, msg) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) ok = false; }

check(normal.batchDone && normal.good === 12 && normal.faults.length === 0, '正常生产: 12/12 无故障');
check(over.faults.length >= 1 && over.recoveries.length >= 1 && over.batchDone, '参数越限: 触发保护停机并恢复');
check(shut.faults.length >= 1 && shut.recoveries.length >= 1 && shut.batchDone, '设备停机: 停机引发故障并恢复');
check(shut.anomalies.some(function (a) { return a.pos.indexOf('灌装头') >= 0; }), '设备停机: 剔除异常定位到瓶位');
check(report.validationSummary.passed, '报告: 三类流程全部通过');
check(report.summary.cachePersistedAcrossReload === false, '报告: 重开不保留旧缓存');

console.log('报告已写入 ' + out);
console.log('良品率: 正常=' + normal.yieldRate + '% 越限=' + over.yieldRate + '% 停机=' + shut.yieldRate + '%');
process.exit(ok ? 0 : 1);

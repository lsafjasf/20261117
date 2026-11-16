/* Node 验证:正常生产 / 参数越限 / 设备停机 三类流程 */
var BS = require('./sim.js');

function run(name) {
  var sim = new BS.Sim();
  var r = sim.runScenario(name);
  console.log('=== ' + r.label + ' ===');
  console.log('批次完成=' + r.batchDone + ' 良品=' + r.good + '/' + r.total +
    ' 良品率=' + r.yieldRate + '% 峰值功率=' + r.peakPower + ' 峰值缓存=' + r.peakCache +
    ' 能耗=' + r.energy + ' 结束时刻=' + r.endTime + 's');
  r.faults.forEach(function (f) {
    console.log('  故障 t=' + f.t + 's [' + f.pos + '] ' + f.detail +
      ' | 数值: 振动=' + f.values.vib + ' 闸门=' + f.values.gate + ' 传送=' + f.values.conv +
      ' 缓存=' + f.values.cache + ' 卡料=' + f.values.jam);
  });
  r.recoveries.forEach(function (rc) {
    console.log('  恢复 t=' + rc.t + 's ' + rc.detail);
  });
  r.anomalies.slice(0, 6).forEach(function (a) {
    console.log('  异常 t=' + a.t + 's [' + a.pos + '] 瓶=' + (a.bottle + 1) + ' ' + a.detail);
  });
  return r;
}

var normal = run('normal');
var over = run('overlimit');
var shut = run('shutdown');

var ok = true;
function check(cond, msg) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) ok = false; }

check(normal.batchDone && normal.good === 12, '正常生产: 12/12 全部计数正确');
check(normal.faults.length === 0, '正常生产: 无故障');
check(over.faults.length >= 1 && over.faults[0].t > 5, '参数越限: 越限后触发保护停机');
check(over.recoveries.length >= 1 && over.batchDone, '参数越限: 排除故障后恢复并完成批次');
check(shut.faults.length >= 1, '设备停机: 停机引发卡料/故障');
check(shut.anomalies.some(function (a) { return a.pos.indexOf('灌装头') >= 0; }), '设备停机: 产生剔除异常并定位瓶位');
check(shut.recoveries.length >= 1 && shut.batchDone, '设备停机: 恢复后完成批次');

// 重开不保留旧缓存
var sim2 = new BS.Sim();
sim2.cache = 123;
sim2.resetBatch('test');
check(sim2.cache === 60 && sim2.bottles.length === 0 && sim2.falling.length === 0, '批次重置: 不保留旧缓存');

// 换规格清空缓存
var sim3 = new BS.Sim();
sim3.cache = 100;
sim3.setSpec('L');
check(sim3.cache === 0 && sim3.specKey === 'L', '换规格: 缓存被清空');

process.exit(ok ? 0 : 1);

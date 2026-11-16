/* Node 端验证入口：多 seed 跑稳态/临界/失败/复现/残留全部断言 */
globalThis.window = globalThis;
require('../js/rng.js');
require('../js/config.js');
require('../js/sim.js');
require('../js/validate.js');

const seeds = [1, 7, 42, 99, 2026, 31337];
let failures = 0;
for (const seed of seeds) {
  const report = BeeValidate.runAll(seed);
  const bad = report.checks.filter((c) => !c.pass);
  if (bad.length) {
    failures += bad.length;
    console.error('seed', seed, 'FAIL:');
    bad.forEach((c) => console.error('  -', c.name, '::', c.detail));
  } else {
    console.log('seed', seed, 'ALL', report.checks.length, 'CHECKS PASS');
  }
}
if (failures) {
  console.error(failures + ' 项断言失败');
  process.exit(1);
}
console.log('\n全部 seed 的 ' + seeds.length + ' 组验证通过（稳态 / 临界 / 处置失败 / 花期超时 / 复现 / 残留）');

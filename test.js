// node 验证入口:node test.js
const { runVerification } = require('./js/verify.js');
const { report, pass } = runVerification('ranch-verify');
for (const r of report) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  -- ${r.detail}`);
}
console.log(pass ? '全部验证通过' : '存在未通过项');
process.exit(pass ? 0 : 1);

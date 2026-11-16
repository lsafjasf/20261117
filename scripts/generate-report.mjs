import { writeFile } from "node:fs/promises";
import { BoxMachine } from "../js/engine.js";
import { runAllValidations } from "../js/validation.js";

const machine = new BoxMachine();
machine.startBatch({ reason: "报告任务：正常生产" });

for (let index = 0; index < 30000; index += 1) {
  if (machine.mode === "paused" && machine.changeoverPending) {
    machine.applyRecommended(machine.currentSize);
    machine.resumeBatch("报告任务：换型继续");
  }
  if (["complete", "failed"].includes(machine.mode)) break;
  machine.update(0.05);
}

const validations = runAllValidations();
const report = machine.buildReport(validations);
await writeFile("artifacts/batch-report.json", `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      goodCount: report.summary.goodCount,
      target: report.summary.target,
      yieldRate: report.summary.yieldRate,
      peakPowerKw: report.summary.peakPowerKw,
      stopReasons: report.summary.stopReasons,
      validationPassed: validations.passed,
      anomalyLocation: validations.results.extreme.anomalyLocation
    },
    null,
    2
  )
);

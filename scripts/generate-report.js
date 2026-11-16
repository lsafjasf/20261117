import { writeFileSync } from "node:fs";
import {
  BATCHES,
  advance,
  createSimulation,
  currentBatch,
  loadNextBatch,
  resetSession,
  setParameter,
  startProduction
} from "../src/simulation.js";
import { buildFullReport, runAllScenarios } from "../src/validation.js";

const sim = createSimulation();
setParameter(sim, "temp", 54);
startProduction(sim);
advance(sim, 20);
resetSession(sim);
for (let index = 0; index < BATCHES.length; index += 1) {
  if (index > 0) loadNextBatch(sim);
  for (const [key, value] of Object.entries(currentBatch(sim).recommended)) {
    setParameter(sim, key, value, { source: "report-generator" });
  }
  startProduction(sim);
  advance(sim, 360);
}

const scenarios = runAllScenarios();
const report = buildFullReport(sim, scenarios);
report.validationSummary = {
  passed: scenarios.filter((scenario) => scenario.passed).length,
  total: scenarios.length,
  allPassed: scenarios.every((scenario) => scenario.passed)
};
writeFileSync(
  "artifacts/validation-report.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
console.log(
  `good=${report.goodUnits}/${report.inspectedUnits} yield=${report.goodRatePercent}% ` +
    `peak=${report.peakKw}kW validation=${report.validationSummary.passed}/${report.validationSummary.total}`
);

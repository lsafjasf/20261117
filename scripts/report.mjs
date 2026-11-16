import { writeFileSync } from "node:fs";
import { AIRLINES, SCENARIOS, buildSnapshot, processFlights } from "../js/data.js";
import { buildExportModel } from "../js/export.js";
import { runValidationTests } from "../js/validation.js";

const allAirlines = Object.keys(AIRLINES);
const datasets = Object.fromEntries(
  Object.values(SCENARIOS).map((scenario) => {
    const processed = processFlights(scenario.flights);
    return [
      scenario.id,
      {
        label: scenario.label,
        note: scenario.note,
        quality: processed.quality,
        routeCounts: Object.fromEntries(
          processed.flights.reduce((entries, flight) => {
            entries.set(flight.routeKey, (entries.get(flight.routeKey) ?? 0) + 1);
            return entries;
          }, new Map()),
        ),
      },
    ];
  }),
);

const normal = buildSnapshot({
  scenarioId: "normal",
  windowId: "morning",
  airlines: allAirlines,
});
const empty = buildSnapshot({
  scenarioId: "normal",
  windowId: "morning",
  airlines: [],
});
const model = buildExportModel(normal);
const tests = runValidationTests();

const report = {
  generatedAt: new Date().toISOString(),
  dataDate: normal.date,
  currentFilter: {
    scenario: normal.scenarioLabel,
    window: normal.window.range,
    airlines: normal.airlines,
    definition: "延误 > 15 分钟；取消不计入平均延误；航线宽度 = 去重后班次量",
  },
  datasetSummary: {
    sourceRows: normal.quality.sourceRows,
    accepted: normal.quality.accepted,
    duplicatesRemoved: normal.quality.duplicatesRemoved,
    repairedMissing: normal.quality.repairedMissing,
    repairedInvalid: normal.quality.repairedInvalid,
    cancellationCount: normal.quality.cancellationCount,
  },
  normalFilter: {
    flights: normal.summary.flights,
    routes: normal.summary.routes,
    avgDelay: Number(normal.summary.avgDelay.toFixed(2)),
    cancelRate: Number((normal.summary.cancelRate * 100).toFixed(2)),
    dataVersion: normal.dataVersion,
    viewVersion: normal.viewVersion,
  },
  emptyResult: {
    flights: empty.summary.flights,
    routes: empty.summary.routes,
    avgDelay: empty.summary.avgDelay,
  },
  exportSnapshot: {
    viewVersion: model.viewVersion,
    flights: model.summary.flights,
    routes: model.summary.routes,
    avgDelay: model.summary.avgDelay,
    cancelRate: model.summary.cancelRate,
    synchronized:
      model.viewVersion === normal.viewVersion &&
      model.summary.flights === normal.summary.flights &&
      model.summary.routes === normal.summary.routes &&
      model.summary.avgDelay === normal.summary.avgDelay &&
      model.summary.cancelRate === normal.summary.cancelRate,
  },
  datasets,
  validation: {
    passed: tests.filter((test) => test.pass).length,
    total: tests.length,
    tests,
  },
};

writeFileSync("artifacts/verification.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote artifacts/verification.json · ${report.validation.passed}/${report.validation.total} tests passed`);

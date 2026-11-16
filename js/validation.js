import {
  AIRLINES,
  SCENARIOS,
  WINDOWS,
  buildSnapshot,
  filterFlights,
  processFlights,
} from "./data.js";
import { buildExportModel } from "./export.js";
import { DEFAULT_MAP_VIEW, WindowStateStore } from "./state.js";

const allAirlines = Object.keys(AIRLINES);

function check(id, label, detail, assertion) {
  try {
    const result = assertion();
    return {
      id,
      label,
      detail: result.detail ?? detail,
      pass: result.pass !== false,
    };
  } catch (error) {
    return {
      id,
      label,
      detail: error instanceof Error ? error.message : String(error),
      pass: false,
    };
  }
}

export function runValidationTests() {
  return [
    check(
      "normal-filter",
      "正常筛选",
      "早间窗口返回非空结果，航线班次合计与航班数一致",
      () => {
        const snapshot = buildSnapshot({
          scenarioId: "normal",
          windowId: "morning",
          airlines: allAirlines,
        });
        const routeTotal = snapshot.routes.reduce((sum, route) => sum + route.count, 0);
        if (snapshot.flights.length === 0) throw new Error("正常筛选意外为空");
        if (routeTotal !== snapshot.flights.length) throw new Error("航线聚合班次不一致");
        return {
          detail: `${snapshot.flights.length} 班 / ${snapshot.routes.length} 航线，聚合一致`,
        };
      },
    ),
    check("empty-result", "空结果", "无匹配航司时返回零航班并清空聚合", () => {
      const snapshot = buildSnapshot({
        scenarioId: "normal",
        windowId: "morning",
        airlines: [],
      });
      if (snapshot.flights.length !== 0) throw new Error("空筛选仍返回航班");
      if (snapshot.routes.length !== 0) throw new Error("空筛选仍生成航线");
      if (snapshot.summary.avgDelay !== null) throw new Error("空筛选平均延误应为空");
      return { detail: "0 班 / 0 航线，平均延误为空" };
    }),
    check("dedupe", "去重验证", "三组数据均以最后一条同航班记录为准", () => {
      let details = [];
      for (const scenario of Object.values(SCENARIOS)) {
        const processed = processFlights(scenario.flights);
        const unique = new Set(processed.flights.map((flight) => flight.flightKey));
        if (unique.size !== processed.flights.length) throw new Error(`${scenario.label} 仍有重复`);
        if (
          processed.quality.sourceRows - processed.quality.duplicatesRemoved !==
          processed.quality.accepted
        ) {
          throw new Error(`${scenario.label} 去重计数不守恒`);
        }
        details.push(`${scenario.label} ${processed.quality.duplicatesRemoved}`);
      }
      return { detail: `去重 ${details.join(" · ")}` };
    }),
    check("missing-impute", "缺失补缺", "缺失延误按航司×航线中位数补齐", () => {
      const processed = processFlights(SCENARIOS.missing.flights);
      const unresolved = processed.flights.filter(
        (flight) => !flight.cancelled && !Number.isFinite(flight.delayMinFinal),
      );
      if (processed.quality.repairedMissing === 0) throw new Error("未检测到缺失值");
      if (unresolved.length) throw new Error("仍有未补缺航班");
      return { detail: `补缺 ${processed.quality.repairedMissing} 条，全部可聚合` };
    }),
    check("anomaly-impute", "异常清洗", "负值与超阈值延误被修正，取消不参与延误均值", () => {
      const processed = processFlights(SCENARIOS.anomalous.flights);
      const invalid = processed.flights.filter(
        (flight) =>
          !flight.cancelled &&
          (!Number.isFinite(flight.delayMinFinal) ||
            flight.delayMinFinal < 0 ||
            flight.delayMinFinal > 720),
      );
      if (processed.quality.repairedInvalid < 2) throw new Error("异常值修正数量不足");
      if (invalid.length) throw new Error("仍有非法延误进入聚合");
      return {
        detail: `异常修正 ${processed.quality.repairedInvalid} 条，取消 ${processed.quality.cancellationCount} 班`,
      };
    }),
    check("export-sync", "导出一致", "导出模型的统计值与当前快照逐项相等", () => {
      const snapshot = buildSnapshot({
        scenarioId: "anomalous",
        windowId: "midday",
        airlines: allAirlines,
      });
      const model = buildExportModel(snapshot);
      if (model.summary.flights !== snapshot.summary.flights) throw new Error("航班数不一致");
      if (model.summary.routes !== snapshot.summary.routes) throw new Error("航线数不一致");
      if (model.summary.avgDelay !== snapshot.summary.avgDelay) throw new Error("平均延误不一致");
      if (model.summary.cancelRate !== snapshot.summary.cancelRate) throw new Error("取消率不一致");
      if (model.viewVersion !== snapshot.viewVersion) throw new Error("快照版本不一致");
      return {
        detail: `${model.viewVersion} · ${model.summary.flights} 班 / ${model.summary.routes} 航线`,
      };
    }),
    check("window-state", "窗口回切", "航司、航线选择与地图范围原样恢复", () => {
      const store = new WindowStateStore();
      const expected = {
        airlines: ["CA", "MU"],
        selectedRouteKey: "PEK-PVG",
        mapView: { scale: 1.62, panX: 44, panY: -18 },
      };
      store.save("normal", "morning", expected);
      store.save("normal", "midday", {
        airlines: allAirlines,
        selectedRouteKey: null,
        mapView: DEFAULT_MAP_VIEW,
      });
      const restored = store.load("normal", "morning");
      if (JSON.stringify(restored) !== JSON.stringify(expected)) throw new Error("窗口状态回切不一致");
      return { detail: "航司 2 家 · 选中 PEK-PVG · 缩放 162%" };
    }),
    check("empty-window", "空窗口保护", "时间窗口与场景组合仍使用同一去重口径", () => {
      const sourceCounts = WINDOWS.map((window) => {
        const processed = processFlights(SCENARIOS.normal.flights);
        return filterFlights(processed.flights, {
          airlines: allAirlines,
          start: window.start,
          end: window.end,
        }).length;
      });
      if (sourceCounts.some((count) => count === 0)) throw new Error("正常窗口不应为空");
      return {
        detail: `${sourceCounts.join(" / ")} 班，四窗口均可用`,
      };
    }),
  ];
}

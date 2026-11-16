# 统一输入状态机：基线 / 修复 / 边界 对比报告

运行 `npm test` 重新生成 `artifacts/results/results.json`；`npm run verify` 执行 20 项断言。

## 修复内容

- 所有指针/滚轮事件进入单一有序入口 `InputStateMachine.handle()`，
  状态机 `IDLE / DOWN / DRAG / INERTIA / PINCH / LIFT` 消除点击、拖动、
  滚轮、双指之间的顺序竞争（`src/input/state-machine.js`）。
- 单击仅在 `DOWN` 状态、250ms 内、位移 < 4 逻辑像素时发出；惯性拖动与
  双指缩放结束后的 `pointerup` 不再产生多余单击（`PINCH -> LIFT` 冷却态
  重新锚定，剩余手指移动不再跳位）。
- 坐标统一在逻辑（CSS 像素）空间计算，画布上下文预乘 `devicePixelRatio`
  （`src/input/coords.js`），在 dpr = 1 / 2 / 3 下导出结果逐字节一致。
- 可观测指标（4 项）：帧时间 avg/p95、空间缓存命中率、活动节点数、
  候选碰撞数（`src/metrics.js`）。

## 手势场景（同一脚本回放）

| 运行 | 帧均时 | p95 | 缓存命中 | 活动节点 | 候选碰撞 | 单击数 | B 终点 |
|---|---|---|---|---|---|---|---|
| legacy dpr=1（基线） | 0.019ms | 0.039ms | 0.1235 | 3 | 227 | 3 | (474.01, 304.40) |
| legacy dpr=2（基线） | 0.010ms | 0.015ms | 0.1124 | 3 | 251 | 3 | **(648.98, 409.39) 跳位** |
| fsm dpr=1（修复） | 0.006ms | 0.012ms | 0.1250 | 3 | 226 | 2 | (474.01, 304.40) |
| fsm dpr=2（修复） | 0.008ms | 0.020ms | 0.1250 | 3 | 226 | 2 | (474.01, 304.40) |
| fsm dpr=3（修复） | 0.006ms | 0.010ms | 0.1250 | 3 | 226 | 2 | (474.01, 304.40) |

- 基线缺陷复现：dpr=2 时 legacy 把设备像素位移直接加到逻辑坐标，B 对象
  偏移约 211px；双指缩放结束触发多余单击（选中 C）。
- 修复后三档 DPR 导出与帧摘要完全一致；dpr=1 下节点位置与缩放与基线
  逐一相等（画面与数据语义未改变）。

## 边界输入场景（错误输入结果）

输入： stray pointerup / 重复 pointerdown / pointercancel / NaN 坐标 /
NaN 滚轮 / 1e9 滚轮 / 未按下先移动。

- 修复版：0 次单击、0 异常，5 条可诊断告警（`input.strayup`、
  `input.dupdown`、`input.badcoords`、`input.badwheel` 等，含 pointerId
  与状态机状态），节点位置不变，缩放被钳制在 [0.25, 4] 且保持有限。
- 基线版（对照）：3 次伪单击；NaN 滚轮把 `viewport.zoom` 污染为 NaN
  （导出 JSON 中为 `null`），渲染活动节点数归零 —— 即"对象消失"类故障的
  根因证据，保留在 `artifacts/results/results.json` 中。

## 资源释放与复跑

- `dispose()` 后 listeners / timers / 网格缓存 / 网格单元 / 节点 全部为 0。
- 同一手势脚本复跑：导出逐字节一致；缓存命中率 delta = 0；
  帧均时比值 0.75（无持续恶化）。

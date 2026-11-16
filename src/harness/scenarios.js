// Deterministic event scripts. The SAME gesture script is replayed against
// the legacy handler (baseline) and the state machine (fixed), at multiple
// devicePixelRatio values, so outputs are directly comparable.
import { Clock } from "../metrics.js";
import { CanvasApp } from "../app.js";
import { LegacyInput } from "../input/legacy.js";
import { InputStateMachine } from "../input/state-machine.js";

export const NODES = [
  { id: "A", x: 100, y: 100, r: 20, color: "#3366cc" },
  { id: "B", x: 300, y: 200, r: 25, color: "#33aa66" },
  { id: "C", x: 500, y: 400, r: 30, color: "#aa3366" },
];

export function buildApp(inputImpl, { dpr = 1, seed = 7 } = {}) {
  const clock = new Clock(1000);
  const app = new CanvasApp({ width: 800, height: 600, dpr, inputImpl, clock });
  for (const n of NODES) app.scene.addNode(n.id, n.x, n.y, n.r, n.color);
  app.addListener("pointerdown");
  app.addListener("pointermove");
  app.addListener("pointerup");
  app.addListener("pointercancel");
  app.addListener("wheel");
  return app;
}

function ev(type, props, t) {
  return { type, timeStamp: t, ...props };
}

// The canonical gesture sequence: click, drag-with-inertia, tap after
// inertia, pinch zoom, wheel zoom. Coordinates are CSS pixels.
export function gestureScript() {
  const s = [];
  let t = 0;
  const step = 16.7;
  const push = (e, frames = 1) => {
    s.push({ event: e, frames });
    t += step;
  };
  // 1. Plain click on node A.
  push(ev("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 }, t));
  t += 80;
  push(ev("pointerup", { pointerId: 1, clientX: 100, clientY: 100 }, t), 2);
  // 2. Drag node B by (50, 30) logical px, release with velocity -> inertia.
  push(ev("pointerdown", { pointerId: 1, clientX: 300, clientY: 200 }, t));
  const dragSteps = [
    [310, 206], [320, 212], [330, 218], [340, 224], [350, 230],
  ];
  for (const [x, y] of dragSteps) {
    push(ev("pointermove", { pointerId: 1, clientX: x, clientY: y }, t));
  }
  push(ev("pointerup", { pointerId: 1, clientX: 350, clientY: 230 }, t), 80);
  // 3. Tap on empty space AFTER inertia has fully decayed (legit click).
  push(ev("pointerdown", { pointerId: 1, clientX: 600, clientY: 100 }, t));
  t += 60;
  push(ev("pointerup", { pointerId: 1, clientX: 600, clientY: 100 }, t), 2);
  // 4. Pinch on node C: two fingers down, spread, lift both.
  push(ev("pointerdown", { pointerId: 1, clientX: 490, clientY: 400 }, t));
  push(ev("pointerdown", { pointerId: 2, clientX: 510, clientY: 400 }, t));
  push(ev("pointermove", { pointerId: 2, clientX: 530, clientY: 400 }, t), 3);
  push(ev("pointerup", { pointerId: 2, clientX: 530, clientY: 400 }, t));
  push(ev("pointerup", { pointerId: 1, clientX: 490, clientY: 400 }, t), 5);
  // 5. Wheel zoom in at viewport center.
  push(ev("wheel", { clientX: 400, clientY: 300, deltaY: -100, deltaMode: 0 }, t), 3);
  return s;
}

// Boundary / erroneous inputs: out-of-order, duplicated, cancelled, NaN,
// and extreme values. Must never throw; every rejection stays logged.
export function boundaryScript() {
  const s = [];
  let t = 0;
  const push = (e, frames = 1) => {
    s.push({ event: e, frames });
    t += 16.7;
  };
  push(ev("pointerup", { pointerId: 99, clientX: 10, clientY: 10 }, t));
  push(ev("pointermove", { pointerId: 98, clientX: 10, clientY: 10 }, t));
  push(ev("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 }, t));
  push(ev("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 }, t)); // dup
  push(ev("pointercancel", { pointerId: 1, clientX: 100, clientY: 100 }, t));
  push(ev("pointerup", { pointerId: 1, clientX: 100, clientY: 100 }, t)); // stray
  push(ev("pointerdown", { pointerId: 2, clientX: NaN, clientY: 50 }, t));
  push(ev("pointerdown", { pointerId: 3, clientX: 490, clientY: 400 }, t));
  push(ev("pointerdown", { pointerId: 4, clientX: 510, clientY: 400 }, t));
  push(ev("pointercancel", { pointerId: 4, clientX: 510, clientY: 400 }, t));
  push(ev("pointerup", { pointerId: 3, clientX: 490, clientY: 400 }, t));
  push(ev("wheel", { clientX: 400, clientY: 300, deltaY: NaN, deltaMode: 0 }, t));
  push(ev("wheel", { clientX: 400, clientY: 300, deltaY: 1e9, deltaMode: 0 }, t));
  push(ev("wheel", { clientX: 400, clientY: 300, deltaY: -3, deltaMode: 1 }, t));
  push(ev("pointermove", { pointerId: 5, clientX: 200, clientY: 200 }, t));
  return s;
}

export function runScript(app, script) {
  for (const { event, frames } of script) {
    app.dispatch(event);
    app.runFrames(frames);
  }
}

export const IMPLS = { legacy: LegacyInput, fsm: InputStateMachine };

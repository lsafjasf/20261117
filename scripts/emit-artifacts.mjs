import { writeFile, mkdir } from "node:fs/promises";
import { createStore } from "../src/core/store.js";
import { createInitialState, reducer } from "../src/core/reducer.js";
import { buildSampleProject } from "../src/core/sampleProject.js";
import { exportPng, exportProgram } from "../src/core/exporter.js";

const store = createStore(reducer, createInitialState(buildSampleProject()));
const { timeline, sources } = store.getState();
await mkdir("artifacts/out", { recursive: true });

const png = await exportPng(timeline, sources, 4.5, "16:9");
await writeFile("artifacts/out/frame-4.5s.png", png);

const program = await exportProgram(timeline, sources, { fps: 4, width: 192, height: 108 });
await writeFile("artifacts/out/program.apng", program.apng);
await writeFile("artifacts/out/program.wav", program.wav);

console.log(JSON.stringify({
  pngBytes: png.length,
  apngBytes: program.apng.length,
  wavBytes: program.wav.length,
  frameCount: program.frameCount,
  durationSeconds: program.durationSeconds,
  audioDurationSeconds: program.audioDurationSeconds
}, null, 2));

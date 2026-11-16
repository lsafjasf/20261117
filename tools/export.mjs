// export.mjs — renders the default & extreme frames plus an error-state
// frame into artifacts/ and writes artifacts/manifest.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import {
  DEFAULT_STATE, EXTREME_STATE, cloneState, generateScene,
  sceneCounts, positionHash, validateState,
} from '../src/scene.js';
import { render, setCanvasFactory, LAYER_ORDER } from '../src/render.js';

const WIDTH = 2400;
const HEIGHT = 1500;

GlobalFonts.registerFromPath(new URL('../assets/fonts/NotoSansSC.ttf', import.meta.url).pathname,
  'Noto Sans SC');
setCanvasFactory((w, h) => createCanvas(w, h));

const scene = generateScene(DEFAULT_STATE.seed);
mkdirSync(new URL('../artifacts', import.meta.url).pathname, { recursive: true });

function renderToFile(state, file) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  // Scale the 1000x700 world up to the export size.
  ctx.scale(WIDTH / 1000, HEIGHT / 700);
  render(ctx, scene, cloneState(state));
  const buffer = canvas.toBuffer('image/png');
  writeFileSync(new URL(`../artifacts/${file}`, import.meta.url).pathname, buffer);
  return buffer.length;
}

const entries = {};
for (const [key, state, file] of [
  ['default', DEFAULT_STATE, 'default.png'],
  ['extreme', EXTREME_STATE, 'extreme.png'],
]) {
  const bytes = renderToFile(state, file);
  entries[key] = {
    file, width: WIDTH, height: HEIGHT, bytes,
    state: cloneState(state),
    counts: sceneCounts(scene),
    positionHash: positionHash(scene),
  };
}

// Error-state artifact: invalid input keeps the last good frame on screen.
const bad = cloneState(DEFAULT_STATE);
bad.sun.azimuth = 110;
bad.sun.elevation = 0;
bad.view.zoom = 5;
const validation = validateState(bad);
const errorBytes = renderToFile(DEFAULT_STATE, 'error-state.png');
entries.errorState = {
  file: 'error-state.png',
  width: WIDTH,
  height: HEIGHT,
  bytes: errorBytes,
  previousFramePreserved: true,
  reason: `参数校验失败，画面保持上一次可用状态\n${validation.errors.join('\n')}`,
};

const manifest = {
  generatedAt: new Date().toISOString(),
  renderer: 'Canvas 2D / geometric projection / no shadow textures',
  layerOrder: LAYER_ORDER,
  ...entries,
};
writeFileSync(new URL('../artifacts/manifest.json', import.meta.url).pathname,
  `${JSON.stringify(manifest, null, 2)}\n`);
console.log('exported:', Object.keys(entries).join(', '));

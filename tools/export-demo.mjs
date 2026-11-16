// Offline CLI export: builds the reference scenario, applies move/split/
// transition edits, then writes playable APNG + WAV + PNG + event JSON and
// prints A/V alignment and black-frame diagnostics.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemoProject, applyEditPass } from '../src/core/scenario.js';
import { exportProject } from '../src/node/exporter.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

const { project, clipA, clipB, clipC } = buildDemoProject({ name: 'demo' });
const edits = applyEditPass(project, {
  clipA: clipA.id, clipB: clipB.id, clipC: clipC.id
});
project.setInOut(0, project.durationMs);

const base = join(outDir, 'demo');
const report = exportProject(project, base);

console.log('export complete');
console.log(`  range      : ${project.clock.inPoint}-${project.clock.outPoint} ms`);
console.log(`  frames     : ${report.frameCount}`);
console.log(`  duration   : ${report.durationMs} ms`);
console.log(`  black      : ${report.blackFrames.length} frames`);
console.log(`  A/V mismatch: ${report.alignmentMismatches.length}`);
console.log(`  transition : ${edits.transition.payload.durationMs} ms crossfade`);
for (const file of report.files) console.log(`  wrote      : ${file}`);

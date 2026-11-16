// Generates the default and extreme scenes as editable SVG plus raster PNG,
// and writes a test summary into artifacts/.
import { writeFile, mkdir } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { serializeSVG } from '../src/render.js';
import { defaultScene, extremeScene } from '../src/state.js';
import { layoutScene } from '../src/layout.js';

const SIZE = { width: 1280, height: 720 };
const OUT = new URL('../artifacts/', import.meta.url);

async function build(name, scene) {
  const { svg, layout } = serializeSVG(scene, scene.view, SIZE);
  await writeFile(new URL(`${name}.svg`, OUT), svg, 'utf8');
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE.width } });
  const png = resvg.render().asPng();
  await writeFile(new URL(`${name}.png`, OUT), png);
  return {
    name,
    layers: scene.layers.length,
    glyphs: layout.totalGlyphs,
    paths: (svg.match(/<path /g) || []).length,
    bounds: layout.layers.map((layer) => ({
      id: layer.id,
      order: layer.order,
      position: layer.position,
      width: Math.round(layer.bounds.width),
      height: Math.round(layer.bounds.height),
      lines: layer.bounds.lines
    }))
  };
}

mkdir(OUT, { recursive: true });
const summaries = [];
summaries.push(await build('default-scene', defaultScene()));
summaries.push(await build('extreme-scene', extremeScene()));
await writeFile(
  new URL('artifact-summary.json', OUT),
  JSON.stringify(summaries, null, 2),
  'utf8'
);
console.log(JSON.stringify(summaries, null, 2));

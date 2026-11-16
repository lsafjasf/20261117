/* Headless renderer: emits default + extreme PNG/OBJ artifacts via the
   same core modules used by the browser (no model loading, no deps). */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function load(rel) {
  global.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}
['js/core/math3d.js', 'js/core/params.js', 'js/core/geometry.js',
 'js/core/handle.js', 'js/core/mesh.js', 'js/core/png.js',
 'js/core/rasterizer.js', 'js/core/scene.js'
].forEach(load);

const T = global.TeaCup;
const outDir = path.join(ROOT, 'artifacts');

function shoot(name, params, layers) {
  const mesh = T.mesh.buildMesh(params);
  const spec = {
    width: 640, height: 480, yaw: 0.7, pitch: 0.3, fovy: 50
  };
  const buf = T.scene.render(mesh, spec, layers);
  fs.writeFileSync(path.join(outDir, name + '.png'),
    Buffer.from(T.png.encode(buf.rgb, 640, 480)));
  fs.writeFileSync(path.join(outDir, name + '.obj'), T.mesh.toOBJ(mesh));
  console.log(name + ': ' + mesh.vertices.length + ' 顶点, ' +
    mesh.faces.length + ' 面 -> artifacts/' + name + '.png/.obj');
}

shoot('teacup-default', T.params.DEFAULT_PARAMS,
  { shadow: true, wireframe: true });
shoot('teacup-extreme', T.params.EXTREME_PARAMS,
  { shadow: true, wireframe: true });
console.log('done');

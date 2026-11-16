/**
 * Browser controller: canvas rendering loop, profile-point dragging,
 * orbit controls, layer toggles, autosave / presets / export.
 * Invalid input never replaces the last good mesh: an error banner shows
 * the reason and the previous frame stays on screen.
 */
(function (global) {
  'use strict';
  var T = global.TeaCup;
  var paramsMod = T.params, meshMod = T.mesh, scene = T.scene,
    storage = T.storage, png = T.png;

  var W = 640, H = 480;

  function defaultState() {
    return {
      params: paramsMod.clone(paramsMod.DEFAULT_PARAMS),
      view: { yaw: 0.6, pitch: 0.28, scale: 1, fovy: 50 },
      layers: { shadow: true, wireframe: false },
      autoRotate: false
    };
  }

  function createApp(canvas) {
    var ctx = canvas.getContext('2d');
    var state = defaultState();
    var mesh = null, lastError = '', draftError = '';
    var paused = false, drag = null, frameNo = 0;

    function rebuild(nextParams) {
      var result = paramsMod.validate(nextParams);
      if (!result.valid) {
        lastError = result.errors.map(function (e) {
          return '• ' + e.message;
        }).join('\n');
        draftError = lastError;
        return false;
      }
      state.params = result.sanitized;
      mesh = meshMod.buildMesh(state.params);
      lastError = '';
      draftError = '';
      if (paused) draw();
      return true;
    }

    function draw() {
      var spec = { width: W, height: H, yaw: state.view.yaw,
        pitch: state.view.pitch, userZoom: state.view.scale,
        fovy: state.view.fovy, activePoint: drag && drag.type === 'point'
          ? drag.pointId : null };
      var buf = scene.render(mesh, spec, state.layers);
      var image = ctx.createImageData(W, H);
      for (var i = 0, j = 0; i < buf.rgb.length; i++, j += 4) {
        image.data[j] = buf.rgb[i];
        image.data[j + 1] = buf.rgb[i + 1];
        image.data[j + 2] = buf.rgb[i + 2];
        image.data[j + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      frameNo++;
      return buf;
    }

    function autosave() {
      storage.saveAutosave({
        params: state.params, view: state.view, layers: state.layers,
        autoRotate: state.autoRotate
      });
    }

    function restore() {
      var saved = storage.loadAutosave();
      if (!saved) return false;
      var s = saved.state;
      if (s && s.params && rebuild(s.params)) {
        if (s.view) state.view = Object.assign(state.view, s.view);
        if (s.layers) state.layers = Object.assign(state.layers, s.layers);
        state.autoRotate = !!s.autoRotate;
        return true;
      }
      return false;
    }

    function currentCameraSpec() {
      var radius = Math.max(mesh.bbox.size[0], mesh.bbox.size[1],
        mesh.bbox.size[2]) / 2;
      var aspect = W / H, fovy = state.view.fovy * Math.PI / 180;
      var fitFov = Math.min(fovy,
        2 * Math.atan(Math.tan(fovy / 2) * aspect));
      var fitDistance = radius / Math.sin(fitFov / 2) * 1.15;
      return {
        width: W, height: H, yaw: state.view.yaw,
        pitch: state.view.pitch, fovy: state.view.fovy,
        distance: fitDistance * state.view.scale,
        target: [mesh.bbox.center[0], mesh.bbox.center[1],
          mesh.bbox.center[2]]
      };
    }

    function screenToWorldRay(sx, sy) {
      var spec = currentCameraSpec();
      var matrix = T.rasterizer.cameraMatrix(spec);
      var inv = T.math3d.invert(matrix);
      var ndcX = (sx / W) * 2 - 1;
      var ndcY = 1 - (sy / H) * 2;
      function unproject(z) {
        var clip = [ndcX * z, ndcY * z, z, z];
        var out = T.math3d.transform4(inv, clip);
        return [out[0] / out[3], out[1] / out[3], out[2] / out[3]];
      }
      var near = unproject(-1), far = unproject(1);
      return { eye: near, dir: T.math3d.normalize(
        T.math3d.sub(far, near)) };
    }

    function rayHitEditPlane(ray) {
      if (Math.abs(ray.dir[2]) < 1e-6) return null;
      var t = -ray.eye[2] / ray.dir[2];
      if (t <= 0) return null;
      return T.math3d.add(ray.eye, T.math3d.scale(ray.dir, t));
    }

    function onPointerDown(e) {
      var rect = canvas.getBoundingClientRect();
      var sx = (e.clientX - rect.left) * (W / rect.width);
      var sy = (e.clientY - rect.top) * (H / rect.height);
      var matrix = T.rasterizer.cameraMatrix(currentCameraSpec());
      var hitId = null, best = 16 * 16;
      mesh.controlPoints.forEach(function (cp) {
        var p = T.rasterizer.project({ width: W, height: H }, matrix, cp.position);
        if (!p) return;
        var d2 = (p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy);
        if (d2 < best) { best = d2; hitId = cp.id; }
      });
      if (hitId) {
        drag = { type: 'point', pointId: hitId, startX: sx, startY: sy,
          original: paramsMod.clone(state.params) };
      } else {
        drag = { type: 'orbit', lastX: e.clientX, lastY: e.clientY };
      }
    }

    function onPointerMove(e) {
      if (!drag) return;
      if (drag.type === 'orbit') {
        state.view.yaw += (e.clientX - drag.lastX) * 0.01;
        state.view.pitch = T.math3d.clamp(
          state.view.pitch + (e.clientY - drag.lastY) * 0.01, -1.2, 1.2);
        drag.lastX = e.clientX; drag.lastY = e.clientY;
        autosave();
        if (paused) draw();
        return;
      }
      var rect = canvas.getBoundingClientRect();
      var sx = (e.clientX - rect.left) * (W / rect.width);
      var sy = (e.clientY - rect.top) * (H / rect.height);
      var hit = rayHitEditPlane(screenToWorldRay(sx, sy));
      if (!hit) return;
      var cp = mesh.controlPoints.filter(function (c) {
        return c.id === drag.pointId;
      })[0];
      var candidate = paramsMod.clone(drag.original);
      var value = cp.axis === 'x' ? hit[0] : hit[1];
      value = T.math3d.clamp(value, cp.min, cp.max);
      candidate[cp.field] = Math.round(value * 1000) / 1000;
      if (rebuild(candidate)) autosave();
    }

    function onPointerUp() { drag = null; autosave(); }

    rebuild(state.params);
    canvas.addEventListener('pointerdown', onPointerDown);
    global.addEventListener('pointermove', onPointerMove);
    global.addEventListener('pointerup', onPointerUp);

    function frame() {
      if (!paused) {
        if (state.autoRotate) state.view.yaw += 0.006;
        draw();
      }
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);

    return {
      W: W, H: H,
      getState: function () { return state; },
      getMesh: function () { return mesh; },
      getError: function () { return draftError; },
      rebuild: rebuild,
      draw: draw,
      autosave: autosave,
      restore: restore,
      setPaused: function (v) { paused = v; },
      isPaused: function () { return paused; },
      redraw: function () { draw(); },
      setAutoRotate: function (v) {
        state.autoRotate = v; autosave();
      },
      applyPreset: function (p) {
        var ok = rebuild(p);
        if (ok) autosave();
        return ok;
      },
      exportPNGBytes: function () {
        var buf = draw();
        return png.encode(buf.rgb, W, H);
      },
      exportOBJText: function () { return meshMod.toOBJ(mesh); },
      frameCount: function () { return frameNo; }
    };
  }

  T.createApp = createApp;
  T.defaultState = defaultState;
})(typeof globalThis !== 'undefined' ? globalThis : this);

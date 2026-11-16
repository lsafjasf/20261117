/**
 * Procedural low-poly teacup geometry.
 * A closed 2D profile (radius, height) is lathed around the Y axis, then a
 * Bezier tube handle is attached. Every triangle's winding is checked against
 * its analytic outward normal at build time, so face normals can never be
 * inverted, regardless of camera angle.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});
  var m3 = NS.math3d;

  function smooth(t) {
    t = m3.clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /** Build the closed (radius, height) profile polygon, CCW, solid on left. */
  function buildProfile(p) {
    var H = p.height, n = p.profileSteps;
    var wall = m3.clamp(p.rimRadius * 0.14, 0.08, 0.18);
    var waistT = 0.45;
    var outerR = function (t) {
      return t < waistT
        ? lerp(p.baseRadius, p.waistRadius, smooth(t / waistT))
        : lerp(p.waistRadius, p.rimRadius, smooth((t - waistT) / (1 - waistT)));
    };
    var pts = [];
    pts.push([p.baseRadius * 0.85, 0]);
    pts.push([p.baseRadius, 0.07 * H]);
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      pts.push([outerR(t), 0.1 * H + t * 0.9 * H]);
    }
    pts.push([p.rimRadius - wall, H]);
    var innerFloorY = 0.14 * H;
    for (var j = n; j >= 0; j--) {
      var tt = j / n;
      var y = 0.1 * H + tt * 0.9 * H;
      if (y <= innerFloorY) continue;
      pts.push([Math.max(outerR(tt) - wall, 0.05), y]);
    }
    pts.push([0, innerFloorY]);
    pts.push([0, 0]);
    return pts;
  }

  /**
   * Append a triangle with winding corrected per-face. ref is either an
   * explicit outward normal vector (body lathe edges) or an interior point
   * (handle tube), from which an outward direction is derived per face.
   */
  function addOrientedFace(vertices, faces, ia, ib, ic, ref, group, isNormal) {
    var a = vertices[ia], b = vertices[ib], c = vertices[ic];
    var n = m3.cross(m3.sub(b, a), m3.sub(c, a));
    var outward = isNormal ? ref : m3.sub(
      m3.scale(m3.add(m3.add(a, b), c), 1 / 3), ref);
    if (m3.dot(n, outward) < 0) {
      var tmp = ib; ib = ic; ic = tmp;
    }
    faces.push({ indices: [ia, ib, ic], group: group });
  }

  function lathe(profile, segments, group) {
    var vertices = [], faces = [];
    var count = profile.length;
    var ringIndex = [];
    var i, j;

    for (i = 0; i < count; i++) {
      var r = profile[i][0], y = profile[i][1];
      ringIndex[i] = [];
      if (r === 0) {
        ringIndex[i][0] = vertices.length;
        vertices.push([0, y, 0]);
      } else {
        for (j = 0; j < segments; j++) {
          var a = (j / segments) * Math.PI * 2;
          ringIndex[i][j] = vertices.length;
          vertices.push([r * Math.cos(a), y, r * Math.sin(a)]);
        }
      }
    }

    for (i = 0; i < count; i++) {
      var next = (i + 1) % count;
      var dr = profile[next][0] - profile[i][0];
      var dy = profile[next][1] - profile[i][1];
      for (j = 0; j < segments; j++) {
        var j2 = (j + 1) % segments;
        var theta = ((j + 0.5) / segments) * Math.PI * 2;
        var refNormal = [dy * Math.cos(theta), -dr,
                         dy * Math.sin(theta)];
        var poleA = profile[i][0] === 0;
        var poleB = profile[next][0] === 0;
        var ia = ringIndex[i][poleA ? 0 : j];
        var ia2 = ringIndex[i][poleA ? 0 : j2];
        var ib = ringIndex[next][poleB ? 0 : j];
        var ib2 = ringIndex[next][poleB ? 0 : j2];
        if (poleA && poleB) continue;
        if (poleA) {
          addOrientedFace(vertices, faces, ia, ib, ib2, refNormal, group, true);
        } else if (poleB) {
          addOrientedFace(vertices, faces, ib, ia, ia2, refNormal, group, true);
        } else {
          addOrientedFace(vertices, faces, ia, ib, ib2, refNormal, group, true);
          addOrientedFace(vertices, faces, ia, ib2, ia2, refNormal, group, true);
        }
      }
    }
    return { vertices: vertices, faces: faces };
  }

  function faceNormal(vertices, face) {
    var idx = face.indices;
    return m3.normalize(m3.cross(
      m3.sub(vertices[idx[1]], vertices[idx[0]]),
      m3.sub(vertices[idx[2]], vertices[idx[0]])
    ));
  }

  NS.geometry = {
    buildProfile: buildProfile,
    lathe: lathe,
    addOrientedFace: addOrientedFace,
    faceNormal: faceNormal,
    smooth: smooth,
    lerp: lerp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

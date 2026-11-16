/**
 * Low-poly tube handle along a cubic Bezier in the z=0 plane (+x side).
 * Endpoints sink into the cup wall; tube faces are oriented against the
 * analytic outward direction, keeping normals correct from every viewpoint.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});
  var m3 = NS.math3d;
  var geom = NS.geometry;

  function bezier(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] +
        3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] +
        3 * u * t * t * p2[1] + t * t * t * p3[1]
    ];
  }

  function bezierTangent(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return m3.normalize([
      3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) +
        3 * t * t * (p3[0] - p2[0]),
      3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) +
        3 * t * t * (p3[1] - p2[1]),
      0
    ]);
  }

  /**
   * @returns {object} {vertices, faces, rings} rings kept for editor hit tests.
   */
  function buildHandle(p) {
    var H = p.height;
    var upperY = 0.72 * H, lowerY = 0.3 * H;
    var p0 = [p.rimRadius * 0.96 - 0.06, upperY];
    var p3 = [p.waistRadius + 0.04, lowerY];
    var p1 = [p0[0] + p.handleReach, upperY + 0.18 * H];
    var p2 = [p3[0] + p.handleReach, lowerY - 0.05 * H];
    var ringCount = Math.max(4, p.profileSteps + 2);
    var sides = p.handleSides;
    var radius = p.handleThick;

    var vertices = [], faces = [], rings = [];
    var k, s;
    for (k = 0; k <= ringCount; k++) {
      var t = k / ringCount;
      var center = bezier(p0, p1, p2, p3, t);
      var tangent = bezierTangent(p0, p1, p2, p3, t);
      var axis1 = m3.normalize([tangent[1], -tangent[0], 0]);
      var axis2 = [0, 0, 1];
      var ring = [];
      for (s = 0; s < sides; s++) {
        var ang = (s / sides) * Math.PI * 2;
        var offset = m3.add(
          m3.scale(axis1, Math.cos(ang) * radius),
          m3.scale(axis2, Math.sin(ang) * radius)
        );
        ring.push(vertices.length);
        vertices.push(m3.add([center[0], center[1], 0], offset));
      }
      rings.push(ring);
    }

    for (k = 0; k < ringCount; k++) {
      for (s = 0; s < sides; s++) {
        var s2 = (s + 1) % sides;
        var a = rings[k][s], b = rings[k][s2];
        var c = rings[k + 1][s2], d = rings[k + 1][s];
        var centerMid = bezier(p0, p1, p2, p3, (k + 0.5) / ringCount);
        geom.addOrientedFace(vertices, faces, a, b, c,
          [centerMid[0], centerMid[1], 0], 'handle');
        geom.addOrientedFace(vertices, faces, a, c, d,
          [centerMid[0], centerMid[1], 0], 'handle');
      }
    }

    var startCenter = vertices.length;
    vertices.push([p0[0], p0[1], 0]);
    var endCenter = vertices.length;
    vertices.push([p3[0], p3[1], 0]);
    var t0 = bezierTangent(p0, p1, p2, p3, 0);
    var t1 = bezierTangent(p0, p1, p2, p3, 1);
    function pushCap(centerIdx, ring, desiredNormal) {
      for (s = 0; s < sides; s++) {
        var n2 = (s + 1) % sides;
        var ia = centerIdx, ib = ring[s], ic = ring[n2];
        var nrm = m3.cross(m3.sub(vertices[ib], vertices[ia]),
          m3.sub(vertices[ic], vertices[ia]));
        if (m3.dot(nrm, desiredNormal) < 0) {
          var tmp = ib; ib = ic; ic = tmp;
        }
        faces.push({ indices: [ia, ib, ic], group: 'handle' });
      }
    }
    pushCap(startCenter, rings[0], t0);
    pushCap(endCenter, rings[ringCount], m3.scale(t1, -1));
    return { vertices: vertices, faces: faces, rings: rings,
      controls: [p0, p1, p2, p3] };
  }

  NS.handle = { buildHandle: buildHandle, bezier: bezier };
})(typeof globalThis !== 'undefined' ? globalThis : this);

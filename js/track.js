/* 闭合轨道：三段不同曲率半径的圆弧。
 * 首段反向弯曲（符号为负），三段转角由二维牛顿迭代求解，
 * 使上半环终点精确回到起点且切线水平（闭合残差 < 1e-12 m）。
 * 下半环为上半环的镜像，整体旋转为横向布局。 */
(function () {
  const T = window.CONFIG.track;
  const R = T.radii, S = T.signs;

  function endPoint(b) {
    let x = 0, y = 0, theta = 0;
    for (let i = 0; i < 3; i++) {
      const cx = x - S[i] * R[i] * Math.sin(theta);
      const cy = y + S[i] * R[i] * Math.cos(theta);
      theta += S[i] * b[i];
      x = cx + S[i] * R[i] * Math.sin(theta);
      y = cy - S[i] * R[i] * Math.cos(theta);
    }
    return [x, y];
  }

  // 约束：总转角为 PI（终点切线水平），自由变量为 b1、b3
  function residual(v) {
    const b = [v[0], Math.PI - S[0] * v[0] - S[2] * v[1], v[1]];
    return endPoint(b);
  }

  function solve() {
    let v = T.initBeta.slice();
    if (Math.hypot(...residual(v)) > 1) {
      // 初值失效时网格搜索最近根（同伦无关，半径可任意更换）
      let best = null;
      for (let b1 = 0.3; b1 < Math.PI - 0.3; b1 += 0.05) {
        for (let b3 = 0.3; b3 < Math.PI - 0.3; b3 += 0.05) {
          const b2 = Math.PI - S[0] * b1 - S[2] * b3;
          if (b2 <= 0.2) continue;
          const n = Math.hypot(...residual([b1, b3]));
          if (!best || n < best.n) best = { n, v: [b1, b3] };
        }
      }
      v = best.v;
    }
    let last = Infinity;
    for (let k = 0; k < 200; k++) {
      const f = residual(v), h = 1e-9;
      const f1 = residual([v[0] + h, v[1]]);
      const f2 = residual([v[0], v[1] + h]);
      const j = [[(f1[0] - f[0]) / h, (f2[0] - f[0]) / h],
                 [(f1[1] - f[1]) / h, (f2[1] - f[1]) / h]];
      const det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
      v[0] -= (j[1][1] * f[0] - j[0][1] * f[1]) / det;
      v[1] -= (-j[1][0] * f[0] + j[0][0] * f[1]) / det;
      const n = Math.hypot(f[0], f[1]);
      if (n < 1e-13) break;
      if (n > last * 1e6) throw new Error('轨道求解发散');
      last = n;
    }
    const b = [v[0], Math.PI - S[0] * v[0] - S[2] * v[1], v[1]];
    if (b.some(x => x <= 0)) throw new Error('轨道转角非法');
    if (Math.hypot(...residual(v)) > 1e-9) throw new Error('轨道闭合残差过大');
    return b;
  }

  function arcSamples(Ri, Si, beta, id, p0, theta0, n) {
    const cx = p0.x - Si * Ri * Math.sin(theta0);
    const cy = p0.y + Si * Ri * Math.cos(theta0);
    const out = [];
    for (let i = 1; i <= n; i++) {
      const theta = theta0 + Si * beta * (i / n);
      out.push({
        x: cx + Si * Ri * Math.sin(theta),
        y: cy - Si * Ri * Math.cos(theta),
        id
      });
    }
    return out;
  }

  function build() {
    const beta = solve();
    const n = T.samplesPerArc;
    const top = [{ x: 0, y: 0, id: 1 }];
    let theta = 0;
    for (let i = 0; i < 3; i++) {
      const p0 = top[top.length - 1];
      top.push(...arcSamples(R[i], S[i], beta[i], i + 1, p0, theta, n));
      theta += S[i] * beta[i];
    }
    // 下半环镜像（反向遍历，保持绕行方向一致）
    const bottom = [];
    for (let i = top.length - 2; i >= 0; i--) {
      bottom.push({ x: top[i].x, y: -top[i].y, id: top[i].id });
    }
    const raw = top.concat(bottom);

    // 居中 + 整体旋转为横向布局
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    raw.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
    const cos = Math.cos(T.rotate), sin = Math.sin(T.rotate);
    const pts = raw.map(p => {
      const x = p.x - ox, y = p.y - oy;
      return { x: x * cos - y * sin, y: x * sin + y * cos, id: p.id };
    });

    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x,
        pts[i].y - pts[i - 1].y));
    }
    const length = cum[cum.length - 1];

    function at(s) {
      const d = ((s % length) + length) % length;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
      }
      const span = cum[hi] - cum[lo] || 1e-12;
      const t = (d - cum[lo]) / span;
      const a = pts[lo], b = pts[hi];
      const tx = (b.x - a.x) / span, ty = (b.y - a.y) / span;
      return {
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        tx, ty, nx: -ty, ny: tx, id: a.id
      };
    }

    return {
      pts, cum, length, at, radii: R, signs: S, betas: beta,
      segmentLengths: beta.map((b, i) => 2 * R[i] * b),
      closureError: Math.hypot(...endPoint(beta))
    };
  }

  window.Track = { build };
})();

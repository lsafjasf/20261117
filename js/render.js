// 渲染：展开图（可编辑）与折叠透视（折面贴图 + 地面投影）。
const Renderer = (() => {

  // 在 mm 坐标系下绘制单个元素（调用方先 setTransform 到 mm 空间，
  // 因此字号按 pxPerMm=1 计算，避免被变换重复缩放）
  function drawElement(ctx, el) {
    if (el.type === 'rect') {
      ctx.fillStyle = el.fill;
      ctx.fillRect(el.x, el.y, el.w, el.h);
      if (el.stroke && el.lineWidth > 0) {
        ctx.strokeStyle = el.stroke; ctx.lineWidth = el.lineWidth;
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      }
    } else if (el.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = el.fill; ctx.fill();
      if (el.stroke && el.lineWidth > 0) {
        ctx.strokeStyle = el.stroke; ctx.lineWidth = el.lineWidth; ctx.stroke();
      }
    } else if (el.type === 'text') {
      const lay = TextLayout.layout(el, 4);
      ctx.font = TextLayout.fontCss(el, 1);
      ctx.fillStyle = el.color;
      ctx.textBaseline = 'alphabetic';
      const ascent = el.fontSize * PT_TO_MM;
      ctx.textAlign = el.align;
      const tx = el.align === 'center' ? el.x + el.w / 2
               : el.align === 'right' ? el.x + el.w : el.x;
      lay.lines.forEach((ln, i) => {
        ctx.fillText(ln, tx, el.y + i * lay.lineHeightMm + ascent);
      });
      ctx.textAlign = 'left';
    }
  }

  // ---- 展开图 ----
  function drawFlat(ctx, doc, o) {
    const P = doc.page, pw = P.w / P.panels;
    const s = o.pxPerMm * o.zoom;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.setTransform(s, 0, 0, s, o.ox, o.oy);
    // 页面
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 12 / s * 4;
    ctx.fillRect(0, 0, P.w, P.h);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    // 安全边距
    ctx.strokeStyle = 'rgba(231,76,60,.45)';
    ctx.setLineDash([2, 2]); ctx.lineWidth = 0.3;
    for (let i = 0; i < P.panels; i++) {
      ctx.strokeRect(i * pw + P.margin, P.margin, pw - 2 * P.margin, P.h - 2 * P.margin);
    }
    // 折线
    ctx.strokeStyle = 'rgba(30,100,200,.6)';
    ctx.setLineDash([4, 3]); ctx.lineWidth = 0.4;
    for (let i = 1; i < P.panels; i++) {
      ctx.beginPath(); ctx.moveTo(i * pw, 0); ctx.lineTo(i * pw, P.h); ctx.stroke();
    }
    ctx.setLineDash([]);
    // 元素
    for (const el of doc.elements) drawElement(ctx, el);
    // 违规高亮
    const errIds = new Set((o.violations || []).filter(v => v.level === 'error').map(v => v.elId));
    const warnIds = new Set((o.violations || []).filter(v => v.level === 'warn').map(v => v.elId));
    for (const el of doc.elements) {
      const b = Model.elBBox(el);
      if (errIds.has(el.id)) {
        ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 0.7; ctx.setLineDash([3, 2]);
        ctx.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2); ctx.setLineDash([]);
      } else if (warnIds.has(el.id)) {
        ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 0.5; ctx.setLineDash([3, 2]);
        ctx.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2); ctx.setLineDash([]);
      }
    }
    // 选中框
    const sel = doc.elements.find(e => e.id === o.selectedId);
    if (sel) {
      const b = Model.elBBox(sel);
      ctx.strokeStyle = '#2d9cdb'; ctx.lineWidth = 0.6;
      ctx.strokeRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3);
      ctx.fillStyle = '#2d9cdb';
      ctx.fillRect(b.x + b.w + 1.5 - 2, b.y + b.h + 1.5 - 2, 2, 2);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- 折叠透视 ----
  // 面板角点 3D 变换：中间折固定，左右折绕折线旋转。世界坐标不变，仅视图变换。
  function panelPoint(panelIdx, u, y, pw, h, theta, dir) {
    // u: 面板内距折线的距离（mm），y: 纵向 mm
    if (panelIdx === 0) return { x: pw - u * Math.cos(theta), y, z: dir * u * Math.sin(theta) };
    if (panelIdx === 2) return { x: 2 * pw + u * Math.cos(theta), y, z: dir * u * Math.sin(theta) };
    return { x: pw + u, y, z: 0 };
  }

  function drawFolded(ctx, doc, o) {
    const P = doc.page, pw = P.w / P.panels, h = P.h;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const theta = o.foldAngleDeg * Math.PI / 180;
    const dir = doc.foldDirection === 'in' ? -1 : 1; // 内折朝观察者
    const S = o.pxPerMm * o.zoom * 0.72;             // 基础缩放（透视视图留余量）
    const cx = W / 2, cy = H / 2 - 30 * o.zoom;
    const D = 700 * o.zoom;                          // 视距（px）
    const sheetCx = P.w / 2, sheetCy = P.h / 2;
    const proj = p => {
      const k = D / (D + p.z * S);
      return { x: cx + (p.x - sheetCx) * S * k, y: cy + (p.y - sheetCy) * S * k, z: p.z };
    };
    // 地面投影：光源从左上前方向右下投射
    const groundY = P.h + 24, L = { x: 0.35, y: 1, z: 0.45 };
    const shadowOf = p => {
      const t = (groundY - p.y) / L.y;
      return proj({ x: p.x + L.x * t, y: groundY, z: p.z + L.z * t });
    };
    const corners = idx => [
      panelPoint(idx, 0, 0, pw, h, theta, dir),
      panelPoint(idx, pw, 0, pw, h, theta, dir),
      panelPoint(idx, pw, h, pw, h, theta, dir),
      panelPoint(idx, 0, h, pw, h, theta, dir),
    ];
    // 先画投影
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let i = 0; i < 3; i++) {
      const pts = corners(i).map(shadowOf);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath(); ctx.fill();
    }
    // 面板内容贴图：按平均深度远→近绘制
    const order = [0, 1, 2].sort((a, b) => {
      const za = corners(a).reduce((s, p) => s + p.z, 0);
      const zb = corners(b).reduce((s, p) => s + p.z, 0);
      return zb - za;
    });
    for (const idx of order) drawPanel(ctx, doc, idx, pw, h, theta, dir, proj, o);
  }

  // 单折面板：渲染到离屏画布，再按竖条透视贴到四边形上
  function drawPanel(ctx, doc, idx, pw, h, theta, dir, proj, o) {
    const R = 6; // 离屏分辨率 px/mm
    const off = document.createElement('canvas');
    off.width = Math.ceil(pw * R); off.height = Math.ceil(h * R);
    const octx = off.getContext('2d');
    octx.fillStyle = idx === 1 ? '#ffffff' : '#f7f5f0';
    octx.fillRect(0, 0, off.width, off.height);
    octx.setTransform(R, 0, 0, R, -idx * pw * R, 0);
    for (const el of doc.elements) {
      const b = Model.elBBox(el);
      if (b.x + b.w < idx * pw || b.x > (idx + 1) * pw) continue; // 不在本面板
      octx.save();
      octx.beginPath(); octx.rect(idx * pw, 0, pw, h); octx.clip();
      drawElement(octx, el);
      octx.restore();
    }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    // 先铺面板底色四边形，避免条带缝隙透出深色背景
    const q0 = proj(panelPoint(idx, 0, 0, pw, h, theta, dir));
    const q1 = proj(panelPoint(idx, pw, 0, pw, h, theta, dir));
    const q2 = proj(panelPoint(idx, pw, h, pw, h, theta, dir));
    const q3 = proj(panelPoint(idx, 0, h, pw, h, theta, dir));
    ctx.beginPath();
    ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y);
    ctx.lineTo(q2.x, q2.y); ctx.lineTo(q3.x, q3.y);
    ctx.closePath();
    ctx.fillStyle = idx === 1 ? '#ffffff' : '#f7f5f0';
    ctx.fill();
    // 竖条贴图
    const N = 48;
    ctx.imageSmoothingQuality = 'high';
    for (let k = 0; k < N; k++) {
      const u0 = (k / N) * pw, u1 = ((k + 1) / N) * pw;
      const pA = proj(panelPoint(idx, u0, 0, pw, h, theta, dir));
      const pB = proj(panelPoint(idx, u1, 0, pw, h, theta, dir));
      const pC = proj(panelPoint(idx, u0, h, pw, h, theta, dir));
      const sx = (k / N) * off.width, sw = off.width / N;
      // 由三点求仿射变换：源 (sx,0),(sx+sw,0),(sx,offH) → 目标 pA,pB,pC
      const a = (pB.x - pA.x) / sw, b = (pB.y - pA.y) / sw;
      const c = (pC.x - pA.x) / off.height, d = (pC.y - pA.y) / off.height;
      // 源条带左右各外扩 1.2px（钳制在画布内），相邻条带轻微重叠避免缝隙
      const pad = 1.2;
      const sx0 = Math.max(0, sx - pad), sx1 = Math.min(off.width, sx + sw + pad);
      ctx.save();
      ctx.setTransform(a, b, c, d, pA.x - a * sx, pA.y - b * sx);
      ctx.drawImage(off, sx0, 0, sx1 - sx0, off.height, sx0, 0, sx1 - sx0, off.height);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 折线高亮
    const e0 = proj(panelPoint(idx, 0, 0, pw, h, theta, dir));
    const e1 = proj(panelPoint(idx, 0, h, pw, h, theta, dir));
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(e0.x, e0.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
  }

  return { drawFlat, drawFolded, drawElement };
})();

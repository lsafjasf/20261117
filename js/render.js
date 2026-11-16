/* Canvas 渲染：湿地剖面、连续水位、芦苇、鸟群、目标位点与告警着色 */
(function (root) {
  'use strict';

  const U = root.WetlandUtil;

  function WetlandRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
  }

  // 水位 cm → 画布 y 坐标；泥面在 62% 高度处
  WetlandRenderer.prototype._waterY = function (levelCm, h) {
    const mudY = h * 0.62;
    return mudY - levelCm * 1.6;
  };

  WetlandRenderer.prototype.render = function (sim, weather) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.t += 0.03;
    this._drawSky(ctx, w, h, weather, sim);
    const waterY = this._drawTerrainAndWater(ctx, w, h, sim);
    this._drawReeds(ctx, w, h, sim, waterY);
    this._drawSitesAndBirds(ctx, w, h, sim, waterY);
    this._drawDepthRuler(ctx, w, h, sim);
    this._drawOverlayStatus(ctx, w, h, sim);
  };

  WetlandRenderer.prototype._drawSky = function (ctx, w, h, weather, sim) {
    const cloud = weather ? weather.cloud : 0.3;
    const hourOfDay = sim.hour % 24;
    const daylight = Math.max(0, Math.sin((Math.PI * hourOfDay) / 24));
    const top = this._mix([122, 178, 222], [214, 232, 242], daylight);
    const grey = this._mix(top, [150, 158, 162], cloud * 0.7);
    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    grad.addColorStop(0, this._rgb(grey));
    grad.addColorStop(1, this._rgb(this._mix(grey, [225, 238, 230], 0.5)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h * 0.62);
    // 太阳/月亮
    ctx.fillStyle = daylight > 0.05 ? 'rgba(255,225,140,0.9)' : 'rgba(220,225,235,0.7)';
    const sunX = w * (0.1 + 0.8 * hourOfDay / 24);
    const sunY = h * 0.5 - Math.sin((Math.PI * hourOfDay) / 24) * h * 0.32;
    ctx.beginPath(); ctx.arc(sunX, sunY, 22, 0, Math.PI * 2); ctx.fill();
    // 云
    ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + cloud * 0.5) + ')';
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 220 + this.t * 6) % (w + 160)) - 80;
      const cy = 40 + (i % 3) * 34;
      this._cloud(ctx, cx, cy, 30 + cloud * 26);
    }
    if (weather && weather.rainy) this._drawRain(ctx, w, h);
  };

  WetlandRenderer.prototype._cloud = function (ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 0.9, y + 6, r * 0.75, 0, Math.PI * 2);
    ctx.arc(x - r * 0.9, y + 8, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  };

  WetlandRenderer.prototype._drawRain = function (ctx, w, h) {
    ctx.strokeStyle = 'rgba(120,150,180,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const x = (i * 47 + this.t * 260) % w;
      const y = (i * 31 + this.t * 420) % (h * 0.62);
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 12);
    }
    ctx.stroke();
  };

  WetlandRenderer.prototype._drawTerrainAndWater = function (ctx, w, h, sim) {
    const mudY = h * 0.62;
    // 土壤剖面：表层有机土 + 下层矿质土
    const soil = ctx.createLinearGradient(0, mudY, 0, h);
    soil.addColorStop(0, '#5d4630');
    soil.addColorStop(0.35, '#43301f');
    soil.addColorStop(1, '#2c2017');
    ctx.fillStyle = soil;
    ctx.beginPath();
    ctx.moveTo(0, mudY + 8);
    for (let x = 0; x <= w; x += 40) {
      ctx.lineTo(x, mudY + Math.sin(x * 0.02) * 6 + 4);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    // 有机层纹理（碳储存越高颜色越深）
    const carbonShade = U.clamp((sim.state.carbon - 60) / 120, 0, 1);
    ctx.fillStyle = 'rgba(28,20,12,' + (0.25 + carbonShade * 0.4) + ')';
    ctx.fillRect(0, mudY + 6, w, 26);

    const level = sim.state.levelCm;
    const waterY = this._waterY(level, h);
    const alarm = sim.alarms.level.status;
    const waterColor = alarm === 'critical' ? [150, 78, 66] :
      alarm === 'warn' ? [156, 132, 78] : [62, 122, 150];
    const grad = ctx.createLinearGradient(0, waterY, 0, mudY + 10);
    grad.addColorStop(0, this._rgba(waterColor, 0.72));
    grad.addColorStop(1, this._rgba(waterColor, 0.92));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, waterY);
    for (let x = 0; x <= w; x += 12) {
      ctx.lineTo(x, waterY + Math.sin(x * 0.05 + this.t * 2) * 2);
    }
    ctx.lineTo(w, mudY + 10); ctx.lineTo(0, mudY + 10); ctx.closePath(); ctx.fill();
    // 水面高光线
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 12) {
      const yy = waterY + Math.sin(x * 0.05 + this.t * 2) * 2;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
    return waterY;
  };

  WetlandRenderer.prototype._drawReeds = function (ctx, w, h, sim, waterY) {
    const mudY = h * 0.62;
    const density = Math.round(sim.state.reed / 4);
    const harvestActive = sim.hour < sim.harvestEffectUntil;
    const baseHeight = harvestActive ? 10 : 46;
    ctx.strokeStyle = '#3f6b35';
    ctx.lineWidth = 2;
    for (let i = 0; i < density; i++) {
      const x = (i * 53 + 24) % w;
      const sway = Math.sin(this.t * 1.5 + i) * 4;
      const reedH = baseHeight * (0.7 + (sim.state.reed / 100) * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, mudY + 4);
      ctx.quadraticCurveTo(x + sway * 0.5, mudY - reedH * 0.5,
        x + sway, mudY - reedH);
      ctx.stroke();
      if (!harvestActive && i % 3 === 0) {
        ctx.fillStyle = '#7a5a2e';
        ctx.fillRect(x + sway - 1.5, mudY - reedH - 6, 3, 7);
      }
    }
  };

  WetlandRenderer.prototype._drawSitesAndBirds = function (ctx, w, h, sim, waterY) {
    const mudY = h * 0.62;
    sim.sites.forEach((site, idx) => {
      const x = site.x * w;
      // 目标位点标记：菱形 + 偏好水深虚线
      const py = this._waterY(site.preferredDepth, h);
      ctx.strokeStyle = 'rgba(255,214,120,0.55)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, mudY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd678';
      ctx.beginPath();
      ctx.moveTo(x, py - 7); ctx.lineTo(x + 6, py);
      ctx.lineTo(x, py + 7); ctx.lineTo(x - 6, py);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a2f16';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(site.id), x, py + 3);
      // 鸟群：数量映射为小 V 形，位置带确定性抖动
      const birdCount = Math.min(14, Math.round(site.birds / 8));
      for (let b = 0; b < birdCount; b++) {
        const bx = x + ((b * 17 + idx * 9) % 60) - 30 +
          (site.jitterX || 0) * w;
        const by = waterY - 26 - (b % 4) * 12 + (site.jitterY || 0) * h +
          Math.sin(this.t * 2 + b) * 2;
        this._bird(ctx, bx, by, 5 + (b % 3));
      }
    });
    ctx.textAlign = 'left';
  };

  WetlandRenderer.prototype._bird = function (ctx, x, y, s) {
    ctx.strokeStyle = '#23303a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - s, y + Math.sin(this.t * 3 + x) * 2);
    ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.7, x, y);
    ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.7, x + s,
      y + Math.sin(this.t * 3 + x) * 2);
    ctx.stroke();
  };

  WetlandRenderer.prototype._drawDepthRuler = function (ctx, w, h, sim) {
    const x = 14;
    const topY = this._waterY(70, h);
    const botY = this._waterY(-30, h);
    ctx.strokeStyle = 'rgba(30,45,50,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, topY); ctx.lineTo(x, botY); ctx.stroke();
    ctx.fillStyle = '#23303a';
    ctx.font = '10px sans-serif';
    [-30, 0, 35, 60].forEach((cm) => {
      const y = this._waterY(cm, h);
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.stroke();
      ctx.fillText(cm + 'cm', x + 7, y + 3);
    });
    // 理想浅水区色带 5–35cm
    const y1 = this._waterY(35, h);
    const y2 = this._waterY(5, h);
    ctx.fillStyle = 'rgba(120,200,140,0.16)';
    ctx.fillRect(x - 3, y1, 6, y2 - y1);
  };

  WetlandRenderer.prototype._drawOverlayStatus = function (ctx, w, h, sim) {
    const crit = Object.keys(sim.alarms).filter((k) =>
      sim.alarms[k].status === 'critical');
    if (!crit.length) return;
    ctx.fillStyle = 'rgba(120,30,30,0.78)';
    ctx.fillRect(w / 2 - 150, 12, 300, 30);
    ctx.fillStyle = '#ffe2e2';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ 临界告警：' + crit.join(' / ') + '  需立即处置', w / 2, 32);
    ctx.textAlign = 'left';
  };

  WetlandRenderer.prototype._mix = function (a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  };
  WetlandRenderer.prototype._rgb = function (c) {
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  };
  WetlandRenderer.prototype._rgba = function (c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  };

  root.WetlandRenderer = WetlandRenderer;
})(typeof self !== 'undefined' ? self : this);

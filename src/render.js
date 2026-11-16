/* Canvas renderer for the buoy cable repair game. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./game.js'));
  } else {
    root.BuoyRender = factory(root.BuoyGame);
  }
})(typeof self !== 'undefined' ? self : this, function (BG) {
  'use strict';

  const { CONFIG, dist } = BG;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.trail = [];
    this.maxTrail = 420;
  }

  Renderer.prototype.pushTrail = function (x, y) {
    const last = this.trail[this.trail.length - 1];
    if (!last || dist(last.x, last.y, x, y) > 6) {
      this.trail.push({ x, y });
      if (this.trail.length > this.maxTrail) this.trail.shift();
    }
  };

  Renderer.prototype.clearTrail = function () {
    this.trail = [];
  };

  Renderer.prototype.draw = function (game, opts) {
    const ctx = this.ctx;
    const w = game.world.W;
    const h = game.world.H;
    ctx.clearRect(0, 0, w, h);
    this._sea(game);
    this._shallows(game, opts && opts.debug);
    this._currents(game, opts && opts.debug);
    this._dock(game);
    this._cables(game);
    this._rocks(game);
    this._trail(opts && opts.debug);
    this._boat(game, opts && opts.debug);
    this._wind(game);
  };

  Renderer.prototype._sea = function (game) {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, game.world.H);
    grad.addColorStop(0, '#0b3d66');
    grad.addColorStop(1, '#082a47');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, game.world.W, game.world.H);
    ctx.strokeStyle = 'rgba(160,210,240,0.10)';
    ctx.lineWidth = 1;
    const drift = (game.time * 14) % 36;
    for (let y = -36 + drift; y < game.world.H; y += 36) {
      ctx.beginPath();
      for (let x = 0; x <= game.world.W; x += 24) {
        const yy = y + Math.sin((x / 90) + game.time * 1.4) * 3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  };

  Renderer.prototype._shallows = function (game, debug) {
    const ctx = this.ctx;
    for (const s of game.world.shallows) {
      const g = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, s.r);
      g.addColorStop(0, 'rgba(230,210,150,0.32)');
      g.addColorStop(0.75, 'rgba(230,210,150,0.12)');
      g.addColorStop(1, 'rgba(230,210,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (debug) {
        ctx.strokeStyle = 'rgba(255,230,160,0.55)';
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  Renderer.prototype._currents = function (game, debug) {
    const ctx = this.ctx;
    const zones = game.world.currents;
    for (const z of zones) {
      if (debug) {
        ctx.strokeStyle = 'rgba(120,200,255,0.30)';
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(150,215,255,0.35)';
      ctx.lineWidth = 2;
      for (let k = -1; k <= 1; k++) {
        const ox = Math.cos(z.angle + Math.PI / 2) * k * 22;
        const oy = Math.sin(z.angle + Math.PI / 2) * k * 22;
        const cx = z.x + ox;
        const cy = z.y + oy;
        const phase = (game.time * 40 * z.strength / 30) % 40;
        const px = cx + Math.cos(z.angle) * phase;
        const py = cy + Math.sin(z.angle) * phase;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(z.angle) * 12, py - Math.sin(z.angle) * 12);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
  };

  Renderer.prototype._dock = function (game) {
    const ctx = this.ctx;
    const d = game.world.dock;
    ctx.fillStyle = '#8a6a45';
    ctx.fillRect(d.x - 14, d.y - 34, 20, 68);
    ctx.fillStyle = '#c8b083';
    ctx.fillRect(d.x - 14, d.y - 34, 6, 68);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8f3ff';
    ctx.font = '12px sans-serif';
    ctx.fillText('码头', d.x - 12, d.y - 42);
  };

  Renderer.prototype._cables = function (game) {
    const ctx = this.ctx;
    for (const cable of game.world.cables) {
      const dx = (Math.cos(cable.angle) * cable.len) / 2;
      const dy = (Math.sin(cable.angle) * cable.len) / 2;
      ctx.strokeStyle = cable.marked ? 'rgba(120,255,170,0.85)'
        : 'rgba(255,190,90,0.55)';
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(cable.x - dx, cable.y - dy);
      ctx.lineTo(cable.x + dx, cable.y + dy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      const buoy = cable.buoy;
      ctx.fillStyle = cable.buoyVisited ? '#ffd166' : '#ff5a5f';
      ctx.beginPath();
      ctx.arc(buoy.x, buoy.y, buoy.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#10233a';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(String(cable.id + 1), buoy.x - 3, buoy.y + 4);
      if (cable.marked && cable.markerAt) {
        ctx.fillStyle = '#7CFC9B';
        ctx.beginPath();
        ctx.arc(cable.markerAt.x, cable.markerAt.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0b3d2a';
        ctx.stroke();
      }
    }
  };

  Renderer.prototype._rocks = function (game) {
    const ctx = this.ctx;
    for (const rock of game.world.rocks) {
      ctx.fillStyle = '#4a5563';
      ctx.beginPath();
      ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#222a33';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '10px sans-serif';
      ctx.fillText(`#${rock.id + 1}`, rock.x - 8, rock.y + 3);
    }
  };

  Renderer.prototype._trail = function (debug) {
    if (!debug || this.trail.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    this.trail.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  };

  Renderer.prototype._boat = function (game, debug) {
    const ctx = this.ctx;
    const b = game.boat;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.heading);
    ctx.fillStyle = game.inShallow ? '#ffd166' : '#e9f2fb';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-11, -8);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-11, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#17324d';
    ctx.stroke();
    ctx.fillStyle = '#2f7dc2';
    ctx.fillRect(-8, -3, 6, 6);
    if (b.thrust > 0.01) {
      ctx.strokeStyle = `rgba(255,170,80,${0.25 + b.thrust * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(-12 - 14 * b.thrust, 0);
      ctx.stroke();
    }
    ctx.restore();
    if (debug) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, CONFIG.BUOY_RANGE, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  Renderer.prototype._wind = function (game) {
    const ctx = this.ctx;
    const wind = game.wind;
    const x = game.world.W - 70;
    const y = 42;
    ctx.fillStyle = 'rgba(6,24,42,0.55)';
    ctx.fillRect(x - 42, y - 30, 84, 52);
    ctx.strokeStyle = '#bfe2ff';
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(wind.angle) * 22, y - Math.sin(wind.angle) * 22);
    ctx.lineTo(x + Math.cos(wind.angle) * 22, y + Math.sin(wind.angle) * 22);
    ctx.stroke();
    const hx = x + Math.cos(wind.angle) * 22;
    const hy = y + Math.sin(wind.angle) * 22;
    const side = wind.angle + 2.4;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - Math.cos(side) * 9, hy - Math.sin(side) * 9);
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(side) * 9, hy + Math.sin(side) * 9);
    ctx.stroke();
    ctx.fillStyle = '#dff1ff';
    ctx.font = '11px sans-serif';
    ctx.fillText('风', x - 5, y + 18);
  };

  return { Renderer };
});

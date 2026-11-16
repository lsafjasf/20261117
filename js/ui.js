// Canvas 渲染与面板更新
(function (global) {
  'use strict';
  const { WEATHER_NAME, CONFIG } = global.RanchSim;
  const HERD_COLORS = ['#e8b23a', '#d8d8d8', '#c96b32'];
  const SEASON_LABEL = { rain: '雨季', normal: '平时', drought: '旱季' };

  function pastureRect(i) {
    const w = 460, h = 260, gx = 20, gy = 20;
    return { x: 20 + (i % 2) * (w + gx), y: 40 + Math.floor(i / 2) * (h + gy), w, h };
  }

  function draw(canvas, sim) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 天空/天气
    const w = sim.weatherNow;
    ctx.fillStyle = w === 'rain' ? '#3a4a56' : w === 'drought' ? '#6b5a3a' : '#4a6a8a';
    ctx.fillRect(0, 0, canvas.width, 30);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(`${sim.timeStr()}  天气:${WEATHER_NAME[w]}  恢复系数 x${CONFIG.weatherMult[w]}`, 12, 20);
    if (w === 'rain') {
      ctx.strokeStyle = 'rgba(150,190,255,0.5)';
      for (let i = 0; i < 40; i++) {
        const x = (i * 97 + sim.hour * 30) % canvas.width;
        const y = (i * 53 + sim.hour * 90) % canvas.height;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9); ctx.stroke();
      }
    }
    const alerts = sim.alerts();
    sim.pastures.forEach((p, i) => {
      const r = pastureRect(i);
      // 草地底色随草量
      const g = Math.round(p.grass);
      ctx.fillStyle = `rgb(${120 - g * 0.6 + p.compaction * 0.5}, ${90 + g * 1.2}, ${60})`;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // 围栏
      ctx.strokeStyle = '#8a6b42';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      // 饮水点
      if (p.waterPoint) {
        ctx.fillStyle = '#3a7bd5';
        ctx.beginPath();
        ctx.arc(r.x + r.w - 40, r.y + r.h - 40, 16 + p.water * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '11px sans-serif';
        ctx.fillText(`水${p.water.toFixed(0)}`, r.x + r.w - 56, r.y + r.h - 36);
      }
      // 标签与告警
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(`草地${p.name}`, r.x + 8, r.y + 20);
      if (alerts[p.id]) {
        ctx.fillStyle = '#ffcf5a';
        ctx.fillText('⚠ ' + alerts[p.id].join('/'), r.x + 8, r.y + 40);
      }
      // 畜群
      sim.herds.filter(h => h.pasture === p.id).forEach((h, k) => {
        ctx.fillStyle = HERD_COLORS[h.id];
        for (let d = 0; d < Math.min(h.size, 12); d++) {
          const dx = r.x + 40 + (d % 6) * 18 + k * 12;
          const dy = r.y + 70 + Math.floor(d / 6) * 18 + k * 40;
          ctx.beginPath(); ctx.arc(dx, dy, 6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.fillText(`${h.species}×${h.size}`, r.x + 36, r.y + 60 + k * 40);
      });
    });
  }

  function renderMetrics(el, sim) {
    const alerts = sim.alerts();
    let html = '<table><tr><th>草地</th><th>草量</th><th>水位</th><th>污染</th><th>压实</th><th>物种</th><th>告警</th></tr>';
    for (const p of sim.pastures) {
      const a = (alerts[p.id] || []).join(' ') || '-';
      const cls = alerts[p.id] ? 'crit' : 'okv';
      const o = p.obs;
      html += `<tr><td>${p.name}${p.waterPoint ? '💧' : ''}</td>` +
        `<td>${o.grass.toFixed(0)}/${p.grass.toFixed(0)}</td>` +
        `<td>${o.water.toFixed(0)}/${p.water.toFixed(0)}</td>` +
        `<td>${o.pollution.toFixed(0)}/${p.pollution.toFixed(0)}</td>` +
        `<td>${o.compaction.toFixed(0)}/${p.compaction.toFixed(0)}</td>` +
        `<td>${o.diversity.toFixed(0)}/${p.diversity.toFixed(0)}</td>` +
        `<td class="${cls}">${a}</td></tr>`;
    }
    el.innerHTML = html + '</table><div style="font-size:11px;color:#9ab">每格:观测值/实际值,观测每6小时更新且含噪声</div>';
  }

  function renderTargets(el, sim) {
    const t = sim.targets;
    const m = sim.metrics();
    el.innerHTML =
      `<div>各草地目标草量:${t.grass.map((v, i) => `${'ABCD'[i]}≥${v}`).join(' ')}</div>` +
      `<div>饮水覆盖 ≥ ${t.waterCoverage} 块(当前 ${m.waterCoverage})</div>` +
      `<div>平均污染 ≤ ${t.pollutionMax}(当前 ${m.pollution.toFixed(0)})</div>` +
      `<div>第30天畜群目标位置:${sim.herds.map((h, i) => `${h.species}→${'ABCD'[t.herdFinal[i]]}`).join(' ')}</div>`;
  }

  function renderLog(el, logs) {
    el.innerHTML = logs.slice(-80).map(l => {
      const cls = l.type === 'alert' ? 'alert-line' : l.type === 'fail' ? 'fail-line' : l.type === 'op' ? 'op-line' : '';
      return `<div class="${cls}"><span class="t">[${l.time}]</span>${l.msg}</div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  global.RanchUI = { draw, renderMetrics, renderTargets, renderLog, pastureRect, SEASON_LABEL };
})(typeof window !== 'undefined' ? window : globalThis);

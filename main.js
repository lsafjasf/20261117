(function () {
  'use strict';
  const Core = window.GameCore;
  const CONFIG = Core.CONFIG;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const statusEl = document.getElementById('status');

  const GROUND_Y = 560;
  const NOZZLE = { x: 330, y: 440 };
  const SCALE = 4.5; // 射程像素 / 压力单位
  const HOSE = [
    { x: 175, y: 535 },
    { x: 235, y: 512 },
    { x: 285, y: 478 },
    { x: NOZZLE.x, y: NOZZLE.y },
  ];

  let mode = 'coop';
  let game = Core.createGame(mode);
  let paused = false;
  let replayView = null;   // 回放时的视图状态
  let replayLog = [];
  let replayEntries = null;
  let replayIdx = 0;
  let replayClock = 0;
  let lastRun = null;

  const keys = Object.create(null);

  function setStatus(msg) { statusEl.textContent = msg; }

  function restart() {
    game = Core.createGame(mode);
    paused = false;
    exitReplay();
    setStatus('已重开：仪表、目标、倒计时、任务记录全部复位');
  }

  function toggleMode() {
    mode = mode === 'coop' ? 'debug' : 'coop';
    restart();
    setStatus(mode === 'debug'
      ? '单人调试模式：W/S 控压，A/D 或 ←/→ 控向，显示辅助线，无保护状态'
      : '双人协作模式：P1=W/S 控压，P2=←/→ 控向');
  }

  function saveLastRun() {
    if (game.saved) return;
    game.saved = true;
    lastRun = { result: game.status, mode: game.mode, log: game.log, replay: game.replay };
    setStatus(game.status === 'win'
      ? '任务成功！按 V 回放，按 E 导出回放，按 R 再来一局'
      : '任务失败。按 V 回放复盘，按 R 重开');
  }

  function startReplay() {
    if (!lastRun) { setStatus('还没有已结束的对局可回放'); return; }
    replayEntries = lastRun.replay;
    replayIdx = 0;
    replayClock = 0;
    replayLog = [];
    replayView = null;
    setStatus('回放中… 按任意键退出');
  }

  function exitReplay() {
    replayEntries = null;
    replayView = null;
  }

  function exportReplay() {
    const data = lastRun || { result: game.status, mode: game.mode, log: game.log, replay: game.replay };
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), config: CONFIG, ...data }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'firehose-replay.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('回放已导出为 firehose-replay.json（含双方输入、共享资源快照与冲突事件）');
  }

  function handleCommand(code) {
    if (replayEntries) { exitReplay(); setStatus('已退出回放'); return; }
    if (code === 'KeyP') { paused = !paused; setStatus(paused ? '已暂停' : '继续'); }
    else if (code === 'KeyR') restart();
    else if (code === 'KeyM') toggleMode();
    else if (code === 'KeyV') startReplay();
    else if (code === 'KeyE') exportReplay();
  }

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (!e.repeat) handleCommand(e.code);
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  document.getElementById('btnPause').onclick = () => handleCommand('KeyP');
  document.getElementById('btnRestart').onclick = () => handleCommand('KeyR');
  document.getElementById('btnMode').onclick = () => handleCommand('KeyM');
  document.getElementById('btnReplay').onclick = () => handleCommand('KeyV');
  document.getElementById('btnExport').onclick = () => handleCommand('KeyE');

  // 双人键位互不相交：P1=W/S，P2=方向键；调试模式额外允许 A/D 控向
  function gatherInputs() {
    const p1 = { up: !!keys.KeyW, down: !!keys.KeyS };
    const p2 = { left: !!keys.ArrowLeft, right: !!keys.ArrowRight };
    if (mode === 'debug') {
      p2.left = p2.left || !!keys.KeyA;
      p2.right = p2.right || !!keys.KeyD;
    }
    return { p1, p2 };
  }

  function tickReplay(dt) {
    replayClock += dt;
    while (replayIdx < replayEntries.length && replayEntries[replayIdx].t <= replayClock) {
      const entry = replayEntries[replayIdx++];
      if (entry.kind === 'snap') replayView = entry.data;
      else if (entry.kind === 'event') replayLog.push({ t: entry.t, text: eventText(entry.data) });
    }
    if (replayIdx >= replayEntries.length) {
      setStatus('回放结束，按任意键退出');
    }
  }

  function eventText(ev) {
    switch (ev.type) {
      case 'start': return '任务开始';
      case 'kink': return `⚠ 转弯 ${ev.corner} 打折（压力 ${ev.pressure}）`;
      case 'unkink': return `✔ 转弯 ${ev.corner} 恢复`;
      case 'recoil': return `⚠ 反冲（压力 ${ev.pressure}）`;
      case 'extinguish': return `✔ 火点 ${ev.fire} 扑灭`;
      case 'protect': return `⚠ ${ev.player.toUpperCase()} 进入保护状态`;
      case 'reconnect': return `${ev.player.toUpperCase()} 重新接入`;
      case 'win': return '✔ 任务成功';
      case 'lose': return `✘ 任务失败（${ev.reason}）`;
      default: return ev.type;
    }
  }

  let lastTs = 0;
  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (replayEntries) tickReplay(dt);
    else if (!paused) {
      Core.step(game, dt, gatherInputs());
      if (game.status !== 'running') saveLastRun();
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- 渲染 ----------

  function firePos(fire) {
    const mid = (fire.band[0] + fire.band[1]) / 2;
    const rad = (fire.angle * Math.PI) / 180;
    return {
      x: NOZZLE.x + Math.cos(rad) * mid * SCALE,
      y: NOZZLE.y - Math.sin(rad) * mid * SCALE,
    };
  }

  function viewState() {
    if (replayView) {
      return {
        pressure: replayView.pressure,
        aim: replayView.aim,
        tank: replayView.tank,
        timeLeft: replayView.timeLeft,
        fires: CONFIG.fires.map((f, i) => ({ ...f, hp: replayView.hp[i] })),
        corners: game.corners.map((c, i) => ({ ...c, kinked: replayView.kinks[i] })),
        spraying: replayView.pressure > 5 && !replayView.kinks.some(Boolean) && replayView.tank > 0,
      };
    }
    return game;
  }

  function render() {
    const s = viewState();
    ctx.clearRect(0, 0, W, H);
    drawScene(s);
    drawHose(s);
    drawAimAndJet(s);
    drawFires(s);
    drawTopBar(s);
    drawPumpPanel(s);
    drawGunnerPanel(s);
    drawLogBox();
    drawBadges();
  }

  function drawScene(s) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#232c3d');
    grad.addColorStop(1, '#1a2130');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2c3547';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    // 泵车
    ctx.fillStyle = '#b03a3a';
    ctx.fillRect(140, 520, 70, 40);
    ctx.fillStyle = '#7d2828';
    ctx.fillRect(150, 505, 34, 18);
    ctx.fillStyle = '#dfe6ef';
    ctx.font = '12px sans-serif';
    ctx.fillText('消防泵', 152, 552);
    if (mode === 'debug' && !replayEntries) drawDebugOverlay(s);
  }

  function drawDebugOverlay(s) {
    ctx.save();
    ctx.setLineDash([4, 6]);
    for (const fire of CONFIG.fires) {
      for (const p of fire.band) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(127,208,255,0.25)';
        ctx.arc(NOZZLE.x, NOZZLE.y, p * SCALE, -Math.PI / 2, 0);
        ctx.stroke();
      }
    }
    const tol = (CONFIG.aimTolerance * Math.PI) / 180;
    const aimRad = (s.aim * Math.PI) / 180;
    ctx.strokeStyle = 'rgba(255,210,127,0.4)';
    for (const a of [aimRad - tol, aimRad + tol]) {
      ctx.beginPath();
      ctx.moveTo(NOZZLE.x, NOZZLE.y);
      ctx.lineTo(NOZZLE.x + Math.cos(a) * 400, NOZZLE.y - Math.sin(a) * 400);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHose(s) {
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#c9a13b';
    ctx.beginPath();
    ctx.moveTo(HOSE[0].x, HOSE[0].y);
    for (const pt of HOSE.slice(1)) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    s.corners.forEach((corner, i) => {
      const pt = HOSE[i + 1];
      if (corner.kinked) {
        ctx.strokeStyle = '#e04c4c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pt.x - 12, pt.y - 12);
        ctx.lineTo(pt.x + 12, pt.y + 12);
        ctx.moveTo(pt.x + 12, pt.y - 12);
        ctx.lineTo(pt.x - 12, pt.y + 12);
        ctx.stroke();
        ctx.fillStyle = '#ff8080';
        ctx.font = '13px sans-serif';
        ctx.fillText('打折!', pt.x - 18, pt.y - 20);
      }
      ctx.fillStyle = '#8a6d1f';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawAimAndJet(s) {
    const rad = (s.aim * Math.PI) / 180;
    const len = s.pressure * SCALE;
    const endX = NOZZLE.x + Math.cos(rad) * len;
    const endY = NOZZLE.y - Math.sin(rad) * len + len * 0.08;
    // 瞄准虚线（显示当前压力可达射程）
    ctx.save();
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = 'rgba(223,230,239,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(NOZZLE.x, NOZZLE.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
    if (s.spraying) {
      const layers = [
        ['rgba(120,190,255,0.35)', 12],
        ['rgba(160,215,255,0.6)', 7],
        ['rgba(235,248,255,0.9)', 3],
      ];
      for (const [color, width] of layers) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(NOZZLE.x, NOZZLE.y);
        ctx.quadraticCurveTo(NOZZLE.x + Math.cos(rad) * len * 0.6,
          NOZZLE.y - Math.sin(rad) * len * 0.6 - 10, endX, endY);
        ctx.stroke();
      }
    }
    // 枪口
    ctx.save();
    ctx.translate(NOZZLE.x, NOZZLE.y);
    ctx.rotate(-rad);
    ctx.fillStyle = '#8fa3c0';
    ctx.fillRect(0, -5, 26, 10);
    ctx.restore();
  }

  function drawFires(s) {
    for (const fire of s.fires) {
      const pos = firePos(fire);
      if (fire.hp > 0) {
        const flicker = 3 * Math.sin(performance.now() / 90 + fire.id * 2);
        const r = 16 + (fire.hp / 100) * 10 + flicker;
        const grad = ctx.createRadialGradient(pos.x, pos.y, 2, pos.x, pos.y, r);
        grad.addColorStop(0, '#fff3b0');
        grad.addColorStop(0.4, '#ff9a3c');
        grad.addColorStop(1, 'rgba(200,60,20,0.05)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fill();
        // HP 条
        ctx.fillStyle = '#444';
        ctx.fillRect(pos.x - 22, pos.y - r - 14, 44, 5);
        ctx.fillStyle = '#ff6b4a';
        ctx.fillRect(pos.x - 22, pos.y - r - 14, 44 * (fire.hp / 100), 5);
        ctx.fillStyle = '#ffd27f';
        ctx.font = '12px sans-serif';
        ctx.fillText(`火点${fire.id} ${fire.angle}° 需压${fire.band[0]}-${fire.band[1]}`, pos.x - 52, pos.y + r + 16);
      } else {
        ctx.fillStyle = 'rgba(160,160,160,0.5)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8ee08a';
        ctx.font = '13px sans-serif';
        ctx.fillText(`火点${fire.id} ✔`, pos.x - 24, pos.y + 24);
      }
    }
  }

  function drawTopBar(s) {
    ctx.fillStyle = 'rgba(20,26,36,0.85)';
    ctx.fillRect(300, 6, 400, 34);
    ctx.strokeStyle = '#33405a';
    ctx.strokeRect(300, 6, 400, 34);
    ctx.fillStyle = s.timeLeft < 20 ? '#ff8080' : '#dfe6ef';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`⏱ ${s.timeLeft.toFixed(1)}s`, 316, 29);
    ctx.fillStyle = '#44597f';
    ctx.fillRect(430, 16, 150, 12);
    ctx.fillStyle = s.tank < 20 ? '#ff8080' : '#7fd0ff';
    ctx.fillRect(430, 16, 150 * (s.tank / CONFIG.tankMax), 12);
    ctx.fillStyle = '#dfe6ef';
    ctx.font = '12px sans-serif';
    ctx.fillText(`水量 ${Math.round(s.tank)}%`, 436, 26);
    ctx.font = '14px sans-serif';
    s.fires.forEach((f, i) => {
      ctx.fillStyle = f.hp <= 0 ? '#8ee08a' : '#ff9a3c';
      ctx.fillText(f.hp <= 0 ? `火${f.id}✔` : `火${f.id}`, 610 + i * 30, 28);
    });
  }

  function drawPumpPanel(s) {
    ctx.fillStyle = 'rgba(20,26,36,0.85)';
    ctx.fillRect(8, 60, 122, 400);
    ctx.strokeStyle = '#33405a';
    ctx.strokeRect(8, 60, 122, 400);
    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('P1 泵手', 20, 84);
    const gx = 46, gy = 100, gh = 280, gw = 30;
    ctx.fillStyle = '#2a3a55';
    ctx.fillRect(gx, gy, gw, gh);
    // 当前目标火点的安全区间高亮
    const target = s.fires.find(f => f.hp > 0);
    if (target) {
      const y1 = gy + gh - (target.band[1] / 100) * gh;
      const y2 = gy + gh - (target.band[0] / 100) * gh;
      ctx.fillStyle = 'rgba(142,224,138,0.3)';
      ctx.fillRect(gx, y1, gw, y2 - y1);
    }
    const ph = (s.pressure / 100) * gh;
    ctx.fillStyle = s.pressure > CONFIG.recoilThreshold ? '#e04c4c' : '#ffb347';
    ctx.fillRect(gx, gy + gh - ph, gw, ph);
    // 阈值刻度：转弯1/转弯2/反冲
    ctx.font = '10px sans-serif';
    const marks = [
      [CONFIG.corners[0].threshold, '弯1', '#ffd27f'],
      [CONFIG.corners[1].threshold, '弯2', '#ffd27f'],
      [CONFIG.recoilThreshold, '反冲', '#ff8080'],
    ];
    for (const [p, label, color] of marks) {
      const y = gy + gh - (p / 100) * gh;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(gx - 4, y);
      ctx.lineTo(gx + gw + 4, y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, gx + gw + 8, y + 3);
    }
    ctx.fillStyle = '#dfe6ef';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`${Math.round(s.pressure)}`, gx - 2, gy + gh + 24);
    ctx.font = '12px sans-serif';
    ctx.fillText('W 增压', 20, gy + gh + 48);
    ctx.fillText('S 降压', 20, gy + gh + 66);
    drawProtectBadge('p1', 20, gy + gh + 84);
  }

  function drawGunnerPanel(s) {
    ctx.fillStyle = 'rgba(20,26,36,0.85)';
    ctx.fillRect(862, 60, 130, 240);
    ctx.strokeStyle = '#33405a';
    ctx.strokeRect(862, 60, 130, 240);
    ctx.fillStyle = '#8ee08a';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('P2 枪手', 876, 84);
    ctx.fillStyle = '#dfe6ef';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`${Math.round(s.aim)}°`, 876, 116);
    ctx.font = '12px sans-serif';
    let y = 140;
    for (const f of s.fires) {
      ctx.fillStyle = f.hp <= 0 ? '#5f6f88' : '#dfe6ef';
      ctx.fillText(`火${f.id}: ${f.angle}° 压${f.band[0]}-${f.band[1]}${f.hp <= 0 ? ' ✔' : ''}`, 876, y);
      y += 20;
    }
    ctx.fillStyle = '#dfe6ef';
    ctx.fillText('← 下压  → 上抬', 876, y + 10);
    drawProtectBadge('p2', 876, y + 28);
  }

  function drawProtectBadge(pid, x, y) {
    const player = game.players[pid];
    const prot = !replayEntries && player.protected;
    ctx.fillStyle = prot ? '#e04c4c' : '#2e7d32';
    ctx.fillRect(x, y, 90, 18);
    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    ctx.fillText(prot ? '保护中(断开)' : '在线', x + 8, y + 13);
  }

  function drawLogBox() {
    const lines = replayEntries ? replayLog.slice(-5) : game.log.slice(-5);
    ctx.fillStyle = 'rgba(20,26,36,0.8)';
    ctx.fillRect(300, 46, 400, 20 + lines.length * 18);
    ctx.strokeStyle = '#33405a';
    ctx.strokeRect(300, 46, 400, 20 + lines.length * 18);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#8fa3c0';
    ctx.fillText(replayEntries ? '回放 · 任务记录' : '任务记录', 310, 61);
    lines.forEach((entry, i) => {
      ctx.fillStyle = entry.text.startsWith('⚠') ? '#ff9a8a' : entry.text.startsWith('✔') ? '#8ee08a' : '#dfe6ef';
      ctx.fillText(`[${entry.t.toFixed(1)}s] ${entry.text}`, 310, 79 + i * 18);
    });
  }

  function drawBadges() {
    ctx.font = 'bold 14px sans-serif';
    if (mode === 'debug') {
      ctx.fillStyle = '#b07fff';
      ctx.fillText('DEBUG 单人调试', 140, 26);
    }
    if (replayEntries) {
      ctx.fillStyle = '#7fd0ff';
      ctx.fillText('▶ 回放中（任意键退出）', 140, 26);
    }
    if (paused && !replayEntries) {
      overlay('已暂停 — 按 P 继续');
    } else if (!replayEntries && game.status !== 'running') {
      overlay(game.status === 'win'
        ? '✔ 任务成功！R 重开 / V 回放 / E 导出'
        : '✘ 任务失败 — R 重开 / V 回放复盘');
    }
  }

  function overlay(text) {
    ctx.fillStyle = 'rgba(10,14,20,0.65)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd27f';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, H / 2);
    ctx.textAlign = 'left';
  }
})();

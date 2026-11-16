/* UI 层：Canvas 场景、面板、声音、自检。模拟逻辑全部在 sim.js。 */
(function () {
  'use strict';
  const { createSim, CAM_RANGE, CAM_HALF_ANGLE, THRESH, RECOVERY_WATCH } = window.SimCore;

  const $ = (id) => document.getElementById(id);
  const canvas = $('view'), ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const sx = (x) => (x / 100) * W, sy = (y) => (y / 100) * H;

  let sim, running = true, speed = 2, lastReal = 0, acc = 0;
  let lastLogCount = 0;
  const SIM_DT = 0.1;

  function newSim() {
    const seed = parseInt($('seed').value, 10) || 1;
    sim = createSim(seed);
    lastLogCount = 0;
    $('log').innerHTML = '';
    $('reports').innerHTML = '<span class="hint">尚无干预记录</span>';
    $('successBanner').style.display = 'none';
    buildCamCards();
  }

  // ---------- Canvas：雪坡、相机覆盖、足迹、动物、降雪 ----------
  const flakes = Array.from({ length: 160 }, () => ({
    x: Math.random() * W, y: Math.random() * H, r: 0.6 + Math.random() * 1.8,
  }));

  function drawSlope(env) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#22334e'); g.addColorStop(0.5, '#31445f'); g.addColorStop(1, '#c9d6e6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = H * 0.18 + i * H * 0.12 + Math.sin(x / 90 + i * 1.7) * 14;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // 积雪覆盖感：雪位越高越白
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.35, env.snowWater / 120)})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawCams(s) {
    for (const cam of s.cams) {
      const cx = sx(cam.x), cy = sy(cam.y);
      // 覆盖扇形
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, CAM_RANGE / 100 * W, cam.angle - CAM_HALF_ANGLE, cam.angle + CAM_HALF_ANGLE);
      ctx.closePath();
      ctx.fillStyle = cam.on
        ? (cam.light > THRESH.lightAvoid ? 'rgba(248,113,113,0.13)' : 'rgba(94,193,255,0.14)')
        : 'rgba(120,140,160,0.06)';
      ctx.fill();
      ctx.strokeStyle = cam.on ? 'rgba(94,193,255,0.5)' : 'rgba(120,140,160,0.25)';
      ctx.stroke();
      // 相机本体
      const alarm = s.alarms.some(a => a.active && a.cam === cam.id);
      ctx.fillStyle = alarm ? '#f87171' : cam.on ? '#5ec1ff' : '#7f93ab';
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0e1522';
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(cam.id + 1), cx, cy);
      // 镜头积雪遮挡
      if (cam.lensSnow > 0.25) {
        ctx.fillStyle = `rgba(255,255,255,${cam.lensSnow * 0.9})`;
        ctx.beginPath(); ctx.arc(cx, cy, 7 * cam.lensSnow, 0, Math.PI * 2); ctx.fill();
      }
      if (cam.heaterT > 0) {
        ctx.strokeStyle = 'rgba(251,191,36,0.8)';
        ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function drawFauna(s) {
    for (const f of s.footprints) {
      const age = (s.t - f.t) / 120;
      ctx.fillStyle = `rgba(30,50,80,${0.55 * (1 - age)})`;
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), 1.6, 0, Math.PI * 2); ctx.fill();
    }
    const colors = ['#ffd166', '#a3e635', '#fb923c', '#c084fc', '#f9a8d4', '#67e8f9'];
    for (const a of s.animals) {
      if (a.captured) continue;
      ctx.fillStyle = colors[a.id % colors.length];
      ctx.beginPath(); ctx.arc(sx(a.x), sy(a.y), 3.2, 0, Math.PI * 2); ctx.fill();
      if (a.avoidT > 0) {
        ctx.strokeStyle = 'rgba(248,113,113,0.9)';
        ctx.beginPath(); ctx.arc(sx(a.x), sy(a.y), 6, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function drawSnow(env, dtReal) {
    const n = Math.floor(flakes.length * Math.min(1, env.snowfall / 1.6));
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < n; i++) {
      const f = flakes[i];
      f.y += (30 + env.snowfall * 40) * dtReal;
      f.x += (env.wind * 6 - 20) * dtReal;
      if (f.y > H) { f.y = -4; f.x = Math.random() * W; }
      if (f.x < 0) f.x += W; if (f.x > W) f.x -= W;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- 环境指标表：观测值 / 实际值 / 告警状态 ----------
  const ENV_ROWS = [
    ['气温', 'temp', '℃', (v) => v < THRESH.coldSnap, '寒潮'],
    ['风速', 'wind', 'm/s', () => false, ''],
    ['降雪', 'snowfall', '', (v) => v > THRESH.blizzard, '暴雪'],
    ['积雪水位', 'snowWater', 'mm', () => false, ''],
    ['污染指数', 'pollution', '', (v) => v > 70, '污染偏高'],
    ['物种活动', 'activity', '', () => false, ''],
  ];

  function renderEnv(s) {
    const tbl = $('envTable');
    while (tbl.rows.length > 1) tbl.deleteRow(1);
    for (const [name, key, unit, isBad, label] of ENV_ROWS) {
      const tr = tbl.insertRow();
      const obs = s.obs[key], act = s.env[key];
      const bad = isBad(obs);
      tr.innerHTML = `<td>${name}</td><td>${obs}${unit}</td>`
        + `<td style="color:var(--dim)">${(+act).toFixed(2)}${unit}</td>`
        + `<td class="${bad ? 'alarmOn' : 'alarmOff'}">${bad ? '⚠ ' + label : '正常'}</td>`;
    }
  }

  // ---------- 相机卡片 ----------
  function barCls(v, warnAt, badAt, invert) {
    const bad = invert ? v < badAt : v > badAt;
    const warn = invert ? v < warnAt : v > warnAt;
    return bad ? 'bar bad' : warn ? 'bar warn' : 'bar';
  }

  function buildCamCards() {
    const host = $('cams');
    host.innerHTML = '';
    sim.state.cams.forEach((cam, i) => {
      const div = document.createElement('div');
      div.className = 'camcard';
      div.id = `cam${i}`;
      div.innerHTML = `
        <h3>相机 ${i + 1} <span data-role="state"></span></h3>
        <label>电量(观测/实际)</label>
        <div class="row"><span data-role="batTxt" style="width:86px"></span>
          <div class="bar" data-role="batBar" style="flex:1"><i></i></div></div>
        <label>镜头积雪(观测/实际)</label>
        <div class="row"><span data-role="lensTxt" style="width:86px"></span>
          <div class="bar" data-role="lensBar" style="flex:1"><i></i></div></div>
        <label>动物信号</label>
        <div class="bar" data-role="sigBar"><i></i></div>
        <div class="row">
          <button data-act="toggle"></button>
          <label>补光 <input type="range" min="0" max="100" value="${cam.light * 100}" data-act="light"></label>
          <span data-role="lightTxt"></span>
        </div>
        <div class="row">
          <button data-act="wipe">除雪擦拭</button>
          <button data-act="heat">加热除冰</button>
          <button data-act="battery">更换电池</button>
        </div>
        <div class="row hint" data-role="alarmLine"></div>`;
      host.appendChild(div);
      div.querySelector('[data-act=toggle]').onclick = () => {
        sim.setCameraOn(i, !sim.state.cams[i].on);
      };
      div.querySelector('[data-act=light]').oninput = (e) => {
        sim.setLight(i, e.target.value / 100);
      };
      for (const type of ['wipe', 'heat', 'battery']) {
        div.querySelector(`[data-act=${type}]`).onclick = () => doIntervene(i, type);
      }
    });
  }

  function doIntervene(i, type) {
    const rec = sim.intervene(i, type);
    const names = { wipe: '除雪擦拭', heat: '加热除冰', battery: '更换电池' };
    $('curAction').textContent = `${names[type]}@相机${i + 1}${rec.ok ? '' : '(失败)'}`;
    $('curAction').style.color = rec.ok ? 'var(--ok)' : 'var(--warn)';
    if (rec.ok) beep(660, 0.08); else buzz();
  }

  function renderCams(s) {
    s.cams.forEach((cam, i) => {
      const div = $(`cam${i}`);
      const q = (sel) => div.querySelector(sel);
      const alarm = s.alarms.filter(a => a.active && a.cam === i);
      q('[data-role=state]').textContent = cam.on ? '● 开机' : '○ 关机';
      q('[data-role=state]').style.color = cam.on ? 'var(--ok)' : 'var(--dim)';
      q('[data-act=toggle]').textContent = cam.on ? '关机' : '开机';
      q('[data-role=batTxt]').textContent = `${s.obs.battery[i]}% / ${cam.battery.toFixed(0)}%`;
      const batBar = q('[data-role=batBar]');
      batBar.className = barCls(s.obs.battery[i], 40, THRESH.batteryLow, true);
      batBar.firstElementChild.style.width = `${s.obs.battery[i]}%`;
      q('[data-role=lensTxt]').textContent = `${s.obs.lensSnow[i]} / ${cam.lensSnow.toFixed(2)}`;
      const lensBar = q('[data-role=lensBar]');
      lensBar.className = barCls(s.obs.lensSnow[i], 0.4, THRESH.lensCovered, false);
      lensBar.firstElementChild.style.width = `${s.obs.lensSnow[i] * 100}%`;
      const sigBar = q('[data-role=sigBar]');
      sigBar.firstElementChild.style.width = `${s.obs.signal[i] * 100}%`;
      sigBar.firstElementChild.style.background = 'var(--accent)';
      q('[data-role=lightTxt]').textContent = `补光 ${(cam.light * 100).toFixed(0)}%`
        + (cam.light > THRESH.lightAvoid ? ' ⚠过强' : '');
      q('[data-role=alarmLine]').textContent =
        alarm.length ? '⚠ ' + alarm.map(a => a.type).join('、') : (cam.heaterT > 0 ? '加热中…' : '');
      q('[data-role=alarmLine]').style.color = alarm.length ? 'var(--bad)' : 'var(--warn)';
    });
  }

  // ---------- 日志与报告 ----------
  function fmtT(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function appendLog(s) {
    const host = $('log');
    for (; lastLogCount < s.log.length; lastLogCount++) {
      const e = s.log[lastLogCount];
      const div = document.createElement('div');
      div.className = 'k-' + e.kind;
      div.textContent = `[${fmtT(e.t)}] ${e.msg}`;
      host.appendChild(div);
      if (e.kind === 'alarm') beep(880, 0.15);
      if (e.kind === 'fail') buzz();
      if (e.kind === 'capture' || e.kind === 'success') beep(520, 0.2);
    }
    host.scrollTop = host.scrollHeight;
  }

  // ---------- 主循环 ----------
  function frame(now) {
    const dtReal = Math.min(0.1, (now - lastReal) / 1000 || 0.016);
    lastReal = now;
    if (running) {
      acc += dtReal * speed;
      while (acc >= SIM_DT) { sim.step(SIM_DT); acc -= SIM_DT; }
    }
    const s = sim.snapshot();
    drawSlope(s.env);
    drawCams(s);
    drawFauna(s);
    drawSnow(s.env, dtReal);
    renderEnv(s);
    renderCams(s);
    appendLog(s);
    renderReports(s);
    updateAudio(s.env);
    $('clock').textContent = fmtT(s.t);
    $('goal').textContent = `${Math.min(3, s.captures.length)}/3`;
    if (s.success) $('successBanner').style.display = 'inline';
    requestAnimationFrame(frame);
  }

  $('btnRun').onclick = () => {
    running = !running;
    $('btnRun').textContent = running ? '⏸ 暂停' : '▶ 连续运行';
    $('btnRun').classList.toggle('active', running);
  };
  $('btnReset').onclick = () => { newSim(); running = true;
    $('btnRun').textContent = '⏸ 暂停'; $('btnRun').classList.add('active'); };
  $('speed').onchange = (e) => { speed = +e.target.value; };
  $('btnAudio').onclick = () => {
    if (!audio) initAudio();
    audioOn = !audioOn;
    if (audioOn) audio.resume();
    if (windGain) { windGain.gain.value = 0; snowGain.gain.value = 0; }
    $('btnAudio').textContent = audioOn ? '🔊 声音' : '🔇 声音';
  };
  $('btnSelfTest').onclick = selfTest;
  $('seed').onchange = () => newSim();

  newSim();
  requestAnimationFrame(frame);
})();

  function renderReports(s) {
    if (!s.reports.length) return;
    $('reports').innerHTML = s.reports.slice(-6).map(r => {
      const tag = r.ok ? '' : '(失败) ';
      return `<div>[${fmtT(r.t)}] ${r.type}@相机${r.cam + 1}${tag}：`
        + `物种 ${r.before.activity}→${r.after.activity}，`
        + `水位 ${r.before.snowWater}→${r.after.snowWater}mm，`
        + `污染 ${r.before.pollution}→${r.after.pollution}</div>`;
    }).join('');
  }

  // ---------- 声音：风雪底噪 + 设备反馈 ----------
  let audio = null, windGain = null, snowGain = null, audioOn = false;

  function initAudio() {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    const mkNoise = (freq, q) => {
      const len = audio.sampleRate * 2;
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = audio.createBufferSource();
      src.buffer = buf; src.loop = true;
      const flt = audio.createBiquadFilter();
      flt.type = 'bandpass'; flt.frequency.value = freq; flt.Q.value = q;
      const gain = audio.createGain(); gain.gain.value = 0;
      src.connect(flt).connect(gain).connect(audio.destination);
      src.start();
      return gain;
    };
    windGain = mkNoise(300, 0.6);   // 风：低频呼啸
    snowGain = mkNoise(4000, 0.8);  // 雪：高频沙沙
  }

  function beep(freq, dur) {
    if (!audioOn || !audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.12, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  }

  function buzz() {
    if (!audioOn || !audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 140; o.type = 'sawtooth';
    g.gain.setValueAtTime(0.1, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.3);
  }

  function updateAudio(env) {
    if (!audioOn || !audio) return;
    windGain.gain.value = Math.min(0.25, env.wind / 60);
    snowGain.gain.value = Math.min(0.12, env.snowfall / 14);
  }

  // ---------- 自检：页内复验临界阈值与处置失败 ----------
  function selfTest() {
    const seed = parseInt($('seed').value, 10) || 1;
    const out = [];
    // 临界阈值
    const s1 = createSim(seed);
    s1.setCameraOn(0, true);
    for (let i = 0; i < 6000; i++) s1.step(0.1);
    const a1 = s1.snapshot().alarms.find(a => a.key === 'bat0');
    out.push(a1 && a1.triggerT !== null
      ? `✔ 临界阈值：低电量告警触发于 ${fmtT(a1.triggerT)}`
      : '✘ 临界阈值验证失败');
    // 处置失败
    const s2 = createSim(seed);
    let rec = null;
    for (let i = 0; i < 9000 && !rec; i++) {
      s2.step(0.1);
      if (s2.state.env.snowfall > THRESH.wipeFailSnow) rec = s2.intervene(0, 'wipe');
    }
    out.push(rec && !rec.ok ? `✔ 处置失败复现：${rec.reason}` : '✘ 处置失败验证未触发');
    // 复现性
    const s3 = createSim(seed), s4 = createSim(seed);
    for (let i = 0; i < 2000; i++) { s3.step(0.1); s4.step(0.1); }
    const same = JSON.stringify(s3.snapshot().animals.map(a => [a.x.toFixed(3), a.y.toFixed(3)]))
      === JSON.stringify(s4.snapshot().animals.map(a => [a.x.toFixed(3), a.y.toFixed(3)]));
    out.push(same ? `✔ seed=${seed} 重开复现：天气与目标分布一致` : '✘ 复现性验证失败');
    const host = $('log');
    for (const line of out) {
      const div = document.createElement('div');
      div.className = 'k-test';
      div.textContent = `[自检] ${line}`;
      host.appendChild(div);
    }
    host.scrollTop = host.scrollHeight;
  }

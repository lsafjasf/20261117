/* UI：Canvas 渲染 + 控制（暂停/单步/恢复/重置/回放）+ 报告 */
(function () {
  "use strict";
  var E = window.WindSim;
  var LIMITS = E.LIMITS;
  var TB_COLORS = ["#4fc3f7", "#aed581", "#ffb74d"];
  var VAR_KEYS = ["power", "rotorRpm", "temp", "pressure", "cableTwist"];

  var sim = null;
  var mode = "ready"; // ready|running|paused|fault|done|replay
  var timer = null;
  var replayIdx = 0;
  var replayPlaying = false;

  var $ = function (id) { return document.getElementById(id); };
  var farmCtx = $("farm-canvas").getContext("2d");
  var trendCtx = $("trend-canvas").getContext("2d");

  function fmtTime(s) {
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function setBadge(text, cls) {
    var b = $("sim-state");
    b.textContent = text;
    b.className = "badge " + cls;
  }

  function setButtons() {
    $("btn-start").disabled = mode !== "ready";
    $("btn-pause").disabled = mode !== "running";
    $("btn-step").disabled = !(mode === "paused" || mode === "ready");
    $("btn-resume").disabled = mode !== "paused";
    $("btn-replay").disabled = !(mode === "done" || mode === "fault" || mode === "paused");
    var inReplay = mode === "replay";
    $("replay-bar").classList.toggle("hidden", !inReplay);
    $("seed-input").disabled = mode === "running" || inReplay;
  }

  // ---------- 主循环 ----------
  function tick() {
    var speed = parseInt($("speed-select").value, 10);
    for (var i = 0; i < speed * 20; i++) {   // 每 tick 约 20×speed 秒仿真
      if (mode !== "running") break;
      E.step(sim);
      if (sim.fault) { onFault(); break; }
      if (sim.done) { onDone(); break; }
    }
    renderAll();
  }

  function startLoop() {
    stopLoop();
    timer = setInterval(tick, 50);
  }
  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function onFault() {
    mode = "fault";
    stopLoop();
    setBadge("故障停机", "fault");
    showFaultOverlay();
    buildReport();
    setButtons();
  }

  function onDone() {
    mode = "done";
    stopLoop();
    setBadge("完成 8 小时 · 电缆安全", "done");
    buildReport();
    setButtons();
  }

  // ---------- 控制事件 ----------
  function doStart() {
    var seed = parseInt($("seed-input").value, 10) || 0;
    sim = E.createSim(seed);
    mode = "running";
    setBadge("运行中", "running");
    setButtons();
    startLoop();
  }
  function doPause() { if (mode === "running") { mode = "paused"; setBadge("已暂停", "paused"); setButtons(); } }
  function doResume() { if (mode === "paused") { mode = "running"; setBadge("运行中", "running"); setButtons(); } }
  function doStep() {
    if (!sim) { // 就绪状态下单步：先按种子建模仿真
      var seed = parseInt($("seed-input").value, 10) || 0;
      sim = E.createSim(seed);
    }
    if (mode === "ready") mode = "paused";
    if (mode !== "paused") return;
    E.step(sim);
    if (sim.fault) { onFault(); return; }
    if (sim.done) { onDone(); return; }
    setBadge("已暂停（单步）", "paused");
    setButtons();
    renderAll();
  }
  function doReset() {
    stopLoop();
    replayPlaying = false;
    sim = null;
    mode = "ready";
    setBadge("就绪", "");
    $("fault-overlay").classList.add("hidden");
    $("report-content").textContent = "尚未运行。";
    setButtons();
    renderAll();
  }

  // ---------- 视图数据：实时或回放快照 ----------
  function currentView() {
    if (!sim) return null;
    if (mode === "replay") return sim.history[replayIdx];
    return sim.history[sim.history.length - 1];
  }

  // ---------- 风电场俯视图 ----------
  function drawArrow(ctx, x, y, angDeg, len, color, width) {
    var a = angDeg * Math.PI / 180;
    var dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    var ha = 0.45, hl = 9;
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - hl * Math.cos(a - ha), y + dy - hl * Math.sin(a - ha));
    ctx.lineTo(x + dx - hl * Math.cos(a + ha), y + dy - hl * Math.sin(a + ha));
    ctx.closePath(); ctx.fill();
  }

  function renderFarm(view) {
    var ctx = farmCtx, W = 640, H = 520;
    ctx.clearRect(0, 0, W, H);
    // 网格
    ctx.strokeStyle = "#1a2431"; ctx.lineWidth = 1;
    for (var gx = 40; gx < W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 40; gy < H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    if (!view) {
      ctx.fillStyle = "#5a6b80"; ctx.font = "15px sans-serif";
      ctx.fillText("点击“开始”运行仿真", 240, 260);
      return;
    }

    // 风向罗盘（来流方向 → 去向箭头）
    var windTo = view.windDir + 180;
    ctx.fillStyle = "#8fa3bd"; ctx.font = "12px sans-serif";
    ctx.fillText("风向(来流) " + ((view.windDir % 360 + 360) % 360).toFixed(0) + "°", 18, 26);
    ctx.fillText("风速 " + view.windSpeed.toFixed(1) + " m/s", 18, 44);
    ctx.strokeStyle = "#3a4c64"; ctx.beginPath(); ctx.arc(560, 60, 34, 0, 7); ctx.stroke();
    drawArrow(ctx, 560 - Math.cos(windTo * Math.PI / 180) * 24, 60 - Math.sin(windTo * Math.PI / 180) * 24,
      windTo, 48, "#e8c547", 3);
    ctx.fillStyle = "#8fa3bd"; ctx.fillText("N", 556, 18);

    // 风机
    for (var i = 0; i < view.tb.length; i++) {
      var tb = view.tb[i];
      var pos = sim.turbines[i];
      var x = pos.x, y = pos.y;
      var color = TB_COLORS[i];
      var faulted = sim.fault && sim.fault.turbineId === i && mode !== "replay";

      // 电缆扭转指示环：颜色随扭转程度变化
      var tw = tb.twist;
      var twRatio = Math.min(Math.abs(tw) / LIMITS.cableTwist.max, 1);
      ctx.strokeStyle = twRatio > 0.75 ? "#f0544f" : (twRatio > 0.5 ? "#f0b429" : "#3f8f5f");
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + (tw / 720) * 2 * Math.PI, tw < 0);
      ctx.stroke();
      ctx.lineWidth = 1;

      // 塔筒
      ctx.fillStyle = "#9fb2c8";
      ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill();

      // 机舱朝向线 + 风轮
      var yawTo = tb.yaw + 180; // 机舱迎风，风轮朝向来流
      drawArrow(ctx, x, y, yawTo, 30, color, 3);
      var pa = (yawTo + 90) * Math.PI / 180;
      var rx = x + Math.cos(yawTo * Math.PI / 180) * 30;
      var ry = y + Math.sin(yawTo * Math.PI / 180) * 30;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rx - Math.cos(pa) * 16, ry - Math.sin(pa) * 16);
      ctx.lineTo(rx + Math.cos(pa) * 16, ry + Math.sin(pa) * 16);
      ctx.stroke();
      ctx.lineWidth = 1;

      // 故障标记
      if (faulted) {
        ctx.strokeStyle = "#f0544f"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 36, 0, 7); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "#f0544f"; ctx.font = "bold 12px sans-serif";
        ctx.fillText("故障", x - 14, y - 42);
      }

      // 标签
      ctx.fillStyle = color; ctx.font = "12px sans-serif";
      ctx.fillText("T" + (i + 1), x - 8, y + 52);
      ctx.fillStyle = "#8fa3bd";
      ctx.fillText("扭 " + tw.toFixed(0) + "°", x - 22, y + 66);
      ctx.fillText(tb.power.toFixed(2) + " MW", x - 24, y + 80);
    }
  }

  // ---------- 趋势图：5 个物理量分条 + 限值线 + 故障点 + 回放游标 ----------
  var SNAP_KEY = { power: "power", rotorRpm: "rpm", temp: "temp", pressure: "pressure", cableTwist: "twist" };

  function renderTrend() {
    var ctx = trendCtx, W = 640, H = 300;
    ctx.clearRect(0, 0, W, H);
    if (!sim || sim.history.length < 2) {
      ctx.fillStyle = "#5a6b80"; ctx.font = "13px sans-serif";
      ctx.fillText("趋势图（功率 / 转速 / 温度 / 压力 / 电缆扭转）", 150, 150);
      return;
    }
    var hist = sim.history;
    var n = hist.length;
    var stripH = H / VAR_KEYS.length;
    var xStep = Math.max(1, Math.floor(n / W));

    for (var v = 0; v < VAR_KEYS.length; v++) {
      var key = VAR_KEYS[v], sk = SNAP_KEY[key];
      var L = LIMITS[key];
      var y0 = v * stripH;
      var lo = L.min, hi = L.max;
      var pad = (hi - lo) * 0.15;
      lo -= pad; hi += pad;
      var toY = function (val) {
        return y0 + stripH - 4 - ((val - lo) / (hi - lo)) * (stripH - 8);
      };

      // 分条底色与标签
      ctx.fillStyle = v % 2 ? "#0d1219" : "#0b0f14";
      ctx.fillRect(0, y0, W, stripH);
      ctx.fillStyle = "#8fa3bd"; ctx.font = "10px sans-serif";
      ctx.fillText(L.name + " [" + L.min + ".." + L.max + "] " + L.unit, 4, y0 + 11);

      // 限值线
      ctx.strokeStyle = "rgba(240,84,79,0.55)"; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(0, toY(L.max)); ctx.lineTo(W, toY(L.max)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toY(L.min)); ctx.lineTo(W, toY(L.min)); ctx.stroke();
      ctx.setLineDash([]);

      // 各风机轨迹
      for (var i = 0; i < 3; i++) {
        ctx.strokeStyle = TB_COLORS[i]; ctx.lineWidth = 1;
        ctx.beginPath();
        var first = true;
        for (var k = 0; k < n; k += xStep) {
          var x = (k / (n - 1)) * (W - 1);
          var y = toY(hist[k].tb[i][sk]);
          if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      // 故障点标记（首次越限位置）
      if (sim.fault && sim.fault.variable === key) {
        var fx = (sim.fault.time / (E.TOTAL_TIME)) * (W - 1);
        ctx.strokeStyle = "#f0544f"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(fx, y0); ctx.lineTo(fx, y0 + stripH); ctx.stroke();
        ctx.fillStyle = "#f0544f";
        ctx.beginPath(); ctx.arc(fx, toY(sim.fault.value), 4, 0, 7); ctx.fill();
        ctx.lineWidth = 1;
      }
    }

    // 回放游标
    if (mode === "replay") {
      var cx = (replayIdx / (n - 1)) * (W - 1);
      ctx.strokeStyle = "#e8c547"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // ---------- 风机状态卡片（物理量 + 边界） ----------
  function renderCards(view) {
    var host = $("turbine-cards");
    if (!view) { host.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < 3; i++) {
      var tb = view.tb[i];
      var faulted = sim.fault && sim.fault.turbineId === i;
      html += '<div class="tcard' + (faulted ? " faulted" : "") + '">';
      html += "<h3 style='color:" + TB_COLORS[i] + "'>风机 T" + (i + 1) + "</h3>";
      html += row("负载(功率)", tb.power, LIMITS.power, 2);
      html += row("转速", tb.rpm, LIMITS.rotorRpm, 1);
      html += row("温度", tb.temp, LIMITS.temp, 1);
      html += row("液压", tb.pressure, LIMITS.pressure, 0);
      html += row("电缆扭转", tb.twist, LIMITS.cableTwist, 0);
      html += '<div>桨距角 <span class="val">' + tb.pitch.toFixed(1) + "°</span></div>";
      html += '<div>偏航次数 <span class="val">' + tb.yawCount + "</span></div>";
      html += "</div>";
    }
    host.innerHTML = html;
  }

  function row(label, val, L, digits) {
    var ratio = (val - L.min) / (L.max - L.min);
    var cls = (val > L.max || val < L.min) ? "over" : (ratio > 0.85 || ratio < 0.15 ? "warn" : "val");
    return '<div>' + label + ' <span class="' + cls + '">' + val.toFixed(digits) + " " + L.unit +
      '</span> <span style="color:#5a6b80">[' + L.min + ".." + L.max + "]</span></div>";
  }

  // ---------- 报告：峰值与故障位置 ----------
  function buildReport() {
    var html = "";
    if (sim.fault) {
      var f = sim.fault;
      html += '<p style="color:#f0544f;font-weight:bold">结果：故障停机 —— 首次越限：风机 T' +
        (f.turbineId + 1) + " 的「" + f.name + "」在 t=" + fmtTime(f.time) +
        " 达到 " + f.value.toFixed(2) + "（限值 " + f.limit + " " + LIMITS[f.variable].unit + "）</p>";
    } else if (sim.done) {
      html += '<p style="color:#7fc97f;font-weight:bold">结果：成功完成 8 小时模拟，电缆扭转始终处于安全范围。</p>';
    }
    html += "<table><tr><th>风机</th><th>峰值功率</th><th>峰值转速</th><th>峰值温度</th><th>最低液压</th><th>最大|扭转|</th><th>偏航次数</th></tr>";
    for (var i = 0; i < 3; i++) {
      var p = sim.peaks[i];
      var twMax = Math.max(Math.abs(p.cableTwist.max), Math.abs(p.cableTwist.min));
      html += "<tr><td style='color:" + TB_COLORS[i] + "'>T" + (i + 1) + "</td>" +
        "<td>" + p.power.max.toFixed(2) + " MW @" + fmtTime(p.power.tMax) + "</td>" +
        "<td>" + p.rotorRpm.max.toFixed(1) + " rpm @" + fmtTime(p.rotorRpm.tMax) + "</td>" +
        "<td>" + p.temp.max.toFixed(1) + " °C @" + fmtTime(p.temp.tMax) + "</td>" +
        "<td>" + p.pressure.min.toFixed(0) + " bar @" + fmtTime(p.pressure.tMin) + "</td>" +
        "<td>" + twMax.toFixed(0) + " °</td>" +
        "<td>" + sim.turbines[i].yawCount + "</td></tr>";
    }
    html += "</table>";
    html += '<p style="color:#8fa3bd">种子 ' + sim.seed + " · 仿真时长 " + fmtTime(sim.t) +
      " · 相同种子重复运行轨迹完全一致；重置后初始条件不漂移。</p>";
    $("report-content").innerHTML = html;
  }

  // ---------- 故障弹窗 ----------
  function showFaultOverlay() {
    var f = sim.fault;
    $("fault-title").textContent = "安全停机：首次越限";
    $("fault-detail").innerHTML =
      "<p>部件：<b>风机 T" + (f.turbineId + 1) + " · " + f.name + "</b></p>" +
      "<p>时间：t = " + fmtTime(f.time) + "（第 " + f.time + " 秒）</p>" +
      "<p>数值：" + f.value.toFixed(2) + " " + LIMITS[f.variable].unit +
      "，越限边界 " + f.limit + " " + LIMITS[f.variable].unit + "</p>" +
      "<p>已停止不安全的计算。可查看回放定位故障发展过程，或重置后调整种子重试。</p>";
    $("fault-overlay").classList.remove("hidden");
  }

  // ---------- 回放 ----------
  function enterReplay() {
    if (!sim || sim.history.length < 2) return;
    mode = "replay";
    stopLoop();
    replayPlaying = true;
    replayIdx = 0;
    $("replay-slider").max = sim.history.length - 1;
    $("fault-overlay").classList.add("hidden");
    setBadge("回放中", "paused");
    setButtons();
    replayTick();
  }
  function replayTick() {
    if (mode !== "replay") return;
    if (replayPlaying) {
      replayIdx = Math.min(replayIdx + 40, sim.history.length - 1);
      if (replayIdx >= sim.history.length - 1) replayPlaying = false;
    }
    $("replay-slider").value = replayIdx;
    $("replay-time").textContent = fmtTime(sim.history[replayIdx].t);
    renderAll();
    setTimeout(replayTick, 50);
  }
  function exitReplay() {
    replayPlaying = false;
    mode = sim.fault ? "fault" : (sim.done ? "done" : "paused");
    setBadge(sim.fault ? "故障停机" : (sim.done ? "完成 8 小时 · 电缆安全" : "已暂停"),
      sim.fault ? "fault" : (sim.done ? "done" : "paused"));
    if (sim.fault) $("fault-overlay").classList.remove("hidden");
    setButtons();
    renderAll();
  }

  // ---------- 总渲染 ----------
  function renderAll() {
    var view = currentView();
    renderFarm(view);
    renderTrend();
    renderCards(view);
    var t = view ? view.t : 0;
    $("sim-clock").textContent = "t = " + fmtTime(t) + " / 08:00:00";
    if (view) {
      $("wind-info").textContent =
        "风向 " + ((view.windDir % 360 + 360) % 360).toFixed(0) + "° · 风速 " + view.windSpeed.toFixed(1) + " m/s";
    } else {
      $("wind-info").textContent = "";
    }
  }

  // ---------- 事件绑定 ----------
  $("btn-start").addEventListener("click", doStart);
  $("btn-pause").addEventListener("click", doPause);
  $("btn-resume").addEventListener("click", doResume);
  $("btn-step").addEventListener("click", doStep);
  $("btn-reset").addEventListener("click", doReset);
  $("btn-replay").addEventListener("click", enterReplay);
  $("btn-replay-exit").addEventListener("click", exitReplay);
  $("btn-fault-replay").addEventListener("click", enterReplay);
  $("btn-fault-reset").addEventListener("click", doReset);
  $("replay-slider").addEventListener("input", function () {
    replayPlaying = false;
    replayIdx = parseInt(this.value, 10);
    $("replay-time").textContent = fmtTime(sim.history[replayIdx].t);
    renderAll();
  });

  setButtons();
  renderAll();
})();

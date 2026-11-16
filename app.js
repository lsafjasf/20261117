/* UI 主控：传输控制（开始/暂停/单步/重置/回放）、读数、报告、画布渲染 */
(function () {
  "use strict";
  var S = window.SIM;

  // ---- DOM ----
  var sceneCv = document.getElementById("scene");
  var chartCv = document.getElementById("chart");
  var sctx = sceneCv.getContext("2d");
  var cctx = chartCv.getContext("2d");
  var btnRun = document.getElementById("btnRun");
  var btnStep = document.getElementById("btnStep");
  var btnReset = document.getElementById("btnReset");
  var btnReplay = document.getElementById("btnReplay");
  var replaybar = document.getElementById("replaybar");
  var replayCursor = document.getElementById("replayCursor");
  var replayTime = document.getElementById("replayTime");
  var statusline = document.getElementById("statusline");
  var reportPanel = document.getElementById("report");
  var reportBody = document.getElementById("reportBody");
  var tblBody = document.querySelector("#tbl tbody");
  var fanSlider = document.getElementById("fan");
  var padSliders = Array.prototype.slice.call(document.querySelectorAll(".pad"));
  var wtSliders = Array.prototype.slice.call(document.querySelectorAll(".wt"));

  // ---- 模拟会话状态 ----
  var state = S.createState();
  var running = false;
  var replayMode = false;
  var replayPlaying = false;
  var acc = 0;            // 固定步长累加器：暂停/单步/连续共用同一步进函数
  var lastTs = null;

  function currentInputs() {
    return {
      fan: fanSlider.value / 100,
      pads: padSliders.map(function (s) { return s.value / 10; }),
      weights: wtSliders.map(function (s) { return +s.value; })
    };
  }

  function pushInputs() {
    state.inputs = currentInputs();
  }

  // ---- 传输控制 ----
  function setRunning(on) {
    if (state.finished) on = false;
    running = on;
    replayMode = false;
    replaybar.hidden = true;
    btnRun.textContent = running ? "暂停" : (state.t > 0 ? "恢复" : "开始");
    btnRun.classList.toggle("active", running);
    btnReplay.classList.remove("active");
    lastTs = null;
    acc = 0;
    updateStatus();
  }

  function doStep() {
    if (state.finished) return;
    setRunning(false);
    pushInputs();
    S.step(state);
    afterAdvance();
  }

  function doReset() {
    state = S.createState(); // 全新对象：初始条件零漂移
    running = false;
    replayMode = false;
    replayPlaying = false;
    acc = 0;
    lastTs = null;
    btnRun.textContent = "开始";
    btnRun.classList.remove("active");
    btnReplay.classList.remove("active");
    replaybar.hidden = true;
    reportPanel.hidden = true;
    syncOutputs();
    updateStatus();
    render();
  }

  function enterReplay() {
    if (state.hist.t.length === 0) return;
    running = false;
    replayMode = true;
    replayPlaying = true;
    replaybar.hidden = false;
    replayCursor.max = state.hist.t.length - 1;
    replayCursor.value = 0;
    btnRun.textContent = state.finished ? "开始" : "恢复";
    btnRun.classList.remove("active");
    btnReplay.classList.add("active");
    updateStatus();
  }

  btnRun.addEventListener("click", function () { setRunning(!running); });
  btnStep.addEventListener("click", doStep);
  btnReset.addEventListener("click", doReset);
  btnReplay.addEventListener("click", enterReplay);
  replayCursor.addEventListener("input", function () { replayPlaying = false; render(); });

  [fanSlider].concat(padSliders, wtSliders).forEach(function (el) {
    el.addEventListener("input", syncOutputs);
  });

  function syncOutputs() {
    document.getElementById("oFan").textContent = fanSlider.value + "%";
    padSliders.forEach(function (s, i) {
      document.getElementById("oPad" + i).textContent = (s.value / 10).toFixed(1) + " W/K";
    });
    wtSliders.forEach(function (s, i) {
      document.getElementById("oW" + i).textContent = s.value;
    });
  }

  // ---- 主循环：固定步长累加器，保证与单步结果一致 ----
  function frame(ts) {
    if (running && !state.finished) {
      if (lastTs === null) lastTs = ts;
      var simSpeed = 20; // 20 倍速：10 分钟约 30 秒真实时间
      acc += Math.min((ts - lastTs) / 1000, 0.25) * simSpeed; // 防后台大跳
      lastTs = ts;
      while (acc >= S.PHYS.dt && !state.finished) {
        pushInputs();
        S.step(state);
        acc -= S.PHYS.dt;
      }
      afterAdvance();
    } else if (replayMode && replayPlaying) {
      var cur = +replayCursor.value;
      if (cur < state.hist.t.length - 1) {
        replayCursor.value = cur + 3; // 回放播放速度
      } else {
        replayPlaying = false;
      }
      render();
    }
    requestAnimationFrame(frame);
  }

  function afterAdvance() {
    if (state.finished) {
      running = false;
      btnRun.textContent = "开始";
      btnRun.classList.remove("active");
      showReport();
    }
    updateStatus();
    render();
  }

  // ---- 状态行 ----
  function updateStatus() {
    var txt, cls = "";
    if (replayMode) {
      txt = "回放中 · 拖动游标查看任意时刻 · 共 " + state.hist.t.length + " 步";
    } else if (state.failed) {
      var f = state.failed;
      txt = "故障：" + f.component + " " + f.type + " @ t=" + f.time.toFixed(1) +
            "s（值 " + fmtVal(f) + " / 限 " + f.limit + "）· 计算已停止";
      cls = "fail";
    } else if (state.won) {
      txt = "成功！三热源安全运行 10 分钟 · 耗电 " + state.energy.toFixed(0) + " J";
      cls = "win";
    } else if (running) {
      txt = "运行中 · t=" + state.t.toFixed(1) + "s / 600s";
    } else {
      txt = (state.t > 0 ? "已暂停 · t=" + state.t.toFixed(1) + "s" : "待机 · 按「开始」运行") +
            " · 负载此刻 " + S.loadProfile(state.t) + "W";
    }
    statusline.textContent = txt;
    statusline.className = "statusline " + cls;
  }

  function fmtVal(f) {
    if (f.type === "压力越限") return f.value.toFixed(3) + " MPa";
    if (f.type === "电量超支") return f.value.toFixed(0) + " J";
    return f.value.toFixed(1) + " °C";
  }

  // ---- 读数表：物理量 / 当前 / 边界 ----
  function viewState() {
    // 回放时按游标取历史快照，否则取实时状态
    if (!replayMode) return { t: state.t, temp: state.temp, tSink: state.tSink,
      pressure: Math.max.apply(null, state.pressures), energy: state.energy,
      load: state.pTotal, fan: state.inputs.fan,
      flows: state.flows, loads: state.loads, pressures: state.pressures };
    var i = +replayCursor.value, h = state.hist;
    if (h.t.length === 0) return { t: 0, temp: [S.PHYS.tInit, S.PHYS.tInit, S.PHYS.tInit],
      tSink: S.PHYS.tInit, pressure: S.PHYS.pRef, energy: 0, load: S.loadProfile(0),
      fan: 0, flows: { pad: [0, 0, 0], adj: [0, 0], fan: 0 }, loads: [0, 0, 0],
      pressures: [S.PHYS.pRef, S.PHYS.pRef, S.PHYS.pRef] };
    return { t: h.t[i], temp: [h.temp[0][i], h.temp[1][i], h.temp[2][i]],
      tSink: h.tSink[i], pressure: h.pressure[i], energy: h.energy[i],
      load: h.load[i], fan: h.fan[i],
      flows: { pad: [h.qPad[0][i], h.qPad[1][i], h.qPad[2][i]],
        adj: [h.qAdj[0][i], h.qAdj[1][i]], fan: h.qFan[i] },
      loads: [h.loads[0][i], h.loads[1][i], h.loads[2][i]],
      pressures: [h.pressure[i], h.pressure[i], h.pressure[i]] };
  }

  function renderTable() {
    var v = viewState();
    var L = S.LIMITS;
    var rows = [
      ["时间 t", v.t.toFixed(1) + " s", S.PHYS.duration + " s", false],
      ["热源1 温度", v.temp[0].toFixed(1) + " °C", L.T_SOURCE_MAX + " °C", v.temp[0] > L.T_SOURCE_MAX],
      ["热源2 温度", v.temp[1].toFixed(1) + " °C", L.T_SOURCE_MAX + " °C", v.temp[1] > L.T_SOURCE_MAX],
      ["热源3 温度", v.temp[2].toFixed(1) + " °C", L.T_SOURCE_MAX + " °C", v.temp[2] > L.T_SOURCE_MAX],
      ["散热器温度", v.tSink.toFixed(1) + " °C", L.T_SINK_MAX + " °C", v.tSink > L.T_SINK_MAX],
      ["热管压力(最大)", v.pressure.toFixed(3) + " MPa", L.P_PIPE_MAX + " MPa", v.pressure > L.P_PIPE_MAX],
      ["风扇耗电", v.energy.toFixed(0) + " J", L.ENERGY_MAX + " J", v.energy > L.ENERGY_MAX],
      ["总负载", v.load.toFixed(0) + " W", "—", false]
    ];
    tblBody.innerHTML = rows.map(function (r) {
      return '<tr class="' + (r[3] ? "over" : "") + '"><td>' + r[0] +
        "</td><td>" + r[1] + '</td><td class="limit">' + r[2] + "</td></tr>";
    }).join("");
  }

  // ---- 运行报告：峰值与故障位置 ----
  function showReport() {
    var p = state.peaks, L = S.LIMITS;
    var html = "";
    if (state.failed) {
      var f = state.failed;
      html += '<div class="fail">✖ 失败：' + f.component + " " + f.type + "</div>" +
        "<div>首次越限时间：t = " + f.time.toFixed(1) + " s（第 " +
        Math.round(f.time / S.PHYS.dt) + " 步）</div>" +
        "<div>触发值 " + fmtVal(f) + "，安全上限 " + f.limit + "</div>";
    } else if (state.won) {
      html += '<div class="win">✔ 成功：安全运行满 10 分钟</div>';
    }
    html += "<table><thead><tr><th>峰值</th><th>数值</th><th>上限</th></tr></thead><tbody>" +
      peakRow("热源1", p.temp[0], L.T_SOURCE_MAX, "°C", 1) +
      peakRow("热源2", p.temp[1], L.T_SOURCE_MAX, "°C", 1) +
      peakRow("热源3", p.temp[2], L.T_SOURCE_MAX, "°C", 1) +
      peakRow("散热器", p.tSink, L.T_SINK_MAX, "°C", 1) +
      peakRow("热管压力", p.pressure, L.P_PIPE_MAX, "MPa", 3) +
      peakRow("风扇耗电", state.energy, L.ENERGY_MAX, "J", 0) +
      "</tbody></table>";
    if (state.failed) {
      html += "<div>故障位置已在场景图中以 ⚠ 标出。</div>";
    }
    reportBody.innerHTML = html;
    reportPanel.hidden = false;
  }

  function peakRow(name, val, limit, unit, digits) {
    var over = val > limit;
    return '<tr class="' + (over ? "over" : "") + '"><td>' + name + '</td><td class="peak">' +
      val.toFixed(digits) + " " + unit + '</td><td class="limit">' + limit + " " + unit + "</td></tr>";
  }

  // ---- 场景渲染 ----
  var SRC_X = 90, SRC_W = 110, SRC_H = 64;
  var SRC_Y = [70, 180, 290];
  var SINK_X = 560, SINK_W = 130;

  function tempColor(t) {
    // 25°C 蓝 → 60°C 绿 → 80°C 黄 → ≥95°C 红
    var x = Math.max(0, Math.min(1, (t - 25) / 70));
    var r, g, b;
    if (x < 0.5) { r = 40 + 350 * x; g = 90 + 280 * x; b = 220 - 260 * x; }
    else { r = 215 + 40 * (x - 0.5); g = 230 - 300 * (x - 0.5); b = 40 - 40 * (x - 0.5); }
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + Math.max(0, b | 0) + ")";
  }

  function flowArrow(ctx, x1, y1, x2, y2, watts, color) {
    var w = Math.max(1, Math.min(9, Math.abs(watts) * 0.12));
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    var ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 10 * Math.cos(ang - 0.4), y2 - 10 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 10 * Math.cos(ang + 0.4), y2 - 10 * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  function drawScene() {
    var v = viewState();
    var ctx = sctx;
    ctx.clearRect(0, 0, sceneCv.width, sceneCv.height);
    ctx.font = "12px sans-serif";

    // 散热器（鳍片）
    for (var i = 0; i < 9; i++) {
      ctx.fillStyle = tempColor(v.tSink);
      ctx.fillRect(SINK_X + i * 14, 60, 9, 300);
    }
    ctx.fillStyle = "#9fb4cc";
    ctx.fillText("散热器 " + v.tSink.toFixed(1) + "°C", SINK_X + 10, 50);

    // 风扇（叶片角度由步数决定 → 视觉同样确定）
    var fx = SINK_X + 65, fy = 395, fr = 26;
    ctx.strokeStyle = "#567";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.stroke();
    var bladeA = (state.step * 0.02 * (0.2 + v.fan)) % (Math.PI * 2);
    ctx.strokeStyle = "#7fd0ff";
    for (i = 0; i < 3; i++) {
      var a = bladeA + i * Math.PI * 2 / 3;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(a) * (fr - 4), fy + Math.sin(a) * (fr - 4));
      ctx.stroke();
    }
    ctx.fillStyle = "#9fb4cc";
    ctx.fillText("风扇 " + Math.round(v.fan * 100) + "%", fx - 26, fy + fr + 14);

    // 热管 + 热流箭头（宽度 ∝ 热流）
    for (i = 0; i < 3; i++) {
      var y1 = SRC_Y[i] + SRC_H / 2;
      var y2 = 92 + i * 108;
      ctx.strokeStyle = "#b87333";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(SRC_X + SRC_W, y1);
      ctx.bezierCurveTo(SRC_X + SRC_W + 120, y1, SINK_X - 120, y2, SINK_X, y2);
      ctx.stroke();
      var q = v.flows.pad[i];
      if (q > 0.5) {
        var mx = (SRC_X + SRC_W + SINK_X) / 2;
        flowArrow(ctx, mx - 40, (y1 + y2) / 2, mx + 40, (y1 + y2) / 2, q, "#ffb347");
      }
      ctx.fillStyle = "#c9a06a";
      ctx.fillText("热管" + (i + 1) + " " + v.pressures[i].toFixed(3) + "MPa",
        SRC_X + SRC_W + 130, (y1 + y2) / 2 - 8);
    }

    // 相邻热流（过载传热）
    for (i = 0; i < 2; i++) {
      var qa = v.flows.adj[i];
      if (Math.abs(qa) > 0.5) {
        var ax = SRC_X + SRC_W / 2;
        var ay1 = SRC_Y[i] + SRC_H, ay2 = SRC_Y[i + 1];
        if (qa > 0) flowArrow(ctx, ax, ay1 + 4, ax, ay2 - 4, qa, "#ff8c69");
        else flowArrow(ctx, ax, ay2 - 4, ax, ay1 + 4, -qa, "#ff8c69");
      }
    }

    // 风冷排热箭头
    if (v.flows.fan > 0.5) {
      flowArrow(ctx, SINK_X + SINK_W + 16, 330, SINK_X + SINK_W + 16, 250,
        v.flows.fan, "#6fc3ff");
      ctx.fillStyle = "#6fc3ff";
      ctx.fillText("排热 " + v.flows.fan.toFixed(0) + "W", SINK_X + SINK_W - 20, 245);
    }

    // 热源块（温度色带 + 负载条）
    for (i = 0; i < 3; i++) {
      ctx.fillStyle = tempColor(v.temp[i]);
      ctx.fillRect(SRC_X, SRC_Y[i], SRC_W, SRC_H);
      ctx.strokeStyle = "#0b0f14";
      ctx.lineWidth = 2;
      ctx.strokeRect(SRC_X, SRC_Y[i], SRC_W, SRC_H);
      ctx.fillStyle = "#0b0f14";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("热源" + (i + 1) + "  " + v.temp[i].toFixed(1) + "°C", SRC_X + 8, SRC_Y[i] + 22);
      ctx.font = "11px sans-serif";
      ctx.fillText("负载 " + v.loads[i].toFixed(0) + "W", SRC_X + 8, SRC_Y[i] + 40);
      // 负载占比条
      var share = v.load > 0 ? v.loads[i] / v.load : 0;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(SRC_X + 8, SRC_Y[i] + SRC_H - 14, (SRC_W - 16) * share, 6);
      ctx.font = "12px sans-serif";
    }

    // 温度色带图例
    for (i = 0; i <= 70; i++) {
      ctx.fillStyle = tempColor(25 + i);
      ctx.fillRect(90 + i * 3, 385, 3, 10);
    }
    ctx.fillStyle = "#9fb4cc";
    ctx.fillText("25°C", 88, 410);
    ctx.fillText("95°C 上限", 270, 410);

    // 故障触发点标记 ⚠
    if (state.failed) {
      var f = state.failed, px, py;
      var m = f.component.match(/(\d)/);
      if (f.component.indexOf("热源") === 0 && m) {
        px = SRC_X + SRC_W / 2; py = SRC_Y[+m[1] - 1] + SRC_H / 2;
      } else if (f.component.indexOf("热管") === 0 && m) {
        px = (SRC_X + SRC_W + SINK_X) / 2; py = 92 + (+m[1] - 1) * 108;
      } else if (f.component === "散热器") {
        px = SINK_X + 65; py = 210;
      } else {
        px = fx; py = fy;
      }
      ctx.font = "bold 26px sans-serif";
      ctx.fillStyle = "#ff4d4d";
      ctx.fillText("⚠", px - 13, py + 9);
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("首次越限 t=" + f.time.toFixed(1) + "s", px + 18, py + 5);
      ctx.font = "12px sans-serif";
    }

    // 时间 / 模式水印
    ctx.fillStyle = "#5c7086";
    ctx.fillText((replayMode ? "回放 " : "") + "t = " + v.t.toFixed(1) + " s / 600 s", 620, 20);
  }

  // ---- 趋势图表：温度 / 压力 / 电量，含边界线与触发点 ----
  var COLORS = ["#ff9f6e", "#7fd0ff", "#a5e08a", "#c9a0ff"];

  function drawChart() {
    var ctx = cctx, W = chartCv.width, H = chartCv.height;
    ctx.clearRect(0, 0, W, H);
    var h = state.hist, n = h.t.length;
    var L = S.LIMITS, dur = S.PHYS.duration;
    var padL = 46, padR = 10;
    var plotW = W - padL - padR;

    // 上：温度 (0..110°C)，下：压力(0..0.4MPa)+电量(0..12kJ)
    var panels = [
      { y0: 8, y1: 118, min: 0, max: 110, unit: "°C",
        series: [
          { data: h.temp[0], c: COLORS[0], name: "热源1" },
          { data: h.temp[1], c: COLORS[1], name: "热源2" },
          { data: h.temp[2], c: COLORS[2], name: "热源3" },
          { data: h.tSink, c: COLORS[3], name: "散热器" }
        ],
        limits: [{ v: L.T_SOURCE_MAX, label: "热源上限" }, { v: L.T_SINK_MAX, label: "散热器上限" }] },
      { y0: 128, y1: 212, min: 0, max: 0.4, unit: "MPa",
        series: [{ data: h.pressure, c: "#ffd166", name: "热管压力" }],
        limits: [{ v: L.P_PIPE_MAX, label: "压力上限" }] }
    ];

    panels.forEach(function (pn) {
      var ph = pn.y1 - pn.y0;
      function X(i) { return padL + (h.t[i] / dur) * plotW; }
      function Y(val) { return pn.y1 - ((val - pn.min) / (pn.max - pn.min)) * ph; }
      // 边框与网格
      ctx.strokeStyle = "#22303f";
      ctx.lineWidth = 1;
      ctx.strokeRect(padL, pn.y0, plotW, ph);
      ctx.fillStyle = "#5c7086";
      ctx.font = "10px sans-serif";
      for (var g = 0; g <= 2; g++) {
        var gv = pn.min + (pn.max - pn.min) * g / 2;
        ctx.fillText(gv.toFixed(pn.max < 1 ? 2 : 0), 6, Y(gv) + 3);
      }
      ctx.fillText(pn.unit, 6, pn.y0 + 9);
      // 边界线
      pn.limits.forEach(function (lm) {
        ctx.strokeStyle = "#ff4d4d";
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, Y(lm.v));
        ctx.lineTo(padL + plotW, Y(lm.v));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ff7b72";
        ctx.fillText(lm.label, padL + plotW - 66, Y(lm.v) - 3);
      });
      // 数据曲线
      pn.series.forEach(function (se) {
        if (n === 0) return;
        ctx.strokeStyle = se.c;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (var i = 0; i < n; i++) {
          var x = X(i), y = Y(se.data[i]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = se.c;
        ctx.fillText(se.name, padL + 6 + pn.series.indexOf(se) * 52, pn.y0 + 11);
      });
      // 触发点标记（首次越限）
      if (state.failed && n > 0) {
        var fi = Math.min(n - 1, Math.round(state.failed.time / S.PHYS.dt) - 1);
        if (fi >= 0) {
          ctx.strokeStyle = "#ff4d4d";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(X(fi), pn.y0);
          ctx.lineTo(X(fi), pn.y1);
          ctx.stroke();
          ctx.fillStyle = "#ff4d4d";
          ctx.font = "bold 12px sans-serif";
          ctx.fillText("✕触发", X(fi) + 3, pn.y0 + 12);
          ctx.font = "10px sans-serif";
        }
      }
      // 回放游标
      if (replayMode && n > 0) {
        var ci = +replayCursor.value;
        ctx.strokeStyle = "#e8f2ff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(ci), pn.y0);
        ctx.lineTo(X(ci), pn.y1);
        ctx.stroke();
      }
    });

    // 电量条（底部内嵌）
    if (n > 0) {
      var eFrac = Math.min(1, viewState().energy / L.ENERGY_MAX);
      ctx.fillStyle = "#22303f";
      ctx.fillRect(padL, H - 4, plotW, 3);
      ctx.fillStyle = eFrac >= 1 ? "#ff4d4d" : "#6fc3ff";
      ctx.fillRect(padL, H - 4, plotW * eFrac, 3);
    }
    if (replayMode && n > 0) {
      replayTime.textContent = "t = " + h.t[+replayCursor.value].toFixed(1) + " s";
    }
  }

  function render() {
    drawScene();
    drawChart();
    renderTable();
  }

  // ---- 初始化 ----
  syncOutputs();
  updateStatus();
  render();
  requestAnimationFrame(frame);
})();

/* 双端仪表 DOM：两个席位结构对称、职责文案互斥，全部数据来自同一个引擎快照。 */
(function (global) {
  "use strict";
  var MC = global.MC || (global.MC = {});
  var T = MC.Track;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildSeat(side) {
    var isP1 = side === "p1";
    var root = el("div", "seat " + side);
    var head = el("div", "seat-head");
    head.innerHTML =
      '<div class="seat-badge">' + (isP1 ? "P1" : "P2") + '</div>' +
      '<div><div class="seat-en">' + (isP1 ? "TRACTION CONTROL" : "BRAKE & ROUTE") + '</div>' +
      '<div class="seat-name">' + (isP1 ? "加速席" : "制动席") + '</div></div>' +
      '<div class="seat-link" data-link><i></i><span>LINK</span></div>';
    root.appendChild(head);

    var scope = el("div", "scope");
    scope.innerHTML = isP1
      ? "<div><b>牵引 / 加速度</b></div><span>不可制动 · 不可改道岔</span>"
      : "<div><b>制动 / 道岔</b></div><span>不可牵引 · 不可调加速度</span>";
    root.appendChild(scope);

    var body = el("div", "seat-body");
    var gauge = el("div", "gauge-wrap");
    gauge.innerHTML =
      '<canvas width="320" height="140" data-gauge></canvas>' +
      '<div class="gauge-readout"><b data-speed>0.0</b> <small>m/s</small></div>' +
      '<div class="gauge-limit">限速 --</div>';
    body.appendChild(gauge);

    if (isP1) {
      body.appendChild(metric("加速度设定", '<b data-throttle>0.00</b> m/s²',
        ["0", "2.1", "4.2 MAX"], "data-throttle-bar"));
      body.appendChild(ringRow("牵引储能 · 共享", "data-traction", "data-traction-ring"));
      body.appendChild(keyCards([
        ["W", "增大加速度", "KeyW"], ["S", "减小加速度", "KeyS"]
      ]));
      var remote1 = el("div", "remote-box");
      remote1.innerHTML = '<span>○ P2 远端回传</span><span>制动压力 <b data-remote-brake>0%</b><br>道岔选路 <b data-remote-switch>内环</b></span>';
      body.appendChild(remote1);
    } else {
      body.appendChild(metric("制动压力", '<b data-brake>0</b> %',
        ["0", "50", "100 MAX"], "data-brake-bar"));
      body.appendChild(ringRow("制动风缸 · 共享", "data-air", "data-air-ring"));
      var route = el("div");
      route.innerHTML =
        '<div class="meter-label"><span>道岔进路</span><b data-j1>J1 · --m</b></div>' +
        '<div class="key-row" style="margin-top:8px">' +
        '<div class="keycard" data-key="ArrowLeft"><kbd>←</kbd><small>内环</small></div>' +
        '<div class="keycard" data-key="ArrowRight"><kbd>→</kbd><small>外环</small></div></div>' +
        '<div class="meter-label" style="margin-top:6px"><span>要求 <b data-required>内环</b></span><span data-aligned>已对齐</span></div>';
      body.appendChild(route);
      body.appendChild(keyCards([
        ["↑", "增大制动", "ArrowUp"], ["↓", "减小制动", "ArrowDown"],
        ["←", "内环", "ArrowLeft"], ["→", "外环", "ArrowRight"]
      ]));
      var space = el("div", "keycard", "<kbd>SPACE</kbd><small>紧急制动</small>");
      space.setAttribute("data-key", "Space");
      space.style.marginTop = "10px";
      body.appendChild(space);
      var remote2 = el("div", "remote-box");
      remote2.innerHTML = '<span>○ P1 远端回传</span><span>牵引加速度 <b data-remote-throttle>0.0</b><br>牵引储能 <b data-remote-traction>100%</b></span>';
      body.appendChild(remote2);
    }
    root.appendChild(body);

    var foot = el("div", "seat-foot");
    foot.innerHTML =
      '<span data-foot-timer>T- 03:00.0</span><span data-foot-watch>链路 30.0s · LOG</span>' +
      '<span>模拟断链/恢复 <button data-link-btn>' + (isP1 ? "Q" : "L") + '</button></span>';
    root.appendChild(foot);
    document.getElementById(isP1 ? "panelP1" : "panelP2").appendChild(root);
    return root;
  }

  function metric(label, rightHtml, ticks, barAttr) {
    var box = el("div");
    box.innerHTML =
      '<div class="meter-label"><span>' + label + '</span><b style="font-weight:400">' + rightHtml + '</b></div>' +
      '<div class="meter-track"><i ' + barAttr + '></i></div>' +
      '<div class="meter-ticks">' + ticks.map(function (t) { return "<span>" + t + "</span>"; }).join("") + "</div>";
    return box;
  }
  function ringRow(label, valAttr, ringAttr) {
    var row = el("div", "ring-row");
    row.innerHTML = '<div class="ring-label">' + label + '<b ' + valAttr + '>100%</b></div>' +
      '<canvas class="ring" width="92" height="92" ' + ringAttr + '></canvas>';
    return row;
  }
  function keyCards(cards) {
    var wrap = el("div");
    wrap.innerHTML = '<div class="meter-label" style="margin-bottom:6px"><span>' +
      (cards.length > 2 ? "制动 / 道岔键区" : "加速键区") + '</span><span>可同时按住</span></div>';
    var grid = el("div", "key-row");
    if (cards.length === 5) grid.style.gridTemplateColumns = "repeat(4,1fr)";
    cards.forEach(function (c) {
      var k = el("div", "keycard", "<kbd>" + c[0] + "</kbd><small>" + c[1] + "</small>");
      k.setAttribute("data-key", c[2]);
      grid.appendChild(k);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  MC.UI = { buildSeat: buildSeat };
})(typeof window !== "undefined" ? window : globalThis);

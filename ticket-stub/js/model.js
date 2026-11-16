/* 票根数据模型：状态、布局计算、排版规则校验。
 * 布局完全由状态推导，Canvas / SVG / 批量生成共用，保证一致。 */
(function (global) {
  'use strict';

  var LIMITS = {
    width: [200, 2000],
    height: [80, 600],
    tearX: [0.5, 0.85],
    fontScale: [0.5, 2]
  };

  function defaults() {
    return {
      width: 800,
      height: 300,
      tearX: 0.68,          // 撕线位置（宽度比例）
      fontFamily: 'sans-serif',
      fontScale: 1,
      title: '星空音乐厅 · 年度音乐会',
      session: '2026-12-24 19:30 晚场',
      seat: 'A区 3排 12座',
      date: '2026-12-24',
      serial: 'NO.2026-0001'
    };
  }

  // 文本宽度测量：浏览器用 canvas，Node 用近似估算（测试用）
  var measureCtx = null;
  function measure(text, size, family) {
    if (typeof document !== 'undefined') {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = size + 'px ' + family;
      return measureCtx.measureText(text).width;
    }
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      w += (text.charCodeAt(i) > 0xff ? 1 : 0.56) * size;
    }
    return w;
  }

  function safeMargin(s) {
    return Math.max(8, Math.min(32, s.height * 0.08));
  }

  /* 由状态推导完整布局。所有文本/图形位置在此确定。 */
  function layout(s) {
    var safe = safeMargin(s);
    var tearPx = Math.round(s.width * s.tearX);
    var fs = s.fontScale;
    var mainX = safe;
    var mainW = tearPx - safe * 2;
    var stubX = tearPx + safe;
    var stubW = s.width - tearPx - safe * 2;

    var titleSize = Math.round(s.height * 0.13 * fs);
    var bodySize = Math.round(s.height * 0.085 * fs);
    var smallSize = Math.round(s.height * 0.07 * fs);
    var serialSize = Math.round(s.height * 0.075 * fs);

    var texts = [];
    // 主票区：标题 + 场次 + 座位 + 日期，垂直均匀分布
    var lineH = s.height / 5;
    texts.push({ key: 'title', text: s.title, x: mainX, y: lineH, size: titleSize, weight: 'bold', region: 'main', maxW: mainW });
    texts.push({ key: 'session', text: '场次  ' + s.session, x: mainX, y: lineH * 2.2, size: bodySize, weight: 'normal', region: 'main', maxW: mainW });
    texts.push({ key: 'seat', text: '座位  ' + s.seat, x: mainX, y: lineH * 3.1, size: bodySize, weight: 'normal', region: 'main', maxW: mainW });
    texts.push({ key: 'date', text: '日期  ' + s.date, x: mainX, y: lineH * 4.0, size: bodySize, weight: 'normal', region: 'main', maxW: mainW });

    // 副券区（撕线右侧）：验证纹样 + 编号 + 座位小字
    var patSize = Math.min(stubW, s.height * 0.52);
    var pattern = {
      x: stubX + (stubW - patSize) / 2,
      y: safe,
      w: patSize,
      h: patSize
    };
    texts.push({ key: 'serial', text: s.serial, x: stubX + stubW / 2, y: pattern.y + pattern.h + serialSize * 1.5, size: serialSize, weight: 'bold', align: 'center', region: 'stub', maxW: stubW });
    texts.push({ key: 'seatCopy', text: s.seat, x: stubX + stubW / 2, y: s.height - safe, size: smallSize, weight: 'normal', align: 'center', region: 'stub', maxW: stubW });

    return { safe: safe, tearPx: tearPx, texts: texts, pattern: pattern,
             main: { x: mainX, w: mainW }, stub: { x: stubX, w: stubW } };
  }

  /* 校验状态。返回错误数组，每条包含违反的规则与修复建议。 */
  function validate(s) {
    var errs = [];
    function range(name, v, lim, fix) {
      if (typeof v !== 'number' || isNaN(v) || v < lim[0] || v > lim[1]) {
        errs.push(name + ' 必须在 ' + lim[0] + ' ~ ' + lim[1] + ' 之间（当前：' + v + '）。' + fix);
        return false;
      }
      return true;
    }
    if (!range('票宽', s.width, LIMITS.width, '请调整票宽。')) return errs;
    if (!range('票高', s.height, LIMITS.height, '请调整票高。')) return errs;
    range('撕线位置', s.tearX, LIMITS.tearX, '撕线需在票宽 50%~85% 之间，否则副券无法容纳编号与纹样。');
    range('字号缩放', s.fontScale, LIMITS.fontScale, '请调整字号缩放。');
    if (errs.length) return errs;

    if (!s.serial || !/^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(s.serial)) {
      errs.push('编号只能包含字母、数字、点和短横线，且不能为空（当前："' + s.serial + '"）。');
    }

    var L = layout(s);
    // 规则1：文本不得超出所属区域安全边距（主票区不过撕线，副券区不出右边界）
    L.texts.forEach(function (t) {
      var w = measure(t.text, t.size, s.fontFamily);
      if (w > t.maxW) {
        errs.push('「' + t.text.slice(0, 12) + (t.text.length > 12 ? '…' : '') + '」宽 '
          + Math.round(w) + 'px，超出' + (t.region === 'main' ? '主票区' : '副券区')
          + '安全边距内可用宽度 ' + Math.round(t.maxW)
          + 'px。请缩短文本、减小字号缩放或加大票宽。');
      }
      // 规则2：文本不得垂直越界
      if (t.y - t.size < 0 || t.y > s.height) {
        errs.push('「' + t.key + '」垂直方向超出票面，请增大票高或减小字号。');
      }
    });
    // 规则3：编号与验证纹样必须完整位于副券区（撕线右侧）内
    if (L.pattern.x < L.tearPx + L.safe - 0.01 || L.pattern.x + L.pattern.w > s.width - L.safe + 0.01) {
      errs.push('验证纹样越过撕线或右安全边距，请右移撕线或加大票宽。');
    }
    // 规则4：纹样与编号垂直不重叠、不出界
    var serialText = L.texts.filter(function (t) { return t.key === 'serial'; })[0];
    if (L.pattern.y + L.pattern.h > serialText.y - serialText.size) {
      errs.push('验证纹样与编号垂直重叠，请增大票高或减小字号缩放。');
    }
    if (serialText.y > s.height - L.safe * 0.5) {
      errs.push('编号超出票面下安全边距，请增大票高。');
    }
    return errs;
  }

  var api = { LIMITS: LIMITS, defaults: defaults, layout: layout, validate: validate, measure: measure, safeMargin: safeMargin };
  global.TicketModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);

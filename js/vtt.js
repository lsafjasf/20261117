/* WebVTT 导入导出。
   逐字时间用 cue 内联时间戳表达：<mm:ss.ttt>字，cue 时间为绝对工程时间。 */
(function (root, factory) {
  var api = factory(
    (typeof module === "object" && module.exports) ? require("./util.js") : root.TC.util
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TC = root.TC || {};
  root.TC.vtt = api;
})(typeof self !== "undefined" ? self : this, function (util) {
  "use strict";

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function pad3(n) { return n < 10 ? "00" + n : n < 100 ? "0" + n : "" + n; }

  /* 秒 -> HH:MM:SS.mmm / MM:SS.mmm */
  function toTimestamp(seconds) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    var ms = Math.round((seconds - Math.floor(seconds)) * 1000);
    if (ms === 1000) { ms = 0; s += 1; }
    var base = (h > 0 ? pad2(h) + ":" : "") + pad2(m) + ":" + pad2(s) + "." + pad3(ms);
    return base;
  }

  function fromTimestamp(text) {
    var m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) throw new Error("非法时间戳: " + text);
    var h = m[1] ? parseInt(m[1], 10) : 0;
    var min = parseInt(m[2], 10);
    var sec = parseInt(m[3], 10);
    var msText = m[4];
    while (msText.length < 3) msText += "0";
    return h * 3600 + min * 60 + sec + parseInt(msText, 10) / 1000;
  }

  function exportVTT(subtitles) {
    var lines = ["WEBVTT", ""];
    subtitles.forEach(function (cue, index) {
      lines.push(cue.id || ("cue-" + (index + 1)));
      lines.push(toTimestamp(cue.start) + " --> " + toTimestamp(cue.end));
      var body = cue.chars.map(function (item) {
        return "<" + toTimestamp(item.t) + ">" + item.ch;
      }).join("");
      lines.push(body);
      lines.push("");
    });
    return lines.join("\n");
  }

  function parseInlineTimestamps(body, cueStart, cueEnd, fallbackText) {
    var re = /<((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})>/g;
    var match;
    var chars = [];
    var plain = "";
    while ((match = re.exec(body)) !== null) {
      var t = fromTimestamp(match[1]);
      var after = body.slice(re.lastIndex);
      var nextTag = after.search(/<((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})>/);
      var segment = nextTag === -1 ? after : after.slice(0, nextTag);
      segment.split("").forEach(function (ch) {
        if (ch.trim() === "") return;
        plain += ch;
        chars.push({ ch: ch, t: Number(t.toFixed(6)) });
      });
      re.lastIndex += segment.length;
    }
    if (chars.length === 0) {
      var text = fallbackText || body.replace(/<[^>]+>/g, "");
      var span = cueEnd - cueStart;
      chars = text.split("").map(function (ch, i) {
        return { ch: ch, t: Number((cueStart + span * (i / text.length)).toFixed(6)) };
      });
      plain = text;
    }
    return { text: plain, chars: chars };
  }

  function importVTT(content, idFactory) {
    if (!/^\uFEFF?WEBVTT/.test(content.trim())) {
      throw new Error("缺少 WEBVTT 文件头");
    }
    var nextId = idFactory || (function () {
      var n = 0;
      return function () { n += 1; return "cue_imp_" + n; };
    })();
    var blocks = content.replace(/\r\n/g, "\n").split(/\n\n+/);
    var cues = [];
    blocks.forEach(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.trim() !== ""; });
      if (lines.length === 0 || /^WEBVTT/.test(lines[0])) return;
      var timingIndex = lines.findIndex(function (l) { return l.indexOf("-->") !== -1; });
      if (timingIndex === -1) return;
      var timing = lines[timingIndex].split("-->").map(function (x) {
        return x.trim().split(/\s+/)[0];
      });
      var start = fromTimestamp(timing[0]);
      var end = fromTimestamp(timing[1]);
      var body = lines.slice(timingIndex + 1).join("\n");
      var parsed = parseInlineTimestamps(body, start, end, "");
      cues.push({
        id: nextId(),
        start: Number(start.toFixed(6)),
        end: Number(end.toFixed(6)),
        text: parsed.text,
        chars: parsed.chars
      });
    });
    if (cues.length === 0) throw new Error("未解析到任何字幕条目");
    return cues;
  }

  return {
    toTimestamp: toTimestamp,
    fromTimestamp: fromTimestamp,
    exportVTT: exportVTT,
    parseInlineTimestamps: parseInlineTimestamps,
    importVTT: importVTT
  };
});

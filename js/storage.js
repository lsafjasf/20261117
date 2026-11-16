/* 工程文件保存 / 载入，带版本校验与结构体检。 */
(function (root, factory) {
  var api = factory(
    (typeof module === "object" && module.exports) ? require("./util.js") : root.TC.util
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TC = root.TC || {};
  root.TC.storage = api;
})(typeof self !== "undefined" ? self : this, function (util) {
  "use strict";

  var STORAGE_KEY = "tc.timeline.project.v1";
  var CURRENT_VERSION = 1;

  function serialize(project) {
    return JSON.stringify(project, null, 2);
  }

  function parseProject(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error("工程文件不是合法 JSON: " + err.message);
    }
    var problems = inspect(data);
    if (problems.length) {
      throw new Error("工程结构损坏: " + problems.join("；"));
    }
    return data;
  }

  function inspect(data) {
    var problems = [];
    if (!data || typeof data !== "object") return ["根节点不是对象"];
    if (data.version !== CURRENT_VERSION) problems.push("版本号不匹配(" + data.version + ")");
    ["bpm", "duration", "beats", "subtitles", "clips"].forEach(function (key) {
      if (!(key in data)) problems.push("缺少字段 " + key);
    });
    if (Array.isArray(data.beats) && data.beats.some(function (b) {
      return typeof b.time !== "number" || !b.kind;
    })) problems.push("节拍数据损坏");
    if (Array.isArray(data.clips) && data.clips.some(function (c) {
      return typeof c.start !== "number" || typeof c.end !== "number";
    })) problems.push("片段数据损坏");
    if (Array.isArray(data.subtitles) && data.subtitles.some(function (c) {
      return typeof c.start !== "number" || !Array.isArray(c.chars);
    })) problems.push("字幕数据损坏");
    return problems;
  }

  function saveLocal(project) {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(STORAGE_KEY, serialize(project));
    return true;
  }

  function loadLocal() {
    if (typeof localStorage === "undefined") return null;
    var raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseProject(raw) : null;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CURRENT_VERSION: CURRENT_VERSION,
    serialize: serialize,
    parseProject: parseProject,
    inspect: inspect,
    saveLocal: saveLocal,
    loadLocal: loadLocal
  };
});

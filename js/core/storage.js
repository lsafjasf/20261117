/**
 * Persistence layer. In browsers it uses localStorage; under Node an
 * in-memory map is used so the same API can be unit tested.
 * The autosave key holds everything needed to restore an unsaved draft:
 * camera angle, layer toggles and the full parameter set.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});
  var VERSION = 1;
  var KEYS = {
    autosave: 'teacup.autosave.v' + VERSION,
    presets: 'teacup.presets.v' + VERSION
  };

  function makeBackend() {
    try {
      if (typeof global.localStorage !== 'undefined' && global.localStorage) {
        return {
          get: function (k) { return global.localStorage.getItem(k); },
          set: function (k, v) { global.localStorage.setItem(k, v); },
          remove: function (k) { global.localStorage.removeItem(k); }
        };
      }
    } catch (e) { /* private mode etc. */ }
    var mem = {};
    return {
      get: function (k) { return Object.prototype.hasOwnProperty.call(mem, k)
        ? mem[k] : null; },
      set: function (k, v) { mem[k] = String(v); },
      remove: function (k) { delete mem[k]; }
    };
  }

  var backend = makeBackend();

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); }
    catch (e) { return fallback; }
  }

  function saveAutosave(state) {
    var payload = { version: VERSION, savedAt: new Date().toISOString(),
      state: state };
    backend.set(KEYS.autosave, JSON.stringify(payload));
    return payload;
  }

  function loadAutosave() {
    var payload = safeParse(backend.get(KEYS.autosave), null);
    if (!payload || payload.version !== VERSION || !payload.state) return null;
    return payload;
  }

  function clearAutosave() { backend.remove(KEYS.autosave); }

  function listPresets() {
    return safeParse(backend.get(KEYS.presets), {});
  }

  function savePreset(name, state) {
    if (!name || !/^[\w\u4e00-\u9fa5\-]{1,20}$/.test(name)) {
      throw new Error('预设名只能包含 1-20 个字母、数字、中文、下划线或连字符');
    }
    var all = listPresets();
    all[name] = { savedAt: new Date().toISOString(), state: state };
    backend.set(KEYS.presets, JSON.stringify(all));
    return all;
  }

  function loadPreset(name) {
    var all = listPresets();
    return all[name] || null;
  }

  function deletePreset(name) {
    var all = listPresets();
    delete all[name];
    backend.set(KEYS.presets, JSON.stringify(all));
    return all;
  }

  NS.storage = {
    KEYS: KEYS,
    saveAutosave: saveAutosave,
    loadAutosave: loadAutosave,
    clearAutosave: clearAutosave,
    listPresets: listPresets,
    savePreset: savePreset,
    loadPreset: loadPreset,
    deletePreset: deletePreset
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

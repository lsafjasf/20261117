/**
 * Parameter schema, defaults, extreme presets and strict validation.
 * Validation failures carry a human-readable Chinese reason so the UI can
 * keep the last valid frame on screen instead of going blank.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});

  var LIMITS = {
    rimRadius:    { min: 0.5, max: 2.2, label: '杯口半径' },
    waistRadius:  { min: 0.35, max: 2.0, label: '腰身半径' },
    baseRadius:   { min: 0.3, max: 1.8, label: '底足半径' },
    height:       { min: 0.8, max: 3.2, label: '杯身高度' },
    handleReach:  { min: 0.35, max: 1.6, label: '把手外伸' },
    handleThick:  { min: 0.06, max: 0.45, label: '把手粗细' },
    segments:     { min: 5, max: 24, integer: true, label: '环向分段' },
    profileSteps: { min: 3, max: 16, integer: true, label: '轮廓细分' },
    handleSides:  { min: 4, max: 12, integer: true, label: '把手截面边数' }
  };

  var DEFAULT_PARAMS = {
    rimRadius: 1.15,
    waistRadius: 0.78,
    baseRadius: 0.62,
    height: 1.9,
    handleReach: 0.85,
    handleThick: 0.16,
    segments: 12,
    profileSteps: 6,
    handleSides: 6
  };

  var EXTREME_PARAMS = {
    rimRadius: 2.2,
    waistRadius: 0.35,
    baseRadius: 1.8,
    height: 3.2,
    handleReach: 1.6,
    handleThick: 0.45,
    segments: 5,
    profileSteps: 16,
    handleSides: 4
  };

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /**
   * @returns {{valid: boolean, errors: Array<{field:string,message:string}>,
   *           sanitized: Object}}
   */
  function validate(input) {
    var errors = [];
    var sanitized = {};
    var source = input && typeof input === 'object' ? input : {};

    Object.keys(LIMITS).forEach(function (key) {
      var spec = LIMITS[key];
      var raw = source[key];
      if (raw === undefined || raw === null || raw === '') {
        errors.push({ field: key, message: spec.label + '缺少数值' });
        sanitized[key] = DEFAULT_PARAMS[key];
        return;
      }
      var num = Number(raw);
      if (!isFiniteNumber(num)) {
        errors.push({ field: key, message: spec.label + '必须是数字，收到「' + raw + '」' });
        sanitized[key] = DEFAULT_PARAMS[key];
        return;
      }
      if (spec.integer && Math.round(num) !== num) {
        errors.push({ field: key, message: spec.label + '必须是整数，收到「' + num + '」' });
        sanitized[key] = DEFAULT_PARAMS[key];
        return;
      }
      if (num < spec.min || num > spec.max) {
        errors.push({
          field: key,
          message: spec.label + '超出允许范围 [' + spec.min + ', ' + spec.max + ']，当前 ' + num
        });
        sanitized[key] = DEFAULT_PARAMS[key];
        return;
      }
      sanitized[key] = spec.integer ? num : num;
    });

    if (!errors.length) {
      if (sanitized.baseRadius >= sanitized.rimRadius) {
        errors.push({
          field: 'baseRadius',
          message: '底足半径(' + sanitized.baseRadius + ')必须小于杯口半径(' + sanitized.rimRadius + ')'
        });
      }
      if (sanitized.handleThick * 2 >= sanitized.handleReach) {
        errors.push({
          field: 'handleReach',
          message: '把手外伸(' + sanitized.handleReach + ')必须大于两倍把手粗细(' +
            (sanitized.handleThick * 2) + ')，否则把手会自交'
        });
      }
    }

    return { valid: errors.length === 0, errors: errors, sanitized: sanitized };
  }

  function clone(params) {
    var out = {};
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k)) out[k] = params[k];
    }
    return out;
  }

  NS.params = {
    LIMITS: LIMITS,
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    EXTREME_PARAMS: EXTREME_PARAMS,
    validate: validate,
    clone: clone
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function (global) {
  "use strict";

  const Canyon = global.Canyon = global.Canyon || {};

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRandom(seedText) {
    const seed = hashString(String(seedText));
    const random = mulberry32(seed);
    return {
      seed,
      random,
      range(min, max) {
        return min + (max - min) * random();
      },
      integer(min, max) {
        return Math.floor(min + (max - min + 1) * random());
      },
      pick(items) {
        return items[Math.floor(random() * items.length)];
      },
      shuffle(items) {
        const copy = items.slice();
        for (let i = copy.length - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function smoothstep(amount) {
    const value = clamp(amount, 0, 1);
    return value * value * (3 - 2 * value);
  }

  function hex(value, length) {
    return (value >>> 0).toString(16).toUpperCase().padStart(length || 8, "0");
  }

  function mod(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  Canyon.seed = {
    hashString,
    mulberry32,
    createRandom,
    clamp,
    lerp,
    smoothstep,
    hex,
    mod,
    deepClone
  };
})(window);

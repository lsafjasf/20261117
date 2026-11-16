// 确定性 PRNG (mulberry32) —— 同 seed 必得同序列
export function createRng(seed) {
  let a = seed >>> 0;
  const rng = {
    next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) { return min + rng.next() * (max - min); },
    int(min, max) { return Math.floor(rng.range(min, max + 1)); },
    pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
    getState() { return a >>> 0; },
    setState(s) { a = s >>> 0; },
  };
  return rng;
}

// 简单字符串哈希,用于把 seed 字符串转成数字
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

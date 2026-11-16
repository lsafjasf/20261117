// Procedural single-stroke vector font. No external font file is ever loaded.
// Design grid: x in 0..4 (nominal advance 5), y 0..7 (cap height),
// descender row 8. Each glyph is a list of polylines; a one-point polyline
// denotes a dot, rendered as a filled circle whose radius follows weight.

const U = {
  A: ['07 10 27', '04 24'],
  B: ['07 00', '00 20 23 03', '03 23 27 07'],
  C: ['20 00 07 27'],
  D: ['07 00', '00 20 27 07'],
  E: ['07 00', '00 20', '03 23', '07 27'],
  F: ['07 00', '00 20', '03 23'],
  G: ['20 00 07 27', '27 24 14'],
  H: ['00 07', '20 27', '03 23'],
  I: ['00 20', '10 17', '07 27'],
  J: ['20 27 07 05'],
  K: ['00 07', '03 20', '03 27'],
  L: ['00 07 27'],
  M: ['07 00 13 20 27'],
  N: ['07 00 27 20'],
  O: ['00 20 27 07 00'],
  P: ['07 00', '00 20 23 03'],
  Q: ['00 20 27 07 00', '15 28'],
  R: ['07 00', '00 20 23 03', '03 27'],
  S: ['20 00 03 23 27 07'],
  T: ['00 20', '10 17'],
  U: ['00 07 27 20'],
  V: ['00 17 20'],
  W: ['00 07 13 27 20'],
  X: ['00 27', '20 07'],
  Y: ['00 13 20', '13 17'],
  Z: ['00 20 07 27']
};

const D = {
  '0': ['00 20 27 07 00'],
  '1': ['10 02', '10 17', '07 27'],
  '2': ['00 20 23 07 27'],
  '3': ['00 20 23 13', '13 23 27 07'],
  '4': ['20 27', '04 24', '04 20'],
  '5': ['20 00 03 23 27 07'],
  '6': ['20 00 07 27 23 03'],
  '7': ['00 20 07'],
  '8': ['00 20 23 03 00', '03 23 27 07 03'],
  '9': ['07 27 20 00 04 24']
};

const P = {
  ' ': [],
  '!': ['10 15', '17'],
  '"': ['00 02', '20 22'],
  '#': ['10 17', '20 27', '02 32', '05 35'],
  $: ['10 17', '21 01 03 23 25 05'],
  '%': ['20 07', '01', '26'],
  '&': ['20 01 14 23 26 07'],
  "'": ['10 12'],
  '(': ['20 02 05 27'],
  ')': ['00 22 25 07'],
  '*': ['11 14', '02 23', '22 03'],
  '+': ['11 15', '03 23'],
  ',': ['16 18'],
  '-': ['03 23'],
  '.': ['17'],
  '/': ['20 07'],
  ':': ['12', '15'],
  ';': ['10 13', '16'],
  '<': ['21 03 25'],
  '=': ['02 22', '04 24'],
  '>': ['01 23 05'],
  '?': ['00 20 22 13 14', '16'],
  '@': ['13 23 25 05 02 22 20 00 05'],
  '[': ['20 00 07 27'],
  '\\': ['00 27'],
  ']': ['00 20 27 07'],
  '^': ['02 10 22'],
  _: ['08 28'],
  '`': ['00 12'],
  '{': ['20 11 13 03', '03 13 15 27'],
  '|': ['10 17'],
  '}': ['00 11 13 23', '23 13 15 07'],
  '~': ['02 11 22 13 04']
};

function parseStrokes(lines) {
  return lines.map((line) =>
    line.split(' ').filter(Boolean).map((pair) => ({
      x: Number(pair[0]),
      y: Number(pair[1])
    }))
  );
}

const GLYPH_DATA = {};
for (const [ch, lines] of Object.entries(U)) {
  GLYPH_DATA[ch] = parseStrokes(lines);
  GLYPH_DATA[ch.toLowerCase()] = GLYPH_DATA[ch];
}
for (const [ch, lines] of Object.entries(D)) GLYPH_DATA[ch] = parseStrokes(lines);
for (const [ch, lines] of Object.entries(P)) GLYPH_DATA[ch] = parseStrokes(lines);

export const GRID = { advance: 5, capHeight: 7, descender: 8 };

export function hasGlyph(ch) {
  return Object.prototype.hasOwnProperty.call(GLYPH_DATA, ch);
}

export function getGlyph(ch) {
  return GLYPH_DATA[ch] || null;
}

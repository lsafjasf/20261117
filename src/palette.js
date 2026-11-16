export const COLOR_ROLES = ["background", "primary", "secondary", "accent"];
export const COLOR_LABELS = {
  background: "底色",
  primary: "主色",
  secondary: "辅色",
  accent: "点缀"
};

export const PALETTE_RULES = {
  analogous: {
    label: "邻近色",
    shifts: [34, -31]
  },
  complementary: {
    label: "互补色",
    shifts: [174, 205]
  },
  monochrome: {
    label: "同色明度",
    shifts: [0, 0]
  }
};

const SCHEME_META = [
  { id: "mist", name: "晨雾", mode: "light" },
  { id: "night", name: "夜航", mode: "dark" },
  { id: "clay", name: "陶土", mode: "muted" }
];

export function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeHex(value, fallback = "#000000") {
  if (isHexColor(value)) return value.toUpperCase();
  if (typeof value !== "string") return fallback;
  const short = value.trim().match(/^#?([0-9a-f]{3})$/i);
  if (short) {
    return `#${short[1].split("").map((part) => part + part).join("")}`.toUpperCase();
  }
  return fallback;
}

export function hexToHsl(hex) {
  const safe = normalizeHex(hex);
  const red = parseInt(safe.slice(1, 3), 16) / 255;
  const green = parseInt(safe.slice(3, 5), 16) / 255;
  const blue = parseInt(safe.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: hue, s: saturation * 100, l: lightness * 100 };
}

export function hslToHex({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const lightness = Math.min(100, Math.max(0, l)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  let rgb;
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return `#${rgb
    .map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function schemeTone(mode) {
  if (mode === "dark") {
    return { background: [13, 26], secondary: [72, 42], accent: [64, 70] };
  }
  if (mode === "muted") {
    return { background: [82, 34], secondary: [30, 34], accent: [51, 62] };
  }
  return { background: [93, 35], secondary: [29, 38], accent: [57, 68] };
}

export function deriveSchemes(primary, ruleName = "analogous") {
  const base = hexToHsl(normalizeHex(primary, "#C95135"));
  const rule = PALETTE_RULES[ruleName] || PALETTE_RULES.analogous;
  return SCHEME_META.map((meta, index) => {
    const tone = schemeTone(meta.mode);
    const isMono = ruleName === "monochrome";
    const hue = base.h;
    const secondaryHue = hue + rule.shifts[0];
    const accentHue = hue + rule.shifts[1];
    const backgroundSaturation = isMono ? base.s * 0.28 : tone.background[1];
    const secondarySaturation = isMono
      ? Math.min(72, base.s * 0.8)
      : tone.secondary[1] + index * 3;
    const accentSaturation = isMono
      ? Math.min(78, base.s * 0.92)
      : tone.accent[1];
    return {
      ...meta,
      colors: {
        background: hslToHex({
          h: hue + (isMono ? 0 : 6),
          s: backgroundSaturation,
          l: tone.background[0]
        }),
        primary: normalizeHex(primary),
        secondary: hslToHex({
          h: secondaryHue,
          s: secondarySaturation,
          l: tone.secondary[0]
        }),
        accent: hslToHex({
          h: accentHue,
          s: accentSaturation,
          l: tone.accent[0]
        })
      }
    };
  });
}

export function createDefaultSchemes() {
  return [
    {
      id: "mist",
      name: "晨雾",
      mode: "light",
      colors: {
        background: "#F3E8D6",
        primary: "#C95135",
        secondary: "#214F56",
        accent: "#D69A36"
      }
    },
    {
      id: "night",
      name: "夜航",
      mode: "dark",
      colors: {
        background: "#142D35",
        primary: "#C95135",
        secondary: "#A8D8CC",
        accent: "#E5B95C"
      }
    },
    {
      id: "clay",
      name: "陶土",
      mode: "muted",
      colors: {
        background: "#E1C3AB",
        primary: "#C95135",
        secondary: "#563D2D",
        accent: "#8B5E3C"
      }
    }
  ];
}

export function applyPaletteRule(project) {
  const source = project.palette.schemes[project.palette.active] || project.palette.schemes[0];
  const lockedPrimary = normalizeHex(source.colors.primary);
  project.palette.schemes = project.palette.schemes.map((scheme) => {
    const primary = project.palette.locked ? lockedPrimary : normalizeHex(scheme.colors.primary);
    const generated = deriveSchemes(primary, project.palette.rule);
    const match = generated.find((item) => item.id === scheme.id) || generated[0];
    return {
      ...scheme,
      colors: match.colors
    };
  });
  if (project.palette.locked) {
    project.palette.schemes.forEach((scheme) => {
      scheme.colors.primary = lockedPrimary;
    });
  }
  return project;
}

export function setPrimaryColor(project, schemeIndex, color) {
  const safe = normalizeHex(color);
  const scheme = project.palette.schemes[schemeIndex];
  if (!scheme) return;
  scheme.colors.primary = safe;
  if (project.palette.locked) {
    project.palette.schemes.forEach((item) => {
      item.colors.primary = safe;
    });
  }
}

export function setPaletteLock(project, locked) {
  project.palette.locked = Boolean(locked);
  if (project.palette.locked) {
    const source = project.palette.schemes[project.palette.active] || project.palette.schemes[0];
    const primary = normalizeHex(source.colors.primary);
    project.palette.schemes.forEach((scheme) => {
      scheme.colors.primary = primary;
    });
  }
}

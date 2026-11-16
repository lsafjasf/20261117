import type {
  Contact,
  ContactKind,
  EchoEvent,
  Point,
  SignalProfile,
  SonarParams,
} from "./types";

export const DEFAULT_PARAMS: SonarParams = {
  master: 0.72,
  panWidth: 0.82,
  echoGain: 0.68,
  tempo: 80,
};

export const PROFILES: Record<ContactKind, SignalProfile> = {
  shallow: {
    label: "浅水暗滩",
    shortLabel: "浅滩",
    freq: 270,
    frequencyLabel: "LOW · 270 Hz",
    gain: 0.52,
    taps: [0, 0.055],
    decay: 0.58,
    color: "#7db9e8",
    wave: "triangle",
    clue: "低频长尾 / 宽而柔",
  },
  rock: {
    label: "垂直岩壁",
    shortLabel: "岩壁",
    freq: 1420,
    frequencyLabel: "HIGH · 1.4 kHz",
    gain: 0.9,
    taps: [0, 0.085, 0.145],
    decay: 0.24,
    color: "#f5b45b",
    wave: "square",
    clue: "高频短促 / 强反射",
  },
  debris: {
    label: "漂浮物群",
    shortLabel: "漂浮物",
    freq: 670,
    frequencyLabel: "MID · 670 Hz",
    gain: 0.27,
    taps: [0, 0.038, 0.112, 0.193],
    decay: 0.46,
    color: "#c58ad8",
    wave: "sawtooth",
    clue: "中频破碎 / 弱散射",
  },
  exit: {
    label: "安全出口",
    shortLabel: "出口",
    freq: 455,
    frequencyLabel: "GUIDE · 455 Hz",
    gain: 0.4,
    taps: [0, 0.245],
    decay: 0.32,
    color: "#8adf9e",
    wave: "sine",
    clue: "双脉冲 / 稳定航标",
  },
};

export const SOURCE: Point = { x: 0.135, y: 0.54 };

const RAW_CONTACTS: Array<{ id: string; kind: ContactKind; position: Point }> = [
  { id: "E-01", kind: "shallow", position: { x: 0.365, y: 0.235 } },
  { id: "E-02", kind: "rock", position: { x: 0.635, y: 0.705 } },
  { id: "E-03", kind: "debris", position: { x: 0.43, y: 0.79 } },
  { id: "X-07", kind: "exit", position: { x: 0.905, y: 0.36 } },
];

export function createContacts(): Contact[] {
  return RAW_CONTACTS.map((raw) => {
    const dx = raw.position.x - SOURCE.x;
    const dy = raw.position.y - SOURCE.y;
    const distance = Math.hypot(dx * 1.55, dy);
    const pan = Math.max(-1, Math.min(1, (dy / 0.5) * 0.92));
    const delay = 0.17 + distance * 0.76;
    return {
      ...raw,
      distance,
      pan,
      delay,
      intensity: PROFILES[raw.kind].gain,
      profile: PROFILES[raw.kind],
    };
  });
}

export function makeEchoes(contacts: Contact[], baseBeat: number, params: SonarParams): EchoEvent[] {
  const secondsPerBeat = 60 / params.tempo;
  return contacts.flatMap((contact) =>
    contact.profile.taps.map((tap) => ({
      contactId: contact.id,
      beat: baseBeat + (contact.delay + tap * contact.profile.decay * 1.8) / secondsPerBeat,
      time: contact.delay + tap * contact.profile.decay * 1.8,
      kind: contact.kind,
      pan: contact.pan,
      delay: contact.delay + tap * contact.profile.decay * 1.8,
      intensity: contact.intensity,
      frequency: contact.profile.freq,
    })),
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

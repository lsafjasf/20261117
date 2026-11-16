export type ContactKind = "shallow" | "rock" | "debris" | "exit";

export type MonitorMode = "main" | "bypass" | "mute";

export interface Point {
  x: number;
  y: number;
}

export interface SonarParams {
  master: number;
  panWidth: number;
  echoGain: number;
  tempo: number;
}

export interface SignalProfile {
  label: string;
  shortLabel: string;
  freq: number;
  frequencyLabel: string;
  gain: number;
  taps: number[];
  decay: number;
  color: string;
  wave: OscillatorType;
  clue: string;
}

export interface Contact {
  id: string;
  kind: ContactKind;
  position: Point;
  distance: number;
  pan: number;
  delay: number;
  intensity: number;
  profile: SignalProfile;
  mark?: ContactKind;
}

export interface EchoEvent {
  contactId: string;
  beat: number;
  time: number;
  kind: ContactKind;
  pan: number;
  delay: number;
  intensity: number;
  frequency: number;
}

export interface ScanRecord {
  id: number;
  beat: number;
  time: number;
  echoes: EchoEvent[];
}

export interface PeakInfo {
  time: number;
  value: number;
  channel: "L" | "R";
}

export interface WavAnalysis {
  duration: number;
  sampleRate: number;
  channels: number;
  peakLeft: number;
  peakRight: number;
  peakTimeLeft: number;
  peakTimeRight: number;
  rmsLeft: number;
  rmsRight: number;
  peakCount: number;
  firstPeak: number;
  lastPeak: number;
  tailRms: number;
}

export interface RenderResult {
  buffer: AudioBuffer;
  wav: Uint8Array;
  analysis: WavAnalysis;
  events: EchoEvent[];
  duration: number;
}

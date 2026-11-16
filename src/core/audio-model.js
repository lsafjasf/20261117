// Platform-independent audio description. The browser renders these events
// with Web Audio (AudioContext/OscillatorNode); the Node exporter renders the
// same events into PCM. Both consume this exact model, so sound stays aligned
// to the shared millisecond clock.

export const NOTE_FREQUENCIES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];

export function noteFrequency(note) {
  return NOTE_FREQUENCIES[((note % NOTE_FREQUENCIES.length)
    + NOTE_FREQUENCIES.length) % NOTE_FREQUENCIES.length];
}

// Render one trigger as additive sine partials with an exponential-style decay.
export function renderPulse(buffer, sampleRate, pulse) {
  const startSample = Math.floor((pulse.t / 1000) * sampleRate);
  const sampleCount = Math.floor((pulse.durationMs / 1000) * sampleRate);
  const frequency = noteFrequency(pulse.note);
  for (let index = 0; index < sampleCount; index += 1) {
    const sampleIndex = startSample + index;
    if (sampleIndex < 0 || sampleIndex >= buffer.length) continue;
    const progress = index / sampleCount;
    const envelope = Math.sin(Math.PI * progress) * (1 - progress * 0.3);
    const seconds = index / sampleRate;
    const tone =
      Math.sin(2 * Math.PI * frequency * seconds) * 0.6 +
      Math.sin(2 * Math.PI * frequency * 2 * seconds) * 0.25 +
      Math.sin(2 * Math.PI * frequency * 3 * seconds) * 0.12;
    buffer[sampleIndex] += tone * envelope * 0.32;
  }
}

export function renderAudioTrack(pulses, durationMs, sampleRate) {
  const totalSamples = Math.ceil((durationMs / 1000) * sampleRate);
  const buffer = new Float32Array(totalSamples);
  for (const pulse of pulses) {
    renderPulse(buffer, sampleRate, { ...pulse,
      t: pulse.t });
  }
  // Soft safety limiter keeps summed overlays inside [-1, 1].
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Math.tanh(buffer[index]);
  }
  return buffer;
}

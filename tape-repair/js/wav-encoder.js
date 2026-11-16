/* Encode interleaved 16-bit PCM stereo WAV. Usable from browser and Node. */
(function (root) {
  function encodeWav(channels, sampleRate) {
    const ch = channels.length;
    if (ch !== 1 && ch !== 2) {
      throw new Error('encodeWav expects 1 or 2 channels');
    }
    const frames = channels[0].length;
    const bytesPerSample = 2;
    const dataSize = frames * ch * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let p = 0;
    const writeStr = (s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
    };
    const writeU32 = (v) => { view.setUint32(p, v, true); p += 4; };
    const writeU16 = (v) => { view.setUint16(p, v, true); p += 2; };

    writeStr('RIFF');
    writeU32(36 + dataSize);
    writeStr('WAVEfmt ');
    writeU32(16);
    writeU16(1);
    writeU16(ch);
    writeU32(sampleRate);
    writeU32(sampleRate * ch * bytesPerSample);
    writeU16(ch * bytesPerSample);
    writeU16(16);
    writeStr('data');
    writeU32(dataSize);

    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < ch; c++) {
        let s = channels[c][i];
        s = Math.max(-1, Math.min(1, s));
        view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        p += 2;
      }
    }
    return buffer;
  }

  function decodeWav(buffer) {
    const view = new DataView(buffer);
    if (view.getUint32(0, false) !== 0x52494646) {
      throw new Error('not a RIFF/WAV file');
    }
    let p = 12;
    let audioFormat = 1;
    let channels = 2;
    let sampleRate = 48000;
    let dataOffset = 44;
    let dataSize = 0;
    while (p + 8 <= view.byteLength) {
      const id = String.fromCharCode(
        view.getUint8(p), view.getUint8(p + 1),
        view.getUint8(p + 2), view.getUint8(p + 3));
      const size = view.getUint32(p + 4, true);
      if (id === 'fmt ') {
        audioFormat = view.getUint16(p + 8, true);
        channels = view.getUint16(p + 10, true);
        sampleRate = view.getUint32(p + 12, true);
      } else if (id === 'data') {
        dataOffset = p + 8;
        dataSize = size;
        break;
      }
      p += 8 + size + (size & 1);
    }
    if (audioFormat !== 1) throw new Error('only PCM supported, got ' + audioFormat);
    const frames = Math.floor(dataSize / (2 * channels));
    const out = [];
    for (let c = 0; c < channels; c++) out.push(new Float32Array(frames));
    let q = dataOffset;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        out[c][i] = view.getInt16(q, true) / 0x8000;
        q += 2;
      }
    }
    return { channels: out, sampleRate };
  }

  const api = { encodeWav, decodeWav };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.WavCodec = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);

/* Canvas renderers: waveform, spectrum compare, node chain. */
(function (root) {
  function withClear(canvas, draw) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h);
  }

  function drawWaveform(canvas, analyser, mode, meters) {
    withClear(canvas, (ctx, w, h) => {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      ctx.fillStyle = '#10141c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const step = Math.max(1, Math.floor(data.length / w));
      ctx.lineWidth = 1.5;
      const colors = { main: '#5ad1a3', bypass: '#e0b341', mute: '#7a8394' };
      ctx.strokeStyle = colors[mode] || colors.main;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const v = data[x * step] || 0;
        const y = h / 2 + v * (h / 2) * 0.92;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (meters) {
        ctx.fillStyle = '#c9d4e3';
        ctx.font = '11px monospace';
        ctx.fillText('L peak ' + meters.peakL.toFixed(3) +
          '  R peak ' + meters.peakR.toFixed(3), 8, 14);
      }
    });
  }

  function drawSpectrum(canvas, preAnalyser, postAnalyser, mode) {
    withClear(canvas, (ctx, w, h) => {
      ctx.fillStyle = '#10141c';
      ctx.fillRect(0, 0, w, h);
      const bins = preAnalyser.frequencyBinCount;
      const pre = new Float32Array(bins);
      const post = new Float32Array(bins);
      preAnalyser.getFloatFrequencyData(pre);
      postAnalyser.getFloatFrequencyData(post);
      const nyquist = preAnalyser.context.sampleRate / 2;
      const plot = (data, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const f = Math.pow(2, (x / w) * Math.log2(nyquist));
          const k = Math.min(bins - 1, Math.floor(f / (nyquist / bins)));
          const db = data[k];
          const y = h - ((db + 100) / 100) * h;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      plot(pre, 'rgba(224,90,90,0.85)', 1.2);
      if (mode !== 'mute') plot(post, 'rgba(90,209,163,0.95)', 1.4);
      ctx.fillStyle = '#c9d4e3';
      ctx.font = '11px monospace';
      ctx.fillText('红: 修复前频谱    绿: 修复后频谱', 8, 14);
    });
  }

  const CHAIN = [
    ['source', '磁带合成源'],
    ['preGain', '输入'],
    ['deess', '去齿音'],
    ['notch', '陷波'],
    ['gate', '噪声门'],
    ['mainOut', '主输出'],
    ['bypassOut', '旁路'],
    ['muteOut', '静音'],
    ['master', '主增益'],
    ['postAnalyser', '分析/导出'],
  ];

  function drawNodeChain(canvas, activeNames, mode, playing) {
    withClear(canvas, (ctx, w, h) => {
      ctx.fillStyle = '#10141c';
      ctx.fillRect(0, 0, w, h);
      const cols = 5;
      const boxW = (w - 24 - (cols - 1) * 10) / cols;
      const boxH = 46;
      CHAIN.forEach(([name, label], i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 12 + col * (boxW + 10);
        const y = 12 + row * (boxH + 18);
        const exists = activeNames.indexOf(name) >= 0;
        let hot = exists;
        if (mode === 'bypass' && ['deess', 'notch', 'gate', 'mainOut'].indexOf(name) >= 0) {
          hot = false;
        }
        if (mode === 'mute' && name !== 'muteOut' && name !== 'master' &&
            name !== 'postAnalyser' && name !== 'source') {
          hot = false;
        }
        ctx.fillStyle = !exists ? '#2a2f3a'
          : hot ? (playing ? '#1f6f57' : '#274a43') : '#243044';
        ctx.strokeStyle = hot ? '#5ad1a3' : '#3a4456';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = exists ? '#e8eef7' : '#8a93a3';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + boxW / 2, y + 20);
        ctx.font = '10px monospace';
        ctx.fillStyle = hot ? '#8ff0c8' : '#7a8394';
        ctx.fillText(hot ? (playing ? 'ACTIVE' : 'IDLE') : 'OFFLINE',
          x + boxW / 2, y + 36);
        ctx.textAlign = 'left';
        if (col < cols - 1 && i < CHAIN.length - 1) {
          ctx.strokeStyle = '#3a4456';
          ctx.beginPath();
          ctx.moveTo(x + boxW, y + boxH / 2);
          ctx.lineTo(x + boxW + 10, y + boxH / 2);
          ctx.stroke();
        }
      });
    });
  }

  root.TapeDraw = { drawWaveform, drawSpectrum, drawNodeChain };
})(typeof self !== 'undefined' ? self : globalThis);

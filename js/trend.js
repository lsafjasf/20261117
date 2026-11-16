function prepare(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width, height };
}

function roundedTopBar(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  context.beginPath();
  context.moveTo(x, y + height);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height);
  context.closePath();
}

function niceMax(value, step) {
  if (value <= 0) return step;
  return Math.ceil(value / step) * step;
}

export function drawTrendChart(canvas, snapshot) {
  const { context, width, height } = prepare(canvas);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(5, 17, 29, 0.32)";
  context.fillRect(0, 0, width, height);

  if (!snapshot.trend.length) {
    context.fillStyle = "#658095";
    context.font = '10px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    context.textAlign = "center";
    context.fillText("当前筛选无可用时段数据", width / 2, height / 2);
    return;
  }

  const margin = { left: 32, right: 35, top: 13, bottom: 25 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const bins = snapshot.trend;
  const maxCount = niceMax(Math.max(...bins.map((bin) => bin.count), 1), 2);
  const maxDelayValue = Math.max(
    ...bins.filter((bin) => bin.avgDelay != null).map((bin) => bin.avgDelay),
    15,
  );
  const maxDelay = niceMax(maxDelayValue, 15);
  const top = margin.top;
  const bottom = margin.top + plotHeight;

  context.save();
  context.lineWidth = 1;
  context.font = '7.5px "SFMono-Regular", Consolas, monospace';
  for (let index = 0; index <= 4; index += 1) {
    const y = top + (plotHeight / 4) * index;
    context.beginPath();
    context.moveTo(margin.left, y);
    context.lineTo(width - margin.right, y);
    context.strokeStyle = index === 4 ? "rgba(87, 126, 151, 0.26)" : "rgba(80, 118, 143, 0.12)";
    context.setLineDash(index === 4 ? [] : [3, 5]);
    context.stroke();
    const countLabel = Math.round(maxCount - (maxCount / 4) * index);
    context.fillStyle = "#526d81";
    context.textAlign = "right";
    context.fillText(String(countLabel), margin.left - 7, y + 2.5);
    context.textAlign = "left";
    context.fillStyle = "#6d6771";
    context.fillText(`${Math.round(maxDelay - (maxDelay / 4) * index)}m`, width - margin.right + 6, y + 2.5);
  }
  context.setLineDash([]);
  context.restore();

  const slot = plotWidth / bins.length;
  const barWidth = Math.max(4, Math.min(15, slot * 0.44));
  bins.forEach((bin, index) => {
    const x = margin.left + slot * index + slot / 2 - barWidth / 2;
    const totalHeight = (bin.count / maxCount) * plotHeight;
    const activeHeight = ((bin.count - bin.cancelled) / maxCount) * plotHeight;
    const cancelledHeight = totalHeight - activeHeight;
    if (bin.count > 0) {
      const gradient = context.createLinearGradient(0, bottom - totalHeight, 0, bottom);
      gradient.addColorStop(0, "rgba(62, 123, 153, 0.74)");
      gradient.addColorStop(1, "rgba(32, 76, 101, 0.24)");
      roundedTopBar(context, x, bottom - activeHeight, barWidth, activeHeight, 2.2);
      context.fillStyle = gradient;
      context.fill();
      if (cancelledHeight > 0) {
        context.beginPath();
        context.rect(x, bottom - totalHeight, barWidth, cancelledHeight);
        context.fillStyle = "rgba(242, 100, 121, 0.72)";
        context.fill();
      }
    }

    if (index % 2 === 0 || bins.length <= 6) {
      context.fillStyle = "#61798c";
      context.font = '7.5px "SFMono-Regular", Consolas, monospace';
      context.textAlign = "center";
      context.fillText(bin.label, margin.left + slot * index + slot / 2, height - 9);
    }
  });

  const linePoints = [];
  bins.forEach((bin, index) => {
    if (bin.avgDelay == null) return;
    linePoints.push({
      x: margin.left + slot * index + slot / 2,
      y: bottom - (bin.avgDelay / maxDelay) * plotHeight,
      delay: bin.avgDelay,
      index,
    });
  });

  if (linePoints.length) {
    const fill = context.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(242, 184, 75, 0.2)");
    fill.addColorStop(1, "rgba(242, 184, 75, 0)");
    context.beginPath();
    context.moveTo(linePoints[0].x, bottom);
    linePoints.forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(linePoints.at(-1).x, bottom);
    context.closePath();
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    linePoints.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = "#f2b84b";
    context.lineWidth = 1.7;
    context.lineJoin = "round";
    context.shadowColor = "rgba(242, 184, 75, 0.5)";
    context.shadowBlur = 7;
    context.stroke();
    context.shadowBlur = 0;

    for (const point of linePoints) {
      context.beginPath();
      context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      context.fillStyle = "#071522";
      context.fill();
      context.strokeStyle = "#f2b84b";
      context.lineWidth = 1.4;
      context.stroke();
    }
  } else {
    context.fillStyle = "#658095";
    context.font = '9px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    context.textAlign = "center";
    context.fillText("当前筛选均为取消航班", width / 2, height / 2);
  }

  context.fillStyle = "#526d81";
  context.font = '7px "SFMono-Regular", Consolas, monospace';
  context.textAlign = "left";
  context.fillText("班次", margin.left, 7);
  context.textAlign = "right";
  context.fillText("延误 min", width - margin.right, 7);

  return {
    maxCount,
    maxDelay,
    bins: bins.length,
    points: linePoints.length,
  };
}

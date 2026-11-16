import { ROWS, weatherAt } from "./sim.js";

const TAU = Math.PI * 2;

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function mixColor(a, b, amount) {
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
  const first = parse(a);
  const second = parse(b);
  const values = first.map((value, index) => Math.round(value + (second[index] - value) * amount));
  return `rgb(${values.join(",")})`;
}

function drawSky(ctx, width, height, weather, daylight, time) {
  const night = 1 - Math.min(1, daylight * 1.7);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, mixColor("#b8d1c8", "#162d32", night * 0.72));
  sky.addColorStop(0.58, mixColor("#dbe6ce", "#354d49", night * 0.45));
  sky.addColorStop(1, "#9bb58d");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const sunX = width * (0.12 + (weather.hour - 6) / 24);
  const sunY = height * 0.22;
  if (weather.icon === "sun" || weather.icon === "heat") {
    const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 80);
    glow.addColorStop(0, "rgba(255,231,158,.88)");
    glow.addColorStop(0.25, "rgba(245,213,124,.38)");
    glow.addColorStop(1, "rgba(245,213,124,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 90, sunY - 90, 180, 180);
    ctx.beginPath();
    ctx.arc(sunX, sunY, 15, 0, TAU);
    ctx.fillStyle = "#f4d884";
    ctx.fill();
  }

  if (weather.icon === "cloud" || weather.icon === "rain") {
    ctx.fillStyle = "rgba(230,238,228,.58)";
    for (let index = 0; index < 4; index += 1) {
      const x = ((index * 157 + 70) % (width + 100)) - 40;
      const y = 40 + (index % 2) * 26;
      ctx.beginPath();
      ctx.ellipse(x, y, 44, 13, 0, 0, TAU);
      ctx.ellipse(x + 30, y - 8, 27, 13, 0, 0, TAU);
      ctx.fill();
    }
  }

  if (weather.icon === "rain") {
    ctx.strokeStyle = "rgba(190,220,220,.38)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 26; index += 1) {
      const x = (index * 53 + time * 19) % width;
      const y = 54 + ((index * 37 + time * 80) % (height * 0.52));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + 12);
      ctx.stroke();
    }
  }

  const hill = ctx.createLinearGradient(0, height * 0.38, 0, height * 0.7);
  hill.addColorStop(0, "rgba(84,120,83,.45)");
  hill.addColorStop(1, "rgba(55,91,68,.82)");
  ctx.fillStyle = hill;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.54);
  ctx.bezierCurveTo(width * 0.2, height * 0.4, width * 0.38, height * 0.6, width * 0.54, height * 0.49);
  ctx.bezierCurveTo(width * 0.75, height * 0.33, width * 0.84, height * 0.57, width, height * 0.47);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fill();
}

function drawGlasshouse(ctx, width, height, daylight) {
  const left = 28;
  const right = width - 28;
  const base = height - 53;
  const peak = 24;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left, base);
  ctx.lineTo(left, height * 0.35);
  ctx.bezierCurveTo(left + width * 0.08, 70, width * 0.28, peak, width * 0.5, peak);
  ctx.bezierCurveTo(width * 0.72, peak, right - width * 0.08, 70, right, height * 0.35);
  ctx.lineTo(right, base);
  ctx.closePath();
  const glass = ctx.createLinearGradient(0, peak, 0, base);
  glass.addColorStop(0, `rgba(222,239,216,${0.2 + daylight * 0.13})`);
  glass.addColorStop(0.5, "rgba(196,222,196,.16)");
  glass.addColorStop(1, "rgba(142,179,144,.2)");
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.clip();

  const interior = ctx.createLinearGradient(0, peak, 0, base);
  interior.addColorStop(0, "rgba(227,241,212,.06)");
  interior.addColorStop(1, "rgba(62,103,69,.13)");
  ctx.fillStyle = interior;
  ctx.fillRect(left, peak, right - left, base - peak);

  ctx.strokeStyle = "rgba(223,237,218,.13)";
  ctx.lineWidth = 1;
  for (let x = left + 45; x < right; x += 45) {
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, 72 + Math.abs(width / 2 - x) * 0.22);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(30,66,48,.92)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(left, base);
  ctx.lineTo(left, height * 0.35);
  ctx.bezierCurveTo(left + width * 0.08, 70, width * 0.28, peak, width * 0.5, peak);
  ctx.bezierCurveTo(width * 0.72, peak, right - width * 0.08, 70, right, height * 0.35);
  ctx.lineTo(right, base);
  ctx.stroke();

  ctx.strokeStyle = "rgba(23,54,39,.55)";
  ctx.lineWidth = 2;
  const ribs = 6;
  for (let index = 0; index <= ribs; index += 1) {
    const ratio = index / ribs;
    const x = left + (right - left) * ratio;
    const roofY = 72 + Math.abs(0.5 - ratio) * (height * 0.22);
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, roofY);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(left, height * 0.34);
  ctx.lineTo(right, height * 0.34);
  ctx.strokeStyle = "rgba(23,54,39,.35)";
  ctx.stroke();

  ctx.fillStyle = "rgba(18,48,33,.75)";
  ctx.fillRect(0, base, width, height - base);
  ctx.strokeStyle = "rgba(182,209,165,.16)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x + 20, height);
    ctx.stroke();
  }
}

function bedLayout(width, height) {
  const left = 58;
  const right = width - 64;
  return {
    left,
    right,
    width: right - left,
    rows: [0.46, 0.6, 0.74].map((ratio) => ({
      y: Math.round(height * ratio),
      x: left,
      width: right - left
    }))
  };
}

function drawBeds(ctx, layout, state) {
  layout.rows.forEach((bed, rowIndex) => {
    const row = ROWS[rowIndex];
    ctx.save();
    ctx.shadowColor = "rgba(17,38,25,.22)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    roundedRect(ctx, bed.x, bed.y - 7, bed.width, 22, 8);
    const soil = ctx.createLinearGradient(0, bed.y - 7, 0, bed.y + 15);
    soil.addColorStop(0, "#826544");
    soil.addColorStop(0.25, "#5d4933");
    soil.addColorStop(1, "#3d3226");
    ctx.fillStyle = soil;
    ctx.fill();
    ctx.restore();

    roundedRect(ctx, bed.x - 3, bed.y + 12, bed.width + 6, 8, 4);
    ctx.fillStyle = "rgba(26,47,31,.74)";
    ctx.fill();

    const bedGlow = ctx.createLinearGradient(bed.x, 0, bed.x + bed.width, 0);
    bedGlow.addColorStop(0, "rgba(189,216,95,0)");
    bedGlow.addColorStop(0.12, row.id === "A" ? "rgba(145,190,113,.18)" : "rgba(145,190,113,.09)");
    bedGlow.addColorStop(0.88, "rgba(145,190,113,.09)");
    bedGlow.addColorStop(1, "rgba(189,216,95,0)");
    ctx.fillStyle = bedGlow;
    ctx.fillRect(bed.x, bed.y - 8, bed.width, 20);

    ctx.fillStyle = "rgba(10,32,21,.72)";
    roundedRect(ctx, 34, bed.y - 8, 18, 22, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(229,239,204,.82)";
    ctx.font = '600 8px "IBM Plex Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(row.id, 43, bed.y + 6);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(238,243,224,.62)";
    ctx.font = '9px "Noto Sans SC", sans-serif';
    ctx.fillText(row.species, 57, bed.y - 12);

    const met = state.plants.filter((plant) => plant.row === row.id && plant.height >= plant.heightGoal * 0.94 && plant.health >= 72).length;
    ctx.fillStyle = met === 3 ? "rgba(189,216,95,.7)" : "rgba(231,238,218,.35)";
    ctx.font = '7px "IBM Plex Mono", monospace';
    ctx.fillText(`${met}/3`, bed.x + bed.width - 17, bed.y - 13);
  });
}

function plantColor(row, health) {
  const healthy = row.color;
  if (health >= 72) return healthy;
  if (health >= 50) return mixColor(healthy, "#c1aa59", (72 - health) / 22);
  return mixColor("#b39a4f", "#86563c", (50 - health) / 50);
}

function drawLeaf(ctx, x, y, rx, ry, rotation, color, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(34,69,37,.2)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-rx * 0.65, 0);
  ctx.lineTo(rx * 0.65, 0);
  ctx.stroke();
  ctx.restore();
}

function drawBasil(ctx, x, baseY, scale, health, color, sway) {
  const stemHeight = 31 * scale;
  const lean = (100 - health) * 0.0018 * stemHeight;
  ctx.strokeStyle = mixColor("#4f7b3e", "#876b3f", Math.max(0, (65 - health) / 65));
  ctx.lineWidth = 1.7 * scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + lean, baseY - stemHeight * 0.55, x + lean + sway, baseY - stemHeight);
  ctx.stroke();

  const leafColor = plantColor(ROWS[0], health);
  const levels = [
    { y: 0.43, spread: 12, size: 1 },
    { y: 0.7, spread: 9, size: 0.88 },
    { y: 0.91, spread: 5, size: 0.7 }
  ];
  for (const level of levels) {
    const ly = baseY - stemHeight * level.y;
    drawLeaf(ctx, x + lean * level.y - level.spread * scale, ly, 10 * scale * level.size, 5.4 * scale * level.size, -0.38 - sway * 0.05, leafColor, 0.94);
    drawLeaf(ctx, x + lean * level.y + level.spread * scale, ly - 1, 10 * scale * level.size, 5.4 * scale * level.size, 0.38 - sway * 0.05, leafColor, 0.86);
  }
  drawLeaf(ctx, x + lean + sway, baseY - stemHeight - 2, 6 * scale, 8 * scale, 0.04, leafColor);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + lean + sway, baseY - stemHeight - 3, 1.2, 0, TAU);
  ctx.fill();
}

function drawLettuce(ctx, x, baseY, scale, health, color, sway) {
  const lettuceColor = plantColor(ROWS[1], health);
  const tilt = sway * 0.02;
  for (let layer = 0; layer < 3; layer += 1) {
    const count = 7 - layer * 2;
    const radius = (15 - layer * 3) * scale;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * TAU + layer * 0.45 + tilt;
      const px = x + Math.cos(angle) * radius;
      const py = baseY - 5 * scale + Math.sin(angle) * radius * 0.34 - layer * 5 * scale;
      const rx = (7 - layer * 1.2) * scale;
      const ry = (4.2 - layer * 0.4) * scale;
      drawLeaf(ctx, px, py, rx, ry, angle * 0.55, lettuceColor, 0.72 + layer * 0.09);
    }
  }
  ctx.beginPath();
  ctx.arc(x, baseY - 12 * scale, 4.3 * scale, 0, TAU);
  ctx.fillStyle = mixColor(lettuceColor, "#e4e9ac", 0.22);
  ctx.fill();
  ctx.strokeStyle = "rgba(233,243,187,.35)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(x, baseY - 2, 5 * scale, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPepper(ctx, x, baseY, scale, health, color, sway) {
  const stemHeight = 42 * scale;
  const lean = (100 - health) * 0.0012 * stemHeight;
  ctx.strokeStyle = mixColor("#557b3e", "#8d6b3e", Math.max(0, (60 - health) / 60));
  ctx.lineWidth = 1.7 * scale;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x - lean * 0.4, baseY - stemHeight * 0.5, x + lean + sway, baseY - stemHeight);
  ctx.stroke();

  const leafColor = plantColor(ROWS[2], health);
  const branches = [
    { y: 0.5, dir: -1 },
    { y: 0.65, dir: 1 },
    { y: 0.8, dir: -1 }
  ];
  for (const branch of branches) {
    const by = baseY - stemHeight * branch.y;
    ctx.strokeStyle = "rgba(77,105,56,.85)";
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(x + lean * branch.y, by);
    ctx.lineTo(x + lean * branch.y + branch.dir * 12 * scale, by - 4 * scale);
    ctx.stroke();
    drawLeaf(
      ctx,
      x + lean * branch.y + branch.dir * 13 * scale,
      by - 5 * scale,
      9 * scale,
      3.4 * scale,
      branch.dir * -0.45,
      leafColor
    );
  }
  drawLeaf(ctx, x + lean + sway, baseY - stemHeight - 3, 6.4 * scale, 3 * scale, 0.18, leafColor);

  if (health > 55) {
    const fruitAlpha = Math.min(1, (health - 55) / 22);
    ctx.globalAlpha = fruitAlpha;
    for (const [dx, dy] of [[-7, 0.62], [8, 0.74]]) {
      ctx.beginPath();
      ctx.ellipse(x + lean + dx * scale, baseY - stemHeight * dy, 2.8 * scale, 4.4 * scale, dx * 0.02, 0, TAU);
      ctx.fillStyle = "#d77146";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,208,159,.3)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(x, baseY - 1, 5 * scale, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawTargetMarker(ctx, x, baseY, target, time) {
  const pulse = 0.5 + Math.sin(time * 2.1) * 0.5;
  ctx.save();
  ctx.strokeStyle = `rgba(232,242,158,${0.35 + pulse * 0.2})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.ellipse(x, baseY + 1, 17, 5, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(231,241,158,.75)";
  ctx.beginPath();
  ctx.arc(x, baseY + 1, 4 + pulse * 2, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 8, baseY - 4);
  ctx.lineTo(x + 8, baseY - 20);
  ctx.stroke();
  ctx.fillStyle = "rgba(238,243,196,.94)";
  roundedRect(ctx, x + 2, baseY - 34, 30, 14, 4);
  ctx.fill();
  ctx.fillStyle = "#2c492e";
  ctx.font = '600 7px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText(target.position, x + 17, baseY - 24);
  ctx.restore();
}

function drawPlants(ctx, layout, state, time) {
  const drawFunctions = { A: drawBasil, B: drawLettuce, C: drawPepper };
  layout.rows.forEach((bed, rowIndex) => {
    const row = ROWS[rowIndex];
    const rowPlants = state.plants.filter((plant) => plant.row === row.id);
    rowPlants.forEach((plant, index) => {
      const x = bed.x + bed.width * ((index + 0.5) / rowPlants.length);
      const baseY = bed.y - 5;
      const heightRatio = plant.height / plant.heightGoal;
      const scale = 0.55 + heightRatio * 0.63;
      const sway = Math.sin(time * 1.2 + rowIndex + index) * 1.2;
      if (plant.isTarget) drawTargetMarker(ctx, x, baseY, state.targets[rowIndex], time);
      drawFunctions[row.id](ctx, x, baseY, scale, plant.health, row.color, sway);

      if (plant.health < 58) {
        ctx.fillStyle = `rgba(214,142,75,${Math.min(0.8, (58 - plant.health) / 45)})`;
        ctx.font = '7px "IBM Plex Mono", monospace';
        ctx.textAlign = "center";
        ctx.fillText("stress", x, baseY - 45 * scale);
      }
    });
  });
}

function drawLights(ctx, layout, state, time) {
  const lampY = Math.max(78, layout.rows[0].y - 115);
  const positions = layout.rows.flatMap((bed) => [0.2, 0.5, 0.8].map((ratio) => bed.x + bed.width * ratio));
  ctx.save();
  for (let index = 0; index < positions.length; index += 1) {
    const x = positions[index];
    const rowIndex = Math.floor(index / 3);
    const bedY = layout.rows[rowIndex]?.y || layout.rows[0].y;
    ctx.fillStyle = "rgba(19,49,34,.8)";
    roundedRect(ctx, x - 16, lampY, 32, 7, 3);
    ctx.fill();
    if (state.controls.lights) {
      const flicker = 0.94 + Math.sin(time * 7.2 + index) * 0.03;
      const cone = ctx.createLinearGradient(0, lampY + 7, 0, bedY);
      cone.addColorStop(0, `rgba(249,233,156,${0.2 * flicker})`);
      cone.addColorStop(0.65, `rgba(240,224,142,${0.075 * flicker})`);
      cone.addColorStop(1, "rgba(240,224,142,0)");
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(x - 11, lampY + 7);
      ctx.lineTo(x + 11, lampY + 7);
      ctx.lineTo(x + 39, bedY + 5);
      ctx.lineTo(x - 39, bedY + 5);
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = "screen";
      const spot = ctx.createRadialGradient(x, bedY - 3, 0, x, bedY - 3, 24);
      spot.addColorStop(0, "rgba(242,229,148,.28)");
      spot.addColorStop(1, "rgba(242,229,148,0)");
      ctx.fillStyle = spot;
      ctx.beginPath();
      ctx.ellipse(x, bedY - 3, 25, 7, 0, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.fillStyle = state.controls.lights ? "#f1e7a9" : "#789085";
    ctx.beginPath();
    ctx.arc(x, lampY + 9, 1.7, 0, TAU);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(18,47,32,.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.left, lampY + 2);
  ctx.lineTo(layout.right, lampY + 2);
  ctx.stroke();
  ctx.restore();
}

function drawMist(ctx, layout, state, time) {
  if (!state.controls.mist) return;
  ctx.save();
  for (let index = 0; index < 46; index += 1) {
    const bed = layout.rows[index % layout.rows.length];
    const seed = index * 19.13;
    const x = bed.x + ((Math.sin(seed) * 0.5 + 0.5) * bed.width);
    const cycle = (time * (17 + (index % 7)) + index * 23) % 96;
    const y = 112 + cycle * (bed.y - 112) / 96;
    const radius = 0.7 + (index % 4) * 0.32;
    ctx.fillStyle = `rgba(206,236,229,${0.12 + (1 - cycle / 96) * 0.35})`;
    ctx.beginPath();
    ctx.arc(x + Math.sin(time + index) * 3, y, radius, 0, TAU);
    ctx.fill();
  }
  const haze = ctx.createLinearGradient(0, 105, 0, layout.rows[2].y);
  haze.addColorStop(0, "rgba(204,232,226,.02)");
  haze.addColorStop(0.5, "rgba(204,232,226,.1)");
  haze.addColorStop(1, "rgba(204,232,226,.02)");
  ctx.fillStyle = haze;
  ctx.fillRect(layout.left, 105, layout.right - layout.left, layout.rows[2].y - 105);
  ctx.restore();
}

function drawFan(ctx, width, height, state, time) {
  const x = width - 55;
  const y = height * 0.34;
  ctx.save();
  ctx.fillStyle = "rgba(21,55,38,.84)";
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(202,223,194,.26)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.translate(x, y);
  ctx.rotate(state.controls.fan ? time * 7 : 0.2);
  ctx.fillStyle = state.controls.fan ? "#c8d9c7" : "#789185";
  for (let blade = 0; blade < 4; blade += 1) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(6, 0, 7, 3.2, 0.45, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, TAU);
  ctx.fillStyle = "#dce8db";
  ctx.fill();
  ctx.restore();

  if (state.controls.fan) {
    ctx.save();
    ctx.strokeStyle = "rgba(208,231,208,.28)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 5; index += 1) {
      const offset = ((time * 35 + index * 18) % 90);
      ctx.beginPath();
      ctx.moveTo(x - 24 - offset, y - 13 + index * 6);
      ctx.bezierCurveTo(x - 58 - offset, y - 22 + index * 7, x - 78 - offset, y + 10, x - 112 - offset, y + index * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawSensors(ctx, width, height, state) {
  const x = 42;
  const y = height * 0.31;
  ctx.save();
  ctx.fillStyle = "rgba(20,51,35,.78)";
  roundedRect(ctx, x, y, 43, 56, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(196,220,181,.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(211,231,198,.38)";
  ctx.font = '6px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText("SENSOR", x + 21.5, y + 11);
  ctx.fillStyle = state.activeEvent ? "#f18a72" : "#bdd85f";
  ctx.beginPath();
  ctx.arc(x + 21.5, y + 21, 3.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(228,239,219,.72)";
  ctx.font = '7px "IBM Plex Mono", monospace';
  ctx.fillText(`${state.observed.humidity.toFixed(0)}%`, x + 21.5, y + 36);
  ctx.fillText(`${state.observed.temperature.toFixed(1)}°`, x + 21.5, y + 46);
  ctx.restore();
}

function drawWaterTank(ctx, width, height, state) {
  const x = width - 80;
  const y = height - 146;
  const tankHeight = 73;
  ctx.save();
  ctx.fillStyle = "rgba(19,48,34,.42)";
  roundedRect(ctx, x, y, 29, tankHeight, 7);
  ctx.fill();
  const waterHeight = tankHeight * (state.actual.water / 100);
  const water = ctx.createLinearGradient(0, y + tankHeight - waterHeight, 0, y + tankHeight);
  water.addColorStop(0, "rgba(112,175,178,.75)");
  water.addColorStop(1, "rgba(67,124,131,.9)");
  ctx.fillStyle = water;
  roundedRect(ctx, x + 3, y + tankHeight - waterHeight + 3, 23, Math.max(0, waterHeight - 5), 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(202,225,211,.22)";
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, 29, tankHeight, 7);
  ctx.stroke();
  ctx.fillStyle = "rgba(224,239,226,.53)";
  ctx.font = '6px "IBM Plex Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText("H₂O", x + 14.5, y - 6);
  ctx.fillText(`${Math.round(state.actual.water)}%`, x + 14.5, y + tankHeight + 12);
  ctx.restore();
}

function drawAlertPulse(ctx, layout, state, time) {
  if (!state.activeEvent) return;
  const pulse = (time * 0.9) % 1;
  ctx.save();
  ctx.strokeStyle = `rgba(244,123,92,${0.62 * (1 - pulse)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(63, layout.rows[1].y + 3, 10 + pulse * 24, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = "rgba(128,45,32,.72)";
  roundedRect(ctx, 73, layout.rows[1].y - 28, 82, 17, 5);
  ctx.fill();
  ctx.fillStyle = "#ffe0d4";
  ctx.font = '600 8px "Noto Sans SC", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("环境临界 · 请处置", 114, layout.rows[1].y - 17);
  ctx.restore();
}

function drawAmbientLabel(ctx, width, height, state, weather) {
  ctx.save();
  ctx.fillStyle = "rgba(225,238,218,.44)";
  ctx.font = '7px "IBM Plex Mono", monospace';
  ctx.textAlign = "left";
  ctx.fillText(`OUTSIDE  ${weather.label.toUpperCase()}  ${weather.ambientTemperature.toFixed(1)}°C`, 45, 62);
  ctx.strokeStyle = "rgba(225,238,218,.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(45, 68);
  ctx.lineTo(45 + Math.min(155, width * 0.25), 68);
  ctx.stroke();
  ctx.restore();
}

export function drawGreenhouse(canvas, state, time = 0) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(280, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const weather = weatherAt(state.weather, state.elapsedHours);
  const layout = bedLayout(width, height);
  drawSky(ctx, width, height, weather, weather.daylight, time);
  drawGlasshouse(ctx, width, height, weather.daylight);
  drawAmbientLabel(ctx, width, height, state, weather);
  drawLights(ctx, layout, state, time);
  drawBeds(ctx, layout, state);
  drawPlants(ctx, layout, state, time);
  drawMist(ctx, layout, state, time);
  drawFan(ctx, width, height, state, time);
  drawSensors(ctx, width, height, state);
  drawWaterTank(ctx, width, height, state);
  drawAlertPulse(ctx, layout, state, time);

  const scan = ctx.createLinearGradient(0, 0, 0, height);
  scan.addColorStop(0, "rgba(5,22,14,.2)");
  scan.addColorStop(0.15, "rgba(5,22,14,0)");
  scan.addColorStop(0.85, "rgba(5,22,14,0)");
  scan.addColorStop(1, "rgba(5,22,14,.2)");
  ctx.fillStyle = scan;
  ctx.fillRect(0, 0, width, height);
}

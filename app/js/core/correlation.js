// 两孔对比连线：仅按同一岩性（同一层位代码）配对。
// gap 占位与对方缺失的层位不产生任何连线，从根本上杜绝“缺失层误连”。
export function buildCorrelation(columnA, columnB) {
  const layersA = columnA.units.filter((u) => u.kind === 'layer');
  const layersB = columnB.units.filter((u) => u.kind === 'layer');
  const mapB = new Map(layersB.map((u) => [u.lithoId, u]));

  const lines = [];
  const missingInB = [];
  const missingInA = [];

  for (const a of layersA) {
    const b = mapB.get(a.lithoId);
    if (b) {
      lines.push({
        lithoId: a.lithoId,
        a: { boreholeId: a.boreholeId, depth: mid(a) },
        b: { boreholeId: b.boreholeId, depth: mid(b) }
      });
    } else {
      missingInB.push({ lithoId: a.lithoId, boreholeId: columnB.boreholeId });
    }
  }
  const idsA = new Set(layersA.map((u) => u.lithoId));
  for (const b of layersB) {
    if (!idsA.has(b.lithoId)) missingInA.push({ lithoId: b.lithoId, boreholeId: columnA.boreholeId });
  }

  return { lines, missingInB, missingInA };
}

function mid(unit) {
  return (unit.top + unit.bottom) / 2;
}

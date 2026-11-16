// Shared render-list preparation. Both pipelines consume the exact same list,
// so batching can never silently reorder transparent nodes.
export function prepareRenderList(scene) {
  return scene.nodes
    .slice()
    .sort((a, b) => (a.z - b.z) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Spatial-hash overlap counting: observable "candidate collision" metric.
// Each node is inserted into the grid cells it overlaps; pairs sharing a cell
// are counted once. Does not mutate scene data.
export function countCandidateCollisions(nodes, cellSize = 48) {
  const buckets = new Map();
  const place = (node, index) => {
    const width = node.type === 'sprite' ? node.w : Math.max(1, node.text.length * 6);
    const height = node.type === 'sprite' ? node.h : 9 * (node.scale || 1);
    const x0 = Math.floor(node.x / cellSize);
    const y0 = Math.floor(node.y / cellSize);
    const x1 = Math.floor((node.x + width) / cellSize);
    const y1 = Math.floor((node.y + height) / cellSize);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = `${cx}:${cy}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      }
    }
  };

  nodes.forEach(place);
  const pairs = new Set();
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const low = Math.min(bucket[i], bucket[j]);
        const high = Math.max(bucket[i], bucket[j]);
        pairs.add(`${low}#${high}`);
      }
    }
  }
  return pairs.size;
}

export function summarizeNodes(nodes) {
  let visible = 0;
  let sprites = 0;
  let texts = 0;
  let culled = 0;
  for (const node of nodes) {
    if (node.alpha === 0) {
      culled += 1;
      continue;
    }
    visible += 1;
    if (node.type === 'sprite') sprites += 1;
    else texts += 1;
  }
  return { total: nodes.length, visible, culled, sprites, texts };
}

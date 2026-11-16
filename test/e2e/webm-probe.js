// Minimal EBML/WebM reader: walks the element tree and counts SimpleBlocks.

const ID = {
  EBML: 0x1a45dfa3,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114d9b74,
  INFO: 0x1549a966,
  TRACKS: 0x1654ae6b,
  CLUSTER: 0x1f43b675,
  BLOCK_GROUP: 0xa0,
  SIMPLE_BLOCK: 0xa3,
  BLOCK: 0xa1,
};

const CONTAINER_IDS = new Set([
  ID.EBML, ID.SEGMENT, ID.SEEK_HEAD, ID.INFO, ID.TRACKS,
  ID.CLUSTER, ID.BLOCK_GROUP,
]);

function vintLength(firstByte) {
  let length = 1;
  let mask = 0x80;
  while ((firstByte & mask) === 0 && length < 8) {
    length += 1;
    mask >>= 1;
  }
  return length;
}

function readVint(bytes, offset) {
  const length = vintLength(bytes[offset]);
  let value = bytes[offset] & (0x7f >> (length - 1));
  for (let i = 1; i < length; i += 1) value = value * 256 + bytes[offset + i];
  return { value, length, unknown: bytes[offset] === 0 };
}

function readId(bytes, offset) {
  const length = vintLength(bytes[offset]);
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + bytes[offset + i];
  return { id, length };
}

function walk(bytes, start, end, stats) {
  let offset = start;
  while (offset + 2 < end) {
    let idInfo;
    try {
      idInfo = readId(bytes, offset);
    } catch {
      break;
    }
    const { id, length: idLen } = idInfo;
    const sizeOffset = offset + idLen;
    if (sizeOffset >= end) break;
    const sizeInfo = readVint(bytes, offset + idLen);
    const headerLen = idLen + sizeInfo.length;
    const payloadStart = offset + headerLen;
    // All-one marker bits means unknown size (Segment/Cluster streaming).
    const unknownSize = sizeInfo.value === (2 ** (7 * sizeInfo.length) - 1);
    const payloadEnd = unknownSize ? end : Math.min(end, payloadStart + sizeInfo.value);

    if (id === ID.SIMPLE_BLOCK) {
      stats.simpleBlocks += 1;
      if (payloadStart < end) {
        const track = readVint(bytes, payloadStart);
        stats.trackNumbers.add(track.value);
      }
    } else if (id === ID.BLOCK) {
      if (payloadStart < end) {
        const track = readVint(bytes, payloadStart);
        stats.trackNumbers.add(track.value);
      }
    } else if (id === ID.BLOCK_GROUP) {
      stats.blockGroups += 1;
    } else if (id === ID.CLUSTER) {
      stats.clusterCount += 1;
    }

    // Known-size containers are parsed recursively; unknown-size ones are
    // scanned sequentially (their children still get visited in place).
    if (!unknownSize && CONTAINER_IDS.has(id) && payloadEnd > payloadStart) {
      walk(bytes, payloadStart, payloadEnd, stats);
      offset = payloadEnd;
    } else if (unknownSize) {
      offset = payloadStart;
    } else {
      offset = payloadEnd;
    }
    if (offset <= sizeOffset) offset = sizeOffset + 1;
  }
}

export function probeWebm(buffer) {
  const bytes = new Uint8Array(buffer);
  const stats = {
    simpleBlocks: 0,
    blockGroups: 0,
    clusterCount: 0,
    trackNumbers: new Set(),
    byteLength: bytes.length,
  };
  walk(bytes, 0, bytes.length, stats);
  return {
    simpleBlocks: stats.simpleBlocks,
    blockGroups: stats.blockGroups,
    clusterCount: stats.clusterCount,
    trackNumbers: [...stats.trackNumbers],
    byteLength: stats.byteLength,
  };
}

// Coordinate normalization. The canvas backing store is sized
// cssSize * dpr and the 2D context is pre-scaled by dpr, so all
// scene math happens in logical (CSS-pixel) coordinates.
export function toLogical(event, rect) {
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

export function isFinitePoint(event) {
  return (
    Number.isFinite(event.clientX) &&
    Number.isFinite(event.clientY)
  );
}

// Normalize wheel deltas across deltaModes (0=pixel, 1=line, 2=page).
export function normalizeWheelDelta(event) {
  const mode = event.deltaMode || 0;
  const scale = mode === 1 ? 16 : mode === 2 ? 800 : 1;
  return event.deltaY * scale;
}

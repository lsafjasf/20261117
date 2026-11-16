export const DEFAULT_MAP_VIEW = Object.freeze({
  scale: 1,
  panX: 0,
  panY: 0,
});

export function normalizeMapView(view) {
  const scale = Number.isFinite(view?.scale) ? Math.min(2.8, Math.max(0.72, view.scale)) : 1;
  return {
    scale,
    panX: Number.isFinite(view?.panX) ? view.panX : 0,
    panY: Number.isFinite(view?.panY) ? view.panY : 0,
  };
}

export class WindowStateStore {
  constructor() {
    this.entries = new Map();
  }

  key(scenarioId, windowId) {
    return `${scenarioId}:${windowId}`;
  }

  save(scenarioId, windowId, state) {
    const key = this.key(scenarioId, windowId);
    this.entries.set(key, {
      airlines: [...(state.airlines ?? [])],
      selectedRouteKey: state.selectedRouteKey ?? null,
      mapView: normalizeMapView(state.mapView),
    });
    return this.entries.get(key);
  }

  load(scenarioId, windowId, fallback = {}) {
    const saved = this.entries.get(this.key(scenarioId, windowId));
    if (!saved) {
      return {
        airlines: [...(fallback.airlines ?? [])],
        selectedRouteKey: fallback.selectedRouteKey ?? null,
        mapView: normalizeMapView(fallback.mapView ?? DEFAULT_MAP_VIEW),
      };
    }
    return {
      airlines: [...saved.airlines],
      selectedRouteKey: saved.selectedRouteKey,
      mapView: { ...saved.mapView },
    };
  }

  has(scenarioId, windowId) {
    return this.entries.has(this.key(scenarioId, windowId));
  }

  count() {
    return this.entries.size;
  }
}

export function reconcileSelection(state, snapshot) {
  const availableAirlines = new Set(snapshot.flights.map((flight) => flight.airline));
  const airlines = state.airlines.filter((airline) => availableAirlines.has(airline));
  const selectedRouteKey = snapshot.routes.some((route) => route.key === state.selectedRouteKey)
    ? state.selectedRouteKey
    : null;
  return {
    airlines,
    selectedRouteKey,
    mapView: normalizeMapView(state.mapView),
  };
}

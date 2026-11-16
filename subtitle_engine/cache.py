"""LRB cache for layout results with observable hit/miss statistics.

The cache key embeds *text, font, size, box width and alignment*, so any
style change naturally misses and the old entry is never reused — explicit
invalidation happens through :meth:`LayoutCache.invalidate` (single key) or
:meth:`LayoutCache.release` (full teardown, used between benchmark runs).
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from dataclasses import dataclass

from .layout import LayoutKey, LayoutResult


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    evictions: int = 0

    @property
    def lookups(self) -> int:
        return self.hits + self.misses

    @property
    def hit_rate(self) -> float:
        return self.hits / self.lookups if self.lookups else 0.0

    def as_dict(self) -> dict[str, float]:
        return {
            "hits": self.hits,
            "misses": self.misses,
            "evictions": self.evictions,
            "hit_rate": round(self.hit_rate, 6),
            "entries": 0,
        }


class LayoutCache:
    """Thread-safe bounded LRU cache of :class:`LayoutResult` objects."""

    def __init__(self, capacity: int = 512) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._capacity = capacity
        self._store: OrderedDict[LayoutKey, LayoutResult] = OrderedDict()
        self._stats = CacheStats()
        self._lock = threading.RLock()

    def get(self, key: LayoutKey) -> LayoutResult | None:
        with self._lock:
            result = self._store.get(key)
            if result is None:
                self._stats.misses += 1
                return None
            self._store.move_to_end(key)
            self._stats.hits += 1
            return result

    def put(self, key: LayoutKey, result: LayoutResult) -> None:
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
                self._store[key] = result
                return
            while len(self._store) >= self._capacity:
                self._store.popitem(last=False)
                self._stats.evictions += 1
            self._store[key] = result

    def invalidate(self, key: LayoutKey) -> bool:
        """Drop one entry (e.g. external style change).  Return whether it existed."""
        with self._lock:
            return self._store.pop(key, None) is not None

    def release(self) -> int:
        """Release every cached entry.  Returns the number dropped."""
        with self._lock:
            dropped = len(self._store)
            self._store.clear()
            return dropped

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._store)

    def stats(self) -> dict[str, float]:
        with self._lock:
            data = self._stats.as_dict()
            data["entries"] = self.size
            data["capacity"] = self._capacity
            return data

    def reset_stats(self) -> None:
        with self._lock:
            self._stats = CacheStats()

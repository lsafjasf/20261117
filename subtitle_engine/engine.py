"""Subtitle layout engine.

Two implementations share the exact same :func:`compute_layout` core:

* :class:`UncachedEngine` re-measures and re-wraps every cue on every frame —
  the pre-fix baseline that caused repeated work and frame hitches;
* :class:`SubtitleEngine` consults a keyed :class:`LayoutCache` first, so
  repeated cues with identical text/font/size/width/alignment cost one hash
  lookup instead of a full shaping pass.

Both engines return identical geometry, which the scenario runner asserts.
Failures are never swallowed: invalid cues are logged with full context and
reported in the per-frame diagnostics instead of being silently dropped.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from .cache import LayoutCache
from .collision import check_collisions
from .layout import LayoutKey, LayoutResult, compute_layout
from .measure import FontSpec, TextMeasurer

LOGGER = logging.getLogger("subtitle_engine")


@dataclass
class SubtitleCue:
    text: str
    font_family: str = "sans"
    size: float = 24.0
    max_width: float = 320.0
    align: str = "left"

    def key(self) -> LayoutKey:
        return LayoutKey.create(
            self.text,
            FontSpec(self.font_family),
            self.size,
            self.max_width,
            self.align,
        )


@dataclass
class FrameReport:
    frame: int
    ok: bool
    frame_ms: float
    layout_ms: float
    active_nodes: int
    candidate_collisions: int
    error: str | None = None
    geometry: tuple = field(default_factory=tuple)


@dataclass
class RunSummary:
    frames: int
    errors: int
    total_layout_ms: float
    max_frame_ms: float
    mean_frame_ms: float
    measure_calls: int
    candidate_collisions: int
    cache: dict

    def as_dict(self) -> dict:
        return {
            "frames": self.frames,
            "errors": self.errors,
            "total_layout_ms": round(self.total_layout_ms, 4),
            "max_frame_ms": round(self.max_frame_ms, 4),
            "mean_frame_ms": round(self.mean_frame_ms, 4),
            "measure_calls": self.measure_calls,
            "candidate_collisions": self.candidate_collisions,
            "cache": self.cache,
        }


class UncachedEngine:
    """Baseline: full layout on every cue, every frame."""

    name = "baseline-uncached"

    def __init__(self, measurer: TextMeasurer) -> None:
        self.measurer = measurer

    def layout(self, cue: SubtitleCue) -> LayoutResult:
        return compute_layout(cue.key(), self.measurer)

    def cache_stats(self) -> dict:
        return {"hits": 0, "misses": 0, "hit_rate": 0.0, "entries": 0, "capacity": 0}

    def release(self) -> int:
        return 0


class SubtitleEngine:
    """Optimized engine: keyed LRU cache in front of the same layout core."""

    name = "cached"

    def __init__(
        self,
        measurer: TextMeasurer,
        capacity: int = 512,
        logger: logging.Logger | None = None,
    ) -> None:
        self.measurer = measurer
        self.cache = LayoutCache(capacity=capacity)
        self.logger = logger or LOGGER

    def layout(self, cue: SubtitleCue) -> LayoutResult:
        key = cue.key()
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        result = compute_layout(key, self.measurer)
        self.cache.put(key, result)
        return result

    def invalidate_cue(self, cue: SubtitleCue) -> bool:
        return self.cache.invalidate(cue.key())

    def cache_stats(self) -> dict:
        return self.cache.stats()

    def release(self) -> int:
        return self.cache.release()


def run_frames(
    engine: SubtitleEngine | UncachedEngine,
    frames: list[list[SubtitleCue]],
) -> tuple[list[FrameReport], RunSummary]:
    """Drive ``frames`` (a list of per-frame cue lists) through an engine."""
    reports: list[FrameReport] = []
    error_count = 0
    total_layout_ms = 0.0
    total_frame_ms = 0.0
    max_frame_ms = 0.0
    total_candidates = 0

    for frame_index, cues in enumerate(frames):
        frame_start = time.perf_counter()
        layout_start = time.perf_counter()
        frame_geometry: list[tuple] = []
        candidates = 0
        error: str | None = None
        ok = True
        for cue in cues:
            try:
                result = engine.layout(cue)
                collisions, checked = check_collisions(result)
                candidates += checked
                if collisions:
                    raise AssertionError(
                        "overlap between lines "
                        + ", ".join(f"{c.first}-{c.second}" for c in collisions)
                    )
                frame_geometry.append(result.to_geometry())
            except (ValueError, TypeError, AssertionError) as exc:
                ok = False
                error = f"{type(exc).__name__}: {exc}"
                error_count += 1
                LOGGER.error(
                    "frame=%d cue failed text=%r font=%s size=%s width=%s "
                    "align=%s error=%s",
                    frame_index,
                    cue.text,
                    cue.font_family,
                    cue.size,
                    cue.max_width,
                    cue.align,
                    error,
                )
        layout_ms = (time.perf_counter() - layout_start) * 1000.0
        frame_ms = (time.perf_counter() - frame_start) * 1000.0
        total_layout_ms += layout_ms
        total_frame_ms += frame_ms
        max_frame_ms = max(max_frame_ms, frame_ms)
        total_candidates += candidates
        reports.append(
            FrameReport(
                frame=frame_index,
                ok=ok,
                frame_ms=frame_ms,
                layout_ms=layout_ms,
                active_nodes=len(cues),
                candidate_collisions=candidates,
                error=error,
                geometry=tuple(frame_geometry),
            )
        )

    frame_count = len(frames)
    summary = RunSummary(
        frames=frame_count,
        errors=error_count,
        total_layout_ms=total_layout_ms,
        max_frame_ms=max_frame_ms,
        mean_frame_ms=(total_frame_ms / frame_count) if frame_count else 0.0,
        measure_calls=engine.measurer.measure_calls,
        candidate_collisions=total_candidates,
        cache=engine.cache_stats(),
    )
    return reports, summary

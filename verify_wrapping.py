"""Manual verification: print wrapped geometry for Chinese/English/Mixed text.

Run with ``python3 verify_wrapping.py``.  Exits non-zero if any overlap is
found, so it can be used as a smoke check in CI as well.
"""

from subtitle_engine.collision import check_collisions
from subtitle_engine.engine import SubtitleCue, SubtitleEngine, UncachedEngine
from subtitle_engine.measure import TextMeasurer
from subtitle_engine.workload import CN_LONG, EN_LONG, MIXED_LONG


def show(label: str, cue: SubtitleCue) -> int:
    baseline = UncachedEngine(TextMeasurer()).layout(cue)
    cached = SubtitleEngine(TextMeasurer())
    first = cached.layout(cue)
    second = cached.layout(cue)
    assert first.to_geometry() == baseline.to_geometry()
    assert second.to_geometry() == first.to_geometry()
    collisions, candidates = check_collisions(first)
    print(f"\n== {label} (width={cue.max_width}, align={cue.align}) ==")
    for line in first.lines:
        print(
            f"  line {line.line_index}: x={line.x:7.2f} "
            f"w={line.width:7.2f} | {line.text}"
        )
    print(
        f"  lines={len(first.lines)} candidate_checks={candidates} "
        f"collisions={len(collisions)} cache_stats={cached.cache_stats()}"
    )
    return len(collisions)


def main() -> int:
    samples = [
        ("Chinese", SubtitleCue(CN_LONG, "sans", 22, 160, "left")),
        ("English", SubtitleCue(EN_LONG, "serif", 20, 180, "left")),
        ("Mixed CJK/Latin", SubtitleCue(MIXED_LONG, "sans", 22, 200, "center")),
    ]
    overlaps = sum(show(label, cue) for label, cue in samples)
    print(f"\noverlap count across samples: {overlaps}")
    return 1 if overlaps else 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Run the three required scenarios and emit comparable metrics + logs.

Scenarios:

1. ``baseline``  - standard workload through :class:`UncachedEngine`
   (the pre-fix behaviour);
2. ``optimized`` - the same workload through the cached engine, with an
   assertion that every frame's geometry is byte-for-byte identical to the
   baseline (no change to picture/export semantics);
3. ``boundary``  - edge + invalid inputs, exercising diagnostic logging.

A fourth pass re-runs the optimized scenario after :meth:`release` to prove
that metrics do not keep deteriorating across runs (no leaked entries/counters).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .engine import (
    FrameReport,
    SubtitleEngine,
    UncachedEngine,
    run_frames,
)
from .measure import TextMeasurer
from .workload import build_boundary_workload, build_standard_workload


def configure_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("subtitle_engine")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()
    file_handler = logging.FileHandler(log_path, mode="w", encoding="utf-8")
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    logger.addHandler(file_handler)
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    logger.addHandler(stream_handler)


def _geometry(reports: list[FrameReport]) -> list[tuple]:
    return [report.geometry for report in reports]


def run_standard_comparison(frames: int) -> dict:
    workload = build_standard_workload(frames)

    baseline = UncachedEngine(TextMeasurer())
    base_reports, base_summary = run_frames(baseline, workload)

    optimized = SubtitleEngine(TextMeasurer())
    opt_reports, opt_summary = run_frames(optimized, workload)

    baseline_geometry = _geometry(base_reports)
    optimized_geometry = _geometry(opt_reports)
    if baseline_geometry != optimized_geometry:
        raise AssertionError(
            "cached engine changed layout semantics: geometry mismatch"
        )

    overlap_failures = [
        report.frame for report in opt_reports if not report.ok
    ]
    result = {
        "scenario": "standard_workload",
        "frames": frames,
        "semantic_equivalence": baseline_geometry == optimized_geometry,
        "overlap_failures": overlap_failures,
        "baseline": base_summary.as_dict(),
        "optimized": opt_summary.as_dict(),
    }
    baseline_measures = base_summary.measure_calls
    optimized_measures = opt_summary.measure_calls
    result["measure_call_reduction_pct"] = round(
        100.0 * (baseline_measures - optimized_measures) / baseline_measures, 2
    )
    result["layout_speedup_x"] = round(
        base_summary.total_layout_ms / opt_summary.total_layout_ms, 2
    )
    optimized.release()
    return result


def run_boundary() -> dict:
    engine = SubtitleEngine(TextMeasurer())
    reports, summary = run_frames(engine, build_boundary_workload())
    failed = [
        {
            "frame": report.frame,
            "error": report.error,
            "active_nodes": report.active_nodes,
        }
        for report in reports
        if not report.ok
    ]
    result = {
        "scenario": "boundary_and_invalid_input",
        "frames": len(reports),
        "summary": summary.as_dict(),
        "failed_frames": failed,
        "valid_layouts": sum(1 for report in reports if report.ok),
    }
    engine.release()
    return result


def run_release_stability(frames: int, repeats: int = 3) -> dict:
    """Re-run after release; counters/entries must not drift upward."""
    workload = build_standard_workload(frames)
    runs = []
    for run_index in range(repeats):
        engine = SubtitleEngine(TextMeasurer())
        _, summary = run_frames(engine, workload)
        data = summary.as_dict()
        data["released_entries"] = engine.release()
        data["entries_after_release"] = engine.cache.size
        data["run"] = run_index
        runs.append(data)
    stable = all(
        run["measure_calls"] == runs[0]["measure_calls"]
        and run["cache"]["entries"] == runs[0]["cache"]["entries"]
        and run["released_entries"] == runs[0]["released_entries"]
        and run["entries_after_release"] == 0
        for run in runs
    )
    return {"scenario": "release_stability", "stable": stable, "runs": runs}


def main(frames: int = 120, out_dir: str = "artifacts") -> dict:
    out = Path(out_dir)
    configure_logging(out / "logs" / "scenario.log")
    report = {
        "standard": run_standard_comparison(frames),
        "boundary": run_boundary(),
        "release_stability": run_release_stability(frames),
    }
    metrics_path = out / "metrics.json"
    metrics_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False, indent=2))

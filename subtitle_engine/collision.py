"""Overlap verification for placed subtitle lines.

Two lines collide when their vertical bands intersect (with the configured
line gap applied) *and* their horizontal spans overlap.  Every pair that is
examined counts as a *candidate collision* — an observable metric — and only
the pairs that actually intersect are returned as collisions.
"""

from __future__ import annotations

from dataclasses import dataclass

from .layout import LayoutResult, PlacedLine


@dataclass(frozen=True)
class Collision:
    first: int
    second: int


def line_bands(result: LayoutResult) -> tuple[tuple[float, float, float, float], ...]:
    """Return ``(y_top, y_bottom, x_left, x_right)`` for every line."""
    bands = []
    pitch = result.key.size + result.line_gap
    for line in result.lines:
        top = line.line_index * pitch
        bottom = top + result.key.size
        bands.append((top, bottom, line.x, line.x + line.width))
    return tuple(bands)


def check_collisions(result: LayoutResult) -> tuple[list[Collision], int]:
    """Return ``(collisions, candidate_checks)`` for one layout."""
    bands = line_bands(result)
    collisions: list[Collision] = []
    candidates = 0
    for i in range(len(bands)):
        top_i, bottom_i, left_i, right_i = bands[i]
        for j in range(i + 1, len(bands)):
            candidates += 1
            top_j, bottom_j, left_j, right_j = bands[j]
            vertical_overlap = bottom_i > top_j and bottom_j > top_i
            horizontal_overlap = right_i > left_j and right_j > left_i
            if vertical_overlap and horizontal_overlap:
                collisions.append(Collision(i, j))
    return collisions, candidates


def assert_no_overlap(result: LayoutResult) -> None:
    """Raise ``AssertionError`` with diagnostic detail on any overlap."""
    collisions, _ = check_collisions(result)
    if collisions:
        detail = ", ".join(f"lines {c.first}<->{c.second}" for c in collisions)
        raise AssertionError(
            f"subtitle text overlap detected ({detail}) for key={result.key}"
        )


def any_glyph_overlap(lines: tuple[PlacedLine, ...], size: float, gap: float) -> bool:
    """Lightweight predicate used by tests."""
    pitch = size + gap
    for i, line in enumerate(lines):
        for other in lines[i + 1 :]:
            if (
                line.x + line.width > other.x
                and other.x + other.width > line.x
                and (line.line_index * pitch + size) > other.line_index * pitch
            ):
                return True
    return False

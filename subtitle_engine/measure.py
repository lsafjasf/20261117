"""Deterministic text measurement used in place of a platform font API.

A real renderer (e.g. a video pipeline using PIL/Skia/CoreText) would call
into a font shaper for every substring probe while wrapping text.  This module
reproduces that cost model without external dependencies:

* every :class:`TextMeasurer` probe is counted, so cache effectiveness can be
  observed directly through ``measure_calls``;
* CJK ideographs are treated as full-width, Latin/digits as half-width and
* spaces as a quarter-width advance, which makes wrapping behaviour
  distinguishable for Chinese and English inputs.
"""

from __future__ import annotations

from dataclasses import dataclass


def is_cjk(ch: str) -> bool:
    """Return True for full-width CJK ideographs / kana / hangul."""
    code = ord(ch)
    return (
        0x4E00 <= code <= 0x9FFF
        or 0x3040 <= code <= 0x30FF
        or 0xAC00 <= code <= 0xD7AF
        or 0x3400 <= code <= 0x4DBF
        or 0xF900 <= code <= 0xFAFF
    )


@dataclass(frozen=True)
class FontSpec:
    """Identity of a type face.  Two fonts never share metrics."""

    family: str

    def __post_init__(self) -> None:
        if not isinstance(self.family, str) or not self.family:
            raise ValueError("FontSpec.family must be a non-empty string")


class TextMeasurer:
    """Measures substring advances and tracks probe counts."""

    # Per-font shaping multiplier so different fonts produce different widths.
    _FONT_SCALE = {
        "sans": 1.0,
        "serif": 1.08,
        "mono": 1.15,
    }

    def __init__(self) -> None:
        self.measure_calls = 0

    def char_width(self, font: FontSpec, size: float, ch: str) -> float:
        """Advance width of a single character."""
        scale = self._FONT_SCALE.get(font.family, 1.05)
        if ch == " ":
            factor = 0.28
        elif is_cjk(ch):
            factor = 1.0
        else:
            factor = 0.55
        return size * factor * scale

    def text_width(self, font: FontSpec, size: float, text: str) -> float:
        """Measure a whole string.  Each invocation counts as one probe."""
        if not isinstance(text, str):
            raise TypeError(f"text must be str, got {type(text).__name__}")
        if size <= 0:
            raise ValueError(f"font size must be positive, got {size!r}")
        self.measure_calls += 1
        scale = self._FONT_SCALE.get(font.family, 1.05)
        total = 0.0
        for ch in text:
            if ch == " ":
                factor = 0.28
            elif is_cjk(ch):
                factor = 1.0
            else:
                factor = 0.55
            total += size * factor * scale
        return total

    def reset(self) -> None:
        self.measure_calls = 0

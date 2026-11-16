"""Line wrapping and subtitle line layout.

The layout produced here is pure geometry (text, width, x offset) so it can be
rendered by any backend.  Wrapping rules:

* CJK characters may break between any two characters;
* Latin words / digit runs are kept intact and only hard-broken when a single
* word is wider than the box;
* a trailing space never overflows onto its own line.

Alignment only affects the x offset of each placed line, never the set of
lines or their widths.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .measure import FontSpec, TextMeasurer, is_cjk

ALIGN_LEFT = "left"
ALIGN_CENTER = "center"
ALIGN_RIGHT = "right"
ALIGNMENTS = frozenset({ALIGN_LEFT, ALIGN_CENTER, ALIGN_RIGHT})


@dataclass(frozen=True)
class PlacedLine:
    """One wrapped line with its measured width and x offset."""

    text: str
    width: float
    x: float
    line_index: int


@dataclass(frozen=True)
class LayoutResult:
    """Full layout of one subtitle cue."""

    key: "LayoutKey"
    lines: tuple[PlacedLine, ...]
    height: float
    line_gap: float

    def to_geometry(self) -> tuple[tuple[str, float, float, int], ...]:
        """Rendering-independent geometry used for semantic comparisons."""
        return tuple(
            (line.text, round(line.width, 6), round(line.x, 6), line.line_index)
            for line in self.lines
        )


@dataclass(frozen=True)
class LayoutKey:
    """Cache identity: text + font + size + box width + alignment."""

    text: str
    font_family: str
    size: float
    max_width: float
    align: str

    @classmethod
    def create(
        cls,
        text: str,
        font: FontSpec,
        size: float,
        max_width: float,
        align: str,
    ) -> "LayoutKey":
        if not isinstance(text, str):
            raise TypeError(f"text must be str, got {type(text).__name__}")
        if size <= 0:
            raise ValueError(f"font size must be positive, got {size!r}")
        if max_width < 0:
            raise ValueError(f"max_width must be >= 0, got {max_width!r}")
        if align not in ALIGNMENTS:
            raise ValueError(
                f"align must be one of {sorted(ALIGNMENTS)}, got {align!r}"
            )
        return cls(text, font.family, float(size), float(max_width), align)


def _tokenize(text: str) -> list[str]:
    """Split text into break opportunities.

    Every CJK character and every space is its own token; consecutive
    non-breakable Latin/digit characters form a single word token.
    """
    tokens: list[str] = []
    run: list[str] = []
    for ch in text:
        if is_cjk(ch) or ch == " ":
            if run:
                tokens.append("".join(run))
                run = []
            tokens.append(ch)
        else:
            run.append(ch)
    if run:
        tokens.append("".join(run))
    return tokens


def _wrap_tokens(
    tokens: list[str],
    font: FontSpec,
    size: float,
    max_width: float,
    measurer: TextMeasurer,
) -> list[str]:
    """Greedy wrap.  ``measurer`` probes are the expensive operation."""
    lines: list[str] = []
    current = ""
    for token in tokens:
        if not current:
            candidate = token
        else:
            candidate = current + token
        width = measurer.text_width(font, size, candidate)
        if width <= max_width:
            current = candidate
            continue
        if not current:
            # A single token wider than the box: hard-break immediately.
            current = _hard_break(token, font, size, max_width, measurer, lines)
            continue
        # Overflow: start a new line.  A too-wide single word is hard-broken.
        current = _flush(lines, current)
        if measurer.text_width(font, size, token) <= max_width:
            current = token
        else:
            current = _hard_break(token, font, size, max_width, measurer, lines)
    if current or not lines:
        _flush(lines, current)
    # Drop a trailing empty line created by a dangling space.
    while lines and lines[-1] == "":
        lines.pop()
    return lines or [""]


def _flush(lines: list[str], current: str) -> str:
    lines.append(current.rstrip() if current.endswith(" ") else current)
    return ""


def _hard_break(
    word: str,
    font: FontSpec,
    size: float,
    max_width: float,
    measurer: TextMeasurer,
    lines: list[str],
) -> str:
    """Break an over-wide word one character at a time."""
    piece = ""
    for ch in word:
        trial = piece + ch
        if measurer.text_width(font, size, trial) <= max_width or not piece:
            piece = trial
        else:
            _flush(lines, piece)
            piece = ch
    return piece


def _line_x(width: float, max_width: float, align: str) -> float:
    if align == ALIGN_LEFT:
        return 0.0
    if align == ALIGN_RIGHT:
        return max(0.0, max_width - width)
    return max(0.0, (max_width - width) / 2.0)


def compute_layout(
    key: LayoutKey,
    measurer: TextMeasurer,
    line_gap_ratio: float = 0.25,
) -> LayoutResult:
    """Compute geometry for one validated :class:`LayoutKey`."""
    font = FontSpec(key.font_family)
    tokens = _tokenize(key.text)
    wrapped = _wrap_tokens(tokens, font, key.size, key.max_width, measurer)
    placed: list[PlacedLine] = []
    for index, line_text in enumerate(wrapped):
        width = measurer.text_width(font, key.size, line_text)
        placed.append(
            PlacedLine(
                text=line_text,
                width=width,
                x=_line_x(width, key.max_width, key.align),
                line_index=index,
            )
        )
    line_gap = key.size * line_gap_ratio
    height = key.size * len(placed) + line_gap * max(0, len(placed) - 1)
    return LayoutResult(
        key=key,
        lines=tuple(placed),
        height=height,
        line_gap=line_gap,
    )

"""Deterministic subtitle workloads for the three required scenarios.

``build_standard_workload`` mimics a dynamic-caption timeline: a handful of
cues repeat across many frames (the case that caused repeated re-measuring),
interleaved with one-off cues and occasional style changes.  Chinese and
English long strings force multi-line wrapping.

``build_boundary_workload`` deliberately mixes valid edge cases (empty text,
single CJK char, exact-width line, hard-break Latin word) with invalid input
(bad alignment, negative width, non-string text, bad size).
"""

from __future__ import annotations

from .engine import SubtitleCue

CN_LONG = (
    "动态字幕在每一帧重复测量相同文本会造成明显卡顿，"
    "因此需要缓存排版结果并在样式变化时正确失效。"
)
EN_LONG = (
    "Dynamic subtitles repeatedly measure the same text on every frame and "
    "cause frame hitches, so layout results must be cached and invalidated "
    "whenever the style changes."
)
MIXED_LONG = "Mixed 中英文混排 subtitle 混排 wrapping 换行 must keep 每一行 non-overlapping 不重叠。"


def build_standard_workload(frames: int = 120) -> list[list[SubtitleCue]]:
    recurring = [
        SubtitleCue("欢迎观看本次直播", "sans", 24, 300, "center"),
        SubtitleCue(CN_LONG, "sans", 22, 260, "left"),
        SubtitleCue(EN_LONG, "serif", 20, 280, "left"),
        SubtitleCue(MIXED_LONG, "sans", 22, 300, "center"),
    ]
    timeline: list[list[SubtitleCue]] = []
    for frame in range(frames):
        cues = [recurring[frame % len(recurring)]]
        # Every 10 frames a one-off cue appears; every 30 frames the recurring
        # cue restyles, which must miss the cache rather than corrupt output.
        if frame % 10 == 0:
            cues.append(
                SubtitleCue(f"弹幕消息编号 {frame}", "mono", 18, 240, "right")
            )
        if frame % 30 == 0 and frame > 0:
            cues.append(
                SubtitleCue(recurring[frame % len(recurring)].text,
                            "serif", 26, 260, "center")
            )
        timeline.append(cues)
    return timeline


def build_boundary_workload() -> list[list[SubtitleCue]]:
    valid_edges = [
        SubtitleCue("", "sans", 20, 100, "left"),
        SubtitleCue("字", "sans", 20, 5, "left"),
        SubtitleCue("a", "serif", 20, 1, "center"),
        SubtitleCue("supercalifragilisticexpialidocious", "mono", 20, 60, "left"),
        SubtitleCue(CN_LONG, "sans", 22, 80, "right"),
        SubtitleCue("word word word word", "sans", 20, 70, "center"),
    ]
    invalid = [
        SubtitleCue("错误对齐", "sans", 20, 100, "middle"),
        SubtitleCue("负宽度", "sans", 20, -10, "left"),
        SubtitleCue("零号字", "sans", 0, 100, "left"),
    ]
    non_string = SubtitleCue(123, "sans", 20, 100, "left")  # type: ignore[arg-type]
    return [[cue] for cue in [*valid_edges, *invalid, non_string]]

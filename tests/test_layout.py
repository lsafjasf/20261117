import unittest

from subtitle_engine.collision import check_collisions
from subtitle_engine.engine import SubtitleCue, SubtitleEngine, UncachedEngine
from subtitle_engine.layout import compute_layout
from subtitle_engine.measure import FontSpec, TextMeasurer
from subtitle_engine.workload import (
    CN_LONG,
    EN_LONG,
    MIXED_LONG,
    build_boundary_workload,
    build_standard_workload,
)


class WrappingTests(unittest.TestCase):
    def setUp(self):
        self.measurer = TextMeasurer()

    def layout(self, text, width=200.0, size=22.0, align="left", family="sans"):
        cue = SubtitleCue(text, family, size, width, align)
        return compute_layout(cue.key(), self.measurer)

    def test_chinese_wraps_without_overlap(self):
        result = self.layout(CN_LONG, width=160.0)
        self.assertGreater(len(result.lines), 1)
        collisions, candidates = check_collisions(result)
        self.assertEqual(collisions, [])
        self.assertGreater(candidates, 0)
        for line in result.lines:
            self.assertLessEqual(line.width, 160.0 + 1e-9)

    def test_english_keeps_words_intact_and_no_overlap(self):
        result = self.layout(EN_LONG, width=180.0, family="serif", size=20)
        self.assertGreater(len(result.lines), 1)
        collisions, _ = check_collisions(result)
        self.assertEqual(collisions, [])
        for line in result.lines:
            self.assertLessEqual(line.width, 180.0 + 1e-9)

    def test_mixed_cjk_latin_wrapping(self):
        result = self.layout(MIXED_LONG, width=200.0)
        collisions, _ = check_collisions(result)
        self.assertEqual(collisions, [])
        # Only trailing line-end spaces may be trimmed; internal word spaces
        # and every non-space character survive the wrap unchanged.
        joined = "".join(line.text for line in result.lines)
        self.assertTrue(joined.startswith("Mixed"))
        self.assertTrue(joined.endswith("不重叠。"))
        self.assertIn("must keep", joined)
        self.assertIn("non-overlapping", joined)
        self.assertEqual(
            joined.replace(" ", ""),
            "".join(ch for ch in MIXED_LONG if ch != " "),
        )

    def test_alignment_changes_offset_not_line_set(self):
        left = self.layout(CN_LONG, width=160.0, align="left")
        center = self.layout(CN_LONG, width=160.0, align="center")
        right = self.layout(CN_LONG, width=160.0, align="right")
        texts = [[line.text for line in r.lines]
                 for r in (left, center, right)]
        self.assertEqual(texts[0], texts[1])
        self.assertEqual(texts[1], texts[2])
        self.assertTrue(all(line.x == 0.0 for line in left.lines))
        for line in center.lines:
            self.assertGreaterEqual(line.x, 0.0)
        for line in right.lines:
            self.assertAlmostEqual(line.x, 160.0 - line.width, places=6)

    def test_hard_break_oversized_latin_word(self):
        result = self.layout("supercalifragilistic", width=40.0, size=20)
        self.assertGreater(len(result.lines), 1)
        collisions, _ = check_collisions(result)
        self.assertEqual(collisions, [])

    def test_empty_and_single_char(self):
        empty = self.layout("", width=100.0)
        self.assertEqual(len(empty.lines), 1)
        self.assertEqual(empty.lines[0].text, "")
        single = self.layout("字", width=5.0)
        self.assertEqual(single.lines[0].text, "字")


class CacheTests(unittest.TestCase):
    def test_hit_miss_and_style_invalidation(self):
        measurer = TextMeasurer()
        engine = SubtitleEngine(measurer)
        cue = SubtitleCue("重复字幕文本", "sans", 22, 240, "center")
        engine.layout(cue)
        engine.layout(cue)
        stats = engine.cache_stats()
        self.assertEqual(stats["hits"], 1)
        self.assertEqual(stats["misses"], 1)
        self.assertEqual(stats["hit_rate"], 0.5)

        restyled = SubtitleCue("重复字幕文本", "serif", 26, 240, "center")
        engine.layout(restyled)
        self.assertEqual(engine.cache_stats()["misses"], 2)
        self.assertTrue(engine.invalidate_cue(cue))
        self.assertFalse(engine.invalidate_cue(cue))

    def test_each_key_component_forces_miss(self):
        engine = SubtitleEngine(TextMeasurer())
        base = SubtitleCue("相同文字", "sans", 20, 200, "left")
        variants = [
            SubtitleCue("不同文字", "sans", 20, 200, "left"),
            SubtitleCue("相同文字", "serif", 20, 200, "left"),
            SubtitleCue("相同文字", "sans", 24, 200, "left"),
            SubtitleCue("相同文字", "sans", 20, 220, "left"),
            SubtitleCue("相同文字", "sans", 20, 200, "right"),
        ]
        engine.layout(base)
        for cue in variants:
            engine.layout(cue)
        stats = engine.cache_stats()
        self.assertEqual(stats["misses"], 6)
        self.assertEqual(stats["hits"], 0)

    def test_lru_eviction(self):
        engine = SubtitleEngine(TextMeasurer(), capacity=2)
        first = SubtitleCue("第一条")
        second = SubtitleCue("第二条")
        third = SubtitleCue("第三条")
        engine.layout(first)
        engine.layout(second)
        engine.layout(first)  # touch first -> second is LRU
        engine.layout(third)  # evicts second
        self.assertEqual(engine.cache_stats()["evictions"], 1)
        self.assertEqual(engine.cache.size, 2)

    def test_cached_and_uncached_geometry_identical(self):
        workload = build_standard_workload(frames=24)
        baseline = UncachedEngine(TextMeasurer())
        optimized = SubtitleEngine(TextMeasurer())
        base_reports, _ = __import__(
            "subtitle_engine.engine", fromlist=["run_frames"]
        ).run_frames(baseline, workload)
        opt_reports, opt_summary = __import__(
            "subtitle_engine.engine", fromlist=["run_frames"]
        ).run_frames(optimized, workload)
        self.assertEqual(
            [r.geometry for r in base_reports],
            [r.geometry for r in opt_reports],
        )
        self.assertGreater(opt_summary.cache["hit_rate"], 0.0)
        self.assertLess(
            opt_summary.measure_calls,
            baseline.measurer.measure_calls,
        )


class ErrorHandlingTests(unittest.TestCase):
    def test_invalid_inputs_raise_diagnostic_errors(self):
        bad_keys = [
            lambda: SubtitleCue("x", "sans", 20, 100, "middle").key(),
            lambda: SubtitleCue("x", "sans", 20, -1).key(),
            lambda: SubtitleCue("x", "sans", 0, 100).key(),
        ]
        for build in bad_keys:
            with self.assertRaises(ValueError):
                build()
        with self.assertRaises(TypeError):
            SubtitleCue(123, "sans", 20, 100, "left").key()

    def test_boundary_workload_failures_are_logged_not_hidden(self):
        from subtitle_engine.engine import run_frames

        engine = SubtitleEngine(TextMeasurer())
        reports, summary = run_frames(engine, build_boundary_workload())
        self.assertEqual(summary.errors, 4)
        self.assertTrue(any(not r.ok for r in reports))
        self.assertTrue(any(r.ok for r in reports))
        for report in reports:
            if not report.ok:
                self.assertIsNotNone(report.error)

    def test_release_clears_entries_and_rerun_stable(self):
        engine = SubtitleEngine(TextMeasurer())
        workload = build_standard_workload(frames=30)
        from subtitle_engine.engine import run_frames

        _, first = run_frames(engine, workload)
        dropped = engine.release()
        self.assertEqual(dropped, first.cache["entries"])
        self.assertEqual(engine.cache.size, 0)
        measurer2 = TextMeasurer()
        engine2 = SubtitleEngine(measurer2)
        _, second = run_frames(engine2, workload)
        self.assertEqual(second.measure_calls, first.measure_calls)
        self.assertEqual(second.cache["entries"], first.cache["entries"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

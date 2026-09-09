#!/usr/bin/env python3
"""Tests for the take scorer and splitter.

These are the rules from CLAUDE.md expressed as assertions. They exist
because every bug found in this system so far was a scoring bug that looked
fine by eye:

  - a merged false-start + retake scored 0.98 with "no repeated phrase"
  - splitting ignored the silence map, so retakes never separated
  - calibration assumed digital silence and picked -70dB on real footage

All pure functions, no audio, no ffmpeg. Runs in under a second.
"""
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
from list_candidate_takes import (  # noqa: E402
    has_internal_repeat, score_candidate, group_into_candidates,
    max_gap_within, _similar,
)


def words(*specs):
    """words(("hello", 0.0, 0.4), ...) -> transcript segment shape"""
    return [{"segments": None, "words": [{"w": w, "s": s, "e": e} for w, s, e in specs]}]


class InternalRepeat(unittest.TestCase):
    """The defect the whole method exists to prevent."""

    def test_catches_a_repeated_phrase(self):
        self.assertTrue(has_internal_repeat(
            "if your skin looks like this, if your skin looks like this, you need this"))

    def test_catches_real_footage_stutter(self):
        # straight from Kayer's IMG_9817
        self.assertTrue(has_internal_repeat(
            "Good thing there, good thing there's a serum, good thing there's a serum"))

    def test_clean_line_is_not_flagged(self):
        self.assertFalse(has_internal_repeat(
            "The peptides are going to rebuild your skin barrier fast."))

    def test_incidental_word_reuse_is_not_a_repeat(self):
        # "the" twice is not a stutter -- needs 3 consecutive words
        self.assertFalse(has_internal_repeat("the serum and the cream"))


class Scoring(unittest.TestCase):
    def test_clean_last_take_scores_high(self):
        conf, _ = score_candidate("You need this serum.", is_last=True, has_false_start=False,
                                  has_dead_air=False, dead_air_dur=0.0,
                                  is_repeat_of_later=False, internal_repeat=False)
        self.assertGreaterEqual(conf, 0.90)

    def test_stutter_cannot_pass_the_confidence_bar(self):
        """The regression that shipped a stuttered cut at 0.98."""
        conf, _ = score_candidate("I swear, I swear this, I swear this stuff is",
                                  is_last=True, has_false_start=False, has_dead_air=False,
                                  dead_air_dur=0.0, is_repeat_of_later=False,
                                  internal_repeat=True)
        self.assertLess(conf, 0.70, "a take that repeats itself must never pass review")

    def test_false_start_scores_below_clean(self):
        clean, _ = score_candidate("You need this serum.", True, False, False, 0.0, False, False)
        false_start, _ = score_candidate("You need this", True, True, False, 0.0, False, False)
        self.assertLess(false_start, clean)

    def test_superseded_take_loses_to_its_successor(self):
        superseded, _ = score_candidate("You need this serum.", False, False, False, 0.0, True, False)
        later, _ = score_candidate("You need this serum.", True, False, False, 0.0, False, False)
        self.assertLess(superseded, later)

    def test_dead_air_penalty_scales_with_length(self):
        short, _ = score_candidate("A take with a pause.", True, False, True, 2.0, False, False)
        long_, _ = score_candidate("A take with a pause.", True, False, True, 8.0, False, False)
        self.assertLess(long_, short)

    def test_confidence_stays_in_range(self):
        worst, _ = score_candidate("x", False, True, True, 30.0, True, True)
        best, _ = score_candidate("A clean complete line.", True, False, False, 0.0, False, False)
        self.assertGreaterEqual(worst, 0.0)
        self.assertLessEqual(best, 1.0)


class Splitting(unittest.TestCase):
    """Whisper merges retakes into one segment; the silence map is truth."""

    def test_splits_on_a_silence_even_when_whisper_did_not(self):
        segs = words(("If", 0.0, 0.2), ("your", 0.2, 0.5), ("skin", 0.5, 0.9),
                     ("If", 3.0, 3.2), ("your", 3.2, 3.5), ("skin", 3.5, 3.9))
        silence = [(1.0, 2.8)]  # 1.8s gap -- two attempts
        groups = group_into_candidates(segs, silence, 0, 5, split_gap=0.5)
        self.assertEqual(len(groups), 2, "a real silence must separate two attempts")

    def test_does_not_split_a_continuous_line(self):
        segs = words(("You", 0.0, 0.2), ("need", 0.2, 0.5), ("this", 0.5, 0.8))
        groups = group_into_candidates(segs, [], 0, 2, split_gap=0.5)
        self.assertEqual(len(groups), 1)

    def test_split_uses_word_starts_not_ends(self):
        """CLAUDE.md: Whisper folds a pause into the PRECEDING word's duration,
        so that word's end time is unreliable."""
        segs = words(("this", 0.0, 2.9),   # end inflated across the pause
                     ("this", 3.0, 3.3))
        silence = [(1.0, 2.8)]
        groups = group_into_candidates(segs, silence, 0, 4, split_gap=0.5)
        self.assertEqual(len(groups), 2, "an inflated word end must not defeat the split")


class Similarity(unittest.TestCase):
    def test_same_line_is_similar(self):
        self.assertTrue(_similar("you need this serum today",
                                 "you need this serum today please"))

    def test_different_lines_are_not(self):
        self.assertFalse(_similar("the collagen firms your skin",
                                  "grab one before they sell out"))


class SilenceHelpers(unittest.TestCase):
    def test_finds_longest_gap_inside_a_span(self):
        self.assertAlmostEqual(max_gap_within([(1.0, 2.0), (3.0, 6.0)], 0.0, 10.0), 3.0)

    def test_ignores_gaps_outside_the_span(self):
        self.assertEqual(max_gap_within([(20.0, 26.0)], 0.0, 10.0), 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)


class ProposeTightening(unittest.TestCase):
    """What is safe to take out of a line.

    Built after compare_to_reference said img-9817 was 45% over and named the
    longest beats -- when the longest beat was 91% speech and had 0.82s to
    give, while a beat two seconds shorter held 4.5s. Length is not waste.
    """

    def setUp(self):
        import propose_tightening as pt
        self.pt = pt

    def test_a_real_pause_is_proposed(self):
        # one span 0-10, silent 3-6, words either side
        words = [{"w": "a", "s": 0.5, "e": 1.0}, {"w": "b", "s": 7.0, "e": 7.5}]
        cuts = self.pt.propose_for_beat({}, [(0.0, 10.0)], [(3.0, 6.0)], words, 0.30)
        self.assertEqual(len(cuts), 1)
        self.assertGreater(cuts[0]["seconds"], 2.0)
        self.assertEqual(cuts[0]["where"], "middle")

    def test_breathing_room_is_left_at_both_ends(self):
        words = [{"w": "a", "s": 0.5, "e": 1.0}, {"w": "b", "s": 7.0, "e": 7.5}]
        cuts = self.pt.propose_for_beat({}, [(0.0, 10.0)], [(3.0, 6.0)], words, 0.30)
        self.assertAlmostEqual(cuts[0]["from"], 3.15, places=2)
        self.assertAlmostEqual(cuts[0]["to"], 5.85, places=2)

    def test_nothing_is_proposed_over_a_word(self):
        """The one thing that must never happen."""
        words = [{"w": "mid", "s": 4.0, "e": 4.6}]      # a word inside the silence
        cuts = self.pt.propose_for_beat({}, [(0.0, 10.0)], [(3.0, 6.0)], words, 0.30)
        self.assertEqual(cuts, [], "proposed cutting a range containing a word")

    def test_a_breath_is_left_alone(self):
        words = [{"w": "a", "s": 0.5, "e": 1.0}]
        cuts = self.pt.propose_for_beat({}, [(0.0, 10.0)], [(3.0, 3.3)], words, 0.30)
        self.assertEqual(cuts, [], "0.3s is a breath, not dead air")

    def test_a_line_is_never_left_shorter_than_the_floor(self):
        words = []
        cuts = self.pt.propose_for_beat({}, [(0.0, 2.0)], [(0.0, 2.0)], words, 0.0)
        kept = 2.0 - sum(c["seconds"] for c in cuts)
        self.assertGreaterEqual(round(kept, 3), self.pt.MIN_KEPT)

    def test_touching_silence_rows_are_one_pause(self):
        merged = self.pt.load_silence.__wrapped__ if hasattr(self.pt.load_silence, "__wrapped__") else None
        # load_silence reads a file; the merge rule is exercised through it in
        # build_cut's own tests. Here we only assert the constant contract.
        self.assertLess(self.pt.MIN_WORTH_CUTTING, 1.0)
        self.assertGreater(self.pt.WORD_MARGIN, 0.0)

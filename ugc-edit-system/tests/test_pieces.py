"""What survives a cut.

walk_pieces decides which frames of the raw footage end up in the video. A
mistake here does not throw -- it silently ships a cut with a word missing or
a stutter left in. These are the cases that have actually gone wrong.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from build_cut import walk_pieces, base_label      # noqa: E402


def total(pieces):
    return round(sum(b - a for _, a, b in pieces), 3)


class HandCutHoles(unittest.TestCase):
    """A stretch the editor highlighted and deleted."""

    def test_hole_removes_exactly_what_was_highlighted(self):
        pieces, removed, n = walk_pieces("line", 10.0, 14.0, [], [(11.5, 12.2)])
        self.assertEqual(pieces, [("line-0", 10.0, 11.5), ("line-1", 12.2, 14.0)])
        self.assertEqual(round(removed, 3), 0.7)
        self.assertEqual(n, 1)

    def test_the_pieces_butt_together(self):
        pieces, _, _ = walk_pieces("line", 10.0, 14.0, [], [(11.5, 12.2)])
        self.assertEqual(total(pieces), 3.3, "4.0s line, 0.7s hole")

    def test_a_hole_is_not_given_breathing_room(self):
        """A detected pause is trimmed inside its bounds so the cut does not
        sound clipped. A hand-made cut must not be: the editor drew the
        boundary and expects that boundary."""
        pieces, _, _ = walk_pieces("l", 0.0, 10.0, [], [(4.0, 6.0)], keep=0.30)
        self.assertEqual(pieces[0][2], 4.0)
        self.assertEqual(pieces[1][1], 6.0)

    def test_several_holes_all_come_out(self):
        pieces, _, n = walk_pieces("l", 0.0, 10.0, [], [(1, 2), (5, 6)])
        self.assertEqual(n, 2)
        self.assertEqual(total(pieces), 8.0)

    def test_holes_out_of_order_still_come_out_in_order(self):
        pieces, _, _ = walk_pieces("l", 0.0, 10.0, [], [(5, 6), (1, 2)])
        starts = [a for _, a, _ in pieces]
        self.assertEqual(starts, sorted(starts))

    def test_a_hole_outside_the_line_removes_nothing(self):
        pieces, removed, n = walk_pieces("l", 10.0, 14.0, [], [(50, 60)])
        self.assertEqual(n, 0)
        self.assertEqual(removed, 0.0)
        self.assertEqual(total(pieces), 4.0)

    def test_a_hole_is_clamped_to_the_line(self):
        pieces, _, _ = walk_pieces("l", 10.0, 14.0, [], [(13.0, 99.0)])
        self.assertEqual(total(pieces), 3.0)

    def test_detached_audio_keeps_its_picture_whole(self):
        """When the sound is unlocked from the picture the picture is one run,
        or the J/L cut it was detached for stops lining up."""
        pieces, _, n = walk_pieces("l", 0.0, 10.0, [(4, 6)], [(4, 6)], detached=True)
        self.assertEqual(n, 1, "the hand cut still applies")
        pieces, _, n = walk_pieces("l", 0.0, 10.0, [(4, 6)], [], detached=True)
        self.assertEqual(n, 0, "but a detected pause does not")


class DetectedPauses(unittest.TestCase):
    def test_a_pause_is_trimmed_with_room_either_side(self):
        pieces, _, n = walk_pieces("l", 0.0, 10.0, [(4.0, 6.0)], [], keep=0.30)
        self.assertEqual(n, 1)
        self.assertAlmostEqual(pieces[0][2], 4.15, places=3)
        self.assertAlmostEqual(pieces[1][1], 5.85, places=3)

    def test_a_pause_shorter_than_trim_min_is_left_alone(self):
        _, _, n = walk_pieces("l", 0.0, 10.0, [(4.0, 4.2)], [], trim_min=0.35)
        self.assertEqual(n, 0)

    def test_a_pause_at_the_very_edge_is_left_alone(self):
        """Cutting there would eat the first or last word."""
        _, _, n = walk_pieces("l", 0.0, 10.0, [(0.05, 0.5)], [], trim_min=0.35)
        self.assertEqual(n, 0)

    def test_a_line_with_nothing_to_trim_is_one_piece_keeping_its_bare_label(self):
        pieces, _, n = walk_pieces("need-egf", 81.0, 82.0, [], [])
        self.assertEqual(pieces, [("need-egf", 81.0, 82.0)])
        self.assertEqual(n, 0)


class Labels(unittest.TestCase):
    """The regression that made a 2:08 project report as 2:49."""

    def test_a_numbered_beat_is_not_a_piece_of_another_beat(self):
        known = {"need-egf", "need-egf-2"}
        self.assertEqual(base_label("need-egf-2", known), "need-egf-2")

    def test_a_real_piece_maps_back_to_its_beat(self):
        self.assertEqual(base_label("need-egf-1", {"need-egf"}), "need-egf")


if __name__ == "__main__":
    unittest.main()


class HolesAtTheEdges(unittest.TestCase):
    """The bug the clamping test caught: a hole reaching an edge used to be
    skipped in silence, so footage the editor deleted stayed in the cut."""

    def test_a_hole_reaching_the_end_moves_the_out_point(self):
        pieces, removed, n = walk_pieces("l", 10.0, 14.0, [], [(13.0, 99.0)])
        self.assertEqual(pieces, [("l", 10.0, 13.0)])
        self.assertEqual(round(removed, 3), 1.0)
        self.assertEqual(n, 0)

    def test_a_hole_reaching_the_start_moves_the_in_point(self):
        pieces, removed, n = walk_pieces("l", 10.0, 14.0, [], [(0.0, 11.0)])
        self.assertEqual(pieces, [("l", 11.0, 14.0)])
        self.assertEqual(round(removed, 3), 1.0)

    def test_holes_at_both_edges_leave_the_middle(self):
        pieces, _, _ = walk_pieces("l", 10.0, 14.0, [], [(0.0, 11.0), (13.0, 99.0)])
        self.assertEqual(pieces, [("l", 11.0, 13.0)])

    def test_nothing_after_an_end_hole_survives(self):
        pieces, _, _ = walk_pieces("l", 0.0, 10.0, [], [(4.0, 99.0), (6.0, 7.0)])
        self.assertEqual(pieces, [("l", 0.0, 4.0)])


class TrailingPause(unittest.TestCase):
    """A line that ends in a long silence.

    Found by opening img-9817-v4.mp4 and measuring it: ten seconds of dead air
    at 71.8s, in the middle of a 111-second TikTok. The beat `swear-by-glowing`
    ran 428.30-441.46 and the speech stopped at 430.2 -- Whisper had folded the
    whole pause into the duration of the word " of" (11.48s), exactly the
    failure mode CLAUDE.md warns about.

    The silence map knew: silence.txt had 430.246-444.266. walk_pieces threw it
    away, because the pause runs PAST the beat's out-point and the filter
    required it to end inside. A trailing pause is the commonest shape there
    is, and it was the one shape that could not be trimmed.
    """

    def test_a_pause_running_past_the_out_point_is_still_trimmed(self):
        # the real numbers, rounded: speech to 430.2, silence to well past the end
        pieces, removed, _ = walk_pieces(
            "swear-by-glowing", 428.30, 440.75, [(430.246, 444.266)], [], trim_min=0.22)
        kept = total(pieces)
        self.assertLess(kept, 3.0,
                        f"12.45s line with 10s of trailing silence rendered {kept}s")
        self.assertGreater(kept, 1.5, "the words must survive")
        self.assertGreater(removed, 9.0, f"only {removed:.2f}s of dead air removed")

    def test_the_words_before_the_pause_are_kept_whole(self):
        pieces, _, _ = walk_pieces("l", 0.0, 12.0, [(2.0, 20.0)], [], trim_min=0.22, keep=0.30)
        self.assertTrue(pieces, "the line must not vanish")
        self.assertEqual(pieces[0][1], 0.0, "the line still starts where it started")
        self.assertGreaterEqual(pieces[0][2], 2.0, "nothing spoken may be cut off")
        self.assertLess(pieces[0][2], 2.4, "and no more than a breath is kept after it")

    def test_a_pause_over_the_in_point_is_left_to_the_edge_snapper(self):
        """The head has an owner already.

        snap() pulls the in-point in off the silence map before this runs.
        Trimming a leading pause here as well would cut into the first word
        rather than in front of it, which is the defect this whole guard
        exists to prevent -- so a silence touching the in-point is skipped on
        purpose, and only the tail is clipped."""
        pieces, removed, _ = walk_pieces("l", 3.0, 12.0, [(0.0, 5.0)], [], trim_min=0.22)
        self.assertEqual(round(total(pieces), 2), 9.0)
        self.assertEqual(round(removed, 3), 0.0)

    def test_a_silence_that_swallows_the_whole_line_leaves_something(self):
        pieces, _, _ = walk_pieces("l", 5.0, 9.0, [(0.0, 30.0)], [], trim_min=0.22)
        self.assertTrue(pieces, "a line must never render as nothing")
        self.assertGreater(total(pieces), 0.0)

    def test_a_short_trailing_pause_is_left_alone(self):
        """Under trim_min it is a breath, not dead air."""
        pieces, removed, _ = walk_pieces("l", 0.0, 5.0, [(4.9, 9.0)], [], trim_min=0.22)
        self.assertEqual(round(total(pieces), 2), 5.0)
        self.assertEqual(round(removed, 3), 0.0)

    def test_detached_audio_is_still_never_pause_trimmed(self):
        pieces, removed, _ = walk_pieces(
            "l", 0.0, 12.0, [(2.0, 20.0)], [], detached=True, trim_min=0.22)
        self.assertEqual(round(total(pieces), 2), 12.0)
        self.assertEqual(round(removed, 3), 0.0)

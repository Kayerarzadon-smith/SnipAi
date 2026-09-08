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

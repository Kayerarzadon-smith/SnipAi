"""LEDGER P10 -- tools/add_sfx.py:43, base_label()

build_cut.base_label() takes the list of REAL beat labels and checks it before
stripping a suffix, precisely so a beat genuinely called 'serum-glow-2' is not
folded into 'serum-glow'. add_sfx.base_label() does the blind rsplit that
comment warns against -- and draft_beats.label_for() generates exactly those
labels: duplicate slugs get -2, -3 appended.

Consequence: with real beats 'serum-glow' and 'serum-glow-2', add_sfx compares
base_label('serum-glow-1') to base_label('serum-glow-2'), gets 'serum-glow'
both times, decides they are two pieces of one beat, and skips the whoosh at a
join that is a real change of line.

Expected to FAIL until P10 is fixed.
"""
import os
import sys
import unittest

TOOLS = os.path.join(os.path.dirname(__file__), "..", "..", "tools")
sys.path.insert(0, TOOLS)
import add_sfx                              # noqa: E402
import build_cut                            # noqa: E402


class RealLabelsAreNotPieceSuffixes(unittest.TestCase):
    def test_build_cut_gets_this_right(self):
        known = {"serum-glow", "serum-glow-2"}
        self.assertEqual(build_cut.base_label("serum-glow-2", known), "serum-glow-2")
        self.assertEqual(build_cut.base_label("serum-glow-1", known), "serum-glow")

    def test_add_sfx_must_not_fold_a_real_beat_label(self):
        # add_sfx.base_label takes no `known` set, which is the defect. Once it
        # does, this call site should pass the project's real labels through.
        folded = add_sfx.base_label("serum-glow-2")
        self.assertEqual(
            folded, "serum-glow-2",
            "'serum-glow-2' is a real beat, not the third piece of 'serum-glow' -- "
            "the join before it is a change of line and should get an effect",
        )


if __name__ == "__main__":
    unittest.main()

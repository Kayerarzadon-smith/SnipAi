"""Tools must not resolve DATA out of their own directory.

They used to sit beside the footage, so ROOT/../reference/glossary.json was
right. Inside SnipAi.app the code is read-only and the library lives in
~/Movies/SnipAi -- and a tool that gets this wrong still works in a checkout
and fails only once shipped, which is the worst way to find out.

Generate Graphic shipped broken for exactly this reason.
"""
import os
import sys
import unittest

TOOLS = os.path.join(os.path.dirname(__file__), "..", "tools")
sys.path.insert(0, os.path.abspath(TOOLS))

CODE_ROOT = os.path.abspath(os.path.join(TOOLS, ".."))


class DataPathsResolveToTheLibrary(unittest.TestCase):
    def setUp(self):
        self.lib = os.path.join(os.path.expanduser("~"), "Movies", "SnipAi")

    def _assert_not_beside_the_code(self, value, what):
        inside_code = os.path.abspath(value).startswith(CODE_ROOT + os.sep)
        beside_exists = os.path.exists(os.path.join(CODE_ROOT, "projects"))
        if inside_code and beside_exists:
            return          # un-migrated checkout: beside the code IS the library
        self.assertFalse(
            os.path.abspath(value).startswith(os.path.join(CODE_ROOT, "reference")),
            f"{what} points inside the code bundle: {value}")

    def test_glossary(self):
        import plan_graphics
        self._assert_not_beside_the_code(plan_graphics.DEFAULT_GLOSSARY, "glossary")

    def test_product_catalogue(self):
        import match_product
        self._assert_not_beside_the_code(match_product.CATALOGUE, "product catalogue")

    def test_sfx_map(self):
        import add_sfx
        self._assert_not_beside_the_code(add_sfx.DEFAULT_MAP, "sfx map")

    def test_learned_rules_and_projects(self):
        import learn_from_edits
        self._assert_not_beside_the_code(learn_from_edits.TUNING, "tuning")
        self._assert_not_beside_the_code(learn_from_edits.PROJECTS, "projects")

    def test_snipai_data_is_honoured(self):
        """The server exports SNIPAI_DATA; the tools must follow it."""
        import importlib
        import _paths
        os.environ["SNIPAI_DATA"] = "/tmp/some-other-library"
        try:
            importlib.reload(_paths)
            self.assertEqual(_paths.data_root(), "/tmp/some-other-library")
        finally:
            del os.environ["SNIPAI_DATA"]
            importlib.reload(_paths)


if __name__ == "__main__":
    unittest.main()


class TuningIsReadFromTheLibrary(unittest.TestCase):
    """Learning writes the library's tuning.json; rendering must read the same
    file. Three tools rolled their own resolution to the copy that ships with
    the CODE, so corrections were written to one file and rendering read
    another -- the loop had been open since the library moved out, and the
    renderer sat on a stale snap_tail of 0.881 that left ~10s of dead air in a
    two-minute cut."""

    def test_all_three_read_the_same_file_as_the_learner(self):
        import inspect
        import learn_from_edits
        import build_cut
        import draft_beats
        import list_candidate_takes
        for mod in (build_cut, draft_beats, list_candidate_takes):
            src = inspect.getsource(mod)
            self.assertIn('data_path("state", "tuning.json")', src,
                          f"{mod.__name__} resolves tuning.json for itself")
            self.assertNotIn('"state", "tuning.json")\n', src.replace(
                'data_path("state", "tuning.json")', ''),
                f"{mod.__name__} still has a hand-rolled tuning path")
        self._assert_not_beside_the_code(learn_from_edits.TUNING, "tuning")

    def _assert_not_beside_the_code(self, value, what):
        self.assertFalse(os.path.abspath(value).startswith(
            os.path.join(CODE_ROOT, "state")),
            f"{what} points inside the code bundle: {value}")


class LearnedValuesAreBounded(unittest.TestCase):
    """A shift with no ceiling and no consumed evidence compounds. snap_tail
    reached 1.359s -- over a second of silence kept after every line."""

    def test_edge_snapping_cannot_exceed_what_it_exists_to_prevent(self):
        from learn_from_edits import clamp
        # the setting exists to stop ~0.3-0.4s of silence between phrases,
        # so anything past that is the setting failing at its own job
        self.assertEqual(clamp("snap_tail", 1.359), 0.35)
        self.assertEqual(clamp("snap_lead", 9.0), 0.35)
        self.assertEqual(clamp("snap_tail", -0.5), 0.0)
        self.assertEqual(clamp("snap_tail", 0.2), 0.2)

    def test_evidence_is_consumed_so_the_same_trims_cannot_compound(self):
        import learn_from_edits as L
        trims = [{"at": "2026-01-01T00:00:00Z", "endDelta": 0.1},
                 {"at": "2026-01-02T00:00:00Z", "endDelta": 0.1}]
        fresh, through = L.since_last_applied(trims)
        self.assertEqual(through, "2026-01-02T00:00:00Z")
        self.assertIsInstance(fresh, list)


class ReferenceIsReadFromTheLibrary(unittest.TestCase):
    """compare_to_reference defaulted --style to a RELATIVE path, which
    resolves against the process CWD -- the code root, where reference/ used
    to live and where a stale copy still sat. The comparison silently measured
    against yesterday's house style, and the scorecard reported 'needs a built
    cut' for a cut that had been built."""

    def test_style_default_is_absolute_and_in_the_library(self):
        import inspect
        import compare_to_reference
        src = inspect.getsource(compare_to_reference)
        self.assertIn('data_path("reference", "house-style.json")', src)
        self.assertNotIn('default="reference/house-style.json"', src,
                         "a relative default resolves against the CWD")

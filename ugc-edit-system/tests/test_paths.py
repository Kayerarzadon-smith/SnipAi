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
        saved = os.environ.get("SNIPAI_DATA")
        os.environ["SNIPAI_DATA"] = "/tmp/some-other-library"
        try:
            importlib.reload(_paths)
            self.assertEqual(_paths.data_root(), "/tmp/some-other-library")
        finally:
            # Restore, do not delete. Deleting it left every test after this
            # one running against a different library than the suite was
            # started with.
            if saved is None:
                os.environ.pop("SNIPAI_DATA", None)
            else:
                os.environ["SNIPAI_DATA"] = saved
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


class LearningWritesIntoTheLibraryNotTheBundle(unittest.TestCase):
    """data_path()'s docstring promised a copy-on-write -- "copied into the
    library the first time anything writes to it" -- and there was no copy
    anywhere in the file. So on a library with no state/tuning.json yet,
    data_path returned the copy beside the CODE and learn_from_edits.save()
    wrote there: inside SnipAi.app/Contents/Resources/pipeline/state/. Every
    learned correction is then lost on the next ./scripts/bundle-app, the
    library never gains the file, and once the app is signed the write fails
    outright.

    The old test here only checked where tuning is READ from, which passes on
    any machine whose library already has the file -- exactly the machines
    where the bug is invisible."""

    def setUp(self):
        import importlib
        import shutil
        import tempfile
        self.tmp = tempfile.mkdtemp(prefix="snipai-fresh-lib-")
        os.makedirs(os.path.join(self.tmp, "projects"))
        # Put back whatever was there, rather than deleting: a suite run with
        # SNIPAI_DATA already set in the shell must come out of this test with
        # the same environment it went in with.
        self.saved = os.environ.get("SNIPAI_DATA")
        os.environ["SNIPAI_DATA"] = self.tmp
        import _paths
        importlib.reload(_paths)
        self._paths = _paths
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def tearDown(self):
        # learn_from_edits resolves its paths at IMPORT time, so leaving it
        # holding this test's temp library silently repairs the very assertion
        # TuningIsReadFromTheLibrary makes further down the file -- a green
        # suite that means nothing. Reload it back to the real environment.
        import importlib
        import learn_from_edits
        if self.saved is None:
            os.environ.pop("SNIPAI_DATA", None)
        else:
            os.environ["SNIPAI_DATA"] = self.saved
        importlib.reload(self._paths)
        importlib.reload(learn_from_edits)

    def test_a_fresh_library_is_still_where_writes_go(self):
        target = self._paths.data_write_path("state", "tuning.json")
        self.assertTrue(os.path.abspath(target).startswith(self.tmp + os.sep),
                        f"a write target outside the library: {target}")
        self.assertFalse(os.path.abspath(target).startswith(CODE_ROOT + os.sep),
                         f"a write target inside the code bundle: {target}")

    def test_the_shipped_copy_is_seeded_rather_than_edited_in_place(self):
        """The copy-on-write the docstring always claimed. If the app ships a
        starting point, the library gets its own copy of it before anyone
        writes -- so the writer edits the user's file, not the bundle's."""
        beside = os.path.join(CODE_ROOT, "state", "tuning.json")
        if not os.path.exists(beside):
            self.skipTest("no shipped tuning.json to seed from")
        target = self._paths.data_write_path("state", "tuning.json")
        self.assertTrue(os.path.exists(target), "the shipped copy was not seeded")
        self.assertNotEqual(os.path.abspath(target), os.path.abspath(beside))

    def test_the_learner_saves_into_the_library(self):
        import importlib
        import learn_from_edits
        importlib.reload(learn_from_edits)
        written = learn_from_edits.save({"cutting": {"snap_tail": 0.2}}, [])
        self.assertTrue(os.path.abspath(written).startswith(self.tmp + os.sep),
                        f"learned corrections written outside the library: {written}")


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

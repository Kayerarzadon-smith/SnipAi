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

"""verify_removals must hear the difference between a pause and a word.

The check it replaces read the transcript, and the transcript cannot answer
this question: Whisper starts words early and folds pauses into the preceding
word's duration, so a removal overlapping a "word" span may have removed
nothing but air. A QA pass reported 15 word cutoffs on img-9817 that way; all
13 of that project's real removals measure 20-40 dB below its speech.

So the tool listens. This builds footage where the answer is known by
construction -- tone, silence, tone -- and asks it both questions.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

TOOLS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tools"))
sys.path.insert(0, TOOLS)
import verify_removals  # noqa: E402


def have_ffmpeg():
    try:
        subprocess.run([verify_removals.ffmpeg_bin(), "-version"],
                       capture_output=True, timeout=20)
        return True
    except Exception:
        return False


@unittest.skipUnless(have_ffmpeg(), "no ffmpeg available")
class RemovalsAreJudgedByEar(unittest.TestCase):
    """Six seconds: talking, quiet, talking, quiet, talking.

    A 300Hz tone stands in for speech and true digital silence for the pause.
    The gap between them is far wider than any real recording's, which is the
    point: this is testing that the tool reads the audio at all and gets the
    sense of the comparison the right way round, not that it can split hairs.
    """
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="snipai-removals-")
        cls.proj = os.path.join(cls.tmp, "p")
        os.makedirs(os.path.join(cls.proj, "raw"))
        os.makedirs(os.path.join(cls.proj, "work"))
        src = os.path.join(cls.proj, "raw", "t.mp4")
        # tone 0-1, quiet 1-2, tone 2-3, quiet 3-4, tone 4-5
        f = ("sine=frequency=300:duration=5,"
             "volume=enable='between(t,1,2)+between(t,3,4)':volume=0")
        subprocess.run(
            [verify_removals.ffmpeg_bin(), "-nostdin", "-y",
             "-f", "lavfi", "-i", "color=c=black:s=64x64:d=5:r=10",
             "-f", "lavfi", "-i", f,
             "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", src],
            capture_output=True, check=True)
        cls.src = src

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _write(self, pieces):
        """One beat spanning the whole file, rendered as `pieces`."""
        with open(os.path.join(self.proj, "beats.json"), "w") as fh:
            json.dump({"source": "raw/t.mp4",
                       "beats": [{"label": "line", "start": 0.0, "end": 5.0}]}, fh)
        with open(os.path.join(self.proj, "work", "edl.json"), "w") as fh:
            json.dump([{"label": f"line-{i}", "src_start": a, "src_end": b,
                        "dur": round(b - a, 3)}
                       for i, (a, b) in enumerate(pieces)], fh)

    def _run(self):
        return subprocess.run(
            [sys.executable, os.path.join(TOOLS, "verify_removals.py"),
             "--project", self.proj],
            capture_output=True, text=True)

    def test_a_removal_over_the_quiet_part_passes(self):
        # keeps 0-1 and 2-3, removing 1-2, which is the silence
        self._write([(0.0, 1.0), (2.0, 3.0)])
        r = self._run()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Nothing audible was cut", r.stdout)

    def test_a_removal_over_the_talking_fails(self):
        # keeps 1.0-2.0 and 3.0-4.0, removing 2-3, which is a tone
        self._write([(1.0, 2.0), (3.0, 4.0)])
        r = self._run()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("cutting words in half", r.stdout)

    def test_it_says_which_removal(self):
        self._write([(1.0, 2.0), (3.0, 4.0)])
        r = self._run()
        self.assertIn("line", r.stdout)
        self.assertIn("2.000-3.000", r.stdout)

    def test_an_unbuilt_project_is_not_a_failure(self):
        # no edl.json at all: nothing to check is not the same as a bad cut
        empty = os.path.join(self.tmp, "unbuilt")
        os.makedirs(os.path.join(empty, "work"), exist_ok=True)
        r = subprocess.run(
            [sys.executable, os.path.join(TOOLS, "verify_removals.py"),
             "--project", empty],
            capture_output=True, text=True)
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn("has not been built", r.stdout)


if __name__ == "__main__":
    unittest.main()

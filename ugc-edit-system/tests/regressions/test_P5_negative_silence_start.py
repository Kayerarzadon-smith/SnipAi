"""LEDGER P5 -- tools/build_cut.py:22, load_silence()

ffmpeg emits a negative silence_start when the first audio packet has a
negative PTS, which is routine for MOV/MP4 AAC priming delay. The regex is
r"silence_start:\\s*([\\d.]+)" -- it cannot match a minus sign, so that start is
dropped while its end is kept. zip(starts, ends) then pairs everything off by
one, and the intervals come out inverted or spanning speech.

Downstream this is invisible: walk_pieces finds nothing satisfying
(y - x) >= trim_min and snap() finds nothing satisfying x <= s < y, so pause
trimming and edge snapping just quietly stop working on that file.

Expected to FAIL until P5 is fixed.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from build_cut import load_silence      # noqa: E402


class NegativeSilenceStart(unittest.TestCase):
    def _write(self, text):
        fd, p = tempfile.mkstemp(suffix=".txt")
        with os.fdopen(fd, "w") as f:
            f.write(text)
        self.addCleanup(os.unlink, p)
        return p

    def test_a_negative_first_start_does_not_shift_every_pair(self):
        p = self._write(
            "[silencedetect] silence_start: -0.021333\n"
            "[silencedetect] silence_end: 1.5 | silence_duration: 1.52\n"
            "[silencedetect] silence_start: 3.2\n"
            "[silencedetect] silence_end: 4.0 | silence_duration: 0.8\n"
        )
        got = load_silence(p)
        self.assertEqual(len(got), 2, "one start was dropped, so the pairs shifted")
        for start, end in got:
            self.assertLess(start, end, "an interval that ends before it begins is not an interval")
        self.assertAlmostEqual(got[-1][0], 3.2, places=3)
        self.assertAlmostEqual(got[-1][1], 4.0, places=3)


if __name__ == "__main__":
    unittest.main()

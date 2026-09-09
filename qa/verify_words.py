#!/usr/bin/env python3
"""Every word the person said, still in the cut.

The one invariant a trimming change must never break. Trimming pauses makes
the cut tighter; trimming a fraction too far makes it wrong, and the symptom
is a clipped consonant nobody notices until the video is posted.

Compares the beats against the built EDL and reports any spoken word whose
midpoint no longer falls inside a rendered piece. With --against, compares two
EDLs so a change can be judged by what it costs as well as what it saves.

    python3 qa/verify_words.py <project-dir>
    python3 qa/verify_words.py <new-project-dir> --against <old-project-dir>

Read-only.
"""
import argparse
import json
import os
import sys

# Whisper folds a pause into the duration of the preceding word (CLAUDE.md), so
# a long span is a word plus silence, not a long word. Those cannot be used to
# judge coverage -- the pause is exactly what we are trying to remove.
MAX_HONEST_WORD = 0.8

# Whisper also starts words EARLY, and the difference is not small. Measured on
# img-9817: the word " Not" is timestamped 350.640-351.000, but 350.640-350.884
# measures -71.9 dB mean (silence) and the audio from 350.884 measures -19.1 dB
# (speech). snap() moves the in-point onto the speech, which is its job and is
# what CLAUDE.md means by "the silence map is the ground truth".
#
# So a word whose Whisper span is only partly rendered is NOT evidence of a
# clipped word. Judging by these timings alone said 19 words were missing from
# a cut where nothing was missing at all. The absolute count below is an upper
# bound and is labelled as one; the honest test is --against, which compares
# two builds on identical footing and catches a real regression exactly.


def load_words(project):
    with open(os.path.join(project, "work", "transcript.json")) as fh:
        segs = json.load(fh)
    return [w for s in segs for w in s.get("words", [])]


def load_pieces(project):
    with open(os.path.join(project, "work", "edl.json")) as fh:
        e = json.load(fh)
    return e if isinstance(e, list) else e.get("pieces", e.get("edl", []))


def ranges_for(pieces, label):
    return [(p["src_start"], p["src_end"]) for p in pieces
            if p["label"] == label or p["label"].startswith(label + "-")]


def covered(ranges, w, tol=0.02):
    mid = (w["s"] + w["e"]) / 2
    return any(a - tol <= mid <= b + tol for a, b in ranges)


def coverage(project, pieces):
    """Per beat: the words that should be in the cut, and those that are."""
    words = load_words(project)
    with open(os.path.join(project, "beats.json")) as fh:
        beats = json.load(fh)["beats"]
    out = {}
    for b in beats:
        # A word inside a hole was deleted on purpose. Counting those as
        # missing turns every deliberate cut into a false alarm -- it said 19
        # words were gone from img-9817 when the person had removed them.
        holes = b.get("holes") or []
        def in_hole(w):
            mid = (w["s"] + w["e"]) / 2
            return any(f - 0.02 <= mid <= t + 0.02 for f, t in holes)
        mine = [w for w in words
                if w["s"] >= b["start"] - 0.05 and w["e"] <= b["end"] + 0.05
                and (w["e"] - w["s"]) < MAX_HONEST_WORD and w["w"].strip()
                and not in_hole(w)]
        rs = ranges_for(pieces, b["label"])
        out[b["label"]] = (mine, [w for w in mine if covered(rs, w)])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--against", help="an older copy of the same project to compare with")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    pieces = load_pieces(proj)
    here = coverage(proj, pieces)

    missing = 0
    for label, (mine, got) in here.items():
        if len(got) < len(mine):
            gone = [w["w"].strip() for w in mine if w not in got]
            print(f"  MISSING  {label}: {gone}")
            missing += len(mine) - len(got)

    total = sum(len(m) for m, _ in here.values())
    kept = sum(len(g) for _, g in here.values())
    print(f"\n{kept} of {total} spoken words are in the cut"
          f"  ({sum(p['dur'] for p in pieces):.2f}s over {len(pieces)} pieces)")

    if a.against:
        old = load_pieces(a.against.rstrip("/"))
        # words are judged against THIS project's transcript and beats, so the
        # two runs are compared on the same footing
        before = coverage(proj, old)
        lost = 0
        for label, (mine, got) in here.items():
            was = before.get(label, ([], []))[1]
            if len(got) < len(was):
                gone = [w["w"].strip() for w in was if w not in got]
                print(f"  LOST vs baseline  {label}: {gone}")
                lost += len(was) - len(got)
        oldlen = sum(p["dur"] for p in old)
        newlen = sum(p["dur"] for p in pieces)
        print(f"length {oldlen:.2f}s -> {newlen:.2f}s  ({oldlen - newlen:+.2f}s)")
        print(f"words lost against the baseline: {lost}")
        return 1 if lost else 0

    if missing:
        print(f"\n{missing} word(s) are only partly inside a rendered piece.")
        print("This is an UPPER BOUND, not a defect list: Whisper starts words")
        print("early, and snap() deliberately moves the in-point onto the speech.")
        print("Use --against <an older build> to judge whether a change lost anything.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

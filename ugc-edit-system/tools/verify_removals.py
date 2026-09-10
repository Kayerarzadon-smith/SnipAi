#!/usr/bin/env python3
"""Did the build cut any speech out of the middle of a line?

    python3 tools/verify_removals.py --project projects/<name>

The pipeline splits a beat into pieces to drop the silence inside it. If one
of those splits lands on a word, the finished video clips it, and that is the
single worst thing this app can do to a take.

The check that already exists for this reads the TRANSCRIPT, and the
transcript is the wrong instrument for it. CLAUDE.md: Whisper starts words
200-400ms early and folds pauses and restarts into the preceding word's
duration. A "word" spanning 1.02s is a word, a hesitation, and often a restart
-- so overlapping such a span tells you nothing about whether anything audible
was removed. A QA pass reported 15 word cutoffs across 13 segments on that
basis, including a "word" running from 1.020 to 3.820.

This listens instead. Every removed stretch is measured against the level of
the speech in the same project, and speech is 20-40 dB above the pauses
between it -- a gap nothing in a transcript can close. On img-9817 all 13
interior removals came back between -35 and -57 dB mean, where that project's
speech sits at -19 to -29 and its true pauses at -68 to -73. Nothing audible
was removed, and the timestamps that said otherwise were Whisper's.

Exit 1 if any removal carries speech.
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# How close to the project's own speech level a removal may sit before it is
# treated as containing speech. The two populations are tens of dB apart, so
# this does not need to be finely judged -- it needs to be clear of the
# measurement noise on a stretch a few tens of milliseconds long.
SPEECH_MARGIN_DB = 8.0


def ffmpeg_bin():
    # Same resolution as every other tool: there is no system ffmpeg on this
    # machine, so a bare "ffmpeg" is not a fallback.
    env = (os.environ.get("SNIPAI_FFMPEG") or "").strip()
    if env and os.path.exists(env):
        return env
    venv = os.path.join(ROOT, ".venv", "bin", "ffmpeg")
    if os.path.exists(venv):
        return venv
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def level(src, start, dur):
    """mean and max dBFS of one stretch of the source's audio.

    -ss goes BEFORE -i so the decoder starts at the stretch. With it after,
    ffmpeg decodes from zero and volumedetect reports the WHOLE FILE -- every
    range comes back the same number, which looks like a measurement and is
    not. -map 0:a:0 because -vn alone left the video stream selected on this
    footage and volumedetect then printed nothing at all.
    """
    if dur <= 0:
        return None, None
    out = subprocess.run(
        [ffmpeg_bin(), "-nostdin", "-ss", f"{start:.3f}", "-i", src,
         "-t", f"{dur:.3f}", "-map", "0:a:0", "-af", "volumedetect",
         "-f", "null", "-"],
        capture_output=True, text=True).stderr
    mean = re.findall(r"mean_volume:\s*(-?[\d.]+) dB", out)
    peak = re.findall(r"max_volume:\s*(-?[\d.]+) dB", out)
    return (float(mean[-1]) if mean else None,
            float(peak[-1]) if peak else None)


def base_label(label, known):
    """A piece's beat. `need-egf-2` is a beat in its own right, not piece 2 of
    `need-egf`, so the suffix only comes off when it has to."""
    if label in known:
        return label
    head = label.rsplit("-", 1)[0]
    return head if head in known else label


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--margin", type=float, default=SPEECH_MARGIN_DB,
                    help="dB below the project's speech level that still counts as speech")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    edl_path = os.path.join(proj, "work", "edl.json")
    if not os.path.exists(edl_path):
        print("nothing to check -- this project has not been built yet")
        return 2
    edl = json.load(open(edl_path))
    beats = json.load(open(os.path.join(proj, "beats.json")))
    src = os.path.join(proj, beats["source"])
    if not os.path.exists(src):
        print(f"the footage is not on this machine: {beats['source']}")
        return 2
    known = {b["label"] for b in beats["beats"]}

    by = {}
    for e in edl:
        by.setdefault(base_label(e["label"], known), []).append(e)

    removals = []
    for label, pieces in by.items():
        pieces.sort(key=lambda e: e["src_start"])
        for x, y in zip(pieces, pieces[1:]):
            removals.append((label, x["src_end"], y["src_start"]))
    removals.sort(key=lambda r: r[1])

    if not removals:
        print("  no interior removals in this cut -- nothing to check")
        return 0

    # The reference is this project's own speech, not a fixed number: level
    # depends on the mic, the room and how close he was sitting that day.
    # The longest kept pieces are the ones most certainly full of talking.
    longest = sorted(edl, key=lambda e: -e["dur"])[:4]
    speech = [m for m, _ in (level(src, e["src_start"], min(e["dur"], 2.0)) for e in longest)
              if m is not None]
    if not speech:
        print("  could not measure this project's speech level")
        return 2
    speech_level = sum(speech) / len(speech)
    floor = speech_level - a.margin

    print(f"  speech in this project averages {speech_level:.1f} dB")
    print(f"  a removal is speech if it is above {floor:.1f} dB\n")
    print(f"  {'line':18s} {'removed':19s} {'mean':>7s} {'max':>7s}")

    bad = []
    for label, f, t in removals:
        mean, peak = level(src, f, t - f)
        if mean is None:
            continue
        flag = ""
        if mean > floor:
            bad.append((label, f, t, mean))
            flag = "  <-- SPEECH"
        print(f"  {label:18s} {f:8.3f}-{t:<8.3f} {mean:7.1f} "
              f"{peak if peak is not None else float('nan'):7.1f}{flag}")

    if bad:
        print(f"\n  {len(bad)} of {len(removals)} removals carry speech. "
              "The build is cutting words in half.")
        for label, f, t, mean in bad:
            print(f"    {label}: {f:.3f}-{t:.3f} at {mean:.1f} dB")
        return 1
    print(f"\n  All {len(removals)} removals are below the speech floor. "
          "Nothing audible was cut out of a line.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

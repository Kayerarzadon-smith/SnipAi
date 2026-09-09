#!/usr/bin/env python3
"""Compare a built cut against the measured house style.

    python3 tools/compare_to_reference.py --project projects/medicube-egf-serum

Reads the project's work/edl.json and reference/house-style.json and reports
where this cut sits against the reference: total length, number of cuts, and
beat length. Flags anything outside tolerance.

This is a check, not a corrector. It tells you the cut is running long or the
beats are sitting twice as long as the reference's; deciding what to drop or
tighten is yours.
"""
import argparse, json, os, statistics, sys
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import data_path  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    # Absolute, from the library. A relative default resolves against the
    # process CWD, which is the code root -- where reference/ used to live and
    # where a stale copy still sat, so the comparison silently measured
    # against yesterday's house style, or nothing at all.
    ap.add_argument("--style", default=data_path("reference", "house-style.json"))
    a = ap.parse_args()

    ref = json.load(open(a.style))
    proj = a.project.rstrip("/")

    edl = json.load(open(os.path.join(proj, "work", "edl.json")))


    # a "beat" is one line; build_cut may split it into pieces at pause trims
    beats = {}
    for p in edl:
        label = p["label"].rsplit("-", 1)[0] if p["label"][-1].isdigit() else p["label"]
        beats[label] = beats.get(label, 0.0) + p["dur"]
    durs = sorted(beats.values())
    total = sum(durs)

    # How fast the read is, which is the number that explains a long cut when
    # there is no silence left to take out. CLAUDE.md: "a runtime gap is often
    # the read, not the edit." Without this the report points at the longest
    # beats, and the longest beat is frequently the one with the least to give.
    wps = None
    tpath = os.path.join(proj, "work", "transcript.json")
    if os.path.exists(tpath):
        try:
            segs = json.load(open(tpath))
            words = [w for sg in segs for w in sg.get("words", []) if w.get("w", "").strip()]
            spans = [(p["src_start"], p["src_end"]) for p in edl]
            kept = [w for w in words
                    if any(x - 0.02 <= (w["s"] + w["e"]) / 2 <= y + 0.02 for x, y in spans)]
            if total > 0 and kept:
                wps = len(kept) / total
        except Exception:
            wps = None

    # Read the house style defensively.
    #
    # It is composed by two different writers -- measure_finished.py and the
    # Settings screen's reference route -- and the route builds it by
    # spreading whatever was there before. On a FRESH library there is no
    # "before", so it wrote a style with no `tolerance` at all, and
    #
    #     ref["tolerance"]["duration_pct"]
    #
    # raised KeyError on every build from then on. The render still finished,
    # the job still said done at 100%, and the traceback ended up displayed as
    # the job's current stage. A missing number is not a reason to take down
    # the step that reports on it.
    tol = ref.get("tolerance") or {}
    seg = ref.get("segment_seconds") or {}

    def cmp_row(name, mine, theirs, unit="", tol_pct=None):
        return (name, mine, theirs if isinstance(theirs, (int, float)) else None, unit, tol_pct)

    rows = [
        cmp_row("total length",    total,                    ref.get("duration"),  "s", tol.get("duration_pct")),
        cmp_row("cuts",            float(len(edl)),          ref.get("segments"),  ""),
        cmp_row("beats",           float(len(beats)),        None,                 ""),
        cmp_row("median beat",     statistics.median(durs),  seg.get("median"),    "s", tol.get("median_segment_pct")),
        cmp_row("longest beat",    durs[-1],                 seg.get("max"),       "s"),
        cmp_row("seconds per cut", total / max(len(edl), 1), ref.get("seconds_per_cut"), "s"),
    ]

    missing = [n for n, _, t, _, _ in rows if t is None and n != "beats"]
    if len(missing) >= 4:
        print("The house style has almost nothing measured in it yet.")
        print("Settings -> Style references: add a raw take and your finished")
        print("edit of it, and this will have something to compare against.")
        return 0
    if wps is not None and ref.get("words_per_second"):
        rows.append(("words per second", wps, ref["words_per_second"], "", 15))

    print(f"{'':18s} {'this cut':>10s} {'reference':>10s}")
    flags = []
    for name, mine, theirs, unit, tol in rows:
        t = f"{theirs:.2f}{unit}" if theirs is not None else "--"
        mark = ""
        if theirs and tol:
            off = abs(mine - theirs) / theirs * 100
            if off > tol:
                mark = f"   <-- {off:.0f}% off"
                flags.append((name, mine, theirs, off))
        print(f"  {name:16s} {mine:9.2f}{unit} {t:>10s}{mark}")

    print()
    judged = [n for n, _, t, _, tp in rows if t is not None and tp]
    if not flags and not judged:
        # Nothing to judge by. Saying "in line with the reference" here would
        # be a pass awarded for the absence of a standard.
        print("No tolerances in the house style, so nothing here is a verdict --")
        print("these are just the two sets of numbers side by side.")
    elif not flags:
        print("In line with the reference.")
    else:
        for name, mine, theirs, off in flags:
            direction = "longer" if mine > theirs else "shorter"
            print(f"{name}: {off:.0f}% {direction} than the reference.")
        # Say what the gap is MADE of before naming beats to cut. If the read
        # is slow, no amount of trimming reaches the reference, and pointing
        # at the longest lines sends you to cut the ones with the least to
        # give -- on img-9817 the longest beat is 91% speech.
        if wps is not None and ref.get("words_per_second"):
            slower = (ref["words_per_second"] - wps) / ref["words_per_second"] * 100
            if slower > 10:
                at_ref = total * wps / ref["words_per_second"]
                print(f"\nThe read is {slower:.0f}% slower than the reference "
                      f"({wps:.2f} vs {ref['words_per_second']:.2f} words/sec).")
                print(f"The same words at that pace would run {at_ref:.1f}s, "
                      f"against {ref['duration']:.1f}s.")
                print("That part is the delivery, not the edit -- "
                      "run propose_tightening.py to see what silence is left.")

        print("\nLongest beats, if you need to cut length:")
        for label, d in sorted(beats.items(), key=lambda kv: -kv[1])[:5]:
            print(f"  {label:22s} {d:5.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

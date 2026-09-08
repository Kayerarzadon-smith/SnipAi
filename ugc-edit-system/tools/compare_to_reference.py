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


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--style", default="reference/house-style.json")
    a = ap.parse_args()

    ref = json.load(open(a.style))
    edl = json.load(open(os.path.join(a.project.rstrip("/"), "work", "edl.json")))

    # a "beat" is one line; build_cut may split it into pieces at pause trims
    beats = {}
    for p in edl:
        label = p["label"].rsplit("-", 1)[0] if p["label"][-1].isdigit() else p["label"]
        beats[label] = beats.get(label, 0.0) + p["dur"]
    durs = sorted(beats.values())
    total = sum(durs)

    rows = [
        ("total length",     total,                       ref["duration"],                    "s",  ref["tolerance"]["duration_pct"]),
        ("cuts",             float(len(edl)),             float(ref["segments"]),             "",   None),
        ("beats",            float(len(beats)),           None,                               "",   None),
        ("median beat",      statistics.median(durs),     ref["segment_seconds"]["median"],   "s",  ref["tolerance"]["median_segment_pct"]),
        ("longest beat",     durs[-1],                    ref["segment_seconds"]["max"],      "s",  None),
        ("seconds per cut",  total / max(len(edl), 1),    ref["seconds_per_cut"],             "s",  None),
    ]

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
    if not flags:
        print("In line with the reference.")
    else:
        for name, mine, theirs, off in flags:
            direction = "longer" if mine > theirs else "shorter"
            print(f"{name}: {off:.0f}% {direction} than the reference.")
        print("\nLongest beats, if you need to cut length:")
        for label, d in sorted(beats.items(), key=lambda kv: -kv[1])[:5]:
            print(f"  {label:22s} {d:5.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Compare a built cut against the measured house style.

    python3 tools/compare_style.py --project projects/<name>

Two different things get counted, and mixing them up is misleading:

  cut   -- one continuous piece of footage between two hard cuts. This is what
           align_reference.py counts in the reference (34 of them).
  beat  -- one line of the script. A beat becomes several cuts when pauses
           inside it are trimmed, so beats are always fewer and longer.

The reference's "median 1.95s" is a median CUT length, so it must be compared
with our median cut, not our median beat. Replaces compare_to_reference.py.
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

    cuts = sorted(p["dur"] for p in edl)
    beats = {}
    for p in edl:
        lab = p["label"].rsplit("-", 1)[0] if p["label"][-1].isdigit() else p["label"]
        beats[lab] = beats.get(lab, 0.0) + p["dur"]
    bd = sorted(beats.values())
    total = sum(cuts)
    rs = ref["segment_seconds"]

    print(f"{'':20s} {'this cut':>10s} {'reference':>10s}")
    rows = [
        ("total length",   f"{total:.2f}s",                 f"{ref['duration']:.2f}s",  ref["tolerance"]["duration_pct"], total, ref["duration"]),
        ("cuts",           f"{len(cuts)}",                  f"{ref['segments']}",       None, None, None),
        ("median cut",     f"{statistics.median(cuts):.2f}s", f"{rs['median']:.2f}s",   ref["tolerance"]["median_segment_pct"], statistics.median(cuts), rs["median"]),
        ("shortest cut",   f"{cuts[0]:.2f}s",               f"{rs['min']:.2f}s",        None, None, None),
        ("longest cut",    f"{cuts[-1]:.2f}s",              f"{rs['max']:.2f}s",        None, None, None),
        ("seconds per cut", f"{total/len(cuts):.2f}s",      f"{ref['seconds_per_cut']:.2f}s", None, None, None),
        ("beats (lines)",  f"{len(bd)}",                    "--",                       None, None, None),
        ("median beat",    f"{statistics.median(bd):.2f}s", "--",                       None, None, None),
    ]
    flags = []
    for name, mine, theirs, tol, mv, tv in rows:
        mark = ""
        if tol and mv and tv:
            off = abs(mv - tv) / tv * 100
            if off > tol:
                mark = f"   <-- {off:.0f}% off"
                flags.append((name, mv, tv, off))
        print(f"  {name:18s} {mine:>10s} {theirs:>10s}{mark}")

    print()
    if not flags:
        print("In line with the reference.")
    else:
        for name, mv, tv, off in flags:
            print(f"{name}: {off:.0f}% {'longer' if mv > tv else 'shorter'} than the reference.")
        print("\nLongest beats, if you need to lose length:")
        for lab, d in sorted(beats.items(), key=lambda kv: -kv[1])[:5]:
            print(f"  {lab:22s} {d:5.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

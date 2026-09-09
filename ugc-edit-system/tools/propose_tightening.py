#!/usr/bin/env python3
"""What to take out to reach the house style, line by line.

    python3 tools/propose_tightening.py --project projects/<name>

compare_to_reference.py says the cut is 45% longer than the reference and
names the longest beats. That is the wrong list. On img-9817 the longest beat
runs 8.88s and is 91% speech -- there is nothing in it to give -- while a beat
two seconds shorter is 34% speech and holds 4.5 seconds of silence.

Length is not waste. Silence is waste. This ranks by what can actually be
recovered, finds where in the line it sits, and proposes a specific cut for
each one.

NOTHING IS WRITTEN. This prints a proposal. Applying it is a separate,
deliberate act -- because deciding a line is too long is an editorial call and
belongs to the person, not to a number.

Safety, in order of how badly each would hurt:

  * A proposed cut may never contain a word. Every range is checked against
    the transcript with a margin, and against the silence map, and it has to
    satisfy both.
  * A cut is never taken flush. `keep` leaves breathing room at each end,
    the same as build_cut's own pause trimming, because a cut landing exactly
    on the consonant sounds clipped.
  * A line must survive. Nothing is proposed that would leave less than
    MIN_KEPT of it.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import data_path  # noqa: E402

MIN_KEPT = 0.15
# Under this, a gap is a breath and taking it out makes the read sound hurried.
MIN_WORTH_CUTTING = 0.35
# Whisper starts words early and folds pauses into the preceding word's
# duration (see CLAUDE.md), so a word's stated span is not trustworthy at its
# edges. Stay this far clear of every word.
WORD_MARGIN = 0.12


def load_silence(path):
    """Silence rows, merged where they touch -- one pause reported as several
    rows is still one pause. Same rule as build_cut.merge_touching."""
    if not os.path.exists(path):
        return []
    txt = open(path).read()
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?[\d.]+)", txt)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", txt)]
    out = []
    for a, b in sorted(zip(starts, ends)):
        if out and a <= out[-1][1] + 0.02:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def load_words(path):
    with open(path) as fh:
        segs = json.load(fh)
    return [w for s in segs for w in s.get("words", []) if w.get("w", "").strip()]


def rendered_spans(pieces, label):
    """Where this beat's surviving film sits in the source."""
    return [(p["src_start"], p["src_end"]) for p in pieces
            if p["label"] == label or p["label"].startswith(label + "-")]


def free_of_words(a, b, words):
    """Is this range clear of every word, with margin?"""
    for w in words:
        if w["e"] + WORD_MARGIN > a and w["s"] - WORD_MARGIN < b:
            return False
    return True


def propose_for_beat(beat, spans, sil, words, keep):
    """The cuts worth making inside one line, largest first.

    Only stretches the silence map calls silent AND the transcript agrees
    carry no speech. Each is pulled in by keep/2 at both ends so the join does
    not sound clipped.
    """
    if not spans:
        return []
    rendered = sum(b - a for a, b in spans)
    out = []
    for a, b in spans:
        for x, y in sil:
            lo, hi = max(x, a), min(y, b)
            if hi - lo < MIN_WORTH_CUTTING + keep:
                continue
            co, ci = round(lo + keep / 2, 3), round(hi - keep / 2, 3)
            if ci - co < MIN_WORTH_CUTTING:
                continue
            if not free_of_words(co, ci, words):
                continue
            out.append({"from": co, "to": ci, "seconds": round(ci - co, 3),
                        "where": ("head" if lo - a < 0.25 else
                                  "tail" if b - hi < 0.25 else "middle")})
    out.sort(key=lambda c: -c["seconds"])
    # never propose so much that the line stops being a line
    kept = rendered
    keepable = []
    for c in out:
        if kept - c["seconds"] < MIN_KEPT:
            continue
        keepable.append(c)
        kept -= c["seconds"]
    return keepable


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--style", default=data_path("reference", "house-style.json"))
    ap.add_argument("--keep", type=float, default=0.30,
                    help="breathing room left at each end of a cut")
    ap.add_argument("--json", action="store_true", help="machine-readable, for the app")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    work = os.path.join(proj, "work")
    edl_path = os.path.join(work, "edl.json")
    if not os.path.exists(edl_path):
        print("nothing to tighten -- this project has not been built yet")
        return 2

    edl = json.load(open(edl_path))
    pieces = edl if isinstance(edl, list) else edl.get("pieces", edl.get("edl", []))
    beats = json.load(open(os.path.join(proj, "beats.json")))["beats"]
    words = load_words(os.path.join(work, "transcript.json"))
    sil = load_silence(os.path.join(work, "silence.txt"))
    style = json.load(open(a.style)) if os.path.exists(a.style) else {}

    total = round(sum(p["dur"] for p in pieces), 2)
    target = style.get("duration")
    tol = (style.get("tolerance") or {}).get("duration_pct", 20)

    rows = []
    for b in beats:
        spans = rendered_spans(pieces, b["label"])
        if not spans:
            continue
        rendered = round(sum(y - x for x, y in spans), 3)
        mine = [w for w in words
                if w["s"] >= b["start"] - 0.05 and w["e"] <= b["end"] + 0.05]
        spoken = round(sum(w["e"] - w["s"] for w in mine), 3)
        cuts = propose_for_beat(b, spans, sil, mine, a.keep)
        rows.append({
            "label": b["label"], "text": (b.get("text") or "")[:70],
            "rendered": rendered, "spoken": spoken,
            "speech_pct": round(100 * spoken / rendered) if rendered else 0,
            "recoverable": round(sum(c["seconds"] for c in cuts), 3),
            "cuts": cuts,
        })

    rows.sort(key=lambda r: -r["recoverable"])
    savings = round(sum(r["recoverable"] for r in rows), 2)
    after = round(total - savings, 2)

    if a.json:
        print(json.dumps({
            "total": total, "target": target, "tolerance_pct": tol,
            "savings": savings, "after": after,
            "within_tolerance_after": (target is not None
                                       and after <= target * (1 + tol / 100)),
            "beats": [r for r in rows if r["cuts"]],
        }, indent=1))
        return 0

    print(f"  this cut       {total:6.2f}s")
    if target:
        over = 100 * (total - target) / target
        print(f"  house style    {target:6.2f}s   ({over:+.0f}%)")
    print()
    if not any(r["cuts"] for r in rows):
        print("  Nothing safe to take out. Every silence left is either shorter than")
        print(f"  {MIN_WORTH_CUTTING}s -- a breath, not dead air -- or too close to a word.")
        print("  What is left is the read itself; shortening it is an editorial call.")
        return 0

    print("  Worth taking out, most first. Silence only -- no proposal here touches a word.\n")
    print(f"  {'line':24s} {'now':>6s} {'speech':>7s} {'save':>6s}  where")
    for r in rows:
        if not r["cuts"]:
            continue
        where = ", ".join(f"{c['seconds']:.2f}s {c['where']}" for c in r["cuts"][:3])
        print(f"  {r['label']:24s} {r['rendered']:6.2f} {r['speech_pct']:6d}% "
              f"{r['recoverable']:6.2f}  {where}")

    print(f"\n  {savings:.2f}s to recover -> {after:.2f}s")
    if target:
        if after <= target * (1 + tol / 100):
            print(f"  That lands inside your house style ({target:.2f}s +{tol}%).")
        else:
            still = 100 * (after - target) / target
            print(f"  Still {still:.0f}% over {target:.2f}s. The rest is the read, not the silence --")
            print("  reaching the reference from here means saying less, not cutting tighter.")
    print("\n  Nothing has been written. --json gives the same thing for the app.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

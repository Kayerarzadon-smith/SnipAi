#!/usr/bin/env python3
"""Turn Kayer's corrections into corrected parameters.

    python3 tools/learn_from_edits.py                 # show what the edits imply
    python3 tools/learn_from_edits.py --apply         # write it into state/tuning.json

Every time a different take is picked than the one recommended, that is a
labelled example: the scorer ranked them in an order a human disagreed with.
Enough of those in the same direction and the weights are measurably wrong.

This reads every project's review-state.json, finds the overrides, and works
out which scoring rule was responsible each time -- the rejected take and the
chosen one differ by some set of flags, and the flags that keep showing up on
the CHOSEN side are the ones being over-penalised.

It proposes, it does not decide. Nothing changes without --apply, and every
proposal carries the count behind it, because two examples is a coincidence
and twenty is a preference.
"""
import argparse, json, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import data_path  # noqa: E402
TUNING = data_path("state", "tuning.json")
PROJECTS = data_path("projects")

# which scoring knob each flag corresponds to
FLAG_TO_PENALTY = {
    "internal_repeat": "penalty_internal_repeat",
    "superseded_by_later_take": "penalty_superseded",
    "false_start": "penalty_false_start",
    "incomplete_sentence": "penalty_incomplete",
}
# minimum examples before a proposal is worth making
MIN_EVIDENCE = 3
STEP = 0.05


def flag_kind(flag):
    if flag.startswith("dead_air"):
        return "dead_air"
    return flag


def collect_overrides():
    """Every case where the take chosen was not the one recommended."""
    overrides = []
    if not os.path.isdir(PROJECTS):
        return overrides
    for name in sorted(os.listdir(PROJECTS)):
        if name.startswith("_"):
            continue
        state_path = os.path.join(PROJECTS, name, "review-state.json")
        if not os.path.exists(state_path):
            continue
        try:
            state = json.load(open(state_path))
        except Exception:
            continue
        cache = state.get("candidateCache", {})
        for label, pick in (state.get("takePicks") or {}).items():
            entry = cache.get(label)
            if not entry:
                continue
            rec_id = entry.get("recommendedId")
            chosen_id = pick.get("chosenId")
            if not rec_id or not chosen_id or rec_id == chosen_id:
                continue
            by_id = {c["id"]: c for c in entry.get("candidates", [])}
            rec, chosen = by_id.get(rec_id), by_id.get(chosen_id)
            if not rec or not chosen:
                continue
            overrides.append({
                "project": name, "beat": label,
                "recommended": rec, "chosen": chosen,
            })
    return overrides


def collect_trims():
    """Every manual in/out adjustment across all projects."""
    trims = []
    if not os.path.isdir(PROJECTS):
        return trims
    for name in sorted(os.listdir(PROJECTS)):
        if name.startswith("_"):
            continue
        sp = os.path.join(PROJECTS, name, "review-state.json")
        if not os.path.exists(sp):
            continue
        try:
            for t in (json.load(open(sp)).get("trimEdits") or []):
                t["project"] = name
                trims.append(t)
        except Exception:
            continue
    return trims


def since_last_applied(trims):
    """Only the corrections that have not already been learned from.

    Proposals are SHIFTS, and learning now runs after every edit, so the same
    handful of trims was being applied again and again -- eleven times over,
    in the case that put snap_tail at 1.359s. A shift has to consume its
    evidence or it is not learning, it is compounding.
    """
    mark = ""
    try:
        with open(TUNING) as f:
            mark = (json.load(f).get("learned_through") or "")
    except Exception:
        pass
    fresh = [t for t in trims if str(t.get("at") or "") > mark]
    return fresh, max([str(t.get("at") or "") for t in trims] or [mark])


def collect_regions():
    """Every stretch cut out of the middle of a line."""
    out = []
    if not os.path.isdir(PROJECTS):
        return out
    for name in sorted(os.listdir(PROJECTS)):
        if name.startswith("_"):
            continue
        sp = os.path.join(PROJECTS, name, "review-state.json")
        if not os.path.exists(sp):
            continue
        try:
            for r in (json.load(open(sp)).get("cutRegions") or []):
                r["project"] = name
                out.append(r)
        except Exception:
            continue
    return out


# words that carry no meaning and are usually cut on sight
FILLERS = {"um", "uh", "like", "you", "know", "so", "basically", "literally",
           "actually", "right", "okay", "ok", "yeah", "i", "mean", "just"}


def analyse_regions(regions, min_evidence):
    """What the cut-out stretches have in common.

    Two patterns are worth acting on. If the removed stretches are mostly
    silence, the pause-trimming threshold is too lax and build_cut should be
    taking them out already. If the same filler words keep appearing inside
    them, the drafter can stop picking takes that lead with those words.
    """
    proposals = []
    if len(regions) < min_evidence:
        return proposals

    silent = [r for r in regions if r.get("silenceRatio", 0) >= 0.65]
    if len(silent) >= min_evidence:
        durs = sorted(r["seconds"] for r in silent)
        median = durs[len(durs) // 2]
        proposals.append({
            "param": "trim_min", "section": "cutting",
            "value": round(max(0.08, min(median, 0.4)), 3),
            "evidence": len(silent),
            "why": f"{len(silent)} of {len(regions)} cut-out stretches were mostly silence, "
                   f"median {median:.2f}s -- trim pauses at least this long automatically",
        })

    from collections import Counter
    heard = Counter()
    for r in regions:
        for w in r.get("words", []):
            w = re.sub(r"[^a-z']", "", w.lower())
            if w in FILLERS:
                heard[w] += 1
    common = [w for w, n in heard.items() if n >= min_evidence]
    if common:
        proposals.append({
            "param": "filler_words", "section": "cutting",
            "value": sorted(common),
            "evidence": sum(heard[w] for w in common),
            "why": "kept cutting these out: " + ", ".join(f"{w} x{heard[w]}" for w in sorted(common)),
        })
    return proposals


# What a learned parameter is allowed to become.
#
# snap_lead/snap_tail exist to stop ~0.3-0.4s of silence sitting between every
# phrase, so a value above that is not a preference, it is the setting failing
# at its own job. Left unbounded, snap_tail reached 1.359s -- over a second of
# dead air kept after every line, 10.8s across a two-minute cut, which is
# exactly the "there are gaps, it is not tight" complaint.
LIMITS = {
    "snap_lead": (0.0, 0.35),
    "snap_tail": (0.0, 0.35),
    "split_gap": (0.15, 2.0),
    "trim_min":  (0.10, 1.50),
}


def clamp(param, value):
    lo, hi = LIMITS.get(param, (0.0, float("inf")))
    return round(min(max(value, lo), hi), 3)


def analyse_trims(trims, min_evidence):
    """If the edges keep getting moved the same way, the defaults are wrong.

    snap_lead/snap_tail decide how close to the speech a cut lands. Every
    trim says "you put it here, it belonged there" -- the median of those
    corrections IS the better default, in the units the setting uses.
    """
    proposals = []
    for edge, key in (("startDelta", "snap_lead"), ("endDelta", "snap_tail")):
        vals = [t[edge] for t in trims if abs(t.get(edge, 0)) > 0.001]
        if len(vals) < min_evidence:
            continue
        vals.sort()
        median = vals[len(vals) // 2]
        # a consistent direction, not just noise either side of zero
        same_way = sum(1 for v in vals if (v > 0) == (median > 0))
        if same_way < 0.7 * len(vals):
            continue
        # start edge: moving earlier (negative) means MORE lead is wanted
        shift = -median if key == "snap_lead" else median
        proposals.append({
            "param": key, "section": "cutting",
            "shift": round(shift, 3), "evidence": len(vals),
            "why": f"{len(vals)} trims, median {median:+.2f}s on the {edge.replace('Delta','')} edge "
                   f"({same_way}/{len(vals)} the same direction)",
        })
    return proposals


def analyse(overrides):
    """Flags that keep appearing on the CHOSEN take are over-penalised;
    flags on the REJECTED one are under-penalised."""
    chosen_flags, rejected_flags = Counter(), Counter()
    conf_gaps = []
    for o in overrides:
        for f in o["chosen"].get("flags", []):
            chosen_flags[flag_kind(f)] += 1
        for f in o["recommended"].get("flags", []):
            rejected_flags[flag_kind(f)] += 1
        conf_gaps.append(o["recommended"]["confidence"] - o["chosen"]["confidence"])

    proposals = []
    for flag, n in chosen_flags.items():
        key = FLAG_TO_PENALTY.get(flag) or ("penalty_dead_air_max" if flag == "dead_air" else None)
        if not key or n < MIN_EVIDENCE:
            continue
        proposals.append({
            "param": key, "direction": "decrease", "by": STEP, "evidence": n,
            "why": f"chosen {n}x despite '{flag}' -- penalised more than it deserves",
        })
    for flag, n in rejected_flags.items():
        key = FLAG_TO_PENALTY.get(flag) or ("penalty_dead_air_max" if flag == "dead_air" else None)
        if not key or n < MIN_EVIDENCE:
            continue
        if any(p["param"] == key for p in proposals):
            continue  # appears on both sides -- not a clean signal
        proposals.append({
            "param": key, "direction": "increase", "by": STEP, "evidence": n,
            "why": f"rejected {n}x carrying '{flag}' -- not penalised enough",
        })
    return proposals, conf_gaps


def save(tuning, overrides, path=None):
    """Write the corrected defaults out. The only writer in this file."""
    import datetime
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    tuning.setdefault("evidence", {})["overrides_seen"] = len(overrides)
    tuning["evidence"]["last_analysis"] = stamp
    tuning["updated"] = stamp
    target = path or TUNING
    tmp = target + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(tuning, fh, indent=1)
    os.replace(tmp, target)          # never leave a half-written tuning file
    return target


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="write proposals into state/tuning.json")
    ap.add_argument("--min-evidence", type=int, default=MIN_EVIDENCE)
    a = ap.parse_args()

    tuning = json.load(open(TUNING)) if os.path.exists(TUNING) else {}
    applied = False
    overrides = collect_overrides()

    trims = collect_trims()
    regions = collect_regions()
    fresh_trims, trims_through = since_last_applied(trims)
    trim_proposals = analyse_trims(fresh_trims, a.min_evidence)
    region_proposals = analyse_regions(regions, a.min_evidence)
    print(f"{len(overrides)} take override(s), {len(trims)} manual trim(s), "
          f"{len(regions)} cut-out stretch(es)")

    if trims:
        starts = [t["startDelta"] for t in trims if abs(t.get("startDelta", 0)) > 0.001]
        ends = [t["endDelta"] for t in trims if abs(t.get("endDelta", 0)) > 0.001]
        if starts:
            print(f"  start edge moved {len(starts)}x, average {sum(starts)/len(starts):+.3f}s")
        if ends:
            print(f"  end edge moved {len(ends)}x, average {sum(ends)/len(ends):+.3f}s")
    if trim_proposals:
        print("\nFrom your trims:")
        for tp in trim_proposals:
            cur = (tuning.get("cutting") or {}).get(tp["param"], 0.0)
            new = clamp(tp["param"], cur + tp["shift"])
            print(f"  {tp['param']}: {cur} -> {new}   ({tp['evidence']} trims)")
            print(f"      {tp['why']}")
        if a.apply:
            for tp in trim_proposals:
                cur = (tuning.setdefault("cutting", {})).get(tp["param"], 0.0)
                tuning["cutting"][tp["param"]] = clamp(tp["param"], cur + tp["shift"])
            tuning["learned_through"] = trims_through    # these trims are spent
            applied = True

    if region_proposals:
        print("\nFrom what you cut out:")
        for rp in region_proposals:
            cur = (tuning.get(rp["section"]) or {}).get(rp["param"])
            print(f"  {rp['param']}: {cur} -> {rp['value']}   ({rp['evidence']} examples)")
            print(f"      {rp['why']}")
        if a.apply:
            for rp in region_proposals:
                tuning.setdefault(rp["section"], {})[rp["param"]] = rp["value"]
            applied = True

    if not overrides and not trim_proposals and not region_proposals:
        print("\nNothing to learn from yet. Corrections are recorded when you trim an")
        print("edge or pick a take other than the recommended one -- that is the signal.")
        return 0

    for o in overrides:
        print(f"  {o['project']}/{o['beat']}: took {o['chosen']['id']} "
              f"({o['chosen']['confidence']:.2f}) over {o['recommended']['id']} "
              f"({o['recommended']['confidence']:.2f})")
        if o["chosen"].get("flags"):
            print(f"      accepted despite: {', '.join(o['chosen']['flags'])}")

    proposals, gaps = analyse(overrides)
    print()
    if not proposals:
        print(f"No take-pick pattern strong enough yet (need {a.min_evidence}+ of the same kind).")
        if applied:
            print(f"Applied to {save(tuning, overrides)}")
        return 0

    print("Proposed changes:")
    for p in proposals:
        cur = tuning.get("scoring", {}).get(p["param"])
        delta = -p["by"] if p["direction"] == "decrease" else p["by"]
        new = round(max(0.0, (cur or 0) + delta), 3)
        print(f"  {p['param']}: {cur} -> {new}   ({p['evidence']} examples)")
        print(f"      {p['why']}")

    if not a.apply:
        print("\nRun with --apply to write these in.")
        return 0

    for p in proposals:
        cur = tuning["scoring"].get(p["param"], 0.0)
        delta = -p["by"] if p["direction"] == "decrease" else p["by"]
        tuning["scoring"][p["param"]] = round(max(0.0, cur + delta), 3)
    print(f"\nApplied to {save(tuning, overrides)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

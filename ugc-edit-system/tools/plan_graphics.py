#!/usr/bin/env python3
"""Propose the motion graphics for a finished cut.

    python3 tools/plan_graphics.py <cut.mp4> -o <project>/work/graphics.json

Transcribes the FINISHED cut -- the beats have been re-timed by then, so only
the cut's own clock means anything -- and proposes a graphic wherever the
script gives a good reason for one:

    definition   a glossary term is spoken           "EGF", "peptides"
    stat         a number with a unit                "92%", "three weeks"
    callout      a before/after marker               "before", "after"

Nothing is burned in here. Every proposal lands in the plan with enabled=true
and a `why`, and the app is where they get kept or dropped -- the same rule as
the rest of this system: the tool proposes, you approve. Definitions in
particular are claims about ingredients going onto a product video, so they
carry the glossary's own `verified` flag straight through.
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from find_overlay_cues import transcribe_words, find_cues, norm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import data_path  # noqa: E402
DEFAULT_GLOSSARY = data_path("reference", "glossary.json")

NUM_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12,
}
UNITS = {
    "percent": "%", "weeks": "weeks", "week": "week", "days": "days", "day": "day",
    "months": "months", "month": "month", "years": "years", "year": "year",
}


def stat_cues(words, hold, lead):
    """A number next to a unit is a claim worth putting on screen."""
    out = []
    for i, w in enumerate(words):
        t = norm(w["w"])
        if not t:
            continue
        num = None
        if re.fullmatch(r"\d{1,4}", t):
            num = t
        elif t in NUM_WORDS:
            num = str(NUM_WORDS[t])
        if num is None:
            continue
        nxt = norm(words[i + 1]["w"]) if i + 1 < len(words) else ""
        unit = UNITS.get(nxt)
        if not unit:
            continue
        value = f"{num}%" if unit == "%" else num
        caption = "" if unit == "%" else unit
        end_w = words[i + 1]
        out.append({
            "type": "stat",
            "value": value,
            "caption": caption,
            "start": round(max(0.0, w["s"] - lead), 2),
            "end": round(end_w["e"] + hold, 2),
            "why": f'heard "{t} {nxt}"',
        })
    return out


def callout_cues(words, hold, lead):
    out = []
    for i, w in enumerate(words):
        t = norm(w["w"])
        if t in ("before", "after"):
            out.append({
                "type": "callout",
                "text": t.upper(),
                "start": round(max(0.0, w["s"] - lead), 2),
                "end": round(w["e"] + hold, 2),
                "why": f'heard "{t}"',
            })
    return out


def content_of(g):
    return (g["type"], g.get("term") or g.get("value") or g.get("text") or "")


def dedupe(items, min_gap=0.6, repeat_gap=25.0):
    """Thin the proposals down to ones worth putting on screen.

    Two rules, both learned from the first run on real footage: graphics must
    not overlap, and the SAME card must not come back straight away. The take
    says "five months" three times in thirteen seconds, and three identical
    stat cards in thirteen seconds looks broken, not emphatic."""
    kept = []
    for g in sorted(items, key=lambda x: x["start"]):
        if any(g["start"] < k["end"] + min_gap and k["start"] < g["end"] + min_gap for k in kept):
            continue
        if any(content_of(k) == content_of(g) and g["start"] - k["start"] < repeat_gap
               for k in kept):
            continue
        kept.append(g)
    return kept


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut")
    ap.add_argument("-o", "--out")
    # Scanning ONE line does not deserve a Whisper run. The project already has
    # word timings for the source, so a per-line scan reads those, keeps the
    # words inside the line, and shifts the result into cut time. That is the
    # difference between a button that answers instantly and one that thinks
    # for a minute about footage it has already transcribed once.
    ap.add_argument("--words", help="transcript.json to read instead of transcribing")
    ap.add_argument("--from", dest="t_from", type=float,
                    help="keep only words at or after this source time")
    ap.add_argument("--to", dest="t_to", type=float,
                    help="keep only words at or before this source time")
    ap.add_argument("--shift", type=float, default=0.0,
                    help="added to every time in the result, to land in cut time")
    ap.add_argument("--glossary", default=DEFAULT_GLOSSARY)
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--hold", type=float, default=2.4)
    ap.add_argument("--lead", type=float, default=0.15)
    ap.add_argument("--no-stats", action="store_true")
    ap.add_argument("--no-callouts", action="store_true")
    ap.add_argument("--repeat-gap", type=float, default=25.0,
                    help="seconds before the same card may appear again")
    a = ap.parse_args()

    glossary = json.load(open(a.glossary))
    verified = {t["term"]: bool(t.get("verified")) for t in glossary["terms"]}

    if a.words:
        # transcript.json is a list of SEGMENTS, each carrying its own words.
        # Accept the flat shapes too rather than assume one -- this file is
        # written by transcribe.py and read by several tools.
        raw = json.load(open(a.words))
        segs = raw["segments"] if isinstance(raw, dict) and "segments" in raw else raw
        if isinstance(raw, dict) and "words" in raw:
            segs = [raw]
        flat = []
        for seg in segs if isinstance(segs, list) else []:
            if isinstance(seg, dict) and isinstance(seg.get("words"), list):
                flat.extend(seg["words"])
            elif isinstance(seg, dict) and "w" in seg:
                flat.append(seg)
        words = [{"w": w["w"], "s": float(w["s"]), "e": float(w["e"])} for w in flat]
        if a.t_from is not None:
            words = [w for w in words if w["e"] > a.t_from]
        if a.t_to is not None:
            words = [w for w in words if w["s"] < a.t_to]
    else:
        words = transcribe_words(a.cut, a.model)
    plan = []

    for c in find_cues(words, glossary, a.hold, a.lead):
        plan.append({
            "type": "definition",
            "term": c["term"],
            "definition": c["definition"],
            "start": c["start"],
            "end": c["end"],
            "why": f'said "{c["term"]}"',
            "verified": verified.get(c["term"], False),
        })
    if not a.no_stats:
        plan += stat_cues(words, a.hold, a.lead)
    if not a.no_callouts:
        plan += callout_cues(words, a.hold, a.lead)

    plan = dedupe(plan, repeat_gap=a.repeat_gap)
    if a.shift:
        for g in plan:
            g["start"] = round(g["start"] + a.shift, 3)
            g["end"] = round(g["end"] + a.shift, 3)
    for i, g in enumerate(plan):
        g["id"] = f"g{i:02d}"
        g.setdefault("enabled", True)

    print(f"{os.path.basename(a.cut)}  {len(words)} words  ->  {len(plan)} graphic(s)")
    if a.words:
        # A per-line scan hands the plan back for the caller to merge, so it
        # prints it whether or not there is an --out file. Guarding this on
        # --out meant the app asked for a line's graphics, the tool found
        # them, and nothing came back.
        print(json.dumps(plan))
    for g in plan:
        label = g.get("term") or g.get("value") or g.get("text") or g.get("title")
        flag = "" if g.get("verified", True) else "   [definition UNVERIFIED]"
        print(f"  {g['start']:6.2f}-{g['end']:6.2f}  {g['type']:11s} {label}{flag}")
        print(f"                  {g['why']}")

    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump({"cut": os.path.basename(a.cut), "graphics": plan}, open(a.out, "w"), indent=1)
        print(f"\nWrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

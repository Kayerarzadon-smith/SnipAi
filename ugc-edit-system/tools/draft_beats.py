#!/usr/bin/env python3
"""Raw transcript in, drafted beats.json out -- the whole video, not one region.

    python3 tools/draft_beats.py projects/<name>

This is the missing link between "footage is in" and "there is a cut to
review". list_candidate_takes.py answers "which take of THIS line is best";
this runs that across the entire file, groups the attempts of each line
together, and picks a winner for every line.

Method, straight out of CLAUDE.md:
  1. split the file into attempts at silences (using the calibrated strict
     threshold, so a pause inside a word never splits it)
  2. group consecutive attempts that are near-duplicates -- those are retakes
     of the same line
  3. per group, take the highest-confidence candidate, which by the scoring
     rules means the LAST complete recitation with no repeat and no false start
  4. drop groups where nothing scores above --min-confidence, and report them,
     rather than quietly shipping a bad take

Nothing is auto-approved: this writes a DRAFT beats.json for review. Beats
whose winner scored below the confidence bar are marked needs_review so the
app can surface them first.
"""
import argparse, difflib, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import data_path  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from list_candidate_takes import (  # noqa: E402
    load_silence, group_into_candidates, has_internal_repeat,
    score_candidate, max_gap_within, _similar,
)

STOPWORDS = {"the", "a", "an", "and", "is", "it", "to", "of", "you", "your", "i",
             "this", "that", "in", "on", "for", "with", "my", "me", "so", "but",
             "are", "was", "have", "has", "be", "at", "as", "if", "we", "they"}


def norm(t):
    return re.sub(r"[^a-z0-9' ]", " ", t.lower()).split()


def label_for(text, used):
    # Labels become clip FILENAMES and get written into concat.txt, which
    # single-quotes each path -- an apostrophe in "there's" breaks the concat
    # demuxer and the render dies partway through. Strip to [a-z0-9-] only.
    words = [re.sub(r"[^a-z0-9]", "", w) for w in norm(text) if w not in STOPWORDS]
    words = [w for w in words if w]
    base = "-".join(words[:3]) or "beat"
    lab, n = base, 2
    while lab in used:
        lab = f"{base}-{n}"
        n += 1
    used.add(lab)
    return lab


def build_candidates(segs, silence, split_gap):
    """Every attempt in the whole file, scored."""
    lo = min((w["s"] for s in segs for w in s.get("words", [])), default=0.0)
    hi = max((w["e"] for s in segs for w in s.get("words", [])), default=0.0)
    groups = group_into_candidates(segs, silence, lo - 1, hi + 1, split_gap)

    raw = []
    for g in groups:
        text = re.sub(r"\s+", " ", " ".join(w["w"].strip() for w in g).strip())
        start, end = g[0]["s"], g[-1]["e"]
        gap = max((g[i + 1]["s"] - g[i]["e"] for i in range(len(g) - 1)), default=0.0)
        gap = max(gap, max_gap_within(silence, start, end))
        if text:
            raw.append({"text": text, "start": start, "end": end, "gap": gap})
    return raw


def cluster_retakes(raw, ratio):
    """Consecutive attempts at the same line belong to one group."""
    groups, cur = [], []
    for r in raw:
        if not cur:
            cur = [r]
            continue
        a, b = norm(cur[-1]["text"]), norm(r["text"])
        if not a or not b:
            cur.append(r)
            continue
        sim = difflib.SequenceMatcher(None, a, b).ratio()
        shorter = min(len(a), len(b))
        prefix = a[:shorter] == b[:shorter]
        if sim >= ratio or prefix or _similar(cur[-1]["text"], r["text"]):
            cur.append(r)
        else:
            groups.append(cur)
            cur = [r]
    if cur:
        groups.append(cur)
    return groups


def tuned(key, fallback):
    """A learned default from state/tuning.json, or the original guess.

    learn_from_edits.py corrects these from what actually got trimmed. Reading
    them here is what closes the loop: without it the corrections are written
    down and then ignored, and the next video needs exactly the same edits as
    the last one.
    """
    # The library's copy, which is the one learn_from_edits writes. Resolving
    # this from the tool's own directory read the copy that ships with the
    # CODE instead -- so corrections were written to one file and rendering
    # read another, and the loop had been open since the library moved out.
    path = data_path("state", "tuning.json")
    try:
        with open(path) as fh:
            return json.load(fh).get("cutting", {}).get(key, fallback)
    except Exception:
        return fallback


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project")
    ap.add_argument("--split-gap", type=float, default=tuned("split_gap", 0.5),
                    help="silence long enough to separate two attempts. Measured on real "
                         "footage: 1.2s merged separate retakes into one stuttery beat "
                         "(8 clean of 27); 0.5s found 24 clean of 35.")
    ap.add_argument("--similarity", type=float, default=0.55,
                    help="how alike two attempts must be to count as the same line")
    ap.add_argument("--min-confidence", type=float, default=0.70,
                    help="below this a beat is kept but marked needs_review "
                         "(matches the red tier in NOTES.md)")
    ap.add_argument("--min-words", type=int, default=3)
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--force", action="store_true", help="overwrite an existing beats.json")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    work = os.path.join(proj, "work")
    tpath = os.path.join(work, "transcript.json")
    if not os.path.exists(tpath):
        print(f"missing {tpath} -- transcribe first", file=sys.stderr)
        return 1

    segs = json.load(open(tpath))

    # prefer the calibrated strict map, then the strict map, then the plain one
    silence = []
    for name in ("silence-strict.txt", "silence.txt"):
        p = os.path.join(work, name)
        if os.path.exists(p):
            silence = load_silence(p)
            break

    source = None
    bpath = os.path.join(proj, "beats.json")
    if os.path.exists(bpath):
        try:
            source = json.load(open(bpath)).get("source")
        except Exception:
            source = None
    if not source:
        raw_dir = os.path.join(proj, "raw")
        vids = [f for f in os.listdir(raw_dir) if re.search(r"\.(mp4|mov)$", f, re.I)] \
            if os.path.isdir(raw_dir) else []
        source = f"raw/{vids[0]}" if vids else "raw/UNKNOWN.mp4"

    raw = build_candidates(segs, silence, a.split_gap)
    if not raw:
        print("no speech found in the transcript", file=sys.stderr)
        return 1

    clusters = cluster_retakes(raw, a.similarity)

    beats, skipped, flagged, analysis = [], [], [], []
    used = set()
    for cl in clusters:
        word_counts = [len(c["text"].split()) for c in cl]
        max_words = max(word_counts)
        scored = []
        for i, c in enumerate(cl):
            wc = len(c["text"].split())
            fs = max_words > 0 and wc < 0.6 * max_words
            dead = c["gap"] >= 1.5
            is_last = i == len(cl) - 1
            later = any(j > i and _similar(c["text"], cl[j]["text"]) for j in range(len(cl)))
            rep = has_internal_repeat(c["text"])
            conf, why = score_candidate(c["text"], is_last, fs, dead, c["gap"], later, rep)
            scored.append((conf, why, c, rep, fs, dead))

        conf, why, best, rep, fs, dead = max(scored, key=lambda x: x[0])

        if len(best["text"].split()) < a.min_words:
            skipped.append((best["text"], "too short"))
            continue

        label = label_for(best["text"], used)
        # beats.json stays EXACTLY the shape build_cut.py has always read:
        # label / start / end (+ text, which the template already allows).
        # Confidence, attempt counts and review flags are AI commentary and
        # belong beside it, not inside Kayer's edit list.
        beats.append({
            "label": label,
            "start": round(best["start"], 2),
            "end": round(best["end"], 2),
            "text": best["text"],
        })
        meta = {
            "label": label,
            "confidence": conf,
            "attempts": len(cl),
        }
        if conf < a.min_confidence:
            meta["needs_review"] = True
            meta["why"] = [w["label"] for w in why if not w["ok"]]
            flagged.append(meta)
        analysis.append(meta)

    out = a.out or bpath
    if os.path.exists(out) and not a.force and out == bpath:
        print(f"{bpath} already exists -- pass --force to overwrite, or -o to write elsewhere",
              file=sys.stderr)
        return 1

    data = {
        "source": source,
        "notes": "DRAFT written by tools/draft_beats.py -- one beat per line, each the "
                 "best-scoring attempt. Beats marked needs_review scored below the "
                 "confidence bar and want a human call before building.",
        "beats": beats,
    }
    json.dump(data, open(out, "w"), indent=1)

    # sidecar: everything the AI thought, kept out of the edit list
    sidecar = os.path.join(work, "beat-analysis.json")
    os.makedirs(work, exist_ok=True)
    json.dump({
        "for": os.path.basename(out),
        "generated": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "split_gap": a.split_gap,
        "beats": analysis,
    }, open(sidecar, "w"), indent=1)

    print(f"{len(raw)} attempts -> {len(clusters)} lines -> {len(beats)} beats")
    by_label = {m["label"]: m for m in analysis}
    for b in beats:
        m = by_label.get(b["label"], {})
        mark = "  <-- NEEDS REVIEW" if m.get("needs_review") else ""
        print(f"  {b['label']:24} {b['start']:7.2f}-{b['end']:7.2f}  "
              f"conf={m.get('confidence', 0):.2f} of {m.get('attempts', 1)} take(s){mark}")
        print(f"      \"{b['text'][:72]}\"")
    if skipped:
        print(f"\nskipped {len(skipped)}:")
        for t, why in skipped:
            print(f"  ({why}) \"{t[:60]}\"")
    if flagged:
        print(f"\n{len(flagged)} beat(s) need your call before this is postable.")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

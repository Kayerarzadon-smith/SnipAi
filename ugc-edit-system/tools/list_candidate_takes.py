#!/usr/bin/env python3
"""List every candidate take in a source region, with flags and a confidence score.

    python3 tools/list_candidate_takes.py projects/medicube-egf-serum 122 127 --json

The speaker runs each line several times in a row (see CLAUDE.md). Where
`tools/scan_takes.py` re-transcribes a region for a human to read bottom-up,
this tool structures the same idea into discrete candidates for a UI:
groups `work/transcript.json`'s segments in the requested region into
distinct attempts (splitting on gaps), flags each one (false start,
mid-take dead-air, incomplete sentence), and scores confidence the same way
`tools/auto_edit.py`'s pick_beats() picks a winner -- last complete
recitation wins -- except here every candidate is returned, not just the
winner, so a person can see what the AI saw and override it.

Does not touch beats.json. Read-only.
"""
import argparse, json, os, re, sys


def load_tuning():
    """Learned weights from state/tuning.json.

    These start as guesses and get corrected by what Kayer actually approves
    (see tools/learn_from_edits.py). Falling back to the defaults means a
    missing file degrades to the original behaviour rather than breaking.
    """
    defaults = {
        "penalty_internal_repeat": 0.55, "penalty_superseded": 0.35,
        "penalty_false_start": 0.25, "penalty_incomplete": 0.20,
        "penalty_dead_air_max": 0.30, "bonus_last_complete": 0.08,
        "false_start_word_ratio": 0.6, "dead_air_seconds": 1.5,
    }
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "state", "tuning.json")
    try:
        with open(path) as f:
            defaults.update(json.load(f).get("scoring", {}))
    except Exception:
        pass
    return defaults


TUNING = load_tuning()



def load_words(transcript_path):
    segs = json.load(open(transcript_path))
    return segs


def load_silence(silence_path):
    starts, ends = [], []
    for line in open(silence_path):
        m = re.search(r"silence_start:\s*([\d.]+)", line)
        if m:
            starts.append(float(m.group(1)))
        m = re.search(r"silence_end:\s*([\d.]+)", line)
        if m:
            ends.append(float(m.group(1)))
    return sorted(zip(starts, ends))


def max_gap_within(silence, start, end):
    """Longest silence interval fully inside [start, end]."""
    best = 0.0
    for x, y in silence:
        if x >= start - 0.05 and y <= end + 0.05:
            best = max(best, y - x)
    return best


def collect_words(segs, region_start, region_end):
    """Words are the atomic unit, not Whisper's segments.

    Whisper happily merges a false start and the real take into ONE segment
    (see CLAUDE.md -- the transcript reads clean when the audio is not), so
    grouping by segment boundaries misses the retake entirely.
    """
    words = []
    for s in segs:
        for w in s.get("words", []):
            if w["e"] > region_start - 0.5 and w["s"] < region_end + 0.5:
                words.append(w)
    return sorted(words, key=lambda w: w["s"])


def separating_silences(silence, region_start, region_end, min_gap):
    """Silence intervals long enough to separate two attempts. The silence map
    is ground truth here; the transcript's timings are not."""
    return [(x, y) for x, y in silence
            if (y - x) >= min_gap and y > region_start - 0.5 and x < region_end + 0.5]


def group_into_candidates(segs, silence, region_start, region_end, split_gap):
    words = collect_words(segs, region_start, region_end)
    if not words:
        return []
    gaps = separating_silences(silence, region_start, region_end, split_gap)

    # Split at the MIDPOINT of each qualifying silence, comparing against word
    # START times only. CLAUDE.md: Whisper folds a pause into the duration of
    # the preceding word, so that word's END is unreliable -- its START is not.
    split_times = sorted((x + y) / 2.0 for x, y in gaps)

    groups, cur = [], []
    for w in words:
        if cur:
            prev = cur[-1]
            crossed = any(prev["s"] < t <= w["s"] for t in split_times)
            if crossed or (w["s"] - prev["e"]) >= split_gap:
                groups.append(cur)
                cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return groups


def has_internal_repeat(text, n=3):
    """A phrase repeated inside ONE take -- the stutter verify_cut.py catches.
    Without this a merged false-start+retake scores as a clean take."""
    toks = re.sub(r"[^a-z0-9' ]", "", text.lower()).split()
    seen = set()
    for i in range(len(toks) - n + 1):
        gram = tuple(toks[i:i + n])
        if gram in seen:
            return True
        seen.add(gram)
    return False


def score_candidate(text, is_last, has_false_start, has_dead_air, dead_air_dur,
                    is_repeat_of_later, internal_repeat=False):
    conf = 0.90
    why = []

    if internal_repeat:
        # Two attempts at the same sentence inside one take. This is THE
        # defect per CLAUDE.md -- never present it as usable.
        conf -= TUNING['penalty_internal_repeat']
        why.append({"ok": False, "label": "Repeats itself -- two attempts at the same line are inside this take"})

    complete = bool(re.search(r"[.!?]\s*$", text.strip()))
    if complete and not internal_repeat:
        why.append({"ok": True, "label": "Complete idea, no repeated phrase" if not is_repeat_of_later else "Complete sentence"})
    elif complete:
        why.append({"ok": True, "label": "Ends on a full stop"})
    else:
        conf -= TUNING['penalty_incomplete']
        why.append({"ok": False, "label": "Sentence does not end on a full stop -- looks cut off or abandoned"})

    if has_false_start:
        conf -= TUNING['penalty_false_start']
        why.append({"ok": False, "label": "Short / restarted quickly -- looks like a false start"})

    if has_dead_air:
        conf -= min(TUNING['penalty_dead_air_max'], dead_air_dur / 20.0)
        why.append({"ok": False, "label": f"{dead_air_dur:.1f}s dead-air gap inside this take"})
    else:
        why.append({"ok": True, "label": "No clipped word at either edge"})

    if is_repeat_of_later:
        conf -= TUNING['penalty_superseded']
        why.append({"ok": False, "label": "A later, more complete attempt of the same line exists"})

    if is_last and complete and not has_false_start and not internal_repeat:
        conf += TUNING['bonus_last_complete']
        why.append({"ok": True, "label": "Last complete recitation in the source -- matches house style rule"})

    return max(0.02, min(0.98, round(conf, 3))), why


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project")
    ap.add_argument("start", type=float)
    ap.add_argument("end", type=float)
    ap.add_argument("--label", default=None)
    ap.add_argument("--split-gap", type=float, default=1.2,
                     help="a gap at least this long between segments starts a new candidate")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    work = os.path.join(proj, "work")
    transcript_path = os.path.join(work, "transcript.json")
    silence_path = os.path.join(work, "silence.txt")

    if not os.path.exists(transcript_path):
        print(json.dumps({"error": f"missing {transcript_path}"}))
        return 1

    segs = load_words(transcript_path)
    silence = load_silence(silence_path) if os.path.exists(silence_path) else []

    groups = group_into_candidates(segs, silence, a.start, a.end, a.split_gap)
    if not groups:
        print(json.dumps({"region": {"start": a.start, "end": a.end}, "candidates": [], "recommendedId": None}))
        return 0

    raw = []
    for g in groups:
        # groups are lists of WORDS now, not segments
        text = " ".join(w["w"].strip() for w in g).strip()
        text = re.sub(r"\s+", " ", text)
        start = g[0]["s"]
        end = g[-1]["e"]
        internal_gap = max(
            (g[i + 1]["s"] - g[i]["e"] for i in range(len(g) - 1)),
            default=0.0,
        )
        internal_gap = max(internal_gap, max_gap_within(silence, start, end))
        raw.append({"text": text, "start": start, "end": end, "gap": internal_gap})

    word_counts = [len(r["text"].split()) for r in raw]
    max_words = max(word_counts) if word_counts else 0

    candidates = []
    for i, r in enumerate(raw):
        wc = len(r["text"].split())
        has_false_start = max_words > 0 and wc < 0.6 * max_words
        has_dead_air = r["gap"] >= 1.5
        is_last = i == len(raw) - 1
        is_repeat_of_later = any(
            j > i and _similar(r["text"], raw[j]["text"]) for j in range(len(raw))
        )
        internal_repeat = has_internal_repeat(r["text"])
        confidence, why = score_candidate(r["text"], is_last, has_false_start, has_dead_air,
                                          r["gap"], is_repeat_of_later, internal_repeat)

        flags = []
        if internal_repeat:
            flags.append("internal_repeat")
        if has_false_start:
            flags.append("false_start")
        if has_dead_air:
            flags.append(f"dead_air_{r['gap']:.1f}s")
        if not re.search(r"[.!?]\s*$", r["text"].strip()):
            flags.append("incomplete_sentence")
        if is_repeat_of_later:
            flags.append("superseded_by_later_take")

        candidates.append({
            "id": f"take-{chr(65 + i)}",
            "start": round(r["start"], 2),
            "end": round(r["end"], 2),
            "text": r["text"],
            "confidence": confidence,
            "flags": flags,
            "why": why,
        })

    best = max(candidates, key=lambda c: c["confidence"])
    result = {
        "region": {"start": a.start, "end": a.end},
        "label": a.label,
        "candidates": candidates,
        "recommendedId": best["id"],
    }
    print(json.dumps(result, indent=1))
    return 0


def _similar(a, b):
    aw, bw = set(a.lower().split()), set(b.lower().split())
    if not aw or not bw:
        return False
    overlap = len(aw & bw) / max(len(aw), len(bw))
    return overlap >= 0.5


if __name__ == "__main__":
    sys.exit(main())

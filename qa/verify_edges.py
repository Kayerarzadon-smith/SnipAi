#!/usr/bin/env python3
"""CATEGORY 021 — did the build clip a word at a beat's IN or OUT point?

`ugc-edit-system/tools/verify_removals.py` measures only the gaps BETWEEN
pieces of a beat — the interior holes. The in-point and out-point are where
snap() works, and that is where the only clipping this project has shipped
happened: the "s" of "this", the "ce" of "face" (10ab9c3). The instrument that
caught those was qa/verify_words.py --against, which needs an older build to
compare with. There has been no absolute check on the edges at all.

This is that check. Same reasoning as verify_removals — measure the audio, not
the timestamps, because Whisper starts words 200-400ms early and folds pauses
and restarts into the preceding word's duration. For every spoken word whose
Whisper span is only partly rendered, the UNRENDERED part is measured against
this project's own speech level. Silence there means snap() did its job;
speech there means a word was clipped.

Two differences from verify_removals, both deliberate:

  * The source audio is decoded ONCE into a wav and every window is sliced out
    of it by sample index. verify_removals seeks per fragment with `-ss`
    before `-i`, which on this footage lands ~85ms late — measured up to 55 dB
    of error on an 80ms window, which is wider than the 8 dB margin the check
    turns on. A few tens of milliseconds is exactly the size of fragment that
    matters, and a keyframe seek cannot resolve it.

  * Interiors are checked too, so this tool's verdict can be compared with
    verify_removals' on identical footing.

A word that straddles a beat's boundary because the NEXT take starts there is
not a clipped word — `good-thing-medicube` ("good thing that MediCube has a,
I") ends mid-abandoned-take and the audio past its out-point is the first word
of the retake. Those show up here and must be read, not filed. The report
prints the beat text so that call can be made.

Read-only. It never touches a project.

    python3 qa/verify_edges.py --project ~/Movies/SnipAi/projects/<name>
"""
import argparse
import array
import json
import math
import os
import subprocess
import sys
import tempfile
import wave

# How close to the project's own speech level a fragment may sit before it is
# treated as containing speech. Same margin, and same reasoning, as
# verify_removals: the two populations are tens of dB apart.
SPEECH_MARGIN_DB = 8.0

# A span longer than this is a word plus a swallowed pause, or a restart, and
# cannot be used to judge coverage. Same constant as qa/verify_words.py.
LONG_WORD = 0.8

MIN_WINDOW = 0.004


def ffmpeg_bin():
    env = (os.environ.get("SNIPAI_FFMPEG") or "").strip()
    if env and os.path.exists(env):
        return env
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv = os.path.join(here, "ugc-edit-system", ".venv", "bin", "ffmpeg")
    if os.path.exists(venv):
        return venv
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def decode_audio(src, out):
    """The whole source's audio, mono, once. Every measurement below indexes
    into this — no seeking, so nothing can drift."""
    p = subprocess.run(
        [ffmpeg_bin(), "-nostdin", "-v", "error", "-i", src,
         "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-y", out],
        capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stderr.strip()[:400])
        return None
    w = wave.open(out)
    d = array.array("h")
    d.frombytes(w.readframes(w.getnframes()))
    return d, w.getframerate()


def level(d, sr, t0, t1):
    """mean and peak dBFS of one window, by sample index."""
    i0, i1 = max(0, int(t0 * sr)), min(len(d), int(t1 * sr))
    if i1 - i0 < 8:
        return None, None
    seg = d[i0:i1]
    rms = math.sqrt(sum(x * x for x in seg) / len(seg)) / 32768.0
    pk = max(abs(x) for x in seg) / 32768.0
    return (20 * math.log10(rms) if rms > 0 else -120.0,
            20 * math.log10(pk) if pk > 0 else -120.0)


def base_label(label, known):
    """A piece's beat. `need-egf-2` is a beat in its own right, not piece 2 of
    `need-egf`, so the suffix only comes off when it has to."""
    if label in known:
        return label
    head = label.rsplit("-", 1)[0]
    return head if head in known else label


def ranges_for(pieces, label):
    return sorted((p["src_start"], p["src_end"]) for p in pieces
                  if p["label"] == label or p["label"].startswith(label + "-"))


def uncovered(ranges, s, e):
    """The sub-spans of [s,e] that no rendered piece covers."""
    out, cur = [], s
    for a, b in ranges:
        if b <= cur or a >= e:
            continue
        if a > cur:
            out.append((cur, min(a, e)))
        cur = max(cur, b)
        if cur >= e:
            break
    if cur < e:
        out.append((cur, e))
    return [(a, b) for a, b in out if b - a > MIN_WINDOW]


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--margin", type=float, default=SPEECH_MARGIN_DB,
                    help="dB below the project's speech level that still counts as speech")
    ap.add_argument("--interiors", action="store_true",
                    help="also re-measure what verify_removals checks, sample-exact")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    edl_path = os.path.join(proj, "work", "edl.json")
    if not os.path.exists(edl_path):
        print("nothing to check -- this project has not been built yet")
        return 2
    edl = json.load(open(edl_path))
    pieces = edl if isinstance(edl, list) else edl.get("pieces", edl.get("edl", []))
    cfg = json.load(open(os.path.join(proj, "beats.json")))
    src = os.path.join(proj, cfg["source"])
    if not os.path.exists(src):
        print(f"the footage is not on this machine: {cfg['source']}")
        return 2
    tr = os.path.join(proj, "work", "transcript.json")
    if not os.path.exists(tr):
        print("no transcript -- nothing to judge coverage against")
        return 2
    words = [w for s in json.load(open(tr)) for w in s.get("words", [])]

    with tempfile.TemporaryDirectory() as tmp:
        got = decode_audio(src, os.path.join(tmp, "src.wav"))
        if got is None:
            print("could not decode the source audio")
            return 2
        d, sr = got

        # The reference is this project's own speech, not a fixed number: level
        # depends on the mic, the room and how close he was sitting that day.
        longest = sorted(pieces, key=lambda e: -e["dur"])[:4]
        sp = [m for m, _ in (level(d, sr, e["src_start"],
                                   min(e["src_start"] + 2.0, e["src_end"]))
                             for e in longest) if m is not None]
        if not sp:
            print("  could not measure this project's speech level")
            return 2
        speech = sum(sp) / len(sp)
        floor = speech - a.margin
        print(f"  speech in this project averages {speech:.1f} dB")
        print(f"  an edge fragment is speech if it is above {floor:.1f} dB\n")

        texts = {b["label"]: (b.get("text") or b.get("line") or "") for b in cfg["beats"]}
        flagged, checked = [], 0
        for b in cfg["beats"]:
            rs = ranges_for(pieces, b["label"])
            if not rs:
                continue
            holes = b.get("holes") or []
            for w in words:
                if not (w["s"] >= b["start"] - 0.05 and w["e"] <= b["end"] + 0.05):
                    continue
                if (w["e"] - w["s"]) >= LONG_WORD or not w["w"].strip():
                    continue
                mid = (w["s"] + w["e"]) / 2
                if any(f - 0.02 <= mid <= t + 0.02 for f, t in holes):
                    continue            # deleted on purpose
                for g0, g1 in uncovered(rs, w["s"], w["e"]):
                    m, pk = level(d, sr, g0, g1)
                    if m is None:
                        continue
                    checked += 1
                    if m > floor:
                        flagged.append((b["label"], w["w"].strip(), g0, g1, m, pk))

        if flagged:
            print(f"  {len(flagged)} of {checked} edge fragments carry speech:\n")
            for lab, wd, g0, g1, m, pk in flagged:
                print(f"    {lab}  {wd!r}")
                print(f"      {g0:.3f}-{g1:.3f}  ({(g1-g0)*1000:.0f}ms)  "
                      f"mean {m:.1f} dB  peak {pk:.1f} dB")
                print(f"      line: {texts.get(lab, '')[:90]}")
            print("\n  Read these before filing them. A beat that ends mid-abandoned-take")
            print("  has the NEXT take's first word past its out-point, and dropping that")
            print("  is take selection working. A fragment inside a line is a clipped word.")
        else:
            print(f"  All {checked} edge fragments are below the speech floor. "
                  "No word is clipped at an edge.")

        if a.interiors:
            known = {b["label"] for b in cfg["beats"]}
            by = {}
            for e in pieces:
                by.setdefault(base_label(e["label"], known), []).append(e)
            bad = n = 0
            print()
            for lab, ps in by.items():
                ps.sort(key=lambda e: e["src_start"])
                for x, y in zip(ps, ps[1:]):
                    f, t = x["src_end"], y["src_start"]
                    if t - f <= MIN_WINDOW:
                        continue
                    m, pk = level(d, sr, f, t)
                    if m is None:
                        continue
                    n += 1
                    if m > floor:
                        bad += 1
                        print(f"  INTERIOR SPEECH  {lab}  {f:.3f}-{t:.3f}  "
                              f"mean {m:.1f} dB  peak {pk:.1f} dB")
            print(f"  {bad} of {n} interior removals carry speech (sample-exact)")

    return 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Find where a definition card should pop up in a finished cut.

    python3 tools/find_overlay_cues.py <cut.mp4> -o <project>/work/cues.json

Transcribes the FINISHED cut (not the raw source -- the beats have been
re-timed, so only the cut's own timeline is meaningful), then looks for any
glossary term being spoken. Each hit becomes a cue: when the card appears,
how long it stays, and what it says.

Cues are written out rather than burned straight in, so they can be reviewed
and edited before rendering -- same principle as the rest of the system: the
AI proposes, you approve.
"""
import argparse, json, os, re, subprocess, sys, tempfile

def _ffmpeg():
    """ffmpeg is not on PATH on this Mac -- it ships inside the venv."""
    import os as _os
    venv = _os.path.join(
        _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), ".venv", "bin", "ffmpeg")
    return venv if _os.path.exists(venv) else "ffmpeg"


def _whisper_threads():
    """Threads Whisper may use. Defaults to (cores - 2, min 1) so the machine
    stays usable -- unbounded CPU inference on a 4-core laptop with 8GB RAM
    locks the UI and drives the system into swap. Override with SNIPAI_THREADS."""
    import os as _os
    env = _os.environ.get("SNIPAI_THREADS")
    if env and env.isdigit():
        return max(1, int(env))
    return max(1, (_os.cpu_count() or 4) - 2)



DEFAULT_GLOSSARY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "reference", "glossary.json")


def transcribe_words(video, model):
    from faster_whisper import WhisperModel
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run([_ffmpeg(), "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", wav, "-loglevel", "error", "-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    m = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=_whisper_threads())
    segs, _ = m.transcribe(wav, word_timestamps=True, vad_filter=False,
                           condition_on_previous_text=False)
    words = []
    for s in segs:
        for w in s.words:
            words.append({"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)})
    os.remove(wav)
    return words


def norm(t):
    return re.sub(r"[^a-z0-9 ]", " ", t.lower()).strip()


def find_cues(words, glossary, hold, lead):
    """Match each alias against the spoken word sequence."""
    spoken = [norm(w["w"]) for w in words]
    cues = []
    used_spans = []

    for entry in glossary["terms"]:
        for alias in sorted(entry.get("aliases", []), key=len, reverse=True):
            parts = norm(alias).split()
            if not parts:
                continue
            n = len(parts)
            for i in range(len(spoken) - n + 1):
                window = [p for p in spoken[i:i + n] if p]
                if window != parts:
                    continue
                start = max(0.0, words[i]["s"] - lead)
                end = words[i + n - 1]["e"] + hold
                # one card per term, and never two cards stacked on each other
                if any(entry["term"] == t and abs(start - s) < 8 for t, s, _ in used_spans):
                    continue
                if any(start < e and s < end for _, s, e in used_spans):
                    continue
                used_spans.append((entry["term"], start, end))
                cues.append({
                    "term": entry["term"],
                    "definition": entry["definition"],
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "spokenAt": words[i]["s"],
                })
                break

    cues.sort(key=lambda c: c["start"])
    return cues


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--glossary", default=DEFAULT_GLOSSARY)
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--hold", type=float, default=2.2,
                    help="seconds the card stays up after the word is said")
    ap.add_argument("--lead", type=float, default=0.15,
                    help="seconds the card appears BEFORE the word, so it's already "
                         "on screen as you say it")
    a = ap.parse_args()

    glossary = json.load(open(a.glossary))
    words = transcribe_words(a.cut, a.model)
    cues = find_cues(words, glossary, a.hold, a.lead)

    print(f"{os.path.basename(a.cut)}  {len(words)} words")
    if not cues:
        print("  no glossary terms spoken -- no cards to place")
    for c in cues:
        print(f"  {c['start']:6.2f}-{c['end']:6.2f}  {c['term']}")
        print(f"                  {c['definition']}")

    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump({"cut": os.path.basename(a.cut), "cues": cues}, open(a.out, "w"), indent=1)
        print(f"\nWrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

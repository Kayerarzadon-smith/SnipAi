#!/usr/bin/env python3
"""Verify a cut: catch stutters, ignore scripted repetition.

    python3 tools/verify_beats.py <cut.mp4> --edl projects/<name>/work/edl.json

A stutter is two attempts at the same sentence left in the timeline. Scripted
repetition is not -- this script says "you need EGF" three times on purpose,
and both ingredient lines end "rebuilding themselves faster". So a repeat is a
defect only when both occurrences sit inside the SAME beat, which is what a
beat starting inside a previous attempt looks like. Cross-beat repeats are
listed for information and do not fail.

Exit 1 only on a same-beat repeat. Replaces verify_cut.py.
"""
import argparse, json, os, re, subprocess, tempfile, sys

def _whisper_threads():
    """Threads Whisper may use. Defaults to (cores - 2, min 1) so the machine
    stays usable -- unbounded CPU inference on a 4-core laptop with 8GB RAM
    locks the UI and drives the system into swap. Override with SNIPAI_THREADS."""
    import os as _os
    env = _os.environ.get("SNIPAI_THREADS")
    if env and env.isdigit():
        return max(1, int(env))
    return max(1, (_os.cpu_count() or 4) - 2)




def beat_spans(p):
    spans, t = [], 0.0
    for x in json.load(open(p)):
        lab = x["label"].rsplit("-", 1)[0] if x["label"][-1].isdigit() else x["label"]
        if spans and spans[-1][0] == lab:
            spans[-1][2] = t + x["dur"]
        else:
            spans.append([lab, t, t + x["dur"]])
        t += x["dur"]
    return spans


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut"); ap.add_argument("--edl", default=None)
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--window", type=float, default=12.0)
    ap.add_argument("-n", "--ngram", type=int, default=3)
    ap.add_argument("--print-transcript", action="store_true")
    a = ap.parse_args()

    spans = beat_spans(a.edl) if a.edl and os.path.exists(a.edl) else None
    at = lambda t: next((l for l, s, e in spans if s - .01 <= t < e + .01), None) if spans else None

    from faster_whisper import WhisperModel
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-i", a.cut, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", wav, "-loglevel", "error", "-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    segs, _ = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=_whisper_threads()).transcribe(
        wav, word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
    words = []
    for s in segs:
        if a.print_transcript:
            print(f"{s.start:6.2f}-{s.end:6.2f}: {s.text.strip()}")
        for w in s.words:
            tok = re.sub(r"[^a-z0-9']", "", w.word.lower())
            if tok:
                words.append((tok, w.start))
    os.remove(wav)

    seen, hits = {}, []
    for i in range(len(words) - a.ngram + 1):
        g = tuple(w[0] for w in words[i:i + a.ngram]); t = words[i][1]
        if g in seen and t - seen[g] <= a.window:
            hits.append((seen[g], t, " ".join(g)))
        seen[g] = t
    merged = []
    for s0, s1, g in hits:
        if merged and abs(merged[-1][1] - s1) < 1.5:
            merged[-1] = (merged[-1][0], s1, merged[-1][2] + " " + g.split()[-1])
        else:
            merged.append((s0, s1, g))

    info = subprocess.run(["ffmpeg", "-i", a.cut], capture_output=True, text=True).stderr
    mm = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", info)
    dur = f"{int(mm.group(1))*3600+int(mm.group(2))*60+float(mm.group(3)):.2f}" if mm else "?"
    print(f"\n{os.path.basename(a.cut)}  duration {dur}s  {len(words)} words")

    stut, script = [], []
    for s0, s1, g in merged:
        b0, b1 = at(s0), at(s1)
        (stut if (b0 and b0 == b1) else script).append((s0, s1, g, b0, b1))

    if script:
        head = "scripted repetition across beats (expected)" if spans else \
               "repeats found -- pass --edl to separate scripted lines from stutters"
        print(f"\n{head}:")
        for s0, s1, g, b0, b1 in script:
            w = f"   [{b0} -> {b1}]" if b0 else ""
            print(f"  {s0:6.2f}s / {s1:6.2f}s  \"{g}\"{w}")

    if stut:
        print(f"\nFAIL -- {len(stut)} repeat(s) inside one beat:")
        for s0, s1, g, b0, _ in stut:
            print(f"  {s0:6.2f}s / {s1:6.2f}s  beat '{b0}'  \"{g}\"")
        print("\nThat beat starts inside a previous attempt. Re-scan with scan_takes.py")
        print("and move its start later in beats.json.")
        return 1

    print("\nPASS -- no beat repeats itself." if spans
          else "\nNo same-beat check without --edl.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

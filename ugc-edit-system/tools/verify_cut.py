#!/usr/bin/env python3
"""Verify a finished cut by listening to it the way a viewer does.

    python3 tools/verify_cut.py cuts/my-cut-v1.mp4

Transcribes the finished file and flags any phrase that repeats within a short
span -- that is a surviving stutter, i.e. two attempts at the same sentence
left in the timeline. This is the only check that reflects the actual audio;
an edit plan can look correct and still contain a repeat.

Exit code 1 if repeats were found.
"""
import argparse, json, re, subprocess, tempfile, os, sys

def _whisper_threads():
    """Threads Whisper may use. Defaults to (cores - 2, min 1) so the machine
    stays usable -- unbounded CPU inference on a 4-core laptop with 8GB RAM
    locks the UI and drives the system into swap. Override with SNIPAI_THREADS."""
    import os as _os
    env = _os.environ.get("SNIPAI_THREADS")
    if env and env.isdigit():
        return max(1, int(env))
    return max(1, (_os.cpu_count() or 4) - 2)




def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut")
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--window", type=float, default=12.0,
                    help="flag repeats occurring within this many seconds of each other")
    ap.add_argument("-n", "--ngram", type=int, default=3)
    ap.add_argument("--print-transcript", action="store_true")
    a = ap.parse_args()

    from faster_whisper import WhisperModel
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-i", a.cut, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", wav, "-loglevel", "error", "-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    m = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=_whisper_threads())
    segs, _ = m.transcribe(wav, word_timestamps=True, vad_filter=False,
                           condition_on_previous_text=False)

    words = []
    for s in segs:
        if a.print_transcript:
            print(f"{s.start:6.2f}-{s.end:6.2f}: {s.text.strip()}")
        for w in s.words:
            tok = re.sub(r"[^a-z0-9']", "", w.word.lower())
            if tok:
                words.append((tok, w.start, w.end))
    os.remove(wav)

    seen, hits = {}, []
    for i in range(len(words) - a.ngram + 1):
        gram = tuple(w[0] for w in words[i:i + a.ngram])
        t = words[i][1]
        if gram in seen and t - seen[gram] <= a.window:
            hits.append((seen[gram], t, " ".join(gram)))
        seen[gram] = t

    merged = []
    for s0, s1, g in hits:
        if merged and abs(merged[-1][1] - s1) < 1.5:
            merged[-1] = (merged[-1][0], s1, merged[-1][2] + " " + g.split()[-1])
        else:
            merged.append((s0, s1, g))

    try:
        dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                              "-of", "default=nw=1:nk=1", a.cut],
                             capture_output=True, text=True).stdout.strip()
    except FileNotFoundError:
        # no ffprobe (e.g. ffmpeg installed via imageio-ffmpeg) -- read it off ffmpeg
        info = subprocess.run(["ffmpeg", "-i", a.cut], capture_output=True, text=True).stderr
        m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", info)
        dur = f"{int(m.group(1))*3600 + int(m.group(2))*60 + float(m.group(3)):.2f}" if m else "?"
    print(f"\n{a.cut}  duration {dur}s  {len(words)} words")
    if not merged:
        print("PASS -- no repeated phrases.")
        return 0
    print(f"FAIL -- {len(merged)} repeated phrase(s):")
    for s0, s1, g in merged:
        print(f"  {s0:6.2f}s and {s1:6.2f}s: \"{g}\"")
    print("\nFix the in-point of the beat covering the later timestamp -- it is almost")
    print("always starting inside the tail of a previous attempt. Use scan_takes.py.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

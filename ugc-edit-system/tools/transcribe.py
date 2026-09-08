#!/usr/bin/env python3
"""Word-level transcript of a source video.

    python3 tools/transcribe.py <video> -o work/transcript.json

The transcript is a starting point, NOT ground truth for take selection --
Whisper folds pauses and restarts into the duration of the preceding word.
Any mid-sentence word longer than ~0.8s is a suspected restart; confirm with
scan_takes.py before trusting an in-point. See CLAUDE.md.
"""
import argparse, json, subprocess, tempfile, os, sys

def _whisper_threads():
    """Threads Whisper may use. Defaults to (cores - 2, min 1) so the machine
    stays usable -- unbounded CPU inference on a 4-core laptop with 8GB RAM
    locks the UI and drives the system into swap. Override with SNIPAI_THREADS."""
    import os as _os
    env = _os.environ.get("SNIPAI_THREADS")
    if env and env.isdigit():
        return max(1, int(env))
    return max(1, (_os.cpu_count() or 4) - 2)




def audio_of(video):
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", wav, "-loglevel", "error", "-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    return wav


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("-o", "--out", default="transcript.json")
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--flag-threshold", type=float, default=0.8,
                    help="warn about word spans longer than this (likely hidden restarts)")
    a = ap.parse_args()

    from faster_whisper import WhisperModel
    wav = audio_of(a.video)
    m = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=_whisper_threads())
    segs, info = m.transcribe(wav, word_timestamps=True, vad_filter=False,
                              condition_on_previous_text=False)

    # Whisper streams segments as it goes, and info.duration is the whole
    # file, so how far through it is is simply the last timestamp over the
    # total. Printed as a machine-readable line the app turns into a progress
    # bar -- a nine-minute transcription with no feedback looks like a hang.
    total = float(getattr(info, "duration", 0) or 0)
    last_pct = -1

    out, suspects = [], []
    for s in segs:
        words = [{"w": w.word, "s": round(w.start, 2), "e": round(w.end, 2)} for w in s.words]
        out.append({"start": round(s.start, 2), "end": round(s.end, 2),
                    "text": s.text, "words": words})
        print(f"{s.start:7.2f}-{s.end:7.2f}: {s.text.strip()}")
        if total > 0:
            pct = min(99, int(s.end / total * 100))
            if pct > last_pct:
                last_pct = pct
                print(f"PROGRESS {pct}", flush=True)
        for w in words:
            if w["e"] - w["s"] > a.flag_threshold:
                suspects.append(w)
    print("PROGRESS 100", flush=True)
    os.remove(wav)

    with open(a.out, "w") as f:
        json.dump(out, f, indent=1)
    print(f"\nWrote {a.out}  ({len(out)} segments)")
    if suspects:
        print(f"\n{len(suspects)} long word spans -- likely hidden pauses or restarts.")
        print("Scan these regions before choosing in-points:")
        for w in suspects[:40]:
            print(f"  {w['s']:7.2f}-{w['e']:7.2f} ({w['e']-w['s']:4.2f}s) {w['w'].strip()!r}")


if __name__ == "__main__":
    sys.exit(main())

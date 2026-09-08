#!/usr/bin/env python3
"""Fine-window scan of a source region, to expose restarts the transcript hides.

    python3 tools/scan_takes.py <video> 120 130
    python3 tools/scan_takes.py <video> 120 130 --width 2.2 --hop 1.4

Whisper collapses repeated attempts when it decodes a long stretch at once.
Short windows force fine decoding, so each restart shows up as its own line.
Read the output bottom-up: the LAST complete recitation is the one to use.
"""
import argparse, subprocess, tempfile, os, sys

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
    ap.add_argument("video")
    ap.add_argument("start", type=float)
    ap.add_argument("end", type=float)
    ap.add_argument("--width", type=float, default=3.5)
    ap.add_argument("--hop", type=float, default=2.5)
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--words", action="store_true", help="also print word timings")
    a = ap.parse_args()

    from faster_whisper import WhisperModel
    m = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=_whisper_threads())
    wav = tempfile.mktemp(suffix=".wav")
    t = a.start
    while t < a.end:
        d = min(a.width, a.end - t)
        if d < 0.8:
            break
        subprocess.run(["ffmpeg", "-y", "-ss", str(t), "-t", str(d), "-i", a.video, "-vn",
                        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
                        "-loglevel", "error", "-nostats"], check=True, stdin=subprocess.DEVNULL)
        segs, _ = m.transcribe(wav, word_timestamps=a.words, vad_filter=False,
                               condition_on_previous_text=False)
        segs = list(segs)
        print(f"  {t:7.2f}-{t+d:7.2f}: " + " ".join(s.text.strip() for s in segs), flush=True)
        if a.words:
            for s in segs:
                for w in s.words:
                    print(f"        {t+w.start:7.2f}-{t+w.end:7.2f} {w.word!r}")
        t += a.hop
    if os.path.exists(wav):
        os.remove(wav)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Measure the style of a finished video you did NOT shoot.

    python3 tools/measure_finished.py <video> [-o reference/target-style.json]

`align_reference.py` needs a raw + finished pair of the SAME take, so it can
only measure your own reference. To emulate someone else's channel you have
only their finished video -- no raw. This measures what can be recovered from
a finished cut alone:

  - cut rhythm, via ffmpeg scene detection (how often the picture changes)
  - shot length distribution (median / min / max)
  - delivery speed in words per second, via the transcript
  - total duration

Writes the same shape as reference/house-style.json so it can be dropped in
as the target that compare_to_reference.py measures against.

Caveat it cannot answer: whether captions/motion graphics are present. That
needs looking at the video, so those fields are left null for a human to set.
"""
import argparse, json, os, re, statistics, subprocess, sys, tempfile

def _whisper_threads():
    """Threads Whisper may use. Defaults to (cores - 2, min 1) so the machine
    stays usable -- unbounded CPU inference on a 4-core laptop with 8GB RAM
    locks the UI and drives the system into swap. Override with SNIPAI_THREADS."""
    import os as _os
    env = _os.environ.get("SNIPAI_THREADS")
    if env and env.isdigit():
        return max(1, int(env))
    return max(1, (_os.cpu_count() or 4) - 2)




def duration_of(video):
    out = subprocess.run(["ffmpeg", "-i", video], capture_output=True, text=True,
                         stdin=subprocess.DEVNULL).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", out)
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def scene_cuts(video, threshold):
    """Timestamps where the picture changes enough to count as a cut."""
    p = subprocess.run(
        ["ffmpeg", "-i", video, "-filter:v", f"select='gt(scene,{threshold})',showinfo",
         "-f", "null", "-"],
        capture_output=True, text=True, stdin=subprocess.DEVNULL)
    times = []
    for line in p.stderr.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            times.append(float(m.group(1)))
    return sorted(set(times))


def word_count(video, model):
    from faster_whisper import WhisperModel
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", wav, "-loglevel", "error", "-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    m = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=_whisper_threads())
    segs, _ = m.transcribe(wav, word_timestamps=False, vad_filter=False,
                           condition_on_previous_text=False)
    text = " ".join(s.text for s in segs)
    os.remove(wav)
    return len(text.split()), text.strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--threshold", type=float, default=0.30,
                    help="scene-change sensitivity, 0-1. Lower finds more cuts.")
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--no-transcribe", action="store_true")
    a = ap.parse_args()

    dur = duration_of(a.video)
    if not dur:
        print("could not read duration", file=sys.stderr)
        return 1

    cuts = scene_cuts(a.video, a.threshold)
    # shot boundaries are the cuts plus the start and end of the video
    bounds = [0.0] + cuts + [dur]
    shots = [round(bounds[i + 1] - bounds[i], 3) for i in range(len(bounds) - 1)]
    shots = [s for s in shots if s > 0.01]
    segments = len(shots)

    words, text = (0, "")
    if not a.no_transcribe:
        words, text = word_count(a.video, a.model)

    style = {
        "measured_from": [os.path.basename(a.video)],
        "how": "tools/measure_finished.py -- finished video only, no raw take available",
        "duration": round(dur, 2),
        "segments": segments,
        "seconds_per_cut": round(dur / max(segments, 1), 2),
        "segment_seconds": {
            "min": min(shots) if shots else None,
            "median": round(statistics.median(shots), 2) if shots else None,
            "max": max(shots) if shots else None,
        },
        "words_per_second": round(words / dur, 2) if words else None,
        "captions": None,
        "graphic_overlays": None,
        "music_bed": None,
        "tolerance": {"duration_pct": 20, "median_segment_pct": 40},
        "_note": "captions/graphic_overlays/music_bed need a human to look at the video -- "
                 "they cannot be measured from timing alone.",
    }

    print(f"{os.path.basename(a.video)}")
    print(f"  duration        {style['duration']}s")
    print(f"  cuts detected   {segments}  (threshold {a.threshold})")
    print(f"  seconds per cut {style['seconds_per_cut']}s")
    if shots:
        print(f"  shot length     min {style['segment_seconds']['min']}s  "
              f"median {style['segment_seconds']['median']}s  max {style['segment_seconds']['max']}s")
    if words:
        print(f"  words/sec       {style['words_per_second']}  ({words} words)")
    if segments <= 1:
        print("  NOTE: no picture changes found -- either a single continuous shot, or the")
        print("        threshold is too high. Try --threshold 0.15.")

    if a.out:
        with open(a.out, "w") as f:
            json.dump(style, f, indent=1)
        print(f"\nWrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

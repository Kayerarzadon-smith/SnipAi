#!/usr/bin/env python3
"""Silence map of a source video, used for trimming pauses inside a beat.

    python3 tools/silence_map.py <video> -o work/silence.txt
"""
import argparse, subprocess, sys


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("-o", "--out", default="silence.txt")
    ap.add_argument("--noise", default="-28dB")
    ap.add_argument("--min-dur", default="0.10")
    a = ap.parse_args()

    # -vn: never decode the video stream. silencedetect only reads audio,
    # and decoding 4K HEVC to find silence is minutes instead of seconds.
    p = subprocess.run(["ffmpeg", "-i", a.video, "-vn", "-af",
                        f"silencedetect=noise={a.noise}:d={a.min_dur}", "-f", "null", "-"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    lines = [l for l in p.stderr.splitlines() if "silence_start" in l or "silence_end" in l]
    with open(a.out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {a.out}  ({len(lines)//2} silence intervals at {a.noise}/{a.min_dur}s)")


if __name__ == "__main__":
    sys.exit(main())

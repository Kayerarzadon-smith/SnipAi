#!/usr/bin/env python3
"""Tile frames from a source into one strip image, for a timeline.

    python3 tools/filmstrip.py projects/<name> -o work/strip.jpg
    python3 tools/filmstrip.py projects/<name> --start 78 --end 83 --count 12

A timeline with no pictures in it is a grey bar -- you cannot tell what you
are about to cut. This pulls evenly spaced frames and lays them side by side
so the strip shows the footage itself, the way an edit suite does.

Frames are centre-cropped to a square: the footage is 9:16, and a strip of
true-aspect verticals is a row of slivers nobody can read.
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ffmpeg_bin():
    venv = os.path.join(ROOT, ".venv", "bin", "ffmpeg")
    return venv if os.path.exists(venv) else "ffmpeg"


def source_of(project):
    with open(os.path.join(project, "beats.json")) as fh:
        data = json.load(fh)
    src = data.get("source") if isinstance(data, dict) else None
    if not src:
        raise SystemExit("beats.json has no 'source'")
    return os.path.join(project, src)


def duration_of(path):
    """Length in seconds, read off ffmpeg (there is no ffprobe on this Mac)."""
    out = subprocess.run([ffmpeg_bin(), "-i", path], capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "Duration:" in line:
            hms = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = hms.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise SystemExit("could not read duration")


def build(src, out, start, end, count, size, aspect="square"):
    """One decode pass over just the window, tiled by ffmpeg itself.

    Seeking to each frame separately means re-opening a 4K HEVC file a dozen
    times; over a short window a single pass is several times faster and the
    tile filter does the assembly for free.
    """
    span = max(0.05, end - start)
    fps = count / span
    # A square crop stretched into a 14px-wide slot is unreadable smear. For
    # a timeline, take a tall centre slice instead -- it squashes gracefully.
    if aspect == "tall":
        crop = "crop='min(iw,ih)/2':'min(iw,ih)'"
        w, h = size // 2, size
    else:
        crop = "crop='min(iw,ih)':'min(iw,ih)'"
        w, h = size, size
    vf = f"fps={fps:.6f},{crop},scale={w}:{h},tile={count}x1"
    r = subprocess.run(
        [ffmpeg_bin(), "-v", "error", "-ss", f"{start:.3f}", "-t", f"{span:.3f}",
         "-i", src, "-vf", vf, "-frames:v", "1", "-q:v", "5", "-y", out],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not os.path.exists(out):
        raise SystemExit(f"ffmpeg failed: {r.stderr[:300]}")
    return count


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--count", type=int, default=0, help="0 = one frame every 4s")
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--aspect", choices=["square", "tall"], default="square")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--input", help="file to sample (default: the project's raw source)")
    a = ap.parse_args()

    project = a.project.rstrip("/")
    src = a.input if a.input else source_of(project)
    if not os.path.isabs(src):
        src = src if os.path.exists(src) else os.path.join(project, src)
    if not os.path.exists(src):
        raise SystemExit(f"not on this machine: {src}")

    end = a.end if a.end is not None else duration_of(src)
    count = a.count or max(8, min(160, int((end - a.start) / 4)))
    out = a.out if os.path.isabs(a.out) else os.path.join(project, a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    n = build(src, out, a.start, end, count, a.size, a.aspect)
    meta = {"start": a.start, "end": end, "count": n, "size": a.size, "aspect": a.aspect}
    with open(out + ".json", "w") as fh:
        json.dump(meta, fh)
    print(f"Wrote {out}  ({n} frames, {a.start:.1f}-{end:.1f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

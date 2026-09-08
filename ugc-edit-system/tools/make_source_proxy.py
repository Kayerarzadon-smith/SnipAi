#!/usr/bin/env python3
"""Make a scrubbing proxy of the raw source.

    python3 tools/make_source_proxy.py projects/<name>

Live edit plays the raw file and jumps from beat to beat. On 4K HEVC every one
of those jumps is a keyframe seek into a 1.4GB file, which is why playback
hitches for a moment at each cut.

This writes a 720p H.264 copy with a keyframe every half second. Same
timeline, same timestamps -- so every in/out point still means exactly what it
meant -- but seeking lands almost instantly. Made once per source and reused.

Audio is copied at full quality: these edits are decided by ear.
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ffmpeg_bin():
    venv = os.path.join(ROOT, ".venv", "bin", "ffmpeg")
    return venv if os.path.exists(venv) else "ffmpeg"


def source_of(project):
    with open(os.path.join(project, "beats.json")) as fh:
        cfg = json.load(fh)
    src = cfg.get("source")
    if not src:
        raise SystemExit("beats.json has no 'source'")
    return os.path.join(project, src) if not os.path.isabs(src) else src


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project")
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--crf", type=int, default=27)
    ap.add_argument("-o", "--out")
    a = ap.parse_args()

    project = a.project.rstrip("/")
    src = source_of(project)
    if not os.path.exists(src):
        raise SystemExit(f"source not on this machine: {src}")

    out = a.out or os.path.join(project, "work", "source-proxy.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    # -g 15 at 30fps is a keyframe every half second: the whole point, since
    # seek time is dominated by how far back the last keyframe is.
    cmd = [
        ffmpeg_bin(), "-y", "-i", src,
        "-vf", f"scale=-2:{a.height}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(a.crf),
        "-g", "15", "-keyint_min", "15", "-sc_threshold", "0",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        out, "-loglevel", "error", "-nostats",
    ]
    print(f"transcoding {os.path.basename(src)} -> {os.path.basename(out)} "
          f"({a.height}p, keyframe every 0.5s)...")
    if subprocess.run(cmd, stdin=subprocess.DEVNULL).returncode != 0:
        raise SystemExit("ffmpeg failed")
    mb = os.path.getsize(out) / 1e6
    print(f"Wrote {out}  ({mb:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

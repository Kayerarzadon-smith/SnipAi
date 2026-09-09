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
import argparse, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ffmpeg_bin():
    # SNIPAI_FFMPEG first: inside the .app there is no venv, and this Mac has
    # no system ffmpeg at all, so a bare "ffmpeg" is not a fallback -- it is a
    # FileNotFoundError with the shape of one.
    env = (os.environ.get("SNIPAI_FFMPEG") or "").strip()
    if env and os.path.exists(env):
        return env
    venv = os.path.join(ROOT, ".venv", "bin", "ffmpeg")
    if os.path.exists(venv):
        return venv
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def source_seconds(src):
    """How long the footage is, read off ffmpeg's own banner.

    There is no ffprobe on this machine (see CLAUDE.md). `ffmpeg -i` with no
    output prints the Duration line and exits non-zero, which costs a few
    milliseconds and is the cheapest honest answer available.
    """
    p = subprocess.run([ffmpeg_bin(), "-i", src], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d\d):(\d\d)\.(\d+)", p.stderr or "")
    if not m:
        return None
    h, mi, sec, frac = m.groups()
    return int(h) * 3600 + int(mi) * 60 + int(sec) + float("0." + frac)


def transcode(cmd, total):
    """Run ffmpeg and report how far in it has got.

    -nostats plus -loglevel error means ffmpeg says NOTHING for the whole
    transcode. On a 1.8GB 4K source that is ten minutes of silence, and the
    runner -- which judges a job by whether it is still talking, not by how
    long it has taken -- killed it at five with "stopped responding". The job
    was working the whole time.

    -progress pipe:1 turns that silence into a key=value block every second:
    a heartbeat the runner can see, and the percentage the queue can show.
    """
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    last = -1
    for line in proc.stdout:
        line = line.strip()
        if not line.startswith("out_time_ms="):
            continue
        try:
            done = int(line.split("=", 1)[1]) / 1_000_000.0
        except ValueError:
            continue
        if total:
            pct = max(0, min(99, int(done / total * 100)))
            if pct != last:
                last = pct
                print(f"PROGRESS {pct}", flush=True)
                print(f"shrinking for smooth playback — {pct}%", flush=True)
        elif int(done) != last:
            last = int(done)
            print(f"shrinking for smooth playback — {int(done)}s in", flush=True)
    err = proc.stderr.read()
    if proc.wait() != 0:
        sys.stderr.write((err or "")[-1500:] + "\n")
        return False
    return True


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
        # a heartbeat, and a real percentage: see transcode()
        "-progress", "pipe:1",
    ]
    total = source_seconds(src)
    print(f"transcoding {os.path.basename(src)} -> {os.path.basename(out)} "
          f"({a.height}p, keyframe every 0.5s)...", flush=True)
    if not transcode(cmd, total):
        raise SystemExit("ffmpeg failed")
    mb = os.path.getsize(out) / 1e6
    print(f"Wrote {out}  ({mb:.0f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

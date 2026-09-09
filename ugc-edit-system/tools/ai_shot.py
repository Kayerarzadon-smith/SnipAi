#!/usr/bin/env python3
"""Hold on a frame, swap what is in it, and carry on.

    python3 tools/ai_shot.py <cut.mp4> --at 12.4 --hold 2.2 \
        --image aged-neck.png --sfx click.wav -o out.mp4

The beat this makes is the one people already know: you point at something,
there is a click, the picture stops dead with the thing changed, and then the
edit carries on as if nothing happened.

Why a FREEZE and not an overlay on moving video:

    A generated still cannot follow a face. Composited over live footage it
    slides off the moment the head moves, and at 4K that is obvious in a
    frame or two. Freezing removes the problem rather than fighting it -- and
    the freeze is what makes the click mean something, instead of a noise
    played over a video that did not react to it.

This tool does not generate anything. It is handed an image and puts it on
screen; where that image came from is the app's business.
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import data_path  # noqa: E402


def ffmpeg():
    """The bundled binary. Never a bare `ffmpeg`: a GUI-launched app has a
    minimal PATH and this machine has no system ffmpeg at all."""
    env = (os.environ.get("SNIPAI_FFMPEG") or "").strip()
    if env and os.path.exists(env):
        return env
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def run(args, what):
    p = subprocess.run(args, stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if p.returncode != 0:
        sys.stderr.write(f"{what} failed:\n{p.stdout[-1500:]}\n")
        return False
    return True


def grab_frame(cut, at, out_png):
    """One frame, at the moment being pointed at.

    -ss before -i seeks by keyframe and is fast but approximate; after -i is
    exact and slower. Exact matters here -- a frame either side is a different
    hand position, and the frozen picture has to match the one the viewer was
    just looking at.
    """
    return run([ffmpeg(), "-y", "-i", cut, "-ss", f"{at:.3f}",
                "-frames:v", "1", "-q:v", "2", out_png,
                "-loglevel", "error", "-nostats"], "frame grab")


def build(cut, at, hold, image, out, sfx=None, fade=0.12):
    """Cut in, hold the still, cut out, with the click on the join."""
    ff = ffmpeg()
    filt = [
        # everything up to the moment
        f"[0:v]trim=end={at:.3f},setpts=PTS-STARTPTS[a]",
        # everything after it, shifted so the hold does not overwrite the edit
        f"[0:v]trim=start={at:.3f},setpts=PTS-STARTPTS[c]",
        # the still, held, at the cut's own size
        f"[1:v]scale=-1:-1,loop=loop=-1:size=1:start=0,"
        f"trim=duration={hold:.3f},setpts=PTS-STARTPTS,format=yuv420p[b]",
        "[a][b][c]concat=n=3:v=1:a=0[v]",
        # audio: the same three spans, so sound and picture stay together
        f"[0:a]atrim=end={at:.3f},asetpts=PTS-STARTPTS[aa]",
        f"[0:a]atrim=start={at:.3f},asetpts=PTS-STARTPTS[ac]",
        f"anullsrc=r=48000:cl=stereo,atrim=duration={hold:.3f}[ab]",
        "[aa][ab][ac]concat=n=3:v=0:a=1[abase]",
    ]
    inputs = [ff, "-y", "-i", cut, "-i", image]
    amap = "[abase]"
    if sfx and os.path.exists(sfx):
        inputs += ["-i", sfx]
        # the click lands ON the freeze, not near it
        filt.append(f"[2:a]adelay={int(at * 1000)}|{int(at * 1000)},volume=0.9[click]")
        filt.append("[abase][click]amix=inputs=2:duration=first:dropout_transition=0[aout]")
        amap = "[aout]"
    return run(inputs + [
        "-filter_complex", ";".join(filt),
        "-map", "[v]", "-map", amap,
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        out, "-loglevel", "error", "-nostats",
    ], "freeze and composite")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut")
    ap.add_argument("--at", type=float, required=True, help="seconds into the cut")
    ap.add_argument("--hold", type=float, default=2.0, help="how long the still holds")
    ap.add_argument("--image", help="the picture to hold. Omitted: grab and hold the "
                                    "untouched frame, which proves the beat without "
                                    "spending anything at a provider")
    ap.add_argument("--sfx", help="a click, landed on the freeze")
    ap.add_argument("--grab-only", metavar="PNG",
                    help="just pull the frame out and stop -- what gets sent away")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()

    if a.grab_only:
        ok = grab_frame(a.cut, a.at, a.grab_only)
        print(f"frame at {a.at:.2f}s -> {a.grab_only}" if ok else "could not grab the frame")
        return 0 if ok else 1

    if not a.out:
        sys.stderr.write("-o is required\n")
        return 2

    image = a.image
    tmp = None
    if not image:
        # No generated image: hold the real frame. The timing, the freeze and
        # the click are all exercised, and nothing has been invented.
        tmp = os.path.join(os.path.dirname(os.path.abspath(a.out)), ".ai-shot-frame.png")
        if not grab_frame(a.cut, a.at, tmp):
            return 1
        image = tmp
        print("no image given -- holding the untouched frame")

    sfx = a.sfx
    if sfx and not os.path.isabs(sfx):
        sfx = data_path("reference", "sfx", sfx)

    ok = build(a.cut, a.at, a.hold, image, a.out, sfx)
    if tmp and os.path.exists(tmp):
        os.remove(tmp)
    if not ok:
        return 1
    print(f"held {a.hold:.2f}s at {a.at:.2f}s -> {os.path.basename(a.out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

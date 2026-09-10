#!/usr/bin/env python3
"""CATEGORY 021 — inspect the rendered media, not the render's exit code.

An export that returned 0 and said "Complete" can still be a file with no
audio, a duration that does not match the edit, a silent tail, or picture and
sound that have drifted apart. The only way to know is to open the file.

Read-only. It never touches a project; it opens the cut and measures it.

    python3 qa/verify_media.py <project-dir> [--cut path]
"""
import argparse
import json
import os
import re
import subprocess
import sys

RESULTS = []


def record(name, outcome, detail=""):
    RESULTS.append((name, outcome, detail))


def ffmpeg():
    env = (os.environ.get("SNIPAI_FFMPEG") or "").strip()
    if env and os.path.exists(env):
        return env
    for guess in ("ugc-edit-system/.venv/bin/ffmpeg",):
        if os.path.exists(guess):
            return guess
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def probe(path):
    """Duration and streams, off ffmpeg's banner. There is no ffprobe here."""
    p = subprocess.run([ffmpeg(), "-i", path], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    txt = p.stderr or ""
    out = {"duration": None, "video": None, "audio": None, "raw": txt}
    m = re.search(r"Duration:\s*(\d+):(\d\d):(\d\d)\.(\d+)", txt)
    if m:
        h, mi, s, f = m.groups()
        out["duration"] = int(h) * 3600 + int(mi) * 60 + int(s) + float("0." + f)
    v = re.search(r"Stream #\d+:\d+.*?: Video: (\w+).*?, (\d+)x(\d+).*?, ([\d.]+) fps", txt)
    if v:
        out["video"] = {"codec": v.group(1), "w": int(v.group(2)),
                        "h": int(v.group(3)), "fps": float(v.group(4))}
    a = re.search(r"Stream #\d+:\d+.*?: Audio: (\w+).*?, (\d+) Hz, (\w+)", txt)
    if a:
        out["audio"] = {"codec": a.group(1), "rate": int(a.group(2)), "layout": a.group(3)}
    return out


def silent_stretches(path, floor="-50dB", min_dur=1.5):
    """Real silent ranges, in seconds, from silencedetect.

    An earlier version of this used `astats=reset=N`, where N counts audio
    FRAMES, not seconds -- so it reported "5239 seconds" of a 111-second file
    and a "328s" silent run. The instrument was wrong, not the cut. Worth
    saying out loud: a QA check that measures the wrong thing manufactures
    defects, which is more expensive than missing one.
    """
    # -vn -map 0:a:0 because without them ffmpeg fully decodes the video to
    # measure the audio. On a 2160x3840 cut that is the difference between
    # about two seconds and not finishing at all -- and this is the check
    # Part 6 of the spec ranks first, so it is the one a tester is most
    # likely to abandon.
    p = subprocess.run(
        [ffmpeg(), "-i", path, "-vn", "-map", "0:a:0",
         "-af", f"silencedetect=noise={floor}:d={min_dur}",
         "-f", "null", "-", "-loglevel", "info", "-nostats"],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    txt = p.stderr or ""
    starts = [float(x) for x in re.findall(r"silence_start:\s*(-?[\d.]+)", txt)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", txt)]
    out = []
    for i, s0 in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        out.append((max(0.0, s0), e))
    return out


def black_frames(path, duration=None, chunk=60.0):
    """Frames that are entirely black. A cut should never produce one.

    Unlike the silence pass this one really does have to decode the video, and
    a 2160x3840 h264 decodes at about 25fps on four cores -- roughly real time
    for a 30fps cut. `-an` keeps it from decoding the audio as well, and the
    file is walked in chunks so that a long cut cannot sit in one command for
    minutes on end. Chunk boundaries are input seeks, so a reported black
    stretch is accurate to the chunk, not to the millisecond -- fine, because
    the question is whether there is one at all.
    """
    windows = [(None, None)]
    if duration and duration > chunk:
        windows = [(t, min(chunk, duration - t))
                   for t in [i * chunk for i in range(int(duration // chunk) + 1)]
                   if duration - t > 0.05]
    found = []
    for start, dur in windows:
        cmd = [ffmpeg(), "-nostdin"]
        if start is not None:
            cmd += ["-ss", f"{start:.3f}"]
        cmd += ["-i", path]
        if dur is not None:
            cmd += ["-t", f"{dur:.3f}"]
        cmd += ["-an", "-vf", "blackdetect=d=0.08:pix_th=0.10",
                "-f", "null", "-", "-loglevel", "info", "-nostats"]
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        off = start or 0.0
        for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", p.stderr or ""):
            found.append((f"{float(a) + off:.3f}", f"{float(b) + off:.3f}"))
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--cut")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    edl_path = os.path.join(proj, "work", "edl.json")
    if not os.path.exists(edl_path):
        print(f"BLOCKED: no work/edl.json in {proj} — nothing has been built")
        return 2

    edl = json.load(open(edl_path))
    pieces = edl if isinstance(edl, list) else edl.get("pieces", edl.get("edl", []))
    edl_total = round(sum(p["dur"] for p in pieces), 3)

    cut = a.cut
    if not cut:
        cuts = os.path.join(proj, "cuts")
        files = [f for f in os.listdir(cuts) if f.endswith((".mp4", ".mov"))
                 and not f.endswith("-graphics.mp4")]
        if not files:
            print("BLOCKED: no cut on disk")
            return 2
        cut = os.path.join(cuts, sorted(files, key=lambda f: os.path.getmtime(os.path.join(cuts, f)))[-1])

    print(f"cut       {os.path.basename(cut)}  ({os.path.getsize(cut)/1e6:.0f} MB)")
    info = probe(cut)
    print(f"duration  {info['duration']}s     EDL says {edl_total}s")

    # INVARIANT 7 — the file must be the timeline it was rendered from
    if info["duration"] is None:
        record("the cut has a readable duration", "fail", "ffmpeg reported none")
    else:
        # The EDL is written to 3dp; video comes in whole frames. Each piece
        # is extracted with -ss/-t and quantised UP to the next frame, so the
        # file is systematically a little longer than the EDL asked for --
        # about half a frame per piece on average, which is what both of
        # Kayer's cuts show (46 pieces / 715ms, 47 pieces / 698ms against a
        # predicted 0.77s and 0.78s). That is physics, not a defect. What
        # WOULD be a defect is drift beyond one whole frame per piece.
        fps = (info["video"] or {}).get("fps") or 30.0
        bound = len(pieces) / fps
        drift = abs(info["duration"] - edl_total)
        record("rendered length matches the EDL it came from",
               "pass" if drift <= bound else "fail",
               f"{drift*1000:.0f}ms over {len(pieces)} pieces "
               f"(frame quantisation allows up to {bound*1000:.0f}ms)")

    record("the cut has a video stream", "pass" if info["video"] else "fail", str(info["video"]))
    record("the cut has an audio stream", "pass" if info["audio"] else "fail", str(info["audio"]))
    if info["video"]:
        record("frame rate is sane", "pass" if 20 <= info["video"]["fps"] <= 61 else "fail",
               f"{info['video']['fps']} fps")
        record("resolution is sane",
               "pass" if info["video"]["w"] > 0 and info["video"]["h"] > 0 else "fail",
               f"{info['video']['w']}x{info['video']['h']}")

    # No dead air where a cut landed, and no black frames at a join
    print("measuring silence...", flush=True)
    gaps = silent_stretches(cut)
    total = info["duration"] or 0
    longest = 0.0
    for s0, e in gaps:
        end = e if e is not None else total
        longest = max(longest, end - s0)
    # A music-free UGC cut has room tone under it, not digital silence. A gap
    # longer than a breath means a beat rendered with no sound behind it.
    record("no dead patch longer than 3s", "pass" if longest <= 3.0 else "fail",
           f"longest silent stretch {longest:.2f}s over {len(gaps)} gap(s)")
    record("the cut is not mostly silence",
           "pass" if sum((e if e is not None else total) - s0 for s0, e in gaps) < total * 0.5 else "fail",
           f"{sum((e if e is not None else total) - s0 for s0, e in gaps):.1f}s silent of {total:.1f}s")

    print("looking for black frames...", flush=True)
    blacks = black_frames(cut, info["duration"])
    record("no black frames at the joins", "pass" if not blacks else "fail",
           f"{len(blacks)} black stretch(es): {blacks[:3]}")

    # Every piece the EDL claims must be inside the source it names
    src = None
    try:
        cfg = json.load(open(os.path.join(proj, "beats.json")))
        src = os.path.join(proj, cfg["source"])
    except Exception:
        pass
    if src and os.path.exists(src):
        sinfo = probe(src)
        if sinfo["duration"]:
            bad = [p for p in pieces
                   if p["src_start"] < -0.01 or p["src_end"] > sinfo["duration"] + 0.5]
            record("every EDL piece lies inside the source footage",
                   "pass" if not bad else "fail",
                   f"{len(bad)} piece(s) outside 0..{sinfo['duration']}s")
            record("no EDL piece is inverted or empty",
                   "pass" if all(p["src_end"] > p["src_start"] for p in pieces) else "fail", "")
    else:
        record("EDL pieces checked against the source", "blocked", "source footage not on this machine")

    print()
    for name, outcome, detail in RESULTS:
        mark = {"pass": "PASS", "fail": "FAIL", "blocked": "BLOCKED"}[outcome]
        print(f"  {mark:8} {name}" + (f"  — {detail}" if detail else ""))
    fails = sum(1 for _, o, _ in RESULTS if o == "fail")
    print(f"\n{len(RESULTS)} checks, {fails} failed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Place and mix sound effects into a finished cut.

    python3 tools/add_sfx.py <cut.mp4> --project projects/<name> -o <out.mp4>

Where effects go is the part that needs to be worked out; the sounds
themselves come from your own library. Drop files in reference/sfx/ and map
them in reference/sfx.json.

What it places, and why:

  cut        a short whoosh on each join between beats. Read off work/edl.json,
             so it lands exactly on the cut, not near it.
  card       a soft pop when a definition card appears, from work/cues.json.
  hook       one impact at the top of the video -- the first beat is the hook,
             and the first second is what decides whether anyone keeps watching.

Effects are ducked under the voice (default -12dB) so they never fight the
read. Voice is never re-encoded louder or compressed; it is mixed, not
replaced.

Nothing is invented: if a sound file is missing, that cue is skipped and
reported rather than silently dropped.
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MAP = os.path.join(ROOT, "reference", "sfx.json")


def load_map(path):
    if not os.path.exists(path):
        return {}
    data = json.load(open(path))
    return data.get("events", {})


def base_label(label):
    """'hook-0' and 'hook-1' are two pieces of the SAME beat, split by a pause
    trim. 'hook' -> 'peptides' is a real change of line."""
    return label.rsplit("-", 1)[0] if label[-1].isdigit() and "-" in label else label


def edl_cut_times(project):
    """Join points BETWEEN beats, in cut time.

    Skips joins inside a beat: build_cut splits a beat into pieces where it
    shortens an internal pause, and those joins are meant to be invisible --
    a whoosh in the middle of a sentence reads as a mistake, not an edit.
    """
    p = os.path.join(project, "work", "edl.json")
    if not os.path.exists(p):
        return []
    edl = json.load(open(p))
    times, t = [], 0.0
    for i, piece in enumerate(edl[:-1]):
        t += piece["dur"]
        if base_label(piece["label"]) != base_label(edl[i + 1]["label"]):
            times.append(round(t, 3))
    return times


def card_times(project):
    p = os.path.join(project, "work", "cues.json")
    if not os.path.exists(p):
        return []
    return [c["start"] for c in json.load(open(p)).get("cues", [])]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut")
    ap.add_argument("--project", required=True)
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--map", default=DEFAULT_MAP)
    ap.add_argument("--duck", type=float, default=-12.0,
                    help="dB the effects sit under the voice")
    ap.add_argument("--no-cut-sfx", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="show placement, render nothing")
    a = ap.parse_args()

    events = load_map(a.map)
    if not events:
        print(f"No sfx map at {a.map}.")
        print("Create reference/sfx.json like:")
        print('  { "events": { "cut": "sfx/whoosh.wav", "card": "sfx/pop.wav",')
        print('                "hook": "sfx/impact.wav" } }')
        print("and put the files in reference/sfx/.")
        return 1

    cues = []
    if not a.no_cut_sfx and events.get("cut"):
        for t in edl_cut_times(a.project):
            cues.append(("cut", t, events["cut"]))
    if events.get("card"):
        for t in card_times(a.project):
            cues.append(("card", max(0.0, t - 0.05), events["card"]))
    if events.get("hook"):
        cues.append(("hook", 0.0, events["hook"]))

    cues.sort(key=lambda c: c[1])

    resolved, missing = [], []
    for kind, t, rel in cues:
        p = rel if os.path.isabs(rel) else os.path.join(ROOT, "reference", rel)
        (resolved if os.path.exists(p) else missing).append((kind, t, p))

    print(f"{os.path.basename(a.cut)} -- {len(resolved)} effect(s) placed")
    for kind, t, p in resolved:
        print(f"  {t:6.2f}s  {kind:5} {os.path.basename(p)}")
    for kind, t, p in missing:
        print(f"  {t:6.2f}s  {kind:5} MISSING {p}")
    if not resolved:
        print("nothing to mix")
        return 1
    if a.dry_run:
        return 0

    # one input per effect, delayed to its cue time, all mixed under the voice
    cmd = ["ffmpeg", "-y", "-i", a.cut]
    for _, _, p in resolved:
        cmd += ["-i", p]

    parts, labels = [], []
    for i, (_, t, _) in enumerate(resolved, start=1):
        ms = int(t * 1000)
        parts.append(f"[{i}:a]adelay={ms}|{ms},volume={a.duck}dB[s{i}]")
        labels.append(f"[s{i}]")
    mix = "".join(labels) + f"amix=inputs={len(resolved)}:duration=longest:dropout_transition=0[sfx]"
    # voice stays at unity; effects sit underneath it
    final = "[0:a][sfx]amix=inputs=2:duration=first:weights=1 1[aout]"
    filt = ";".join(parts + [mix, final])

    cmd += ["-filter_complex", filt, "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", a.out, "-loglevel", "error", "-nostats"]

    if subprocess.run(cmd, stdin=subprocess.DEVNULL).returncode != 0:
        print("ffmpeg failed", file=sys.stderr)
        return 1
    print(f"\nWrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

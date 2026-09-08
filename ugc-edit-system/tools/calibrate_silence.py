#!/usr/bin/env python3
"""Measure a video's actual noise floor and pick silence thresholds from it.

    python3 tools/calibrate_silence.py <video> -o <project>/work/silence-cal.json

Hardcoded thresholds are a guess about someone else's room. -28dB works for
the MediCube footage; a quieter room, a louder AC, a different mic and it is
wrong in one direction or the other -- too high and quiet word tails read as
silence (so snapping to them clips the word), too low and real pauses are
never found.

This measures the file instead:

  floor   the quietest sustained level in the video -- room tone
  speech  the level speech actually sits at

and derives two thresholds from the gap between them:

  trim    for finding pauses to trim INSIDE a line (nearer the speech level)
  strict  for finding where a word truly ends, used to snap beat edges
          (just above the floor, so no word energy is ever cut)

Writes JSON that build_cut.py and the app read.
"""
import argparse, json, os, re, subprocess, sys, tempfile


def extract_audio(video):
    """Pull the audio out ONCE to a small wav.

    The sweep runs a dozen passes; doing them against the original means
    decoding the video stream every time. On 4K HEVC that is the difference
    between a few seconds and many minutes -- decoding 8 minutes of 4K
    twelve times over is exactly the kind of thing that takes a laptop down.
    """
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", wav, "-loglevel", "error", "-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    return wav


def volumedetect(video):
    """Overall mean/max level of the file."""
    p = subprocess.run(["ffmpeg", "-i", video, "-vn", "-af", "volumedetect", "-f", "null", "-"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    mean = max_v = None
    for line in p.stderr.splitlines():
        m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", line)
        if m:
            mean = float(m.group(1))
        m = re.search(r"max_volume:\s*(-?[\d.]+) dB", line)
        if m:
            max_v = float(m.group(1))
    return mean, max_v


def silence_count(video, db, min_dur=0.06):
    p = subprocess.run(["ffmpeg", "-i", video, "-vn", "-af",
                        f"silencedetect=noise={db}dB:d={min_dur}", "-f", "null", "-"],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    starts = len(re.findall(r"silence_start", p.stderr))
    total = sum(float(x) for x in re.findall(r"silence_duration:\s*([\d.]+)", p.stderr))
    return starts, total


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    # one decode, then every pass reads the small wav
    audio = extract_audio(a.video)
    mean, peak = volumedetect(audio)
    if mean is None:
        print("could not read levels", file=sys.stderr)
        return 1

    # Sweep downward. As the threshold drops, fewer things count as silence.
    # The floor is where the count stops changing: below that there is nothing
    # left but true silence.
    sweep = []
    for db in range(-20, -71, -5):
        n, total = silence_count(audio, db)
        sweep.append({"db": db, "regions": n, "silent_seconds": round(total, 2)})

    # Find the room-tone floor by where the curve FLATTENS, not where it stops.
    #
    # A clean synthetic file reaches true digital silence and the region count
    # settles. Real footage never does -- there is always room tone, breath,
    # a fridge -- so the count just wanders and "where it settles" picks an
    # absurdly low threshold. What actually marks the floor is the plateau in
    # how much of the file reads as silent: above the room tone, dropping the
    # threshold barely changes anything; once you go below the room tone,
    # silence falls away fast. The flattest step is the floor.
    deltas = []
    for i in range(len(sweep) - 1):
        drop = sweep[i]["silent_seconds"] - sweep[i + 1]["silent_seconds"]
        deltas.append((abs(drop), sweep[i + 1]["db"], sweep[i]["db"]))

    if deltas:
        _, below, at = min(deltas, key=lambda d: d[0])
        # sit just above the flattest point: still clear of speech energy, but
        # not so low that genuine pauses stop registering
        strict = at
    else:
        strict = -45

    # never trust a threshold that finds almost nothing -- that means we went
    # below the room tone and silence detection has stopped working
    total_dur = sweep[0]["silent_seconds"]
    picked = next((s for s in sweep if s["db"] == strict), None)
    if picked and total_dur > 0 and picked["silent_seconds"] < 0.35 * total_dur:
        strict = -45
    # trim sits nearer speech, for finding pauses worth shortening inside a line
    trim = min(-20, int(round((mean + strict) / 2.0 / 5.0) * 5))

    cal = {
        "measured_from": os.path.basename(a.video),
        "mean_volume_db": mean,
        "max_volume_db": peak,
        "noise_floor_db": strict,
        "thresholds": {"trim": f"{trim}dB", "strict": f"{strict}dB"},
        "sweep": sweep,
        "_note": "trim = finding pauses inside a line. strict = where a word truly "
                 "ends, used to snap beat edges without clipping the word.",
    }

    if not a.quiet:
        print(f"{os.path.basename(a.video)}")
        print(f"  mean volume     {mean} dB")
        print(f"  max volume      {peak} dB")
        print("  threshold sweep:")
        for s in sweep:
            print(f"    {s['db']:>4}dB -> {s['regions']:>3} regions, {s['silent_seconds']:>6.2f}s silent")
        print(f"  => trim   {trim}dB   (pauses inside a line)")
        print(f"  => strict {strict}dB   (true end of a word -- safe to cut at)")

    try:
        os.remove(audio)
    except OSError:
        pass

    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        json.dump(cal, open(a.out, "w"), indent=1)
        if not a.quiet:
            print(f"\nWrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

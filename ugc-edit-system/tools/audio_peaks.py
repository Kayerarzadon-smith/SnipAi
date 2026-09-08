#!/usr/bin/env python3
"""Reduce a source's audio to a peak envelope for drawing a waveform.

    python3 tools/audio_peaks.py projects/<name>
    python3 tools/audio_peaks.py projects/<name> --rate 120

Trimming a beat by typing numbers is guesswork -- you cannot see whether the
out-point lands after the last consonant or a syllable inside it. A waveform
shows exactly that, so this writes one for the whole source once and the UI
slices whatever region it needs out of it.

Stored as one byte per sample (0-255) so a nine-minute take is a few hundred
KB of JSON rather than a few megabytes of floats. Audio is decoded ONCE with
-vn: CLAUDE.md's rule, because decoding 4K HEVC to look at the audio is what
turned a 2-second job into a nine-minute one.
"""
import argparse, array, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ffmpeg_bin():
    venv = os.path.join(ROOT, ".venv", "bin", "ffmpeg")
    return venv if os.path.exists(venv) else "ffmpeg"


def source_of(project):
    beats_path = os.path.join(project, "beats.json")
    with open(beats_path) as fh:
        data = json.load(fh)
    src = data.get("source") if isinstance(data, dict) else None
    if not src:
        raise SystemExit(f"{beats_path} has no 'source'")
    return os.path.join(project, src)


def peaks(path, rate):
    """Per bucket: peak AND rms amplitude, each 0-255.

    Peak alone is why quiet words disappear. Room tone spikes hard enough over
    a 10ms window that the max for silence sits only a little under the max
    for an unstressed word like "if" -- so on screen the two look the same and
    the word gets cut off. RMS separates them cleanly, because silence has
    almost no energy while even a quiet word does. Drawing the RMS as the body
    and the peak as a faint outline gives both: a readable word boundary and
    every transient still visible.
    """
    # mono, 8 kHz, signed 16-bit: plenty for an envelope and ~10x less data
    sr = 8000
    cmd = [ffmpeg_bin(), "-v", "error", "-vn", "-i", path,
           "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    import math
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    samples_per_bucket = max(1, sr // rate)
    pk, rms = bytearray(), bytearray()
    leftover = b""
    while True:
        chunk = proc.stdout.read(1 << 20)
        if not chunk:
            break
        buf = leftover + chunk
        usable = len(buf) - (len(buf) % 2)
        leftover = buf[usable:]
        vals = array.array("h")
        vals.frombytes(buf[:usable])
        n = len(vals)
        i = 0
        while i + samples_per_bucket <= n:
            window = vals[i:i + samples_per_bucket]
            hi = max(abs(min(window)), abs(max(window)))
            pk.append(min(255, hi >> 7))                       # 32768 -> 256
            acc = 0
            for v in window:
                acc += v * v
            r = math.sqrt(acc / samples_per_bucket)
            rms.append(min(255, int(r) >> 7))
            i += samples_per_bucket
        rem = (n - i) * 2
        if rem:
            leftover = vals[i:].tobytes() + leftover
    proc.stdout.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed reading audio")
    return pk, rms


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project")
    ap.add_argument("--rate", type=int, default=800,
                    help="buckets per second (default 800 -- 1.25ms detail, "
                         "finer than a Retina pixel at any usable zoom)")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()

    project = a.project.rstrip("/")
    src = source_of(project)
    if not os.path.exists(src):
        raise SystemExit(f"source not on this machine: {src}")

    pk, rms = peaks(src, a.rate)
    out = a.out or os.path.join(project, "work", "peaks.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as fh:
        json.dump({"rate": a.rate, "count": len(pk),
                   "peaks": list(pk), "rms": list(rms)}, fh)
    print(f"Wrote {out}  ({len(pk)} buckets at {a.rate}/s = {len(pk)/a.rate:.1f}s, peak+rms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

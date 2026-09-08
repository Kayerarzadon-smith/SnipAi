#!/usr/bin/env python3
"""Reverse-engineer a finished edit by aligning it to its own raw take.

    python3 tools/align_reference.py reference/1-raw/raw.mp4 reference/2-finished/final.mp4

Cross-correlates the finished audio against the raw audio to find which source
range every finished segment came from. Prints the segment map plus the style
numbers worth copying: cut count, average beat length, and whether removals fall
between lines or inside them (small gaps = pauses trimmed within one take).
"""
import argparse, json, subprocess, tempfile, wave, os, sys
import numpy as np


def load(video):
    wav = tempfile.mktemp(suffix=".wav")
    subprocess.run(["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", wav, "-loglevel", "error", "-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    w = wave.open(wav, "rb")
    d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    sr = w.getframerate(); w.close(); os.remove(wav)
    return d, sr


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("raw"); ap.add_argument("finished")
    ap.add_argument("-o", "--out", default=None, help="write the segment map as JSON")
    a = ap.parse_args()

    raw, sr = load(a.raw)
    fin, _ = load(a.finished)
    D = 4
    dec = lambda x: x[:(len(x) // D) * D].reshape(-1, D).mean(axis=1)
    R, F = dec(raw), dec(fin)
    fs = sr // D
    R -= R.mean(); F -= F.mean()
    NR, NF = len(R), len(F)
    NFFT = 1 << int(np.ceil(np.log2(NR + fs * 4)))
    RF = np.fft.rfft(R, NFFT)
    R2 = np.concatenate([[0.0], np.cumsum(R.astype(np.float64) ** 2)])

    def search(seg):
        L = len(seg)
        corr = np.fft.irfft(RF * np.fft.rfft(seg[::-1], NFFT), NFFT)[L - 1:L - 1 + NR - L]
        eng = np.sqrt(np.maximum(R2[L:L + len(corr)] - R2[0:len(corr)], 1e-9))
        sc = corr / (eng * (np.linalg.norm(seg) + 1e-9))
        i = int(np.argmax(sc)); return i, float(sc[i])

    def lc(x, y):
        if len(x) != len(y) or not len(x): return 0.0
        nx, ny = np.linalg.norm(x), np.linalg.norm(y)
        if nx < 1e-6 or ny < 1e-6: return 1.0 if (nx < 1e-6 and ny < 1e-6) else 0.0
        return float(np.dot(x, y) / (nx * ny))

    W, W2, FR, MIN = int(0.5 * fs), int(0.12 * fs), max(1, fs // 30), int(0.15 * fs)
    segments, pos = [], 0
    while pos + MIN < NF:
        probe = F[pos:min(pos + W, NF)]
        if len(probe) < MIN: break
        off, sc = search(probe)
        if sc < 0.45:
            pos += int(0.1 * fs); continue
        t = pos
        while t + W2 < NF and off + (t - pos) + W2 < NR:
            if lc(F[t:t + W2], R[off + (t - pos):off + (t - pos) + W2]) < 0.72: break
            t += FR
        end = min(t + W2, NF)
        if end <= pos + MIN: end = min(pos + W, NF)
        segments.append({"fin_start": round(pos / fs, 3), "fin_end": round(end / fs, 3),
                         "raw_start": round(off / fs, 3),
                         "raw_end": round((off + (end - pos)) / fs, 3),
                         "dur": round((end - pos) / fs, 3), "score": round(sc, 3)})
        pos = end

    merged = []
    for s in segments:
        if merged:
            p = merged[-1]
            if abs(s["fin_start"] - p["fin_end"]) < 0.05 and abs(s["raw_start"] - p["raw_end"]) < 0.05:
                p["fin_end"], p["raw_end"] = s["fin_end"], s["raw_end"]
                p["dur"] = round(p["fin_end"] - p["fin_start"], 3)
                continue
        merged.append(dict(s))

    prev = None
    inside = between = 0
    for s in merged:
        gap = "" if prev is None else f"  removed {s['raw_start']-prev:+.2f}s"
        if prev is not None:
            if 0 < s["raw_start"] - prev < 1.0:
                inside += 1
            else:
                between += 1
        print(f"  fin {s['fin_start']:6.2f}-{s['fin_end']:6.2f} ({s['dur']:5.2f}s)"
              f" <- raw {s['raw_start']:7.2f}-{s['raw_end']:7.2f} sc={s['score']:.2f}{gap}")
        prev = s["raw_end"]

    durs = [s["dur"] for s in merged]
    print(f"\nfinished {NF/fs:.1f}s from raw {NR/fs:.1f}s")
    print(f"{len(merged)} segments, one cut every {NF/fs/max(len(merged),1):.1f}s on average")
    print(f"segment length: min {min(durs):.2f}s  median {sorted(durs)[len(durs)//2]:.2f}s  max {max(durs):.2f}s")
    print(f"joins: {inside} trim a pause inside a passage (<1s removed), {between} jump to another take")
    if a.out:
        json.dump(merged, open(a.out, "w"), indent=1)
        print(f"wrote {a.out}")


if __name__ == "__main__":
    sys.exit(main())

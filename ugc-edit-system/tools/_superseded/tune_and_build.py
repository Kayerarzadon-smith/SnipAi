#!/usr/bin/env python3
"""Build a cut, tuning the internal pause trimming to match the reference's rhythm.

    python3 tools/tune_and_build.py --project projects/medicube-egf-serum --out cuts/v7.mp4

The reference cuts *within* lines more than a default build does, so its beats
run about half as long. This tries a range of trim thresholds, picks the one
whose median beat lands closest to the reference, then builds, stitches and
verifies. Take selection is untouched -- beats.json still decides which take is
used; only the pauses inside a take get tightened.
"""
import argparse, json, os, statistics, subprocess, sys

CANDIDATES = [0.30, 0.26, 0.22, 0.19, 0.16, 0.14, 0.12, 0.10]


def metrics(edl_path):
    edl = json.load(open(edl_path))
    beats = {}
    for p in edl:
        lab = p["label"].rsplit("-", 1)[0] if p["label"][-1].isdigit() else p["label"]
        beats[lab] = beats.get(lab, 0.0) + p["dur"]
    d = sorted(beats.values())
    return {"pieces": len(edl), "beats": len(beats), "total": sum(d),
            "median": statistics.median(d), "max": d[-1]}


def build(project, trim, keep):
    subprocess.run([sys.executable, "tools/build_cut.py", "--project", project,
                    "--trim-min", str(trim), "--keep", str(keep)],
                   check=True, capture_output=True, text=True)
    return metrics(os.path.join(project, "work", "edl.json"))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--out", required=True, help="output path, relative to the project")
    ap.add_argument("--style", default="reference/house-style.json")
    ap.add_argument("--keep", type=float, default=0.05)
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    ref = json.load(open(a.style))
    target = ref["segment_seconds"]["median"]
    print(f"reference: {ref['duration']:.1f}s, {ref['segments']} cuts, median beat {target:.2f}s\n")

    results = []
    print(f"{'trim':>6s} {'pieces':>7s} {'total':>8s} {'median':>8s}")
    for t in CANDIDATES:
        try:
            m = build(proj, t, a.keep)
        except subprocess.CalledProcessError as e:
            print(f"{t:6.2f}   build failed: {e.stderr.strip().splitlines()[-1:]}")
            continue
        results.append((t, m))
        print(f"{t:6.2f} {m['pieces']:7d} {m['total']:7.2f}s {m['median']:7.2f}s")

    if not results:
        print("no successful build"); return 1

    best_t, best_m = min(results, key=lambda r: abs(r[1]["median"] - target))
    print(f"\nchosen: trim-min {best_t:.2f} -- median beat {best_m['median']:.2f}s "
          f"vs reference {target:.2f}s, {best_m['pieces']} cuts vs {ref['segments']}")

    build(proj, best_t, a.keep)

    print("\nextracting clips...")
    subprocess.run(["bash", os.path.join(proj, "work", "extract.sh")], check=True)

    out = os.path.join(proj, a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    print("stitching...")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i",
                    os.path.join(proj, "work", "concat.txt"), "-c", "copy", out,
                    "-loglevel", "error", "-nostats"], check=True, stdin=subprocess.DEVNULL)
    print(f"wrote {out}\n")

    print("verifying (transcribes the cut -- takes a minute)...")
    v = subprocess.run([sys.executable, "tools/verify_beats.py", out,
                        "--edl", os.path.join(proj, "work", "edl.json")])
    print()
    subprocess.run([sys.executable, "tools/compare_style.py",
                    "--project", proj, "--style", a.style])
    if v.returncode != 0:
        print("\nVerify FAILED -- a phrase repeats. The trim went too tight, or a beat's")
        print("in-point is starting inside a previous attempt. Re-run with a larger")
        print("--keep, or fix the beat in beats.json and rebuild.")
        return 1
    print("\nVerify passed -- no repeated phrases.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

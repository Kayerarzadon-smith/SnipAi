#!/usr/bin/env python3
"""Raw footage in, finished cut out. No questions asked.

    python3 tools/auto_edit.py <video> [--name my-project]

How it picks takes: the speaker runs each line several times in a row and the
last complete attempt is the keeper. So consecutive utterances that are near
duplicates of each other get grouped, and from each group it takes the last one
that ends on a full stop and is not obviously truncated. That mirrors what a
person does scrubbing the footage, and it is why the transcript alone is not
enough -- see CLAUDE.md.

Then it trims pauses inside each line, tuning the threshold so the cut rhythm
lands near the reference, stitches, and verifies that no beat repeats itself.
If a beat does repeat, that beat's start is moved to its final sentence and it
rebuilds, twice, before giving up and telling you which line to look at.
"""
import argparse, difflib, json, os, re, shutil, statistics, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRIMS = [0.30, 0.22, 0.16, 0.12, 0.10]


def sh(*cmd, **kw):
    return subprocess.run(list(cmd), check=True, stdin=subprocess.DEVNULL, **kw)


def norm(t):
    return re.sub(r"[^a-z0-9 ]", "", t.lower()).split()


def pick_beats(segs, min_words=3, min_dur=0.8):
    """Group consecutive near-duplicate utterances; keep the last complete one."""
    groups, cur = [], []
    for s in segs:
        if not s["words"]:
            continue
        if not cur:
            cur = [s]; continue
        a, b = norm(cur[-1]["text"]), norm(s["text"])
        if not a or not b:
            cur.append(s); continue
        r = difflib.SequenceMatcher(None, a, b).ratio()
        prefix = a[:min(len(a), len(b))] == b[:min(len(a), len(b))]
        if r >= 0.55 or prefix:
            cur.append(s)
        else:
            groups.append(cur); cur = [s]
    if cur:
        groups.append(cur)

    beats = []
    for g in groups:
        counts = [len(norm(s["text"])) for s in g]
        top = max(counts)
        complete = [s for s, c in zip(g, counts)
                    if s["text"].strip().endswith((".", "?", "!")) and c >= 0.7 * top]
        chosen = complete[-1] if complete else g[counts.index(top)]
        w = chosen["words"]
        start, end = w[0]["s"], w[-1]["e"]
        if len(norm(chosen["text"])) < min_words or end - start < min_dur:
            continue
        beats.append({"start": round(start, 2), "end": round(end, 2),
                      "text": chosen["text"].strip(), "words": w})
    return beats


def label_for(text, used):
    words = [w for w in norm(text) if w not in
             {"the", "a", "and", "is", "it", "to", "of", "you", "your", "i", "this", "that"}]
    base = "-".join(words[:3]) or "beat"
    lab, n = base, 2
    while lab in used:
        lab = f"{base}-{n}"; n += 1
    used.add(lab)
    return lab


def metrics(edl_path):
    edl = json.load(open(edl_path))
    d = sorted(p["dur"] for p in edl)
    return len(edl), sum(d), statistics.median(d)


def last_sentence_start(words):
    """Start time of the final sentence inside a beat's word list."""
    idx = 0
    for i, w in enumerate(words[:-2]):
        if w["w"].strip().endswith((".", "?", "!")):
            idx = i + 1
    return words[idx]["s"] if idx else None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--name", default=None)
    ap.add_argument("--out", default=None, help="where to write the finished cut")
    ap.add_argument("--style", default=os.path.join(ROOT, "reference/house-style.json"))
    a = ap.parse_args()

    os.chdir(ROOT)
    name = a.name or re.sub(r"[^a-z0-9]+", "-", os.path.splitext(
        os.path.basename(a.video))[0].lower()).strip("-")[:40] or "untitled"
    proj = os.path.join("projects", name)
    for d in ("raw", "cuts", "work"):
        os.makedirs(os.path.join(proj, d), exist_ok=True)

    src = os.path.join(proj, "raw", os.path.basename(a.video))
    if os.path.abspath(a.video) != os.path.abspath(src):
        shutil.move(a.video, src)
    print(f"project: {name}\nsource:  {src}\n")

    tpath = os.path.join(proj, "work", "transcript.json")
    spath = os.path.join(proj, "work", "silence.txt")
    print("transcribing...")
    sh(sys.executable, "tools/transcribe.py", src, "-o", tpath, capture_output=True, text=True)
    print("mapping silence...")
    sh(sys.executable, "tools/silence_map.py", src, "-o", spath, capture_output=True, text=True)

    segs = json.load(open(tpath))
    beats = pick_beats(segs)
    if not beats:
        print("no usable lines found in the transcript"); return 1

    used = set()
    for b in beats:
        b["label"] = label_for(b["text"], used)
    print(f"\n{len(beats)} lines kept, out of {len(segs)} utterances:\n")
    for b in beats:
        print(f"  {b['label']:26s} {b['start']:7.2f}-{b['end']:7.2f}  {b['text'][:58]}")

    def write_beats():
        json.dump({"source": os.path.relpath(src, proj),
                   "notes": "written by tools/auto_edit.py -- last complete take per line",
                   "beats": [{"label": b["label"], "start": b["start"], "end": b["end"],
                              "text": b["text"]} for b in beats]},
                  open(os.path.join(proj, "beats.json"), "w"), indent=1)

    ref = json.load(open(a.style))
    target = ref["segment_seconds"]["median"]
    out = a.out or os.path.join(proj, "cuts", f"{name}-v1.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    for attempt in range(3):
        write_beats()
        best = None
        for t in TRIMS:
            try:
                sh(sys.executable, "tools/build_cut.py", "--project", proj,
                   "--trim-min", str(t), "--keep", "0.05", capture_output=True, text=True)
            except subprocess.CalledProcessError:
                continue
            cuts, total, med = metrics(os.path.join(proj, "work", "edl.json"))
            if best is None or abs(med - target) < abs(best[3] - target):
                best = (t, cuts, total, med)
        if best is None:
            print("could not build"); return 1
        t, cuts, total, med = best
        print(f"\ntrim {t:.2f}: {cuts} cuts, {total:.1f}s, median cut {med:.2f}s "
              f"(reference {ref['segments']} cuts, {ref['duration']:.1f}s, {target:.2f}s)")
        sh(sys.executable, "tools/build_cut.py", "--project", proj,
           "--trim-min", str(t), "--keep", "0.05", capture_output=True, text=True)

        print("extracting and stitching...")
        sh("bash", os.path.join(proj, "work", "extract.sh"))
        sh("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i",
           os.path.join(proj, "work", "concat.txt"), "-c", "copy", out,
           "-loglevel", "error", "-nostats")

        print("verifying...")
        v = subprocess.run([sys.executable, "tools/verify_beats.py", out,
                            "--edl", os.path.join(proj, "work", "edl.json")],
                           capture_output=True, text=True)
        print(v.stdout)
        if v.returncode == 0:
            break
        bad = set(re.findall(r"beat '([^']+)'", v.stdout))
        fixed = []
        for b in beats:
            if b["label"] in bad:
                ns = last_sentence_start(b["words"])
                if ns and ns < b["end"] - 0.5:
                    b["start"] = round(ns, 2); fixed.append(b["label"])
        if not fixed:
            print(f"Could not fix {', '.join(bad)} automatically -- that line needs a look.")
            break
        print(f"retrying with a later start on: {', '.join(fixed)}")

    subprocess.run([sys.executable, "tools/compare_style.py", "--project", proj,
                    "--style", a.style])
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Build a cut from a beat list.

    python3 tools/build_cut.py --project projects/medicube-egf-serum

Reads <project>/beats.json, pads each beat off the word gaps in the transcript,
trims pauses inside beats using the silence map, and writes the EDL plus the
extract and concat scripts. Then:

    bash <project>/work/extract.sh
    ffmpeg -y -f concat -safe 0 -i <project>/work/concat.txt -c copy <out>

Each beat must be ONE complete recitation. Never stitch two attempts at the
same sentence -- that is the stutter. Trimming a pause inside one take is fine
and is what makes the cut feel tight. See CLAUDE.md.
"""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _paths import data_path  # noqa: E402

HEAD_MAX, TAIL_MAX, MARGIN = 0.07, 0.20, 0.04


def load_silence(path):
    starts, ends = [], []
    for line in open(path):
        m = re.search(r"silence_start:\s*([\d.]+)", line)
        if m: starts.append(float(m.group(1)))
        m = re.search(r"silence_end:\s*([\d.]+)", line)
        if m: ends.append(float(m.group(1)))
    return sorted(zip(starts, ends))


def load_words(path):
    words = []
    for seg in json.load(open(path)):
        for w in seg["words"]:
            words.append((w["s"], w["e"]))
    return sorted(words)


def base_label(piece_label, known):
    """A piece is "<label>" or "<label>-<n>".

    Stripping a trailing number blindly breaks on a beat genuinely called
    "need-egf-2", folding it into "need-egf" -- so only strip when the result
    is a real beat label and the full name is not.
    """
    if piece_label in known:
        return piece_label
    head, _, tail = piece_label.rpartition("-")
    return head if tail.isdigit() and head in known else piece_label


def tuned(key, fallback):
    """A learned default from state/tuning.json, or the original guess.

    learn_from_edits.py corrects these from what actually got trimmed. Reading
    them here is what closes the loop: without it the corrections are written
    down and then ignored, and the next video needs exactly the same edits as
    the last one.
    """
    # The library's copy, which is the one learn_from_edits writes. Resolving
    # this from the tool's own directory read the copy that ships with the
    # CODE instead -- so corrections were written to one file and rendering
    # read another, and the loop had been open since the library moved out.
    path = data_path("state", "tuning.json")
    try:
        with open(path) as fh:
            return json.load(fh).get("cutting", {}).get(key, fallback)
    except Exception:
        return fallback


def walk_pieces(label, s, e, sil, holes, detached=False, trim_min=0.35, keep=0.30):
    """Split one beat into the runs of film that survive.

    Two kinds of stretch come out of the middle of a line:

      * a PAUSE the silence map found. It is given breathing room -- half of
        `keep` at each end -- because cutting a detected pause flush sounds
        clipped, and it is skipped near either edge, where taking it out would
        eat into the words.

      * a HOLE the editor highlighted and deleted. That one is taken at
        exactly the boundaries drawn: no breathing room, and none of the
        near-the-edge guards, because a person pointing at a stretch and
        deleting it meant that stretch and no other.

    Returns (pieces, seconds_removed, splits). The pieces butt together in the
    order returned, so concatenating them closes every gap.
    """
    # A detected pause is CLIPPED to the line, not required to fit inside it.
    #
    # This used to be `x > s + 0.12 and y < e - 0.12`, which throws away any
    # silence that runs past either edge -- and a line ending in a long pause
    # is the commonest shape there is, because Whisper folds the pause into the
    # duration of the preceding word and the out-point lands well inside it.
    # On img-9817 that left ten seconds of dead air in the middle of a
    # 111-second cut: the silence map had 430.246-444.266, the beat ended at
    # 441.46, and the one condition that mattered was the one that failed.
    inner = []
    if not detached:
        for x, y in sil:
            lo, hi = max(x, s), min(y, e)
            if hi - lo < trim_min:
                continue
            # A pause touching the first word is the IN-point's business --
            # snap() pulls the edge in off the silence map. Trimming it here
            # would cut into the word instead of in front of it. The tail is
            # different: it is clipped above and handled below, because that
            # is the edge nothing else was fixing.
            if lo < s + 0.12:
                continue
            inner.append((lo, hi, False))
    for hx, hy in holes:
        if hy > s + 0.02 and hx < e - 0.02:
            inner.append((max(hx, s), min(hy, e), True))
    inner.sort()

    pieces, cur, tail, removed, n = [], s, e, 0.0, 0
    for x, y, explicit in inner:
        if explicit:
            co, ci = x, y
            if ci <= cur + 0.02:
                continue                          # already behind the playhead
            if co <= cur + 0.02:
                # Reaches the start of what is left: that is not a hole in the
                # middle, it is the in-point moving. Emitting a zero-length
                # piece here would be wrong and skipping it would silently
                # keep footage the editor deleted.
                removed += ci - cur
                cur = ci
                continue
            if ci >= tail - 0.02:
                # Reaches the end: the out-point moves instead, and nothing
                # after this can survive.
                removed += tail - co
                tail = co
                break
            if ci <= co + 0.02:
                continue
        else:
            co, ci = x + keep / 2, y - keep / 2
            if co <= cur + 0.18:
                continue                          # too near the first word
            if ci >= tail - 0.18:
                # The pause runs to the end of the line. That is not a stretch
                # out of the middle, it is the out-point sitting in silence --
                # so the out-point moves, exactly as it does for a hand-drawn
                # hole that reaches the end. Skipping it, as this did, is what
                # left the dead air on the end of the line.
                if co < tail - 0.02:
                    removed += tail - co
                    tail = co
                break
            if ci <= co + 0.05:
                continue
        pieces.append((f"{label}-{n}", round(cur, 3), round(co, 3)))
        removed += ci - co
        cur = ci
        n += 1
    if tail - cur >= 0.02:
        pieces.append((f"{label}-{n}" if n else label, round(cur, 3), round(tail, 3)))
    return pieces, removed, n


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True)
    ap.add_argument("--trim-min", type=float, default=tuned("trim_min", 0.22),
                    help="internal pauses at least this long get shortened")
    ap.add_argument("--keep", type=float, default=0.07,
                    help="...down to this much")
    ap.add_argument("--pad", action="store_true",
                    help="extend each beat into the surrounding silence (head <=0.07s, "
                         "tail <=0.20s, never within 0.04s of the neighbouring word). "
                         "Use when in/out points were picked tight on the word boundary; "
                         "leave off when beats.json already includes the handles.")
    ap.add_argument("--proxy", action="store_true",
                    help="render a small, fast review copy instead of full quality. "
                         "720p, faster preset. Reviewing 4K is what makes a laptop "
                         "unusable; the full-res render only has to happen once, after "
                         "the edit is approved.")
    ap.add_argument("--no-snap", action="store_true",
                    help="don't pull beat edges in off the silence map. By default every "
                         "beat's in/out point is snapped to where speech actually starts "
                         "and stops, so no dead air survives at the joins -- Whisper's word "
                         "end times trail into the pause, which otherwise leaves ~0.3-0.4s "
                         "of silence between every phrase.")
    ap.add_argument("--snap-lead", type=float, default=tuned("snap_lead", 0.01),
                    help="silence kept before the first word of a beat")
    ap.add_argument("--snap-tail", type=float, default=tuned("snap_tail", 0.01),
                    help="silence kept after the last word of a beat")
    ap.add_argument("--snap-map", default="silence-strict.txt",
                    help="silence map used for edge snapping, relative to <project>/work. "
                         "Should be a STRICT map (e.g. -50dB): at -28dB a soft trailing "
                         "consonant (s, f, th) reads as silence, so snapping to it clips "
                         "the word. At -50dB only true silence counts, so the edge can be "
                         "cut to almost zero without touching the word. Falls back to "
                         "silence.txt if this file is absent.")
    a = ap.parse_args()

    proj = a.project.rstrip("/")
    work = os.path.join(proj, "work")
    cfg = json.load(open(os.path.join(proj, "beats.json")))
    source = cfg["source"]
    if not os.path.isabs(source):
        source = os.path.join(proj, source)
    beats = [(b["label"], float(b["start"]), float(b["end"])) for b in cfg["beats"]]
    # Beats whose audio has been detached from their picture. Kept separate so
    # the ordinary path below is untouched: no detached audio, nothing changes.
    # Fades, per beat. Applied to the extracted clip so they survive the
    # stream-copy concat -- doing them at the join afterwards would need a
    # re-encode of the whole cut.
    fades = {
        b["label"]: (float(b.get("fadeIn") or 0), float(b.get("fadeOut") or 0))
        for b in cfg["beats"]
        if (b.get("fadeIn") or 0) > 0 or (b.get("fadeOut") or 0) > 0
    }
    detached = {
        b["label"]: (float(b["audioStart"]), float(b["audioEnd"]))
        for b in cfg["beats"]
        if b.get("audioStart") is not None and b.get("audioEnd") is not None
    }
    # Regions the editor highlighted and deleted from inside a line.
    holes = {
        b["label"]: sorted((float(x), float(y)) for x, y in b["holes"] if float(y) > float(x))
        for b in cfg["beats"]
        if b.get("holes")
    }

    words = load_words(os.path.join(work, "transcript.json"))
    sil = load_silence(os.path.join(work, "silence.txt"))
    os.makedirs(os.path.join(work, "clips"), exist_ok=True)

    def pad(s, e):
        nxt = min((w for w in words if w[0] >= e - 0.01), key=lambda w: w[0], default=None)
        tail = max(0.0, min(TAIL_MAX, ((nxt[0] - e) if nxt else 999.0) - MARGIN))
        prv = max((w for w in words if w[1] <= s + 0.01), key=lambda w: w[1], default=None)
        head = max(0.0, min(HEAD_MAX, ((s - prv[1]) if prv else 999.0) - MARGIN))
        return round(s - head, 3), round(e + tail, 3)

    # Edge snapping uses the strict map when available; pause-trimming inside a
    # beat keeps using the -28dB map, which is what that job wants.
    snap_path = os.path.join(work, a.snap_map)
    snap_sil = load_silence(snap_path) if os.path.exists(snap_path) else sil

    def snap(s, e):
        """Pull the in/out points in off the silence map so the beat starts
        and ends on speech.

        Whisper folds a trailing pause into the duration of the preceding word
        (see CLAUDE.md), so a beat's out-point routinely sits several hundred
        ms into silence. Concatenating those beats leaves audible dead air at
        every join. The silence map is the ground truth for where speech
        actually stops."""
        for x, y in snap_sil:
            if x <= s < y:                       # in-point sits inside silence
                s = min(y - a.snap_lead, e - 0.05)
        for x, y in snap_sil:
            if x < e <= y:                       # out-point sits inside silence
                e = max(x + a.snap_tail, s + 0.05)
        return round(s, 3), round(e, 3)

    pieces, report = [], []
    snapped_total = 0.0
    for label, s0, e0 in beats:
        s, e = pad(s0, e0) if a.pad else (s0, e0)
        if not a.no_snap:
            s1, e1 = snap(s, e)
            snapped_total += (s1 - s) + (e - e1)
            s, e = s1, e1
        got, removed, n = walk_pieces(
            label, s, e, sil, holes.get(label, []),
            detached=label in detached,
            trim_min=a.trim_min, keep=a.keep)
        pieces.extend(got)
        report.append((label, s, e, round(e - s, 3), round(e - s - removed, 3), n))

    total = sum(p[2] - p[1] for p in pieces)
    print(f"BEATS={len(beats)}  PIECES={len(pieces)}  TOTAL={total:.2f}s")
    if not a.no_snap and snapped_total > 0.001:
        print(f"snapped {snapped_total:.2f}s of dead air off the beat edges")
    for l, s, e, d0, d1, n in report:
        print(f"  {l:20s} {s:8.2f}-{e:8.2f}  {d0:5.2f} -> {d1:5.2f}  trims {n}")

    json.dump([{"label": l, "src_start": x, "src_end": y, "dur": round(y - x, 3)}
               for l, x, y in pieces], open(os.path.join(work, "edl.json"), "w"), indent=1)

    if fades:
        print(f"{len(fades)} beat(s) with fades")

    # ---- detached audio -------------------------------------------------
    # Where a beat's sound has been unlocked from its picture, the base cut's
    # own audio is silenced across that beat and the chosen range is mixed in
    # at the right offset. Written as a separate script so the normal build is
    # byte-for-byte what it always was, and this only runs when it's needed.
    audio_sh = os.path.join(work, "audio.sh")
    if os.path.exists(audio_sh):
        os.remove(os.path.join(work, "audio.sh"))
    if detached:
        # where each beat sits on the finished timeline
        # A piece is "<label>" or "<label>-<n>". Stripping a trailing number
        # blindly breaks on a beat genuinely called "need-egf-2", folding it
        # into "need-egf" -- so only strip when the result is a real beat
        # label and the full name isn't one.
        def base_of(piece_label):
            return base_label(piece_label, {l for l, _, _ in beats})

        at, beat_at, beat_dur = 0.0, {}, {}
        for l, x, y in pieces:
            base = base_of(l)
            beat_at.setdefault(base, at)
            beat_dur[base] = beat_dur.get(base, 0.0) + (y - x)
            at += y - x

        inputs, filters, mixes, mutes = [], [], [], []
        for i, (label, (as_, ae)) in enumerate(sorted(detached.items())):
            if label not in beat_at:
                continue
            v_start = dict((l, s) for l, s, e in beats)[label]
            off = round(beat_at[label] + (as_ - v_start), 3)
            off = max(0.0, off)
            inputs.append(f'-ss {as_} -t {round(ae - as_, 3)} -i "{source}"')
            filters.append(f"[{i+1}:a]adelay={int(off*1000)}|{int(off*1000)},"
                           f"apad=whole_dur={round(off + (ae - as_), 3)}[a{i}]")
            mixes.append(f"[a{i}]")
            # silence the picture's own sound across this beat
            b0 = round(beat_at[label], 3)
            b1 = round(beat_at[label] + beat_dur.get(label, 0.0), 3)
            mutes.append(f"volume=enable='between(t,{b0},{b1})':volume=0")

        base_chain = ",".join(mutes) if mutes else "anull"
        graph = (f"[0:a]{base_chain}[base];" + ";".join(filters) +
                 f";[base]{''.join(mixes)}amix=inputs={len(mixes)+1}:"
                 f"normalize=0:dropout_transition=0[aout]")
        cut = os.path.join(proj, "cuts", "cut.mp4")
        with open(audio_sh, "w") as f:
            f.write("#!/bin/bash\nset -e\n")
            f.write(f'ffmpeg -y -i "{cut}" {" ".join(inputs)} '
                    f'-filter_complex "{graph}" -map 0:v -map "[aout]" '
                    f'-c:v copy -c:a aac -b:a 192k "{cut}.audio.mp4" '
                    f'-loglevel error -nostats < /dev/null\n')
            f.write(f'mv "{cut}.audio.mp4" "{cut}"\n')
        os.chmod(audio_sh, 0o755)
        print(f"{len(detached)} beat(s) with detached audio -> {work}/audio.sh")

    # which piece is the first / last of its beat, so a fade lands on the
    # outside edges of the line rather than on every internal pause trim
    first_of, last_of = {}, {}
    for i, (l, x, y) in enumerate(pieces):
        base = base_label(l, {b[0] for b in beats})
        first_of.setdefault(base, i)
        last_of[base] = i

    lines, concat = [], []
    for i, (l, x, y) in enumerate(pieces):
        out = os.path.join(work, "clips", f"p{i:02d}_{l}.mp4")
        if a.proxy:
            vopts = ('-vf "scale=-2:720" -c:v libx264 -preset ultrafast -crf 26 '
                     '-pix_fmt yuv420p -r 30 -c:a aac -b:a 128k')
        else:
            vopts = ('-c:v libx264 -preset veryfast -crf 18 '
                     '-pix_fmt yuv420p -r 30 -c:a aac -b:a 192k')
        base = base_label(l, {b[0] for b in beats})
        fi, fo = fades.get(base, (0.0, 0.0))
        dur = round(y - x, 3)
        filt = []
        if fi > 0 and first_of.get(base) == i:
            filt.append(f"afade=t=in:st=0:d={min(fi, dur):.3f}")
        if fo > 0 and last_of.get(base) == i:
            d = min(fo, dur)
            filt.append(f"afade=t=out:st={max(0.0, dur - d):.3f}:d={d:.3f}")
        afilt = f' -af "{",".join(filt)}"' if filt else ""
        lines.append(f'ffmpeg -y -ss {x} -i "{source}" -t {dur} '
                     f'{vopts}{afilt} -movflags +faststart "{out}" '
                     f'-loglevel error -nostats < /dev/null')
        # ffconcat single-quotes paths; an apostrophe inside must be escaped
        # as '\'' or the demuxer stops at that line.
        concat.append("file '{}'".format(os.path.abspath(out).replace("'", "'\\''")))
    with open(os.path.join(work, "extract.sh"), "w") as f:
        f.write("#!/bin/bash\nset -e\n" + "\n".join(lines) + "\n")
    os.chmod(os.path.join(work, "extract.sh"), 0o755)
    with open(os.path.join(work, "concat.txt"), "w") as f:
        f.write("\n".join(concat) + "\n")

    print(f"\nWrote {work}/edl.json, extract.sh, concat.txt")
    print(f"Next:\n  bash {work}/extract.sh")
    print(f"  ffmpeg -y -f concat -safe 0 -i {work}/concat.txt -c copy {proj}/cuts/cut.mp4")
    print(f"  python3 tools/verify_cut.py {proj}/cuts/cut.mp4")


if __name__ == "__main__":
    sys.exit(main())

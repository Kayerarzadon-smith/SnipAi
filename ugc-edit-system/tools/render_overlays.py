#!/usr/bin/env python3
"""Burn definition cards into a cut, from the cues found by find_overlay_cues.py.

    python3 tools/render_overlays.py <cut.mp4> <cues.json> -o <out.mp4>

Cards use the SnipAi palette (dark card, gold term, off-white definition) and
fade in/out so they don't snap. One ffmpeg pass, re-encoding video once;
audio is stream-copied so the cut's audio is untouched.

Position defaults to the lower third, clear of TikTok's right-hand action
rail and the caption safe area at the bottom.
"""
import argparse, json, os, subprocess, sys, textwrap

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
if not os.path.exists(FONT_REG):
    FONT_REG = "/System/Library/Fonts/Helvetica.ttc"
if not os.path.exists(FONT_BOLD):
    FONT_BOLD = FONT_REG


def esc(text):
    """Escape for ffmpeg drawtext: backslash, colon, apostrophe, brackets."""
    out = text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")
    return out.replace("[", "\\[").replace("]", "\\]").replace(",", "\\,")


def build_filters(cues, width, height, wrap_chars, fade):
    filters = []
    term_size = max(26, int(width * 0.055))
    def_size = max(19, int(width * 0.038))
    line_h = int(def_size * 1.35)
    pad = int(width * 0.035)

    # Absolute pixel geometry, computed here rather than as ffmpeg expressions:
    # in drawbox, `w` means the BOX's width, so an expression like (w-w*0.86)/2
    # is circular and fails to evaluate.
    box_w = int(width * 0.86)
    box_x = (width - box_w) // 2
    box_y = int(height * 0.60)
    accent_w = max(3, int(width * 0.008))

    for c in cues:
        s, e = c["start"], c["end"]
        lines = textwrap.wrap(c["definition"], wrap_chars) or [""]
        block_h = term_size + int(term_size * 0.5) + line_h * len(lines) + pad * 2
        # alpha ramp: fade in at the start, fade out at the end
        alpha = (f"if(lt(t\\,{s})\\,0\\,"
                 f"if(lt(t\\,{s + fade})\\,(t-{s})/{fade}\\,"
                 f"if(lt(t\\,{e - fade})\\,1\\,"
                 f"if(lt(t\\,{e})\\,({e}-t)/{fade}\\,0))))")
        enable = f"between(t\\,{s}\\,{e})"

        filters.append(
            f"drawbox=x={box_x}:y={box_y}:w={box_w}:h={block_h}:"
            f"color=0x14161b@0.88:t=fill:enable='{enable}'"
        )
        filters.append(
            f"drawbox=x={box_x}:y={box_y}:w={accent_w}:h={block_h}:"
            f"color=0xd9a441@0.95:t=fill:enable='{enable}'"
        )
        filters.append(
            f"drawtext=fontfile='{FONT_BOLD}':text='{esc(c['term'].upper())}':"
            f"fontcolor=0xd9a441:fontsize={term_size}:"
            f"x={box_x + pad}:y={box_y + pad}:"
            f"alpha='{alpha}':enable='{enable}'"
        )
        for i, line in enumerate(lines):
            y = box_y + pad + term_size + int(term_size * 0.5) + i * line_h
            filters.append(
                f"drawtext=fontfile='{FONT_REG}':text='{esc(line)}':"
                f"fontcolor=0xece7dc:fontsize={def_size}:"
                f"x={box_x + pad}:y={y}:"
                f"alpha='{alpha}':enable='{enable}'"
            )
    return ",".join(filters)


def probe_size(video):
    out = subprocess.run(["ffmpeg", "-i", video], capture_output=True, text=True,
                         stdin=subprocess.DEVNULL).stderr
    import re
    m = re.search(r"(\d{2,5})x(\d{2,5})", out)
    return (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut")
    ap.add_argument("cues")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--wrap", type=int, default=42, help="characters per line")
    ap.add_argument("--fade", type=float, default=0.25)
    a = ap.parse_args()

    data = json.load(open(a.cues))
    cues = data.get("cues", [])
    if not cues:
        print("no cues -- nothing to burn in")
        return 1

    w, h = probe_size(a.cut)
    vf = build_filters(cues, w, h, a.wrap, a.fade)

    cmd = ["ffmpeg", "-y", "-i", a.cut, "-vf", vf,
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
           "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
           a.out, "-loglevel", "error", "-nostats"]
    p = subprocess.run(cmd, stdin=subprocess.DEVNULL)
    if p.returncode != 0:
        print("ffmpeg failed", file=sys.stderr)
        return 1

    print(f"Wrote {a.out}  ({len(cues)} card(s), {w}x{h})")
    for c in cues:
        print(f"  {c['start']:6.2f}-{c['end']:6.2f}  {c['term']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

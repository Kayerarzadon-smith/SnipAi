#!/usr/bin/env python3
"""Render motion graphics onto a finished cut.

    python3 tools/motion_graphics.py <cut.mp4> <plan.json> -o <out.mp4>
    python3 tools/motion_graphics.py <cut.mp4> <plan.json> --print-filter

A plan is a list of graphics, each with a type, a time range, and its copy:

    [{"type": "definition", "start": 12.4, "end": 16.4,
      "term": "EGF", "definition": "Epidermal Growth Factor -- ..."},
     {"type": "emphasis", "start": 22.0, "end": 23.6, "text": "3 WEEKS"},
     {"type": "callout",  "start": 30.1, "end": 33.1, "text": "before"}]

Everything is drawn by ffmpeg itself -- drawbox and drawtext both evaluate
their geometry per frame, so cards wipe on, text slides and fades, and no
image assets or extra libraries are needed. One video re-encode; the audio is
stream-copied so the cut's sound is untouched.

Geometry is computed in absolute pixels here rather than as ffmpeg
expressions: inside drawbox, `w` refers to the BOX's own width, so an
expression like (w-w*0.86)/2 is circular and silently fails to evaluate.
"""
import argparse, json, os, re, subprocess, sys, textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"
for _n, _p in (("FONT_REG", FONT_REG), ("FONT_BOLD", FONT_BOLD), ("FONT_BLACK", FONT_BLACK)):
    if not os.path.exists(_p):
        globals()[_n] = "/System/Library/Fonts/Helvetica.ttc"

# House palette. Dark card, warm accent -- readable over skin tones and
# bright rooms alike, which is most of this footage.
INK = "0x14161b"
ACCENT = "0xd9a441"
PAPER = "0xece7dc"
CRIT = "0xe0574f"

IN_DUR = 0.42          # entrance
OUT_DUR = 0.30         # exit
STAGGER = 0.07         # delay between elements of the same card


def ffmpeg_bin():
    venv = os.path.join(ROOT, ".venv", "bin", "ffmpeg")
    return venv if os.path.exists(venv) else "ffmpeg"


def esc(text):
    """Escape for drawtext. Apostrophes become typographic ones rather than
    being escaped -- ffmpeg's quoting rules around ' inside a filtergraph are
    a reliable way to lose an afternoon."""
    out = str(text).replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")
    return out.replace("[", "\\[").replace("]", "\\]").replace(",", "\\,")


def _ease_out(p):
    """Cubic ease-out, as an ffmpeg expression over a 0..1 progress term.

    Linear motion is the single biggest tell that a graphic was generated
    rather than designed: things in the world decelerate as they arrive. This
    is 1-(1-p)^3, which is the curve most motion design actually uses."""
    return f"(1-pow(1-({p})\,3))"


def _ease_in(p):
    """Cubic ease-in, for exits -- they should accelerate away."""
    return f"pow(({p})\,3)"


def anim(s, e, hold=1.0, delay=0.0, in_dur=IN_DUR, out_dur=OUT_DUR, eased=True):
    """0 -> hold -> 0 across the graphic's life, on an eased curve.

    Used for alpha and for geometry, so a card fades and travels together on
    the same timing. `delay` staggers one element behind another, which is
    what makes a card feel assembled rather than switched on.
    """
    s0 = s + delay
    pin = f"((t-{s0})/{in_dur})"
    pout = f"(({e}-t)/{out_dur})"
    rise = _ease_out(pin) if eased else pin
    fall = _ease_out(pout) if eased else pout
    return (f"if(lt(t\,{s0})\,0\,"
            f"if(lt(t\,{s0 + in_dur})\,{hold}*{rise}\,"
            f"if(lt(t\,{e - out_dur})\,{hold}\,"
            f"if(lt(t\,{e})\,{hold}*{fall}\,0))))")


def travel(s, e, dist, delay=0.0, in_dur=IN_DUR, out_dur=OUT_DUR):
    """Offset in pixels: starts `dist` away, eases to 0, leaves the other way.

    Entrances decelerate in, exits accelerate out -- opposite curves, which is
    what stops a card feeling like it is on a loop."""
    s0 = s + delay
    pin = f"((t-{s0})/{in_dur})"
    pout = f"((t-({e - out_dur}))/{out_dur})"
    return (f"if(lt(t\,{s0})\,{dist}\,"
            f"if(lt(t\,{s0 + in_dur})\,{dist}*(1-{_ease_out(pin)})\,"
            f"if(lt(t\,{e - out_dur})\,0\,"
            f"{-dist * 0.55}*{_ease_in(pout)})))")


def ramp(s, e, hold_val=1.0, in_dur=IN_DUR, out_dur=OUT_DUR):
    """Backwards-compatible alias."""
    return anim(s, e, hold=hold_val, in_dur=in_dur, out_dur=out_dur)


def enable(s, e):
    return f"between(t\,{s}\,{e})"


# --------------------------------------------------------------------------
# templates
# --------------------------------------------------------------------------

def t_definition(g, W, H):
    """Term and meaning.

    Built in pieces rather than switched on: the accent rule draws down first,
    the card wipes open behind it, the term rises in, then each line of the
    definition follows a beat later. On exit the whole thing lifts and
    accelerates away. That staggering is most of what separates a designed
    card from a generated one."""
    s, e = g["start"], g["end"]
    term_size = max(26, int(W * 0.058))
    def_size = max(19, int(W * 0.037))
    line_h = int(def_size * 1.34)
    pad = int(W * 0.038)
    lines = textwrap.wrap(g.get("definition", ""), g.get("wrap", 34)) or [""]

    box_w = int(W * 0.86)
    box_x = (W - box_w) // 2
    box_h = term_size + int(term_size * 0.55) + line_h * len(lines) + pad * 2
    box_y = int(H * float(g.get("y", 0.60)))
    bar_w = max(4, int(W * 0.009))
    lift = int(H * 0.022)
    en = enable(s, e)
    f = []

    # a soft shadow so the card sits above the picture instead of on it
    f.append(f"drawbox=x={box_x + 3}:y={box_y + 5}:w='{anim(s, e, hold=box_w, delay=0.05)}':"
             f"h={box_h}:color=black@0.28:t=fill:enable='{en}'")
    # the rule draws first
    f.append(f"drawbox=x={box_x}:y={box_y}:w={bar_w}:h='{anim(s, e, hold=box_h)}':"
             f"color={ACCENT}@0.98:t=fill:enable='{en}'")
    # then the card opens out from behind it
    f.append(f"drawbox=x={box_x}:y={box_y}:w='{anim(s, e, hold=box_w, delay=0.05)}':"
             f"h={box_h}:color={INK}@0.90:t=fill:enable='{en}'")
    # the term rises in
    f.append(f"drawtext=expansion=none:fontfile='{FONT_BOLD}':text='{esc(g['term'].upper())}':"
             f"fontcolor={ACCENT}:fontsize={term_size}:"
             f"x={box_x + pad}:y='{box_y + pad}+({travel(s, e, lift, delay=0.12)})':"
             f"alpha='{anim(s, e, delay=0.12)}':enable='{en}'")
    # each line of the definition follows the one above it
    for i, line in enumerate(lines):
        d = 0.18 + i * STAGGER
        y0 = box_y + pad + term_size + int(term_size * 0.55) + i * line_h
        f.append(f"drawtext=expansion=none:fontfile='{FONT_REG}':text='{esc(line)}':"
                 f"fontcolor={PAPER}:fontsize={def_size}:"
                 f"x={box_x + pad}:y='{y0}+({travel(s, e, lift, delay=d)})':"
                 f"alpha='{anim(s, e, delay=d)}':enable='{en}'")
    return f


def t_callout(g, W, H):
    """A label that slides in from the edge behind a leading rule."""
    s, e = g["start"], g["end"]
    size = max(22, int(W * 0.050))
    pad = int(W * 0.030)
    y = int(H * float(g.get("y", 0.16)))
    text = esc(g["text"])
    box_h = size + pad
    bar_w = max(4, int(W * 0.008))
    rest_x = int(W * 0.07)
    slide = travel(s, e, -int(W * 0.16))
    en = enable(s, e)
    col = CRIT if g.get("tone") == "critical" else ACCENT
    return [
        f"drawbox=x='{rest_x}+({slide})':y={y}:w={bar_w}:h={box_h}:"
        f"color={col}@0.98:t=fill:enable='{en}'",
        f"drawtext=expansion=none:fontfile='{FONT_BOLD}':text='{text}':fontcolor={PAPER}:"
        f"fontsize={size}:box=1:boxcolor={INK}@0.86:boxborderw={int(pad*0.55)}:"
        f"x='{rest_x + bar_w + int(W*0.012)}+({travel(s, e, -int(W*0.16), delay=0.05)})':"
        f"y={y + int(pad*0.22)}:alpha='{anim(s, e, delay=0.05)}':enable='{en}'",
    ]


def t_emphasis(g, W, H):
    """A word that lands.

    drawtext takes no expression for fontsize, so the scale is a short ladder
    of sizes a couple of frames apart. Overshoot then settle -- it reads as a
    punch at playback speed, which a straight fade never does."""
    s, e = g["start"], g["end"]
    base = max(34, int(W * float(g.get("scale", 0.095))))
    text = esc(g["text"].upper())
    y = int(H * float(g.get("y", 0.36)))
    out = []
    steps = [(0.62, 0.00), (1.12, 0.05), (0.94, 0.10), (1.03, 0.145), (1.0, 0.185)]
    for i, (mult, at) in enumerate(steps):
        size = int(base * mult)
        t0 = s + at
        t1 = s + steps[i + 1][1] if i + 1 < len(steps) else e
        last = i == len(steps) - 1
        out.append(
            f"drawtext=expansion=none:fontfile='{FONT_BLACK}':text='{text}':fontcolor={PAPER}:"
            f"fontsize={size}:x=(w-text_w)/2:y={y}:"
            f"borderw={max(2,int(W*0.004))}:bordercolor={INK}@0.9:"
            f"shadowx=0:shadowy={max(2,int(H*0.004))}:shadowcolor=black@0.45:"
            f"alpha='{anim(t0, t1, in_dur=0.04, out_dur=(OUT_DUR if last else 0.02), eased=last)}':"
            f"enable='{enable(t0, t1)}'"
        )
    return out


def t_stat(g, W, H):
    """A number that drops in, with its caption a beat behind."""
    s, e = g["start"], g["end"]
    num_size = max(48, int(W * 0.16))
    cap_size = max(18, int(W * 0.034))
    y = int(H * float(g.get("y", 0.13)))
    en = enable(s, e)
    drop = int(H * 0.035)
    return [
        f"drawtext=expansion=none:fontfile='{FONT_BLACK}':text='{esc(g['value'])}':"
        f"fontcolor={ACCENT}:fontsize={num_size}:x=(w-text_w)/2:"
        f"y='{y}+({travel(s, e, -drop)})':"
        f"borderw={max(2,int(W*0.004))}:bordercolor={INK}@0.85:"
        f"shadowx=0:shadowy={max(2,int(H*0.004))}:shadowcolor=black@0.4:"
        f"alpha='{anim(s, e)}':enable='{en}'",
        f"drawtext=expansion=none:fontfile='{FONT_BOLD}':text='{esc(g.get('caption',''))}':"
        f"fontcolor={PAPER}:fontsize={cap_size}:x=(w-text_w)/2:"
        f"y='{y + int(num_size * 1.05)}+({travel(s, e, -int(drop*0.5), delay=0.10)})':"
        f"box=1:boxcolor={INK}@0.8:boxborderw={int(cap_size*0.5)}:"
        f"alpha='{anim(s, e, delay=0.10)}':enable='{en}'",
    ]


def t_lower_third(g, W, H):
    """Title over subtitle on a band that wipes open, rule sweeping first."""
    s, e = g["start"], g["end"]
    t_size = max(26, int(W * 0.055))
    sub_size = max(17, int(W * 0.032))
    pad = int(W * 0.034)
    box_w = int(W * 0.80)
    box_x = int(W * 0.07)
    box_h = t_size + sub_size + pad * 2 + int(t_size * 0.25)
    box_y = int(H * float(g.get("y", 0.72)))
    en = enable(s, e)
    lift = int(H * 0.02)
    return [
        f"drawbox=x={box_x + 3}:y={box_y + 5}:w='{anim(s, e, hold=box_w, delay=0.05)}':"
        f"h={box_h}:color=black@0.26:t=fill:enable='{en}'",
        f"drawbox=x={box_x}:y={box_y}:w='{anim(s, e, hold=box_w, delay=0.05)}':h={box_h}:"
        f"color={INK}@0.88:t=fill:enable='{en}'",
        f"drawbox=x={box_x}:y={box_y}:w='{anim(s, e, hold=box_w)}':h={max(3,int(H*0.004))}:"
        f"color={ACCENT}@0.98:t=fill:enable='{en}'",
        f"drawtext=expansion=none:fontfile='{FONT_BOLD}':text='{esc(g['title'])}':fontcolor={PAPER}:"
        f"fontsize={t_size}:x={box_x + pad}:y='{box_y + pad}+({travel(s, e, lift, delay=0.12)})':"
        f"alpha='{anim(s, e, delay=0.12)}':enable='{en}'",
        f"drawtext=expansion=none:fontfile='{FONT_REG}':text='{esc(g.get('subtitle',''))}':"
        f"fontcolor={ACCENT}:fontsize={sub_size}:x={box_x + pad}:"
        f"y='{box_y + pad + t_size + int(t_size*0.25)}+({travel(s, e, lift, delay=0.19)})':"
        f"alpha='{anim(s, e, delay=0.19)}':enable='{en}'",
    ]


TEMPLATES = {
    "definition": t_definition,
    "callout": t_callout,
    "emphasis": t_emphasis,
    "stat": t_stat,
    "lower_third": t_lower_third,
}


def build_filter(plan, W, H):
    filters = []
    for g in plan:
        if not g.get("enabled", True):
            continue
        fn = TEMPLATES.get(g.get("type"))
        if not fn:
            print(f"  skipping unknown type {g.get('type')!r}", file=sys.stderr)
            continue
        filters.extend(fn(g, W, H))
    return ",".join(filters)


def probe_size(video):
    out = subprocess.run([ffmpeg_bin(), "-i", video], capture_output=True, text=True,
                         stdin=subprocess.DEVNULL).stderr
    m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", out)
    return (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cut")
    ap.add_argument("plan")
    ap.add_argument("-o", "--out")
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--preset", default="veryfast")
    ap.add_argument("--print-filter", action="store_true",
                    help="print the filtergraph and stop (for debugging)")
    a = ap.parse_args()

    plan = json.load(open(a.plan))
    if isinstance(plan, dict):
        plan = plan.get("graphics", [])
    W, H = probe_size(a.cut)
    graph = build_filter(plan, W, H)
    if not graph:
        print("nothing enabled in the plan -- nothing to render", file=sys.stderr)
        return 1
    if a.print_filter:
        print(graph)
        return 0

    out = a.out or (os.path.splitext(a.cut)[0] + "-graphics.mp4")
    cmd = [ffmpeg_bin(), "-y", "-i", a.cut, "-vf", graph,
           "-c:v", "libx264", "-preset", a.preset, "-crf", str(a.crf),
           "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
           out, "-loglevel", "error", "-nostats"]
    r = subprocess.run(cmd, stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        print("ffmpeg failed", file=sys.stderr)
        return 1
    n = sum(1 for g in plan if g.get("enabled", True))
    print(f"Wrote {out}  ({n} graphic(s) over {W}x{H})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

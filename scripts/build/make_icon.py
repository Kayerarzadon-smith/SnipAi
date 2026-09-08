#!/usr/bin/env python3
"""Draw the SnipAi app icon and write it as a PNG.

    python3 scripts/build/make_icon.py -o scripts/build/icon-1024.png

The previous icon was a placeholder -- a gold dot on a dark square, in a
colour the app doesn't even use. This draws the real mark: the play triangle
from the wordmark, snipped through by a diagonal cut, on the product's
purple-to-magenta gradient.

Pillow isn't installed on this machine and isn't worth adding for one asset,
so this rasterises by hand and writes the PNG with zlib. Everything is drawn
at 4x and box-filtered down, which is where the clean edges come from.
"""
import argparse, math, struct, zlib

BG_A = (0xA6, 0x26, 0xC4)      # --accent, purple
BG_B = (0xE0, 0x47, 0x9E)      # --accent-2, magenta
FG = (0xFF, 0xFF, 0xFF)

SS = 4                          # supersampling factor


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_rect(x, y, w, h, r):
    """Signed test: is (x, y) inside a rounded rectangle?"""
    cx = min(max(x, r), w - r)
    cy = min(max(y, r), h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r or (r <= x <= w - r) or (r <= y <= h - r)


def point_in_tri(px, py, tri):
    (ax, ay), (bx, by), (cx, cy) = tri
    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if d == 0:
        return False
    a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
    b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
    c = 1 - a - b
    return a >= 0 and b >= 0 and c >= 0


def draw(size):
    """Return an RGBA bytearray for one size, drawn at SS then averaged down."""
    S = size * SS
    radius = S * 0.225                      # macOS squircle-ish
    # play triangle, optically centred (a triangle looks left-heavy centred)
    tri = ((S * 0.375, S * 0.265), (S * 0.375, S * 0.735), (S * 0.775, S * 0.50))
    # the snip: a diagonal band lifted out of the triangle
    cut_w = S * 0.052
    cut_ang = math.radians(-38)
    cx0, cy0 = S * 0.30, S * 0.62

    hi = bytearray(S * S * 4)
    for py in range(S):
        for px in range(S):
            i = (py * S + px) * 4
            if not rounded_rect(px, py, S, S, radius):
                continue                     # transparent outside the squircle
            t = (px / S) * 0.55 + (py / S) * 0.45
            r, g, b = lerp(BG_A, BG_B, t)
            if point_in_tri(px, py, tri):
                # distance from the cut line; inside the band = stay background
                d = abs(math.cos(cut_ang) * (py - cy0) - math.sin(cut_ang) * (px - cx0))
                if d > cut_w:
                    r, g, b = FG
            hi[i:i + 4] = bytes((r, g, b, 255))

    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            rs = gs = bs = as_ = 0
            for dy in range(SS):
                for dx in range(SS):
                    j = (((y * SS + dy) * S) + (x * SS + dx)) * 4
                    rs += hi[j]; gs += hi[j + 1]; bs += hi[j + 2]; as_ += hi[j + 3]
            n = SS * SS
            k = (y * size + x) * 4
            out[k:k + 4] = bytes((rs // n, gs // n, bs // n, as_ // n))
    return out


def write_png(path, size, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * size * 4:(y + 1) * size * 4]) for y in range(size))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--size", type=int, default=1024)
    a = ap.parse_args()
    write_png(a.out, a.size, draw(a.size))
    print(f"Wrote {a.out} ({a.size}x{a.size})")


if __name__ == "__main__":
    main()

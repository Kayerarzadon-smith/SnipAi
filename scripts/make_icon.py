#!/usr/bin/env python3
"""Generates a simple on-brand app icon (dark rounded square + gold accent
mark, matching the app's wordmark stamp/accent colors) as a single 1024x1024
PNG, using only the stdlib (zlib) -- no Pillow needed. Other icon sizes are
produced from this one via `sips`.
"""
import struct
import zlib

SIZE = 1024
BG = (0x14, 0x16, 0x1b)       # --bg
ACCENT = (0xd9, 0xa4, 0x41)   # --accent
CORNER_RADIUS = SIZE * 0.22   # macOS "squircle"-ish rounded square


def rounded_mask(x, y):
    s = SIZE
    r = CORNER_RADIUS
    # distance outside the rounded-rect boundary; <=0 means inside
    dx = max(abs(x - s / 2) - (s / 2 - r), 0)
    dy = max(abs(y - s / 2) - (s / 2 - r), 0)
    return (dx * dx + dy * dy) ** 0.5 - r


def pixel(x, y):
    m = rounded_mask(x, y)
    if m > 0.5:
        return (0, 0, 0, 0)  # transparent outside the rounded square
    edge_alpha = 255 if m < -0.5 else max(0, int(255 * (1 - (m + 0.5))))

    # gold accent circle, centered, ~30% of the icon's radius
    cx, cy = SIZE / 2, SIZE / 2
    dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    radius = SIZE * 0.17
    if dist <= radius:
        return (*ACCENT, edge_alpha)
    return (*BG, edge_alpha)


def make_png(path):
    rows = []
    for y in range(SIZE):
        row = bytearray([0])  # filter type 0 per scanline
        for x in range(SIZE):
            r, g, b, a = pixel(x, y)
            row += bytes([r, g, b, a])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data)))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    import sys
    make_png(sys.argv[1] if len(sys.argv) > 1 else "icon-1024.png")
    print("wrote icon")

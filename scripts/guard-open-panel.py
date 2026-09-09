#!/usr/bin/env python3
"""The desktop app can still open a file chooser, and it offers the right files.

WKWebView has no file picker. `<input type="file">` does nothing at all unless
the host implements runOpenPanelWith -- no sheet, no error, no change event.
For a long time nothing implemented it, so "Import footage" was dead in the
app while the same page in a browser imported fine, because the browser brings
its own picker. Deleting that one method puts the app back to unusable with
nothing to see, so this refuses to let it go missing.

The panel cannot mirror the input's `accept` attribute -- WKOpenPanelParameters
does not carry it -- so the allowed extensions are written out twice, once in
Swift and once in the route that receives the upload. Two lists that must
agree and cannot see each other is how a file becomes pickable and then
rejected on arrival, so they are compared here.

Exit 1 and say which of the three went wrong.
"""
import pathlib
import re
import sys

SWIFT = pathlib.Path("native/main.swift")
ROUTE = pathlib.Path("app/api/projects/route.ts")


def swift_extensions(src):
    m = re.search(r"let kVideoExtensions\s*=\s*\[(.*?)\]", src, re.S)
    if not m:
        return None
    return {x.lower() for x in re.findall(r'"([^"]+)"', m.group(1))}


def route_extensions(src):
    m = re.search(r"VIDEO_EXT_LIST\s*=\s*\[(.*?)\]", src, re.S)
    if not m:
        return None
    return {x.lstrip(".").lower() for x in re.findall(r'"([^"]+)"', m.group(1))}


def file_inputs():
    """Every <input type="file"> in the app, with the accept it asks for.

    The panel filters to video for everything, because everything today is
    video. A file input asking for something else would be silently narrowed
    to video files it cannot use, so it has to be caught here rather than in
    front of the person using it.
    """
    out = []
    for f in sorted(pathlib.Path("app").rglob("*.tsx")):
        lines = f.read_text().splitlines()
        for i, line in enumerate(lines):
            if 'type="file"' not in line:
                continue
            # accept sits on its own line in JSX; look at the tag around it
            window = "\n".join(lines[max(0, i - 6):i + 7])
            acc = re.search(r'accept="([^"]*)"', window)
            out.append((f"{f}:{i + 1}", acc.group(1) if acc else None))
    return out


def main():
    problems = []

    try:
        swift = SWIFT.read_text()
    except OSError as e:
        print(f"  could not read {SWIFT}: {e}")
        return 1

    if "runOpenPanelWith" not in swift:
        problems.append(
            "native/main.swift no longer implements runOpenPanelWith --\n"
            "    every file input in the desktop app is dead, silently")

    sw = swift_extensions(swift)
    if sw is None:
        problems.append("native/main.swift has no kVideoExtensions to check")

    try:
        rt = route_extensions(ROUTE.read_text())
    except OSError as e:
        rt = None
        problems.append(f"could not read {ROUTE}: {e}")
    else:
        if rt is None:
            problems.append(f"{ROUTE} has no VIDEO_EXT_LIST to check")

    if sw and rt and sw != rt:
        pickable = ", ".join(sorted(sw - rt)) or "none"
        importable = ", ".join(sorted(rt - sw)) or "none"
        problems.append(
            "the picker and the importer disagree about what a video is:\n"
            f"    pickable but refused on arrival: {pickable}\n"
            f"    importable but not offered:      {importable}")

    for where, accept in file_inputs():
        if accept is None:
            problems.append(f"{where} is a file input with no accept -- "
                            "the panel will offer video anyway")
        elif not accept.startswith("video/"):
            problems.append(f'{where} asks for "{accept}", but the panel only '
                            "offers video")

    if problems:
        print("  the desktop file chooser is wrong:")
        for p in problems:
            print(f"    {p}")
        return 1

    n = len(file_inputs())
    print(f"  the file chooser is implemented and matches the importer "
          f"({n} input{'s' if n != 1 else ''})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

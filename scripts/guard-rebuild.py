#!/usr/bin/env python3
"""Every handler that changes the edit must schedule the re-render.

QA filed it as "edits are saved but never rebuilt in the packaged app", and
isolated it to the shipped server because a browser pointed at that server
behaved the same way. It was neither the build nor the window: four handlers
in the review screen wrote the edit and never called applyEditsSoon --
deleting a line, undoing, putting a deleted line back, and restoring a
version. Their Pass 1 saw rebuilds because they were trimming, and trimming
was one of the handlers that did call it.

Nothing about the shape of these functions makes the omission visible, so this
looks for it: a handler that sends a POST/PATCH/DELETE and then reloads is
changing the edit, and it has to schedule a build.

Exit 1 and name them if any are missing it.
"""
import re
import sys

PAGE = "app/projects/[project]/review/page.tsx"

# review-action only records what the user did for the learner; it changes no
# edit and must not trigger a render.
IGNORE_BODY = ("review-action",)


def handlers(src):
    """(name, body) for every function declaration, by brace matching."""
    for m in re.finditer(r"(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{", src):
        name, start = m.group(1), m.end()
        depth, i = 1, start
        while i < len(src) and depth:
            depth += (src[i] == "{") - (src[i] == "}")
            i += 1
        yield name, src[start:i]


def main():
    try:
        src = open(PAGE).read()
    except OSError as e:
        print(f"  could not read {PAGE}: {e}")
        return 0

    missing = []
    for name, body in handlers(src):
        if not re.search(r'method:\s*"(POST|PATCH|DELETE)"', body):
            continue
        if "await load()" not in body:
            continue
        if any(x in body for x in IGNORE_BODY):
            continue
        if "applyEditsSoon" in body:
            continue
        missing.append(name)

    if missing:
        print("  these change the edit and never schedule a re-render:")
        for n in sorted(set(missing)):
            print(f"    {n}")
        print("  the file on disk will keep what the user just removed")
        return 1
    print("  every edit handler schedules a re-render")
    return 0


if __name__ == "__main__":
    sys.exit(main())

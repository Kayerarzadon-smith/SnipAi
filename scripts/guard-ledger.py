#!/usr/bin/env python3
"""The bug board and the ledger have to agree about what is fixed.

`tests/regressions/` holds one test per known defect, written to FAIL until
that defect is fixed. `audits/LEDGER.md` holds the status of each. QA.md says
what connects them: "A test there going green is the signal that its bug is
fixed -- flip the ledger row and move on."

Flipping the row is a step a person has to remember, and S2 shows what happens
when nobody does: its test had been green for some time while the ledger still
listed it as `open`, including in the "Fix first" table at the top -- so the
one document written to say what to work on next was pointing at something
already done.

Both directions are checked. A row saying `fixed` whose test is RED is the
worse of the two, because it is the ledger claiming a defect is gone while the
test that defines it says otherwise.

A row marked `wontfix` is exempt: S1 is deliberately red and staying that way.
"""
import pathlib
import re
import subprocess
import sys

LEDGER = pathlib.Path("audits/LEDGER.md")


def board():
    """{id: passed} from the regression suite, run as the runner runs it."""
    # the files, not the directory: node refuses a directory import here, and
    # the shell glob scripts/test uses is not expanded by subprocess
    files = sorted(str(f) for f in pathlib.Path("tests/regressions").glob("*.test.mts"))
    if not files:
        return {}
    # Node picks its reporter by whether stdout is a TTY: the spec reporter
    # (the "✔ name" this used to match) when it is, the tap reporter
    # ("ok N - name") when it is not. subprocess.run's capture_output pipes
    # stdout, which is never a TTY -- so this saw zero matches on every run,
    # which reads identically to "the board found nothing" instead of "the
    # board found six passing tests and one wontfix". Ask for tap explicitly
    # rather than depend on how the caller happens to be connected.
    out = subprocess.run(
        ["node", "--import", "./tests/register.mts", "--test-reporter=tap",
         "--test", *files],
        capture_output=True, text=True).stdout
    seen = {}
    for line in out.splitlines():
        m = re.search(r"^(not ok|ok)\s+\d+\s+-\s+(S\d+):", line)
        if m:
            seen[m.group(2)] = m.group(1) == "ok"
    return seen


def ledger():
    """{id: status} from the detail table -- the one with the file reference."""
    rows = {}
    try:
        text = LEDGER.read_text()
    except OSError as e:
        print(f"  could not read {LEDGER}: {e}")
        return None
    for line in text.splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 4 or not re.fullmatch(r"S\d+", cells[1]):
            continue
        for c in cells[2:]:
            # statuses are written by hand and get decorated: "open",
            # "**fixed 2026-09-09** -- lib/splitBeat.ts divides instead of
            # copying", "wontfix". Strip the emphasis and read the first word.
            low = re.sub(r"[*_`]", "", c).strip().lower()
            m = re.match(r"(wontfix|fixed|open)\b", low)
            if m:
                # a later row wins: the detail table sits below the summary
                rows[cells[1]] = m.group(1)
                break
    return rows


def main():
    tests = board()
    rows = ledger()
    if rows is None:
        return 1
    if not tests:
        print("  no regression tests reported a result -- cannot check the ledger")
        return 1

    wrong = []
    for tid, passed in sorted(tests.items()):
        status = rows.get(tid)
        if status is None:
            wrong.append(f"{tid} has a test but no row in the ledger")
        elif status == "wontfix":
            continue
        elif passed and status == "open":
            wrong.append(f"{tid} passes, but the ledger still calls it open")
        elif not passed and status == "fixed":
            wrong.append(f"{tid} FAILS, but the ledger calls it fixed")

    if wrong:
        print("  the ledger and the bug board disagree:")
        for w in wrong:
            print(f"    {w}")
        print("  audits/LEDGER.md is what tells you what to work on next")
        return 1
    print(f"  the ledger agrees with all {len(tests)} regression tests")
    return 0


if __name__ == "__main__":
    sys.exit(main())

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

--------------------------------------------------------------------- ledger T8

This guard spent its life checking a fraction of the board and reporting the
fraction as the whole: "the ledger agrees with all 5 regression tests" was
printed on a board of 12 tests, and that sentence was quoted to Kayer as
assurance. Three separate defects produced it.

 1. The board side matched only `(S\\d+):`, so every C, N, P, T and E test was
    invisible.
 2. The ledger side matched only `S\\d+` in the id column, so widening (1)
    alone made it worse -- `rows.get("N1")` came back None and the guard failed
    a correct tree with "N1 has a test but no row in the ledger".
 3. Results were recorded into a dict keyed by id, last write winning. The two
    tests in `S19-concat-faststart.test.mts` are both titled `S19: ...`, so a
    failing first and a passing second recorded S19 as passing.

**An id now comes from the FILE NAME, not from the test title.** The board is
already named `S2-failjob-persists.test.mts`, `N1-server-states-its-data-root
.test.mts`, `T6-...`: one declaration per file, in the one place that cannot be
left off. Titles were the wrong source because coverage then depends on how
somebody worded a sentence -- the six tests added for N1 and T6 carry no id
prefix at all, so widening both regexes above would still have left them
invisible, and N1 could have been flipped back to `open` with this guard
printing green. A guard whose coverage silently depends on a title is the same
class of defect as the thing it guards. So: a board file whose name does not
begin with a ledger id is a FAILURE here, not a shrug, and the fix is to
rename the file.

Results are read from node's **junit** reporter rather than tap, because junit
is the only built-in reporter that says which FILE each test came from -- tap
run over several files emits one flat, renumbered list with no file anywhere in
it. Per file, every test must pass for the id to count as passing (bug 3), and
a file that reports no test result at all is called out rather than counted as
green.

The guard also states its own coverage on every run, pass or fail. "Agrees with
all 5 regression tests" was true and useless; the sentence a human reads has to
make under-coverage visible.

Two environment variables exist so this can be pointed at a fixture board and a
fixture ledger by its own regression test (`tests/regressions/T8-*.test.mts`):
SNIPAI_BOARD_DIR and SNIPAI_LEDGER. Neither is set in normal use.
"""
import os
import pathlib
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
LEDGER = pathlib.Path(os.environ.get("SNIPAI_LEDGER") or ROOT / "audits" / "LEDGER.md")
BOARD = pathlib.Path(os.environ.get("SNIPAI_BOARD_DIR") or ROOT / "tests" / "regressions")

# S2, C16, N1, P19, T8, E1, CG1 ... every family the ledger uses.
ID = r"[A-Z]{1,3}\d+"
FILE_ID = re.compile(rf"^({ID})-.+\.test\.mts$")
ROW_ID = re.compile(rf"{ID}\Z")
STATUS = re.compile(r"(wontfix|fixed|open|regressed)\b")


def sort_key(tid):
    """S2 before S18 before S19, and the families kept together."""
    m = re.match(r"([A-Z]+)(\d+)", tid)
    return (m.group(1), int(m.group(2))) if m else (tid, 0)


def rel(p):
    try:
        return str(pathlib.Path(p).resolve().relative_to(ROOT))
    except ValueError:
        return str(p)


class Board:
    """What the regression suite reported, per ledger id."""

    def __init__(self):
        self.passed = {}        # id -> bool  (every test in every file of it)
        self.files = {}         # id -> [relative paths]
        self.problems = []      # things that make the board unreadable
        self.n_files = 0
        self.n_tests = 0
        self.n_skipped = 0

    @property
    def ids(self):
        return sorted(self.passed, key=sort_key)


def run_board():
    b = Board()
    # the files, not the directory: node refuses a directory import here, and
    # the shell glob scripts/test uses is not expanded by subprocess
    files = sorted(f for f in BOARD.glob("*.test.mts") if not f.name.startswith("_"))
    if not files:
        b.problems.append(f"no regression tests found in {rel(BOARD)}")
        return b
    b.n_files = len(files)

    # A file that declares no id is reported before anything runs: it is the
    # one failure mode a green suite would otherwise hide.
    declared = {}
    for f in files:
        m = FILE_ID.match(f.name)
        if m:
            declared[f.resolve()] = m.group(1)
            b.files.setdefault(m.group(1), []).append(rel(f))
        else:
            b.problems.append(
                f"{rel(f)} names no ledger id -- rename it <ID>-<slug>.test.mts "
                f"or this guard cannot check it"
            )

    # junit, not tap: it is the only built-in reporter that attributes each
    # result to a file. (tap is still the right choice for `scripts/qa
    # --regressions`, which wants the titles a person reads -- and note that
    # neither can be left to default, because node picks its reporter by
    # whether stdout is a TTY and subprocess.run never gives it one. That
    # silence is ledger T2 and T7, in two different files.)
    # NODE_TEST_CONTEXT is set by node in the children of a `node --test` run,
    # and a child that sees it reports over an internal channel instead of
    # writing to stdout -- so inheriting it here yields an empty report and a
    # guard that cannot see the board at all. This guard is run from inside a
    # test by tests/regressions/T8-*.test.mts; the run it starts is its own.
    env = {k: v for k, v in os.environ.items() if k != "NODE_TEST_CONTEXT"}
    out = subprocess.run(
        [
            "node",
            "--import",
            str(ROOT / "tests" / "register.mts"),
            "--test-reporter=junit",
            "--test",
            *[str(f) for f in files],
        ],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
    ).stdout
    try:
        report = ET.fromstring(out)
    except ET.ParseError as e:
        b.problems.append(f"could not read the test runner's report: {e}")
        return b

    # per file first, so "every test passed" is an AND and not a last-write
    results = {}            # resolved path -> {"pass": int, "fail": int, "skip": int}
    for case in report.iter("testcase"):
        src = case.get("file")
        if not src:
            continue
        path = pathlib.Path(src).resolve()
        r = results.setdefault(path, {"pass": 0, "fail": 0, "skip": 0})
        if case.find("failure") is not None or case.get("failure") is not None:
            r["fail"] += 1
        elif case.find("skipped") is not None:
            r["skip"] += 1
        elif case.get("name") == path.name:
            # node emits one testcase named after the FILE when that file ran
            # no tests (and also when it failed to load, which lands in the
            # branch above). A file with no tests in it is not a pass, so this
            # counts as nothing and the file falls out as "reported no result".
            pass
        else:
            r["pass"] += 1

    for path, tid in declared.items():
        r = results.get(path, {"pass": 0, "fail": 0, "skip": 0})
        b.n_tests += r["pass"] + r["fail"]
        b.n_skipped += r["skip"]
        if r["pass"] + r["fail"] == 0:
            b.problems.append(
                f"{rel(path)} is on the board for {tid} but reported no test result"
                + (f" ({r['skip']} skipped)" if r["skip"] else "")
            )
            continue
        ok = r["fail"] == 0
        # two files for one id, or two tests in one file: all of them must pass
        b.passed[tid] = b.passed.get(tid, True) and ok
    return b


# The safest reading first: a row this guard cannot read unambiguously is
# treated as the most open of its candidate statuses, because the condition
# this guard exists to catch is "test green, row still open". Guessing
# "fixed" on an ambiguous row is the one error that hides work.
OPEN_MOST = ("regressed", "open", "fixed", "wontfix")


def cell_status(cell):
    """The status a cell declares, or None.

    `.match` anchors, so a row narrating "fixed 2026-09-11" in the MIDDLE of
    its defect column does not register -- checked, because T20 was filed on
    the belief that it did. Only a cell that BEGINS with a status word counts,
    which is what a status column looks like.
    """
    low = re.sub(r"[*_`]", "", cell).strip().lower()
    m = STATUS.match(low)
    return m.group(1) if m else None


def ledger():
    """{id: status} from the tables, plus the rows that could not be read.

    A later row wins, the detail table being lower down.

    WHY THIS NO LONGER TAKES THE FIRST STATUS-BEARING CELL AND STOPS.
    (ledger T20)

    It used to `break` on the first cell that began with a status word,
    whichever column that happened to be. That is fine until a row grows an
    extra column -- and on 2026-09-11 four of them did, when a status was
    APPENDED as a new cell ahead of the old one. The rows then read
    `[fixed, open]`, the guard took `fixed`, and it printed "the ledger
    agrees with the bug board" over four rows whose status column said open.
    **Three malformed rows passed three green runs in one night, and the
    third was a row about a guard.** Verified against tonight's history:
    at 952d039 the S34, S36, S42 and T19 rows all read `[fixed, open]`.

    So every status-bearing cell is collected. Agreement is the answer;
    disagreement is not something to interpret. **A row with two statuses is
    a malformed row, and saying so is the correct output** -- it goes to the
    unreadable list, not the disagreement list (T21's distinction), and its
    status is taken as the most open of the candidates so the guard can only
    ever complain more, never less.

    Measured before shipping: of 209 rows today, 12 carry more than one
    status-bearing cell and **none of them disagree**, so this flags nothing
    that is currently correct. A stricter rule -- every row must match its
    table's column count -- would have flagged 44, most of them long-standing
    and harmless, which is a flood rather than a guard.
    """
    rows, unreadable = {}, []
    try:
        text = LEDGER.read_text()
    except OSError as e:
        print(f"  could not read {rel(LEDGER)}: {e}")
        return None, None
    for n, line in enumerate(text.splitlines(), 1):
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 4 or not ROW_ID.fullmatch(cells[1]):
            continue
        found = [(i, cell_status(c)) for i, c in enumerate(cells[2:], 2)]
        found = [(i, st) for i, st in found if st]
        if not found:
            continue
        seen = {st for _, st in found}
        if len(seen) > 1:
            where = ", ".join(f"cell {i} says {st}" for i, st in found)
            unreadable.append(
                f"{cells[1]} (line {n}) declares more than one status -- {where}. "
                f"Reading it as the most open of them; fix the row"
            )
            rows[cells[1]] = min(seen, key=OPEN_MOST.index)
        else:
            rows[cells[1]] = found[0][1]
    return rows, unreadable


def coverage(board, rows):
    """What this guard did and did not look at. Printed on every run.

    The old success line -- "the ledger agrees with all 5 regression tests" --
    was true of a board with 12 tests on it. A guard that reports agreement
    without reporting its denominator gets quoted as if it covered everything.
    """
    if board.ids:
        print(
            f"    checked {len(board.ids)} ids across {board.n_files} board "
            f"file(s) and {board.n_tests} test(s)"
            + (f", {board.n_skipped} skipped" if board.n_skipped else "")
            + ": " + " ".join(board.ids)
        )
    live = sorted(
        (i for i, s in rows.items() if s in ("open", "regressed") and i not in board.passed),
        key=sort_key,
    )
    if live:
        # Deliberately not called a defect count. LEDGER.md settled on one
        # definition of "how many are left" (the finish-line count) after two
        # totals circulating stopped anyone trusting the file; this is a
        # different quantity -- rows with no test here, whatever section they
        # sit in -- and it must not be mistaken for that one.
        print(
            f"    {len(live)} row(s) marked open or regressed have no test on the board; "
            f"this guard says nothing about those (it is not the defect count)"
        )


def main():
    board = run_board()
    rows, unreadable = ledger()
    if rows is None:
        return 1

    # "I could not read my input" and "the ledger is stale" are different
    # findings and used to print under one heading -- the stale one, which
    # sends whoever reads it to edit the ledger when the fault is a filename,
    # a parse error, or a row with two statuses. (ledger T21)
    unread = list(board.problems) + list(unreadable)
    wrong = []
    for tid in board.ids:
        passed = board.passed[tid]
        status = rows.get(tid)
        if status is None:
            wrong.append(f"{tid} has a test but no row in the ledger")
        elif status == "wontfix":
            continue
        elif passed and status in ("open", "regressed"):
            wrong.append(f"{tid} passes, but the ledger still calls it {status}")
        elif not passed and status == "fixed":
            wrong.append(f"{tid} FAILS, but the ledger calls it fixed")

    if unread:
        print("  this guard could not read part of its input:")
        for u in unread:
            print(f"    {u}")
    if wrong:
        print("  the ledger and the bug board disagree:")
        for w in wrong:
            print(f"    {w}")
        print(f"  {rel(LEDGER)} is what tells you what to work on next")
    if unread or wrong:
        coverage(board, rows)
        return 1
    print("  the ledger agrees with the bug board")
    coverage(board, rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())

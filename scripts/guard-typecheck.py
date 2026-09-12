#!/usr/bin/env python3
"""Every test file has to be inside the typechecker's include set. (ledger N18)

WHY THIS EXISTS, and why it is a stronger case than the guards beside it.

`tsconfig.json`'s include was `["next-env.d.ts", "**/*.ts", "**/*.tsx",
".next/types/**/*.ts"]`. Every test in this repo is `.mts` -- 21 of 21, zero
`.ts` -- so `npx tsc --noEmit` typechecked `lib/`, `app/` and `scripts/` and
not one line of `tests/`, for as long as the suite had existed. `bundle-app`
runs `scripts/qa --full` as its release gate, and that run's typecheck was
never looking there, so "tsc clean" was quoted as green by everyone all day
while covering less than they believed.

It cost two real fail-opens. The `ClipProbe` fixtures in `grouping.test.mts`
and `import-batch.test.mts` were each missing two fields, both feed
`analyseBatch -> joinRefusal`, and a probe carrying `undefined` where the code
tested `=== null` produced `NaN` -- which fails every comparison, so the join
guard answered "no blocker" for exactly the clip it exists to refuse.

`guard-ledger` and `verify-bundle` exist for misses somebody eventually
noticed. **This one had no symptom at all** -- nothing went red, nothing
printed, and the only reason it surfaced is that a fixture happened to be
missing a field somebody was looking for. That is what earns a gate: a wrong
answer is recoverable, an invisible absence of checking is not.

HOW IT ASKS. Not by reimplementing tsconfig's globbing, which is the obvious
way to write a guard that disagrees with the thing it guards. `tsc
--showConfig` expands `include`/`exclude` into a concrete `files` list without
resolving imports -- so it is tsc's own answer to "what would you check", and
it cannot drift from tsc's semantics. Import resolution is deliberately not
used: a test file reachable only because a sibling imports it would appear in
the program while still being outside the include set, and that is the bug.

So the next sibling extension -- `.cts`, a stray `.mjs` helper -- fails this
rather than being silently skipped.

SNIPAI_TSCONFIG and SNIPAI_TESTS_DIR exist so the regression test can point
this at a fixture tree. Neither is set in normal use.
"""
import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TSCONFIG = pathlib.Path(os.environ.get("SNIPAI_TSCONFIG") or ROOT / "tsconfig.json")
TESTS = pathlib.Path(os.environ.get("SNIPAI_TESTS_DIR") or ROOT / "tests")

# Everything tsc could check if it were told to. A file here that tsc is NOT
# told to check is the defect; listing the extensions rather than guessing
# from tsc's own defaults is what makes a new one visible.
SOURCE_SUFFIXES = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}

DIM, ERR, OK, OFF = "\033[2m", "\033[31m", "\033[32m", "\033[0m"


def typechecked_files() -> set[pathlib.Path]:
    """What tsc says it would check, from its own expansion of the config."""
    run = subprocess.run(
        ["npx", "tsc", "--showConfig", "-p", str(TSCONFIG)],
        cwd=ROOT, capture_output=True, text=True, timeout=180,
    )
    if run.returncode != 0:
        print(f"  {ERR}tsc --showConfig failed, so this guard cannot answer:{OFF}")
        print(f"  {DIM}{(run.stderr or run.stdout).strip()[:400]}{OFF}")
        sys.exit(1)
    try:
        cfg = json.loads(run.stdout)
    except json.JSONDecodeError as e:
        # A tsconfig comment containing a glob closes a block comment early,
        # because "*/" sits inside "**/" -- that produced 1211 errors once.
        print(f"  {ERR}tsc --showConfig did not return JSON ({e}){OFF}")
        sys.exit(1)
    base = TSCONFIG.parent
    return {(base / f).resolve() for f in cfg.get("files", [])}


def test_sources() -> list[pathlib.Path]:
    if not TESTS.is_dir():
        return []
    return sorted(
        p.resolve() for p in TESTS.rglob("*")
        if p.is_file() and p.suffix in SOURCE_SUFFIXES
    )


def main() -> int:
    # Before asking tsc anything: a guard pointed at the wrong place must not
    # report success over an empty search. Asked first so the answer is this
    # sentence rather than tsc's "No inputs were found in config file", which
    # is true but describes the wrong problem.
    sources = test_sources()
    if not sources:
        print(f"  {ERR}no test sources found under {TESTS}{OFF}")
        print(f"  {DIM}a guard that finds nothing to check is not a passing guard{OFF}")
        return 1

    checked = typechecked_files()
    missed = [p for p in sources if p not in checked]

    # The denominator, always. A guard that says "fine" without saying how much
    # it looked at is how the ledger got three "agrees" over a malformed table.
    by_suffix: dict[str, int] = {}
    for p in sources:
        by_suffix[p.suffix] = by_suffix.get(p.suffix, 0) + 1
    spread = ", ".join(f"{n} {ext}" for ext, n in sorted(by_suffix.items()))

    if missed:
        print(f"  {ERR}{len(missed)} of {len(sources)} test file(s) are outside the typechecker{OFF}")
        for p in missed[:10]:
            print(f"    {p.relative_to(ROOT) if ROOT in p.parents else p}")
        if len(missed) > 10:
            print(f"    {DIM}...and {len(missed) - 10} more{OFF}")
        print(f"  {DIM}add the extension to {TSCONFIG.name}'s include, then fix what it finds.{OFF}")
        print(f"  {DIM}a test nobody typechecks is how S34's guard came to fail open.{OFF}")
        return 1

    print(f"  {OK}every test file is typechecked{OFF}")
    print(f"    {DIM}{len(sources)} file(s) under {TESTS.name}/ ({spread}), all in tsc's include set{OFF}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

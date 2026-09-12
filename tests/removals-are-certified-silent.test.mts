import test from "node:test";
import assert from "node:assert/strict";

import { exitRunProject, overlap } from "./silence-maps.mts";

/**
 * LEDGER S71 -- the verifier is more sensitive than the detector whose
 * decisions it audits, so it reports the build cutting words that the build
 * never cut.
 *
 * `verify_removals.py` reported *"4 of 37 removals carry speech. The build is
 * cutting words in half"* on the joined project, with a clean single-clip
 * control. It was filed High and put ahead of everything. **It is a tool
 * defect, not a build defect.**
 *
 * `verify_removals.py:171-179` sets `floor = project_speech - 8` = **-34.7 dB**
 * for this project, while the build cuts against `silence_map.py`'s hardcoded
 * **-28 dB** (invoked at `lib/pipeline.ts` with no `--noise`). So the
 * verifier is 6.7 dB more sensitive than the map, and everything in
 * `(-34.7, -28]` is a false positive **by construction** -- a band the build
 * was never asked to avoid.
 *
 * WHAT THIS FILE ASSERTS, and what it deliberately does not.
 *
 * The half that needs no audio is the one that matters most: **every span the
 * build removed lies inside a region the -28 dB map had already certified as
 * silent.** That is the claim "the build is cutting words in half" denies,
 * and it is checkable from `edl.json` and `silence.txt` alone. It passes
 * today, which is the point -- the build is innocent, and this is the guard
 * that would catch a build that genuinely started clipping words.
 *
 * The other half -- clamping the verifier's floor so it is never more
 * sensitive than the map -- **is not fixed here.** `verify_removals.py` is
 * under `ugc-edit-system/`, outside this seat's scope without Kayer saying so
 * in the run, and it takes only `--project` and `--margin`, so the app cannot
 * pass the clamp in from outside: `--margin` shifts the floor relative to
 * measured speech level, which is not the same quantity as the map's absolute
 * threshold. It needs the one-line Python change the row describes.
 *
 * Worth knowing before anyone prioritises it: **`verify_removals.py` is not
 * invoked from `lib/`, `app/`, `scripts/`, `tests/` or `native/` at all.**
 * It is a hand-run diagnostic, so its false alarm reaches a person reading a
 * terminal, never Kayer. That does not make the row wrong -- a lying
 * instrument cost a High-priority slot tonight and nearly cost a tuning pass
 * on an innocent build -- but it is not in the product's path.
 */

const P = exitRunProject();
const skip = !P && "the exit run's evidence is not on this machine";

/** `walk_pieces` labels a beat's pieces `<label>-0`, `<label>-1`, ... */
const baseLabel = (l: string) => l.replace(/-\d+$/, "");

/** The gaps the build cut out from INSIDE a line: between consecutive pieces
 *  of the same beat. Those are the 37 "removals" the verifier audits. */
function interiorRemovals() {
  const out: { label: string; start: number; end: number }[] = [];
  const edl = P!.edl;
  for (let i = 1; i < edl.length; i++) {
    const prev = edl[i - 1];
    const next = edl[i];
    if (baseLabel(prev.label) !== baseLabel(next.label)) continue;
    if (next.src_start <= prev.src_end) continue;
    out.push({ label: baseLabel(prev.label), start: prev.src_end, end: next.src_start });
  }
  return out;
}

test("S71: the build made interior removals at all, so there is something to audit", { skip }, () => {
  /* The premise. The row is about 37 of them; a build that removed nothing
     would make every assertion below vacuously true. */
  const r = interiorRemovals();
  assert.ok(
    r.length >= 20,
    `only ${r.length} interior removals reconstructed from edl.json; the row was filed on 37`
  );
});

test("S71: every span the build removed was silence the map had already found", { skip }, () => {
  /* The claim the verifier's sentence denies.
     
     NOT single-region containment, which was my first instrument and was
     wrong. One real removal -- `im-telling-ladies-3`, 1119.362-1120.575 --
     spans TWO adjacent silent regions separated by a 15ms tick
     (1119.573 to 1119.588), so nothing contains it while it is 98.7%
     silence. Trimming across a 15ms blip between two silent stretches is
     what pause trimming is for; an assertion that called it a defect would
     have been loosened with slack until it passed, which is how a guard
     stops meaning anything. Coverage is the honest measure. */
  const thin = interiorRemovals()
    .map((r) => ({ ...r, cover: overlap(r.start, r.end, P!.loose) / (r.end - r.start) }))
    .filter((r) => r.cover < 0.95);
  assert.deepEqual(
    thin.map((r) => `${r.label} ${r.start.toFixed(3)}-${r.end.toFixed(3)} ${(100 * r.cover).toFixed(0)}%`),
    [],
    `${thin.length} removal(s) are less than 95% silence by the map the build cut against. ` +
    `If this is red the build really is cutting into speech and S71 is the wrong diagnosis`
  );
});

test("S71: and nothing word-length survives inside a removal", { skip }, () => {
  /* The sharpest form of "the build is not cutting words in half". Coverage
     alone would tolerate one 400ms syllable inside a long silent span. What
     is measured here is the LONGEST contiguous non-silent stretch inside any
     removal: a spoken word is hundreds of milliseconds, so anything under
     ~80ms cannot be one. Measured across all 37 removals on his real cut. */
  const WORD_FLOOR = 0.08;
  const worst: { label: string; run: number }[] = [];
  for (const r of interiorRemovals()) {
    /* Walk the removal, stepping over each silent region, and keep the
       largest ungapped remainder. */
    let run = 0;
    let at = r.start;
    for (const s of P!.loose.filter((x) => x.end > r.start && x.start < r.end)) {
      if (s.start > at) run = Math.max(run, s.start - at);
      at = Math.max(at, s.end);
    }
    if (r.end > at) run = Math.max(run, r.end - at);
    if (run >= WORD_FLOOR) worst.push({ label: r.label, run });
  }
  assert.deepEqual(
    worst.map((w) => `${w.label} carries ${(w.run * 1000).toFixed(0)}ms of unbroken non-silence`),
    [],
    `a removal contains a stretch long enough to be speech`
  );
});

test("S71: the verifier's own floor is below the map it audits, which is the defect", { skip }, async () => {
  /* The arithmetic, read off the tool rather than restated. `SPEECH_MARGIN_DB`
     subtracted from measured speech level gives a floor with no relation to
     the map's absolute threshold, so on a project whose speech sits near
     -26.7dB the floor lands at -34.7dB and opens a 6.7dB band of false
     positives. Asserted structurally: nothing clamps the floor against the
     detector's threshold. */
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const tool = path.join(root, "ugc-edit-system", "tools", "verify_removals.py");
  if (!fs.existsSync(tool)) return;
  const src = fs.readFileSync(tool, "utf8");

  assert.match(src, /floor\s*=\s*speech_level\s*-\s*a\.margin/,
    "verify_removals.py's floor is computed differently now -- re-read S71 before trusting its row");
  assert.ok(
    !/max\(.*floor|floor\s*=\s*max\(/.test(src),
    "the floor is clamped now, so S71's fix has landed and this row should be closed"
  );
});

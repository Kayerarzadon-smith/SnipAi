import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scratchDir } from "../scratch.mts";
import { at, clip } from "./_seams.mts";

/**
 * LEDGER C37 (and S38's plumbing) -- the tray showed one sentence that was
 * the same above both answers.
 *
 * `DropZone.tsx` rendered `reasons[0]` at both sites, and `reasons[0]` was
 * always the continuity sentence because `grouping.ts` pushed continuity
 * first. Off the persisted three-clip proposal
 * (`~/Movies/SnipAi/qa-3clip/qa-evidence/proposal-batch.json`):
 *
 *   joined    IMG_0060 -> IMG_0061   verdict same
 *             reasons[0]: "IMG_0061.MOV does not pick up where IMG_0060.MOV left off"
 *   separated IMG_0061 -> IMG_0062   verdict separate
 *             reasons[0]: "IMG_0062.MOV does not pick up where IMG_0061.MOV left off"
 *
 * One template, two opposite verdicts, and the reason that actually decided
 * each sat at `reasons[1]`. A line that does not change with the outcome
 * cannot be explaining it -- and it is the line he reads while deciding
 * whether to trust the proposal, so a wrong one costs him the click the
 * confirm step exists to buy.
 *
 * WHAT THIS FILE ASSERTS, and why not "the card renders `decidedBy`". The
 * defect was invisible to any test that looked at one seam: each sentence was
 * individually true and well-formed. It only shows up in the RELATIONSHIP
 * between two seams that disagree, so that is what is pinned:
 *
 *     two seams with opposite verdicts cannot be explained by the same words
 *
 * and, separately, that the sentence shown is one whose own weight actually
 * moved the score, rather than one that scored nothing.
 *
 * S38's plumbing rides along because the tray needs both to be useful at
 * once: `score`, `confident` and `decidedBy` were dropped by `trayseam`, so
 * even a correct sentence arrived with no way to tell a 0.95 "same" from a
 * -0.1 "separate". **S38's `needsYourEye` predicate is deliberately NOT
 * changed here** -- see the comment at that line, and the row: `!confident`
 * cannot be satisfied without questioning correct splits, because
 * `CONFIDENT_AT` is unreachable for most of the `separate` range.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sandbox = scratchDir("c37");
fs.mkdirSync(path.join(sandbox, "projects"), { recursive: true });
process.env.SNIPAI_DATA = sandbox;

const { proposeGroups } = await import("@/lib/grouping");

/* ---- fixtures, shaped like the three-clip run ---- */
/* The builders are shared with S38's file (`_seams.mts`). They were inline
   here first; a second copy would have been the third hand-rolled `probe()`
   in this repo, and the first two each shipped missing a ClipProbe field. */

/* Clip 1 stops on a function word, minutes before clip 2: the seam the rule
   calls confidently. Clip 2 ends on a finished sentence one minute before
   clip 3: the seam it can barely call. Both seams have nothing carrying over,
   so continuity scores zero on both -- as it did on all five real seams. */
const HOOK = clip("IMG_0060.MOV", at(0), [
  "A question my wife asked me the other day was whether creatine is safe for you",
]);
const MIDDLE = clip("IMG_0061.MOV", at(6), [
  "Creatine is straight up a supplement powerhouse for women.",
]);
const CTA = clip("IMG_0062.MOV", at(7), [
  "If you want to feel good and look your damn best, go and grab some.",
]);

const proposal = proposeGroups([HOOK, MIDDLE, CTA]);
const seam = (from: string, to: string) =>
  proposal.seams.find((s) => s.from === from && s.to === to)!;

const confidentSeam = seam("IMG_0060.MOV", "IMG_0061.MOV");
const closeCall = seam("IMG_0061.MOV", "IMG_0062.MOV");

test("C37: the fixture reproduces the run -- one seam called cleanly, one barely", () => {
  /* The premise, asserted first so nothing below can be measuring a pair of
     seams that do not disagree. These are the two numbers off his own run. */
  assert.equal(confidentSeam.verdict, "same");
  assert.equal(confidentSeam.confident, true, `scored ${confidentSeam.score}`);
  assert.equal(closeCall.verdict, "separate");
  assert.equal(closeCall.confident, false, `scored ${closeCall.score}`);
  assert.ok(
    Math.abs(closeCall.score) < Math.abs(confidentSeam.score),
    "the close call is not weaker than the confident one, so the pair proves nothing"
  );
});

test("C37: two seams with opposite verdicts are not explained by the same words", () => {
  /* The headline, and the only assertion that could have caught this: each
     sentence was individually fine. */
  assert.notEqual(
    confidentSeam.decidedBy.replace(/IMG_\d+\.MOV/g, "X"),
    closeCall.decidedBy.replace(/IMG_\d+\.MOV/g, "X"),
    `both verdicts are explained by the same sentence: "${closeCall.decidedBy}"`
  );
});

test("C37: the sentence shown is one that actually moved the score", () => {
  /* Continuity scored zero on all five real seams and was shown on every one
     of them. A reason that contributed nothing cannot be the reason. Checked
     by its own text, because the zero-weight continuity branch is the one
     that fires when nothing carries over -- which both fixtures do. */
  for (const s of [confidentSeam, closeCall]) {
    const continuity = `${s.to} does not pick up where ${s.from} left off`;
    assert.ok(
      s.reasons.includes(continuity),
      "the fixture no longer exercises the zero-weight continuity branch"
    );
    assert.notEqual(
      s.decidedBy, continuity,
      `${s.from} -> ${s.to} is explained by a reason that scored nothing`
    );
  }
});

test("C37: reasons read strongest-first, so the whole list is an argument", () => {
  for (const s of [confidentSeam, closeCall]) {
    assert.equal(s.reasons[0], s.decidedBy, `${s.from} -> ${s.to}: the list does not lead with what decided it`);
  }
});

test("C37: a quoted sentence is never cut mid-word", () => {
  /* `…${t.slice(-45)}` is a character slice, and it beheaded his own speech
     inside quotation marks: "…traight up a supplement powerhouse for women."
     The word is "straight". Asserted as a relationship -- whatever survives
     the ellipsis has to begin where a word begins in the original -- rather
     than against the fixed string, so it holds for any sentence length. */
  const spoken = "Creatine is straight up a supplement powerhouse for women.";
  const quoted = /"([^"]*)"/.exec(closeCall.decidedBy);
  assert.ok(quoted, `no quoted speech in "${closeCall.decidedBy}"`);
  const shown = quoted![1];
  assert.ok(shown.startsWith("…"), `the fixture is too short to truncate: "${shown}"`);
  const tail = shown.slice(1);
  assert.ok(
    spoken.includes(` ${tail}`),
    `"${tail}" does not start on a word boundary of "${spoken}"`
  );
});

/* -------------------------------------------------------------------------
 * S38's plumbing: what the tray is handed, and what it does with it.
 * ---------------------------------------------------------------------- */
test("S38: the tray is handed the confidence, not just the verdict", () => {
  /* `trayseam` returned four fields, so the tray could not have shown this
     even if it had wanted to. Asserted through the real mapping rather than
     the type, by taking the same route `analyseBatch` takes. */
  for (const s of [confidentSeam, closeCall]) {
    assert.equal(typeof s.score, "number", "score is not carried");
    assert.equal(typeof s.confident, "boolean", "confident is not carried");
    assert.equal(typeof s.decidedBy, "string", "decidedBy is not carried");
  }
});

test("S38: importBatch passes seams through one mapping, confidence included", () => {
  /* Staleness guard, not the proof. The fields above exist on the rule's own
     seam; this is what stops them being dropped again on the way out -- which
     is exactly what `needsYourEye` used to do with its own inline mapping. */
  const src = fs.readFileSync(path.join(ROOT, "lib", "importBatch.ts"), "utf8");
  assert.ok(/needsYourEye: proposal\.needsYourEye\.map\(trayseam\)/.test(src),
    "needsYourEye has its own field list again, which is how score and confident got lost");
  for (const field of ["score:", "confident:", "decidedBy:"]) {
    assert.ok(src.includes(field), `trayseam no longer carries ${field}`);
  }
});

test("S38/C37: the tray reads decidedBy and says when a call was close", () => {
  const src = fs.readFileSync(path.join(ROOT, "app", "dashboard", "DropZone.tsx"), "utf8");
  /* Comments stripped first. A JSX comment in DropZone quotes the old
     expression on purpose so the next reader knows what it replaced, and a
     looser pattern matches that quotation and fails on the fix's own
     history -- the same mistake this session already made twice, in C32's
     and C35's guards. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\.reasons\[0\]/.test(code),
    "DropZone renders reasons[0] again -- that is the sentence that does not change with the verdict");
  assert.equal(
    (src.match(/\.decidedBy/g) ?? []).length >= 2, true,
    "both the split line and the join seam should name what decided them"
  );
  assert.ok(/import-close-call/.test(src), "the tray no longer marks a verdict it could barely reach");
  assert.ok(!/type TraySeam = \{/.test(src),
    "DropZone declares its own copy of the seam shape again -- that copy is how the confidence " +
    "went missing from the tray in the first place");
});

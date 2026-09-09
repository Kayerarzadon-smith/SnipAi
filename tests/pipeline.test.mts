import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runCommand, latestCut } from "../lib/pipeline.ts";
import { PROJECTS_ROOT } from "../lib/paths.ts";

/* A ten-minute wall-clock ceiling killed a real 4K build at 601 seconds and
   reported "see log" with an empty log, because a killed process leaves no
   error behind. Slowness is not failure; silence is. */
describe("a long job is judged by whether it is still working", () => {
  test("something slow but talking is left alone", async () => {
    // Three seconds of work against a two-second idle window: the job has to
    // outlive the window, but no single gap comes close to it. A 200ms cadence
    // under a 1s window read as five times the margin and was not -- a busy
    // Mac stalls a bash loop past a second often enough that this test failed
    // about one run in fifteen, which teaches you to re-run a red suite.
    const r = await runCommand("bash",
      ["-c", 'for i in $(seq 1 15); do echo "working $i"; sleep 0.2; done'],
      { idleMs: 2000 });
    assert.equal(r.ok, true, "a chatty slow job must survive");
    assert.equal(r.timedOut, undefined);
    assert.match(r.stdout, /working 15/);
  });

  test("something that has gone quiet is killed, and says so", async () => {
    const began = Date.now();
    const r = await runCommand("bash", ["-c", 'echo starting; sleep 30'], { idleMs: 600 });
    const took = Date.now() - began;
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true, "must be reported as a timeout, not a plain failure");
    assert.match(r.stderr, /stopped responding/,
                 "a killed process cannot explain itself — the message has to");
    // The children have to die too. Killing only the shell leaves its ffmpeg
    // running and holding the output pipes, so we would wait out the whole
    // job to learn it had already been given up on.
    assert.ok(took < 5000, `killed the tree in ${took}ms, not after the full 30s`);
  });

  test("a real failure is still a failure, not a timeout", async () => {
    const r = await runCommand("bash", ["-c", "exit 3"], { idleMs: 5000 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, undefined);
    assert.equal(r.code, 3);
  });

  test("output is streamed as it arrives, not buffered to the end", async () => {
    const seen: string[] = [];
    await runCommand("bash", ["-c", 'echo one; sleep 0.15; echo two'],
                     { idleMs: 3000, onLine: (l) => seen.push(l) });
    assert.deepEqual(seen, ["one", "two"]);
  });
});

/* Re-scoring a cut that already exists.

   The checks only ever ran at the tail of a build, so a check computed while
   one of the two tools was broken stayed broken until somebody re-rendered
   the whole thing. latestCut is what lets it be recomputed instead -- and it
   has to name the newest render, which is not the last one alphabetically. */
describe("finding the cut to re-check", () => {
  const P = "_test_latestcut";
  const cuts = path.join(PROJECTS_ROOT, P, "cuts");

  before(() => {
    fs.rmSync(path.join(PROJECTS_ROOT, P), { recursive: true, force: true });
    fs.mkdirSync(cuts, { recursive: true });
  });
  after(() => fs.rmSync(path.join(PROJECTS_ROOT, P), { recursive: true, force: true }));

  test("nothing built yet is null, not a guess", () => {
    assert.equal(latestCut(P), null);
  });

  test("the newest version, counted as a number", () => {
    for (const v of [1, 2, 9, 10]) fs.writeFileSync(path.join(cuts, `${P}-v${v}.mp4`), "");
    // sorted as text, v9 wins and the person re-scores a cut two renders old
    assert.equal(latestCut(P), `${P}-v10.mp4`);
  });

  test("things that are not renders are ignored", () => {
    fs.writeFileSync(path.join(cuts, "notes.txt"), "");
    fs.writeFileSync(path.join(cuts, `${P}-draft.mp4`), "");
    assert.equal(latestCut(P), `${P}-v10.mp4`);
  });
});

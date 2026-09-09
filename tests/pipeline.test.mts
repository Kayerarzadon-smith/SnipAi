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

/* A job that has gone quiet says so before it is killed.
 *
 * Kayer watched a 1.76GB import sit on one unchanging word for five minutes
 * and could not tell working from hung -- which is the defect, separately
 * from how long the work legitimately takes. Silence is now narrated. */
describe("a quiet job is narrated, not just killed", () => {
  test("it warns while still alive, then kills", async () => {
    const lines: string[] = [];
    const r = await runCommand("bash", ["-c", 'echo starting; sleep 30'],
                               { idleMs: 1200, onLine: (l) => lines.push(l) });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    const warned = lines.filter((l) => /still working/.test(l));
    assert.ok(warned.length >= 1,
      `expected at least one "still working" warning before the kill, got:\n${lines.join("\n")}`);
    assert.match(warned[0], /nothing reported for \d+s/);
    assert.match(warned[0], /will be stopped/, "the warning has to say what happens next");
  });

  /* QA saw "nothing reported for 20s ... another 280s" during ordinary
     transcription and ordinary rendering, both of which routinely go quiet
     for longer than twenty seconds. A warning that fires when nothing is
     wrong teaches you to ignore the one that matters, so it waits until half
     the window is gone -- and no longer, because the point is to speak before
     the kill, not after. */
  test("the first warning lands around halfway, not immediately", async () => {
    const lines: string[] = [];
    const idleMs = 2000;
    await runCommand("bash", ["-c", "echo starting; sleep 30"],
                     { idleMs, onLine: (l) => lines.push(l) });
    const first = lines.find((l) => /still working/.test(l));
    assert.ok(first, `expected a warning, got:\n${lines.join("\n")}`);
    const quiet = Number(/nothing reported for (\d+)s/.exec(first!)?.[1]);
    const left = Number(/another (\d+)s/.exec(first!)?.[1]);
    assert.ok(quiet >= 1, `warned after ${quiet}s of a ${idleMs / 1000}s window — too eager`);
    assert.ok(quiet < idleMs / 1000, `warned after the kill window closed (${quiet}s)`);
    assert.ok(left >= 1, "a warning with no time left on it is not a warning");
  });

  test("a job that keeps talking is never warned about", async () => {
    const lines: string[] = [];
    const r = await runCommand("bash",
      ["-c", 'for i in $(seq 1 12); do echo "working $i"; sleep 0.2; done'],
      { idleMs: 4000, onLine: (l) => lines.push(l) });
    assert.equal(r.ok, true);
    assert.equal(lines.filter((l) => /still working/.test(l)).length, 0,
      "a job reporting normally must not be accused of stalling");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../lib/pipeline.ts";

/* A ten-minute wall-clock ceiling killed a real 4K build at 601 seconds and
   reported "see log" with an empty log, because a killed process leaves no
   error behind. Slowness is not failure; silence is. */
describe("a long job is judged by whether it is still working", () => {
  test("something slow but talking is left alone", async () => {
    // three seconds of work, well past a one-second idle window, but never
    // quiet for longer than 200ms
    const r = await runCommand("bash",
      ["-c", 'for i in $(seq 1 15); do echo "working $i"; sleep 0.2; done'],
      { idleMs: 1000 });
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

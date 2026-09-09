import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createJob, appendLog, getJob } from "../lib/jobs.ts";

/* `stage` is the sentence on the card and the review screen saying what the
   machine is doing. It is set to the last line the tool printed -- which
   meant that when a Python tool raised, the caption became the exception.

   QA found "KeyError: 'tolerance'" sitting in `stage` on 11 of 16 recorded
   jobs, on a job whose status said done and whose progress said 100. The
   KeyError itself is fixed; this is about the other half, which would happen
   again the next time any tool raised for any reason. */
describe("a crash is not a caption", () => {
  const traceback = [
    "Traceback (most recent call last):",
    '  File "/x/tools/compare_to_reference.py", line 77, in <module>',
    "    sys.exit(main())",
    "             ^^^^^^",
    '  File "/x/tools/compare_to_reference.py", line 43, in main',
    '    ref["tolerance"]["duration_pct"]),',
    "    ~~~^^^^^^^^^^^^",
    "KeyError: 'tolerance'",
  ];

  test("the exception does not become what the app says it is doing", () => {
    const job = createJob("_test_stage", "build");
    appendLog(job.id, "comparing against house style...");
    for (const line of traceback) appendLog(job.id, line);

    const stage = getJob(job.id)!.stage!;
    assert.doesNotMatch(stage, /KeyError|Traceback|\.py|\^\^\^/,
      `the caption is machine wreckage: ${JSON.stringify(stage)}`);
    assert.ok(stage.length > 0, "and it still has to say something");
  });

  test("the traceback is still in the log, which is where it is read", () => {
    const job = createJob("_test_stage_log", "build");
    for (const line of traceback) appendLog(job.id, line);
    const log = getJob(job.id)!.log.join("\n");
    for (const line of traceback) {
      assert.ok(log.includes(line), `the log dropped: ${line}`);
    }
  });

  test("ordinary output after a traceback is a caption again", () => {
    const job = createJob("_test_stage_after", "build");
    for (const line of traceback) appendLog(job.id, line);
    appendLog(job.id, "stitching the clips together...");
    assert.equal(getJob(job.id)!.stage, "stitching the clips together...");
  });

  test("a line that merely mentions an error still reads as a caption", () => {
    // the guard keys on the traceback header, not on the word -- a tool
    // saying what it found must not be silenced
    const job = createJob("_test_stage_word", "build");
    appendLog(job.id, "VERIFY FAILED — a phrase repeats in this cut");
    assert.match(getJob(job.id)!.stage!, /VERIFY FAILED/);
  });
});

/* Jobs are written to disk so a build survives a server restart, and read
   back on every getJob. The read used to overwrite a RUNNING job in memory
   with the copy on file -- and appendLog only writes through every two
   seconds, so the file lags. A live job was quietly losing up to two seconds
   of its own log, and its stage could step backwards, every time the review
   screen polled it. Which is about once a second. */
describe("a running job's own record is the newer one", () => {
  test("polling it does not roll its log back", () => {
    const job = createJob("_test_no_rollback", "build");
    const lines = Array.from({ length: 40 }, (_, i) => `step ${i}`);
    for (const line of lines) {
      appendLog(job.id, line);
      getJob(job.id);            // exactly what the review screen does
    }
    const log = getJob(job.id)!.log;
    assert.deepEqual(log, lines,
      `wrote ${lines.length} lines and got ${log.length} back`);
    assert.equal(getJob(job.id)!.stage, "step 39");
  });
});

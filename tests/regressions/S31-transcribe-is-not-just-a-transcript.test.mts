import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * "Transcribed" means the work, not one of the files it leaves behind.
 * (ledger S31)
 *
 * The auto pipeline decides whether to skip a step with a `done()` check, and
 * `done("transcribe")` was `existsSync(work/transcript.json)`. The same step
 * writes TWO more things -- `silence.txt`, which `draft_beats.py` trims
 * pauses with, and `silence-strict.txt`, which `build_cut.py` snaps beat
 * edges against. So a transcript arriving from anywhere else read as
 * "Transcribing — already done, skipping" and took the silence maps with it.
 *
 * That was a trap rather than a live bug until M0.8: the import now transcribes
 * a standalone clip while working out the grouping and carries that transcript
 * into the project rather than running Whisper twice over the same bytes. The
 * skip is what makes the saving safe.
 *
 * The failure it prevents is the nastiest shape this project keeps paying for:
 * nothing is missing, nothing errors, and the beats are simply worse.
 */
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-transcribe-step-"));
fs.mkdirSync(path.join(sandbox, "projects"), { recursive: true });
process.env.SNIPAI_DATA = sandbox;

const { transcribeStepIsDone, TRANSCRIBE_OUTPUTS, hasUsableTranscript } = await import("@/lib/pipeline");
const { projectDir } = await import("@/lib/paths");

function work(project: string): string {
  const w = path.join(projectDir(project), "work");
  fs.mkdirSync(w, { recursive: true });
  return w;
}

describe("whether the transcribe step has actually been done", () => {
  test("a transcript on its own is not the step being done", () => {
    const w = work("only-transcript");
    fs.writeFileSync(path.join(w, "transcript.json"), "[]");
    assert.equal(transcribeStepIsDone("only-transcript"), false,
      "skipping here skips the silence maps, and nothing says so until the beats are worse");
  });

  test("every artifact the step writes has to be there", () => {
    const w = work("one-at-a-time");
    fs.writeFileSync(path.join(w, "transcript.json"), "[]");
    fs.writeFileSync(path.join(w, "silence.txt"), "");
    assert.equal(transcribeStepIsDone("one-at-a-time"), false, "the -50dB map is still owed");
    fs.writeFileSync(path.join(w, "silence-strict.txt"), "");
    assert.equal(transcribeStepIsDone("one-at-a-time"), true);
  });

  test("the step's outputs are named in one place, and there are three of them", () => {
    // the constant is what the check iterates; a fourth output added to the
    // step without being added here would be skippable all over again
    assert.deepEqual([...TRANSCRIBE_OUTPUTS],
      ["transcript.json", "silence.txt", "silence-strict.txt"]);
  });

  test("half a file left by a killed Whisper is not a transcript", () => {
    const w = work("killed-midway");
    fs.writeFileSync(path.join(w, "silence.txt"), "");
    fs.writeFileSync(path.join(w, "silence-strict.txt"), "");
    fs.writeFileSync(path.join(w, "transcript.json"), '[{"start": 0.0, "end');
    assert.equal(transcribeStepIsDone("killed-midway"), false);

    // ...but a clip with no speech in it legitimately transcribes to nothing
    fs.writeFileSync(path.join(w, "transcript.json"), "[]");
    assert.equal(transcribeStepIsDone("killed-midway"), true);
  });

  test("a transcript that is not even there is not usable", () => {
    assert.equal(hasUsableTranscript(path.join(sandbox, "nope.json")), false);
  });
});

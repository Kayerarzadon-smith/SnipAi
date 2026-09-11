import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The import, from dropped clips to confirmed projects. (DOCKET M0.8)
 *
 * Nothing here runs Whisper or ffmpeg: the two slow, machine-specific pieces
 * are handed in, so what is under test is the FLOW -- what is proposed, what
 * is refused, what is created, and what survives a failure. The transcripts
 * are the same hand-written fixtures `tests/grouping.test.mts` uses, built
 * from lines lifted out of his real img-9817/img-9823.
 *
 * SNIPAI_DATA first, dynamic import second: lib/paths.ts reads it once, at
 * import, and its fallback is his real library.
 */
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-import-"));
fs.mkdirSync(path.join(sandbox, "projects"), { recursive: true });
fs.mkdirSync(path.join(sandbox, "state"), { recursive: true });
process.env.SNIPAI_DATA = sandbox;

const {
  createBatch, readBatch, writeBatch, recordStagedFile, stagedPath, batchDir,
  STAGING_ROOT, analyseBatch, confirmBatch, validateGroups, freeName, discardBatch,
  sweepAbandonedBatches,
} = await import("@/lib/importBatch");
const { PROJECTS_ROOT } = await import("@/lib/paths");
const { createJob, getJob } = await import("@/lib/jobs");
const { transcribeStepIsDone } = await import("@/lib/pipeline");
type ClipProbe = import("@/lib/clipProbe").ClipProbe;

/* ---- fixtures: his own lines, and clips that never touch a disk ---- */

const T0 = Date.UTC(2026, 7, 19, 17, 18, 4);

function probeFor(file: string, startMs: number | null, durationSec: number): ClipProbe {
  return {
    path: file,
    name: path.basename(file),
    durationSec,
    rawDurationSec: durationSec,
    creationTimeMs: startMs,
    video: { codec: "hevc", width: 3840, height: 2160, fps: 30, rotation: -90 },
    audio: { codec: "aac", sampleRate: 48000, channels: "stereo" },
    dataStreams: 4,
  };
}

function transcript(lines: string[]) {
  let t = 1.2;
  return lines.map((text) => {
    const start = t;
    const words = text.trim().split(/\s+/).map((w) => {
      const s = t;
      t += 0.28;
      return { w: ` ${w}`, s: Number(s.toFixed(2)), e: Number(t.toFixed(2)) };
    });
    const end = t;
    t += 0.6;
    return { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: ` ${text}`, words };
  });
}

/**
 * One interrupted TikTok in four clips, plus one finished one, exactly as the
 * milestone's exit line describes.
 *
 * The stamps are laid end to end deliberately -- each clip starts after the
 * one before it has STOPPED, plus however long he was away. Times that
 * overlap are a thing a single camera cannot do, and `gapSecBetween` reads an
 * overlap as "no usable gap" on purpose, so a fixture that overlaps is
 * testing a different case than it looks like it is testing.
 *
 *   9901  T0        +41s   |  away 4 min
 *   9902  T0+281s   +38s   |  away 6 min
 *   9903  T0+679s   +44s   |  away 3 min
 *   9904  T0+903s   +30s   |  away 6 hours
 *   9923  T0+22533s +52s
 */
const TAKE = {
  "IMG_9901.MOV": {
    startMs: T0,
    dur: 41,
    lines: [
      "If your skin looks like this, you need EGF.",
      "I have been using this serum for five months and the difference is because",
    ],
  },
  "IMG_9902.MOV": {
    startMs: T0 + 281_000,
    dur: 38,
    lines: [
      "the difference is because of one ingredient and there's",
      "nothing else on the shelf that has it in this concentration, I swear my",
    ],
  },
  "IMG_9903.MOV": {
    startMs: T0 + 679_000,
    dur: 44,
    lines: [
      "nothing else on the shelf that has it in this concentration, I swear my",
      "under eyes look brighter than they did in January, and my",
    ],
  },
  "IMG_9904.MOV": {
    startMs: T0 + 903_000,
    dur: 30,
    lines: [
      "under eyes look brighter than they did in January, and my whole face just looks awake.",
      "Link is in my bio, they are shipping in the next day or two",
    ],
  },
  "IMG_9923.MOV": {
    startMs: T0 + 22_533_000,
    dur: 52,
    lines: [
      "If your lashes look like this, you need this serum.",
      "Three coats, no clumps, and it comes off with warm water.",
      "Link is in my bio, they are shipping in the next day or two",
    ],
  },
} as const;

/** A batch with those five clips staged as one-byte stand-ins: this suite
 *  never needs their bytes, only their names, and his disk is at 96%. */
function stageTheDrop(order: string[] = Object.keys(TAKE)) {
  const b = createBatch();
  for (const name of order) {
    const p = stagedPath(b.id, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "x");
    recordStagedFile(b.id, name, 1);
  }
  return readBatch(b.id)!;
}

const deps = (opts: { silent?: string[] } = {}) => ({
  probe: async (file: string) => {
    const spec = TAKE[path.basename(file) as keyof typeof TAKE];
    return probeFor(file, spec?.startMs ?? null, spec?.dur ?? 10);
  },
  transcribe: async (file: string, out: string) => {
    const name = path.basename(file);
    if (opts.silent?.includes(name)) return null;
    const spec = TAKE[name as keyof typeof TAKE];
    const t = transcript([...(spec?.lines ?? [])]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(t));
    return t;
  },
});

const clean = (...projects: string[]) => {
  for (const p of projects) fs.rmSync(path.join(PROJECTS_ROOT, p), { recursive: true, force: true });
};

/* ---- staging is not a project ---- */

describe("where the bytes wait", () => {
  test("staging sits beside the library, never inside it", () => {
    assert.ok(!STAGING_ROOT.startsWith(PROJECTS_ROOT + path.sep),
      `${STAGING_ROOT} must not be under ${PROJECTS_ROOT}`);
    const b = createBatch();
    // a half-uploaded batch must not appear anywhere a project appears
    assert.equal(fs.existsSync(path.join(PROJECTS_ROOT, b.id)), false);
    discardBatch(b.id);
  });

  test("a filename off the network cannot escape its batch", () => {
    const b = createBatch();
    const inside = path.resolve(batchDir(b.id), "clips") + path.sep;
    for (const nasty of ["../../../etc/passwd", "..", ".", "/etc/hosts", "a/../../b.MOV"]) {
      assert.ok(stagedPath(b.id, nasty).startsWith(inside), `${nasty} escaped to ${stagedPath(b.id, nasty)}`);
    }
    discardBatch(b.id);
  });

  test("a batch id is a path segment and is checked like one", () => {
    for (const bad of ["../x", "b/../..", "", "short", "B-UPPER-CASE-IS-NOT-IT"]) {
      assert.throws(() => batchDir(bad), /invalid batch id/, `${bad} should be refused`);
    }
  });

  test("two batches never share a staging directory", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createBatch().id));
    assert.equal(ids.size, 50, "ids must not collide, even created in the same millisecond");
    for (const id of ids) discardBatch(id);
  });

  test("staging nobody came back for is swept, and live staging is not", () => {
    const stale = createBatch();
    const staleBatch = readBatch(stale.id)!;
    staleBatch.createdAt = new Date(Date.now() - 48 * 3600_000).toISOString();
    writeBatch(staleBatch);

    const running = createBatch();
    const runningBatch = readBatch(running.id)!;
    runningBatch.createdAt = new Date(Date.now() - 48 * 3600_000).toISOString();
    runningBatch.status = "importing";
    writeBatch(runningBatch);

    const fresh = createBatch();
    const swept = sweepAbandonedBatches();
    assert.ok(swept.includes(stale.id), "a day-old abandoned batch goes");
    assert.ok(!swept.includes(running.id), "an import in flight is not swept out from under itself");
    assert.ok(!swept.includes(fresh.id), "a batch created a second ago stays");
    discardBatch(fresh.id);
    discardBatch(running.id);
  });
});

/* ---- the proposal: the milestone's exit line, through the real flow ---- */

describe("what the tray is told", () => {
  test("four clips of one interrupted TikTok plus one stray propose two projects", async () => {
    // dropped in a mess, as a person selects files
    const b = stageTheDrop(["IMG_9923.MOV", "IMG_9903.MOV", "IMG_9901.MOV", "IMG_9904.MOV", "IMG_9902.MOV"]);
    const job = createJob(b.id, "analyse-import");
    await analyseBatch(job.id, b.id, deps());

    const after = readBatch(b.id)!;
    assert.equal(after.status, "proposed");
    assert.equal(getJob(job.id)?.status, "done", getJob(job.id)?.error);
    const p = after.proposal!;
    assert.equal(p.projects.length, 2, `proposed ${p.projects.map((g) => g.files.join("+")).join(" / ")}`);

    // the interrupted one, in filmed order regardless of the order dropped
    assert.deepEqual(p.projects[0].files,
      ["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV", "IMG_9904.MOV"]);
    assert.equal(p.projects[0].project, "img-9901");
    assert.equal(p.projects[1].files.length, 1);
    assert.equal(p.projects[1].project, "img-9923");

    // the common case costs one click: nothing is put in front of him
    assert.deepEqual(p.needsYourEye, []);
    assert.deepEqual(p.notTranscribed, []);

    // and the totals are the sum of the parts, which is what the join measures
    assert.equal(p.projects[0].totalDurationSec, 41 + 38 + 44 + 30);
    assert.equal(p.projects[1].totalDurationSec, 52);

    discardBatch(b.id);
  });

  test("every seam comes with a reason in words he could have written", async () => {
    const b = stageTheDrop();
    const job = createJob(b.id, "analyse-import");
    await analyseBatch(job.id, b.id, deps());
    const p = readBatch(b.id)!.proposal!;

    const joined = p.projects[0].joinedBy;
    assert.equal(joined.length, 3, "three seams hold four clips together");
    for (const s of joined) {
      assert.ok(s.reasons.length > 0, `${s.from} -> ${s.to} was joined for no stated reason`);
      for (const r of s.reasons) {
        assert.doesNotMatch(r, /score|threshold|verdict|restartRun|[<>]=|0\.\d/,
          `"${r}" reads like a debug line, not a sentence`);
      }
    }
    /* The two shapes an interruption takes, and the tray has a sentence for
       each. 9901 -> 9902 is the quiet one: he stops on "because" and carries
       on four minutes later without going back over it. 9902 -> 9903 is the
       loud one: he restarts the whole line he was cut off in. */
    assert.match(joined[0].reasons.join(" "),
      /IMG_9901\.MOV stops on "because", mid-sentence — that is not how a finished video ends/);
    assert.match(joined[1].reasons.join(" "),
      /IMG_9903\.MOV opens by re-saying \d+ words IMG_9902\.MOV had just said — that is him restarting the line he was cut off in/);

    // and the stray says why it is NOT part of the one before it
    const split = p.projects[1].separatedBy!;
    assert.equal(split.from, "IMG_9904.MOV");
    assert.equal(split.to, "IMG_9923.MOV");
    assert.match(split.reasons.join(" "), /he was away, not interrupted/);

    discardBatch(b.id);
  });

  test("a clip nothing could be heard in is named, not quietly grouped", async () => {
    const b = stageTheDrop();
    const job = createJob(b.id, "analyse-import");
    await analyseBatch(job.id, b.id, deps({ silent: ["IMG_9903.MOV"] }));
    const p = readBatch(b.id)!.proposal!;

    assert.deepEqual(p.notTranscribed, ["IMG_9903.MOV"]);
    // the seams either side of it become a question rather than an answer
    assert.ok(p.needsYourEye.length > 0, "an unreadable clip must reach his eye");
    assert.match(p.needsYourEye.map((s) => s.reasons.join(" ")).join(" "),
      /has not been transcribed yet/);
    // proposed as a break, never as a silent join
    assert.ok(p.projects.length > 2, "an unsure seam splits rather than guessing");
    discardBatch(b.id);
  });

  test("a name already in the library is settled before he is shown it", async () => {
    fs.mkdirSync(path.join(PROJECTS_ROOT, "img-9901"), { recursive: true });
    const b = stageTheDrop();
    const job = createJob(b.id, "analyse-import");
    await analyseBatch(job.id, b.id, deps());
    const p = readBatch(b.id)!.proposal!;
    assert.equal(p.projects[0].project, "img-9901-2",
      "the tray must show the name the import will really use");
    clean("img-9901");
    discardBatch(b.id);
  });

  test("two groups that want the same name do not both get it", () => {
    const taken = new Set(["img-9901"]);
    assert.equal(freeName("img-9901", taken), "img-9901-2");
    taken.add("img-9901-2");
    assert.equal(freeName("img-9901", taken), "img-9901-3");
    assert.equal(freeName("img-9923", taken), "img-9923");
  });
});

/* ---- confirming ---- */

describe("what he confirmed is what is checked", () => {
  test("a clip in no group would be thrown away, and is refused by name", () => {
    const b = stageTheDrop();
    const r = validateGroups(readBatch(b.id)!, [
      { project: "one", files: ["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV"] },
    ]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /IMG_9904\.MOV/);
    assert.match(r.ok ? "" : r.error, /IMG_9923\.MOV/);
    assert.match(r.ok ? "" : r.error, /thrown away/);
    discardBatch(b.id);
  });

  test("a clip in two groups is refused", () => {
    const b = stageTheDrop();
    const r = validateGroups(readBatch(b.id)!, [
      { project: "one", files: ["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV", "IMG_9904.MOV"] },
      { project: "two", files: ["IMG_9904.MOV", "IMG_9923.MOV"] },
    ]);
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /IMG_9904\.MOV is in more than one project/);
    discardBatch(b.id);
  });

  test("a clip that was never uploaded, a bad name and a taken name are all refused", () => {
    fs.mkdirSync(path.join(PROJECTS_ROOT, "already-here"), { recursive: true });
    const b = stageTheDrop(["IMG_9901.MOV"]);
    const batch = readBatch(b.id)!;
    const bad = (groups: { project: string; files: string[] }[]) => {
      const r = validateGroups(batch, groups);
      assert.equal(r.ok, false);
      return r.ok ? "" : r.error;
    };
    assert.match(bad([{ project: "x", files: ["IMG_0000.MOV"] }]), /never uploaded/);
    assert.match(bad([{ project: "Not Kebab", files: ["IMG_9901.MOV"] }]), /not a usable project name/);
    assert.match(bad([{ project: "already-here", files: ["IMG_9901.MOV"] }]), /already a project called/);
    assert.match(bad([{ project: "x", files: [] }]), /no clips in it/);
    assert.match(bad([]), /no groups/);
    clean("already-here");
    discardBatch(b.id);
  });

  test("confirming creates the projects, joins the group, and moves the stray", async () => {
    const b = stageTheDrop();
    const joined: string[][] = [];
    const built: string[] = [];
    const job = createJob("img-9901", "import");

    await confirmBatch(job.id, b.id, [
      { project: "img-9901", files: ["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV", "IMG_9904.MOV"] },
      { project: "img-9923", files: ["IMG_9923.MOV"] },
    ], {
      join: async (files, dest) => {
        joined.push(files.map((f) => path.basename(f)));
        fs.writeFileSync(dest, "joined");
        return {
          ok: true, dest, ordered: [], basis: "creation_time",
          expectedSec: 153, actualSec: 153, driftSec: 0, dataStreamsDropped: 16,
        };
      },
      pipeline: async (_jobId, project) => {
        built.push(project);
        return { ok: true, cutFile: `${project}-v1.mp4` };
      },
    });

    assert.equal(getJob(job.id)?.status, "done", getJob(job.id)?.error);
    // the four clips were joined, in filmed order, into one source
    assert.deepEqual(joined, [["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV", "IMG_9904.MOV"]]);
    assert.deepEqual(built, ["img-9901", "img-9923"], "both projects get built, one after the other");

    const stitched = JSON.parse(fs.readFileSync(path.join(PROJECTS_ROOT, "img-9901", "beats.json"), "utf8"));
    assert.equal(stitched.source, "raw/img-9901.mov");
    assert.match(stitched.notes, /4 clips joined end to end/);
    assert.ok(fs.existsSync(path.join(PROJECTS_ROOT, "img-9901", "raw", "img-9901.mov")));

    const stray = JSON.parse(fs.readFileSync(path.join(PROJECTS_ROOT, "img-9923", "beats.json"), "utf8"));
    assert.equal(stray.source, "raw/IMG_9923.MOV", "a lone clip keeps its own name");
    assert.ok(fs.existsSync(path.join(PROJECTS_ROOT, "img-9923", "raw", "IMG_9923.MOV")));

    // staging is gone only because every clip found a home
    assert.equal(fs.existsSync(batchDir(b.id)), false);
    clean("img-9901", "img-9923");
  });

  test("a group that will not join does not take the other project down with it", async () => {
    const b = stageTheDrop();
    const job = createJob("img-9901", "import");
    await confirmBatch(job.id, b.id, [
      { project: "img-9901", files: ["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV", "IMG_9904.MOV"] },
      { project: "img-9923", files: ["IMG_9923.MOV"] },
    ], {
      join: async (_files, _dest) => ({
        ok: false,
        error: "IMG_9902.MOV was trimmed after it was filmed — Photos does that without re-encoding — so 1.10s of it is still in the file, just hidden.",
      }),
      pipeline: async (_jobId, project) => ({ ok: true, cutFile: `${project}-v1.mp4` }),
    });

    // the stray still became a project and still got built
    assert.ok(fs.existsSync(path.join(PROJECTS_ROOT, "img-9923", "beats.json")));
    // the one that failed left no empty shell on the dashboard
    assert.equal(fs.existsSync(path.join(PROJECTS_ROOT, "img-9901")), false);
    // ...and his four clips are still on disk, where he can try again
    for (const f of ["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV", "IMG_9904.MOV"]) {
      assert.ok(fs.existsSync(stagedPath(b.id, f)), `${f} must not be thrown away by a failed join`);
    }
    const after = readBatch(b.id)!;
    assert.equal(after.status, "failed");
    assert.match(after.error ?? "", /trimmed after it was filmed/);

    clean("img-9923");
    discardBatch(b.id);
  });
});

/* ---- the second Whisper pass: paid where it buys something, not where it
       does not ---- */

describe("how many times the footage is listened to", () => {
  test("a lone clip's transcript is carried across, and the silence maps are still owed", async () => {
    const b = stageTheDrop(["IMG_9923.MOV"]);
    const analyse = createJob(b.id, "analyse-import");
    await analyseBatch(analyse.id, b.id, deps());

    const job = createJob("img-9923", "import");
    await confirmBatch(job.id, b.id, [{ project: "img-9923", files: ["IMG_9923.MOV"] }], {
      join: async () => ({ ok: false, error: "a single clip does not need joining" }),
      pipeline: async () => ({ ok: true }),
    });

    const work = path.join(PROJECTS_ROOT, "img-9923", "work");
    const carried = path.join(work, "transcript.json");
    assert.ok(fs.existsSync(carried), "nothing was joined, so the words are the same words");
    assert.equal(JSON.parse(fs.readFileSync(carried, "utf8"))[0].text.trim(),
      "If your lashes look like this, you need this serum.");

    /* And the trap this milestone was warned about, in one assertion.
       (ledger S31) Placing that transcript must NOT make the pipeline think
       the transcribe step is done: the same step writes the two silence maps
       draft_beats.py and build_cut.py depend on, and skipping those shows up
       as worse beats rather than as a missing file. */
    assert.equal(transcribeStepIsDone("img-9923"), false,
      "a transcript on its own is not the transcribe step being done");

    fs.writeFileSync(path.join(work, "silence.txt"), "");
    assert.equal(transcribeStepIsDone("img-9923"), false, "one map is not both maps");
    fs.writeFileSync(path.join(work, "silence-strict.txt"), "");
    assert.equal(transcribeStepIsDone("img-9923"), true, "all three, and then it is done");

    // half a file left by a killed Whisper is not a transcript either
    fs.writeFileSync(carried, '[{"start": 0.0, "end');
    assert.equal(transcribeStepIsDone("img-9923"), false);

    clean("img-9923");
  });

  test("a joined group is transcribed fresh, because the seams land mid-word", async () => {
    const b = stageTheDrop(["IMG_9901.MOV", "IMG_9902.MOV"]);
    const analyse = createJob(b.id, "analyse-import");
    await analyseBatch(analyse.id, b.id, deps());

    const job = createJob("img-9901", "import");
    await confirmBatch(job.id, b.id, [
      { project: "img-9901", files: ["IMG_9901.MOV", "IMG_9902.MOV"] },
    ], {
      join: async (_files, dest) => {
        fs.writeFileSync(dest, "joined");
        return { ok: true, dest, ordered: [], basis: "creation_time",
                 expectedSec: 79, actualSec: 79, driftSec: 0, dataStreamsDropped: 8 };
      },
      pipeline: async () => ({ ok: true }),
    });

    /* No transcript is carried into a joined project. IMG_9901 ends on
       "...the difference is because" and IMG_9902 opens by re-saying it:
       the seam is inside a sentence, and a transcript assembled from the
       parts would keep each half as its own fragment -- which is the exact
       problem joining exists to solve. */
    assert.equal(
      fs.existsSync(path.join(PROJECTS_ROOT, "img-9901", "work", "transcript.json")),
      false,
      "the joined file has to be heard as one recording"
    );
    clean("img-9901");
  });
});

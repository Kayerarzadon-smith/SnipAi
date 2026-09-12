import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scratchDir } from "../scratch.mts";
import { ffmpegBin, haveFfmpeg } from "./_elst.mts";

/**
 * LEDGER S42 -- deleting one line cost ~1 GB, and nobody pressed Build.
 *
 * Measured in the packaged app 2026-09-11: removing a single line turned a
 * **20,466,228-byte 406x720** cut into a **505,401,938-byte 2160x3840** one,
 * 24.7x the bytes, while `work/clips/` went from 72 files to 142.
 *
 * TWO DEFECTS, AND THE EVIDENCE SPLITS THEM DIFFERENTLY FROM THE ROW.
 * Read off `qa-sandbox/projects/img-0060` before writing this file:
 *
 *   current generation   70 files   482.1 MiB   2160x3840
 *   orphaned generation  72 files    19.6 MiB     406x720
 *
 * So the orphaned generation is the ORIGINAL 720p build, and it costs 3.9% of
 * the directory. The row attributes the ~25x growth to the orphaning ("the
 * new set landed under new filenames instead of overwriting"); the orphaning
 * accounts for 19.6 MiB of it. **The other 96% is the resolution.** Both are
 * real and both are fixed here, but the disk is almost entirely defect one.
 *
 *   1. the automatic re-export took the full-resolution route. `review/page
 *      .tsx`'s auto-apply posted a body identical to the Build button's, so
 *      the server could not tell them apart.
 *   2. `build_cut.py:527` names pieces `p{i:02d}_{label}.mp4` -- a DERIVED
 *      key -- so a delete that shifts indices produces new names beside the
 *      old ones. `p00_could-use-creatine.mp4` next to `p00_use-could-0.mp4`.
 *
 * WHAT THIS FILE ASSERTS. Not that the auto path passes `proxy: true` -- that
 * tests the instruction, and this session has already shipped one test that
 * did the equivalent and stayed green over a live bug. It runs real builds
 * through `runBuildJob` and reads the **resolution of the file that comes
 * out** and the **contents of `work/clips/`**.
 *
 * The fixture source is 1080x1920 -- portrait, like his, and above 720 on its
 * short side so that a downscale is detectable at all. On a source smaller
 * than 720 `scale=-2:720` upscales, and the two routes stop being
 * distinguishable; that edge is documented on `existingCutIsDownscaled`.
 *
 * NOT IN SCOPE, and deliberately not decided here: whether a one-click import
 * ought to end in a full-resolution render. That is Part 5 #9, it is in front
 * of Kayer, and the rule this file pins is narrower -- an action he did not
 * ask for does not change the resolution, in EITHER direction.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PROJECT = "s42";

function pythonBin(): string {
  const venv = path.join(ROOT, "ugc-edit-system", ".venv", "bin", "python3");
  return fs.existsSync(venv) ? venv : "python3";
}

function haveTools(): boolean {
  return haveFfmpeg() && spawnSync(pythonBin(), ["-V"]).status === 0;
}

/**
 * ONE library for the whole file, built before the first `await import`.
 *
 * `lib/paths.ts` resolves SNIPAI_DATA once, at import, so a second
 * `buildLibrary()` hands back a directory the app modules never look at --
 * every later test then ran against the FIRST library and its cut versions
 * climbed to v3, which is how this file first failed. Same trap as C32.
 * `node --test` gives each file its own process, so one root per file is the
 * isolation that actually applies.
 */
function buildLibrary(): string {
  const root = scratchDir("s42-lib");
  const dir = path.join(root, "projects", PROJECT);
  fs.mkdirSync(path.join(dir, "work"), { recursive: true });
  fs.mkdirSync(path.join(root, "state"), { recursive: true });

  const src = path.join(dir, "source.mov");
  const r = spawnSync(ffmpegBin(), [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=9",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=9",
    "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", src,
  ], { encoding: "utf8", timeout: 180_000 });
  assert.equal(r.status, 0, `fixture source did not encode:\n${r.stderr}`);

  writeBeats(root, ["alpha-one", "bravo-two", "charlie-three", "delta-four"]);

  /* build_cut.py:358 reads work/transcript.json unconditionally -- it is not
     one of the optional maps -- and load_words wants [{words:[{s,e}]}]. A word
     every 200ms across the whole source is enough for the pause trimming to
     have something to work with. */
  const words = [];
  for (let t = 0; t < 9; t += 0.2) words.push({ s: Number(t.toFixed(2)), e: Number((t + 0.15).toFixed(2)) });
  fs.writeFileSync(
    path.join(dir, "work", "transcript.json"),
    JSON.stringify([{ words }])
  );

  /* And the two silence maps, made with the pipeline's own tool rather than
     hand-written: build_cut.py:359 reads `silence.txt` unconditionally too.
     The fixture's audio is a continuous tone, so the maps come out empty and
     nothing is pause-trimmed -- which is fine here. What this file measures
     is resolution and piece bookkeeping, not edge snapping. */
  for (const [noise, out] of [["-28dB", "silence.txt"], ["-50dB", "silence-strict.txt"]]) {
    const m = spawnSync(pythonBin(), [
      path.join(ROOT, "ugc-edit-system", "tools", "silence_map.py"),
      src, `--noise=${noise}`, "--min-dur", "0.06", "-o", path.join(dir, "work", out),
    ], {
      encoding: "utf8", timeout: 180_000,
      /* This Mac has no system ffmpeg, and `silence_map.py:20` shells out to
         a bare `ffmpeg` without consulting SNIPAI_FFMPEG. `lib/pipeline.ts`'s
         runCommand solves that by prepending the ffmpeg binary's directory to
         PATH (`:96`, and its comment names this exact tool), so the fixture
         does the same rather than inventing a second mechanism. */
      env: {
        ...process.env,
        PATH: `${path.dirname(ffmpegBin())}:${process.env.PATH ?? ""}`,
      },
    });
    assert.equal(m.status, 0, `silence_map.py (${noise}) failed:\n${m.stderr}`);
  }

  process.env.SNIPAI_DATA = root;
  return root;
}

/** Four 2s lines, or a subset of them -- the labels are the derived key. */
function writeBeats(root: string, labels: string[]): void {
  const beats = labels.map((label, i) => ({ label, start: i * 2 + 0.2, end: i * 2 + 1.8 }));
  fs.writeFileSync(
    path.join(root, "projects", PROJECT, "beats.json"),
    JSON.stringify({ source: "source.mov", beats }, null, 2)
  );
}

function shortSide(file: string): number {
  const out = spawnSync(ffmpegBin(), ["-hide_banner", "-nostdin", "-i", file], { encoding: "utf8" });
  const m = /\b(\d{2,5})x(\d{2,5})\b/.exec(`${out.stderr}\n${out.stdout}`);
  assert.ok(m, `could not read the size of ${path.basename(file)}`);
  return Math.min(Number(m![1]), Number(m![2]));
}

function clipsDir(root: string): string {
  return path.join(root, "projects", PROJECT, "work", "clips");
}

function clipFiles(root: string): string[] {
  const d = clipsDir(root);
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
}

/** Exactly what `build_cut.py` would name the current EDL's pieces. */
function keysTheEdlReferences(root: string): string[] {
  const edl = path.join(root, "projects", PROJECT, "work", "edl.json");
  const pieces = JSON.parse(fs.readFileSync(edl, "utf8")) as { label: string }[];
  return pieces.map((p, i) => `p${String(i).padStart(2, "0")}_${p.label}.mp4`).sort();
}

const ready = haveTools();
const ROOT_LIB = ready ? buildLibrary() : "";
const ALL = ["alpha-one", "bravo-two", "charlie-three", "delta-four"];

/** Back to a project with no renders and no scratch, beats as given. */
function reset(labels: string[]): void {
  const dir = path.join(ROOT_LIB, "projects", PROJECT);
  fs.rmSync(path.join(dir, "cuts"), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "work", "clips"), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "work", "edl.json"), { force: true });
  fs.rmSync(path.join(dir, "review-state.json"), { force: true });
  writeBeats(ROOT_LIB, labels);
}

/* -------------------------------------------------------------------------
 * The headline. Two real builds, because the claim is about produced files:
 * the import's own build path, then the automatic re-export after an edit.
 *
 * Each build carries a Whisper model load it does not need for this claim --
 * `runChecksAndCache` -> `verify_cut.py` is 11.5s on a 3-second clip -- so
 * the build count is kept to the two the row's exit condition actually names,
 * and everything else in this file is asserted without one.
 * ---------------------------------------------------------------------- */
test("S42: an automatic re-export after an edit keeps the resolution the import produced", async () => {
  assert.ok(ready, "no ffmpeg/python3 -- S42's claim is about produced files and cannot be checked without them");
  reset(ALL);
  const { runPipelinePhases, runBuildJob, latestCut, existingCutIsDownscaled } = await import("@/lib/pipeline");
  const { createJob, getJob } = await import("@/lib/jobs");

  /* The FIRST build, through the real import path rather than an emulation of
     it: `runPipelinePhases` is what a confirmed import runs, and its build
     phase is the one that passes `{ proxy: true }` (`lib/pipeline.ts:462`).
     An earlier draft used runBuildJob here and compared full against full --
     it passed and proved nothing, which is why this goes the long way. */
  const j1 = createJob(PROJECT, "import");
  const r1 = await runPipelinePhases(j1.id, PROJECT, { from: 0, to: 100 });
  assert.ok(r1.ok, `the import path did not build: ${JSON.stringify(getJob(j1.id)?.log?.slice(-6))}`);

  const first = latestCut(PROJECT)!;
  assert.ok(first, "the import produced no cut");
  const cutPath = (n: string) => path.join(ROOT_LIB, "projects", PROJECT, "cuts", n);
  const firstShort = shortSide(cutPath(first));

  /* Premise check: the import really does downscale, so this file is not
     measuring two identical routes.
     
     The source is 1080x1920 and `--proxy` is `scale=-2:720`, which sets the
     HEIGHT -- so a portrait clip comes out 406x720 and its SHORT side is 406.
     That is the same pair of numbers his own footage produces (406x720 from
     2160x3840), which is why the short side is what gets compared. */
  assert.ok(
    firstShort < 1080,
    `the import's build came out ${firstShort} on its short side, the same as the source -- ` +
    `it did not take the proxy route, so there is no downscale for the re-export to preserve`
  );
  assert.equal(firstShort, 406, "the proxy ladder moved; re-derive this file's premise");
  assert.equal(await existingCutIsDownscaled(PROJECT), true, "the import's cut does not read as a downscale");

  const keysBefore = keysTheEdlReferences(ROOT_LIB);

  /* He deletes a line. Removing `bravo-two` shifts every index after it, which
     is the mechanism from the evidence -- `p00_could-use-creatine.mp4` beside
     `p00_use-could-0.mp4` on qa-sandbox/img-0060. */
  writeBeats(ROOT_LIB, ["alpha-one", "charlie-three", "delta-four"]);
  const j2 = createJob(PROJECT, "build");
  await runBuildJob(j2.id, PROJECT, { keepResolution: true });

  const second = latestCut(PROJECT)!;
  assert.notEqual(second, first, "the automatic re-export produced no new cut");
  const secondShort = shortSide(cutPath(second));

  assert.equal(
    secondShort, firstShort,
    `deleting one line took the picture from ${firstShort}p to ${secondShort}p on its short side, ` +
    `and nobody pressed Build. On his footage that was 20,466,228 bytes to 505,401,938.`
  );

  /* The indices really did shift, so the orphaning mechanism was exercised
     rather than side-stepped by a build that would have overwritten anyway. */
  const keysAfter = keysTheEdlReferences(ROOT_LIB);
  assert.ok(
    keysAfter.some((k, i) => k !== keysBefore[i]),
    "the delete shifted no piece key, so this run does not exercise S42's second half"
  );

  /* And no generation of intermediates survives the build that made it --
     which subsumes "holds no piece the current EDL does not reference",
     because it holds none at all. 482 MiB of them on img-0060. */
  assert.deepEqual(
    clipFiles(ROOT_LIB), [],
    `the re-export left ${clipFiles(ROOT_LIB).length} intermediate clip(s) behind`
  );

  /* Cleanup must not have eaten the output. Cheap, and the failure it guards
     against is total. */
  assert.ok(fs.statSync(cutPath(second)).size > 1000, "the cut is present but empty");
  assert.ok(
    fs.existsSync(path.join(ROOT_LIB, "projects", PROJECT, "work", "edl.json")),
    "edl.json was swept away with the clips"
  );
});

/* -------------------------------------------------------------------------
 * The rest, without a build. `existingCutIsDownscaled` is the decision the
 * automatic path turns on, and it answers by comparing two files -- so it can
 * be asked directly for the cost of two probes instead of a model load.
 * ---------------------------------------------------------------------- */
test("S42: a full-resolution cut does not read as a downscale, so auto never downgrades it", async () => {
  /* The other direction, and the reason this fix does not quietly answer
     Part 5 #9: after an explicit full-resolution Build, an automatic
     re-export must stay full resolution. If this returned true, the auto
     path would downscale his picture for deleting a line -- the same defect
     pointed the other way. */
  assert.ok(ready, "no ffmpeg/python3");
  reset(ALL);
  const { existingCutIsDownscaled } = await import("@/lib/pipeline");
  const dir = path.join(ROOT_LIB, "projects", PROJECT);
  fs.mkdirSync(path.join(dir, "cuts"), { recursive: true });
  // a cut at source resolution, which is what an explicit Build produces
  fs.copyFileSync(path.join(dir, "source.mov"), path.join(dir, "cuts", `${PROJECT}-v1.mp4`));
  assert.equal(await existingCutIsDownscaled(PROJECT), false);
});

test("S42: with no cut yet, or nothing to compare against, it declines to guess", async () => {
  /* null, not false: "I could not measure this" must not become "full
     resolution", or the first build after a failed probe silently renders 4K.
     The caller leaves the choice alone on null. */
  assert.ok(ready, "no ffmpeg/python3");
  reset(ALL);
  const { existingCutIsDownscaled } = await import("@/lib/pipeline");
  assert.equal(await existingCutIsDownscaled(PROJECT), null, "no cut on disk, yet it had an opinion");

  const dir = path.join(ROOT_LIB, "projects", PROJECT);
  fs.mkdirSync(path.join(dir, "cuts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cuts", `${PROJECT}-v1.mp4`), "not a video");
  assert.equal(await existingCutIsDownscaled(PROJECT), null, "an unreadable cut produced an answer");
});

test("S42: a build that FAILS still does not inherit the last build's pieces", async () => {
  /* This is what isolates the start-of-build clear, and it needs isolating:
     the removal at the END of a successful build would collect any orphan
     too, so every assertion above still passes with the start clear deleted.
     The case it protects is the one where the end never runs.
     
     A failed build leaves its pieces on disk -- deliberately, they are worth
     looking at -- so without clearing at the start, the NEXT build names a
     shifted set beside them and both generations survive. Here a stale
     generation is planted, the build is made to fail after the clear, and the
     stale files are gone: the new run did not inherit them.
     
     Fast, unlike the two real builds above: it dies inside build_cut.py, long
     before `runChecksAndCache` loads a Whisper model. */
  assert.ok(ready, "no ffmpeg/python3");
  reset(ALL);
  const { runBuildJob } = await import("@/lib/pipeline");
  const { createJob, getJob } = await import("@/lib/jobs");
  const dir = path.join(ROOT_LIB, "projects", PROJECT);

  const stale = ["p00_old-name.mp4", "p01_older-name.mp4", "p02_oldest.mp4"];
  fs.mkdirSync(path.join(dir, "work", "clips"), { recursive: true });
  for (const f of stale) fs.writeFileSync(path.join(dir, "work", "clips", f), "last build's piece");
  assert.deepEqual(clipFiles(ROOT_LIB), stale.slice().sort(), "the fixture did not plant a stale generation");

  /* Make the build fail early: a beats.json build_cut.py cannot use. */
  const good = fs.readFileSync(path.join(dir, "beats.json"), "utf8");
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify({ source: "source.mov", beats: "not a list" }));
  const job = createJob(PROJECT, "build");
  await runBuildJob(job.id, PROJECT, { keepResolution: true });
  fs.writeFileSync(path.join(dir, "beats.json"), good);

  assert.equal(getJob(job.id)?.status, "error", "the build was supposed to fail, so nothing here is isolated");
  const inherited = clipFiles(ROOT_LIB).filter((f) => stale.includes(f));
  assert.deepEqual(
    inherited, [],
    `a new build inherited ${JSON.stringify(inherited)} from the last one`
  );
});


test("S42: work/clips is emptied at the start of a build, not swept afterwards", async () => {
  /* Asserted without a build, because what matters is that a surviving
     generation cannot be there when build_cut.py starts naming pieces. A
     sweep afterwards would have to work out which files the new EDL
     references -- the same derived-key guess that caused the problem. */
  const src = fs.readFileSync(path.join(ROOT, "lib", "pipeline.ts"), "utf8");
  const clear = src.indexOf("clearing ${had} intermediate clip(s)");
  const buildCutCall = src.indexOf('runTool("build_cut.py"');
  assert.ok(clear > 0, "lib/pipeline.ts no longer clears work/clips before a build");
  assert.ok(
    clear < buildCutCall,
    "the clear now happens after build_cut.py has named its pieces, which is too late to prevent orphans"
  );
});

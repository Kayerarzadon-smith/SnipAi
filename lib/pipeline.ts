import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { CODE_ROOT, VENV_ROOT, TOOLS_ROOT, PYTHON_BIN, FFMPEG_BIN, DATA_ROOT, projectDir } from "./paths";
import type { PipelineAvailability } from "./types";
import { appendLog, finishJob, failJob } from "./jobs";

function pythonBin(): string {
  // CLAUDE.md: ffmpeg/whisper live in ugc-edit-system/.venv when it's been
  // set up. Prefer the venv's python3 if present, else fall back to PATH.
  return PYTHON_BIN;
}

function commandExists(cmd: string, args: string[]): boolean {
  try {
    const r = spawnSync(cmd, args, { timeout: 5000 });
    return r.error === undefined;
  } catch {
    return false;
  }
}

let cached: PipelineAvailability | null = null;
let cachedAt = 0;
// Re-check periodically. Caching forever meant installing the venv mid-session
// left the app insisting the tools were missing until a manual restart.
const CACHE_MS = 60_000;

/** Checked lazily and cached for the process lifetime — this dev machine
 * has none of these installed, and every caller needs to degrade cleanly
 * instead of hanging on a spawn that will never resolve usefully. */
export function checkAvailability(): PipelineAvailability {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const venvPy = pythonBin();
  const py = commandExists(venvPy, ["--version"]) ? venvPy : commandExists("python3", ["--version"]) ? "python3" : null;

  const ffmpegOk =
    commandExists(FFMPEG_BIN, ["-version"]) ||
    commandExists("ffmpeg", ["-version"]);

  let whisperOk = false;
  if (py) {
    const r = spawnSync(py, ["-c", "import faster_whisper"], { timeout: 15000 });
    whisperOk = r.status === 0;
  }

  cached = { python3: py !== null, ffmpeg: ffmpegOk, fasterWhisper: whisperOk };
  cachedAt = Date.now();
  return cached;
}

export function resolvedPython(): string {
  const venvPy = pythonBin();
  return commandExists(venvPy, ["--version"]) ? venvPy : "python3";
}

export function resolvedFfmpeg(): string {
  return commandExists(FFMPEG_BIN, ["-version"]) ? FFMPEG_BIN : "ffmpeg";
}

export type ToolRunResult = { ok: boolean; stdout: string; stderr: string; code: number | null;
                              /** killed for going quiet or past the cap, not by its own exit */
                              timedOut?: boolean };

/** Run an arbitrary command and capture output. Never throws on a nonzero
 * exit (verify_cut.py exits 1 on a real, expected FAIL) — callers decide
 * what a nonzero code means. Optionally streams each output line to
 * onLine as it arrives, for a live job log. */
export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; idleMs?: number;
          onLine?: (line: string) => void } = {}
): Promise<ToolRunResult> {
  return new Promise((resolve) => {
    // CLAUDE.md: ffmpeg is NOT installed system-wide on this Mac -- it lives
    // at .venv/bin/ffmpeg. transcribe/silence_map/verify_cut all shell out to
    // a bare `ffmpeg`, so without the venv on PATH they fail silently and
    // their output parses as "nothing to report".
    // the tools shell out to a bare `ffmpeg`, so its directory has to be on
    // PATH whether it came from a venv or from inside a bundled runtime
    const venvBin = path.dirname(FFMPEG_BIN);
    // Run at low priority. Whisper and ffmpeg will otherwise take every core
    // on a 4-core machine and make the whole Mac unresponsive -- this is not
    // hypothetical, it locked Kayer's machine hard enough to need a reboot.
    const child = spawn("nice", ["-n", "10", cmd, ...args], {
      cwd: opts.cwd ?? CODE_ROOT,
      // Its own process group, so a kill reaches the whole tree. extract.sh
      // spawns an ffmpeg per clip: killing the script alone leaves a 4K
      // encode running with nobody watching it, and the script's children
      // hold the output pipes open so we would not even learn it had died.
      detached: true,
      env: {
        ...process.env,
        PATH: `${venvBin}:${process.env.PATH ?? ""}`,
        // ceilings for the native BLAS/OpenMP layers underneath Whisper,
        // which ignore the Python-level thread setting
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS ?? "2",
        MKL_NUM_THREADS: process.env.MKL_NUM_THREADS ?? "2",
        // The tools resolve the glossary, the product list and the learned
        // rules out of the library. Telling them where it is means they can
        // never disagree with the server about which library is in play.
        SNIPAI_DATA: DATA_ROOT,
      },
    });
    let stdout = "";
    let stderr = "";

    /* Wall-clock timeouts are wrong for this work.
     *
     * A ten-minute ceiling killed a real build at 601 seconds -- 35 clips of
     * 60 extracted, then nothing, and a "see log" message with an empty log,
     * because a killed process leaves no error behind. Extraction and
     * transcription are honestly slow on 4K: how long they SHOULD take is a
     * function of the footage, so it is not a number that can be picked.
     *
     * What can be judged is whether anything is still happening. Every one of
     * these tools writes continuously -- a shell trace per clip, a progress
     * line per segment -- so silence, not duration, is what stuck looks like.
     * The absolute cap stays only as a backstop against a process that chats
     * forever without finishing. */
    const idleMs = opts.idleMs ?? 5 * 60 * 1000;
    const hardMs = opts.timeoutMs ?? 6 * 60 * 60 * 1000;
    let killedBy: "silence" | "cap" | null = null;
    let idleTimer: NodeJS.Timeout;

    const stopTimers = () => { clearTimeout(idleTimer); clearTimeout(hardTimer); };
    /** the group, not just the leader -- see `detached` above */
    const killTree = () => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); }
      catch { child.kill("SIGKILL"); }        // already gone, or no group
    };
    const beat = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { killedBy = "silence"; killTree(); }, idleMs);
    };
    const hardTimer = setTimeout(() => { killedBy = "cap"; killTree(); }, hardMs);

    const pipe = (chunk: Buffer) => {
      const text = chunk.toString();
      beat();                                   // it is alive
      if (opts.onLine) {
        for (const line of text.split("\n")) if (line.trim()) opts.onLine(line);
      }
      return text;
    };
    beat();
    child.stdout.on("data", (d: Buffer) => (stdout += pipe(d)));
    child.stderr.on("data", (d: Buffer) => (stderr += pipe(d)));
    child.on("error", (err) => {
      stopTimers();
      resolve({ ok: false, stdout, stderr: stderr + `\n${err.message}`, code: null });
    });
    child.on("close", (code) => {
      stopTimers();
      if (killedBy) {
        // say what happened: a killed process cannot explain itself
        const why = killedBy === "silence"
          ? `stopped responding — nothing written for ${Math.round(idleMs / 60000)} minutes, so it was killed`
          : `ran past the ${Math.round(hardMs / 3600000)} hour ceiling and was killed`;
        opts.onLine?.(why);
        resolve({ ok: false, stdout, stderr: `${stderr}\n${why}`, code: null, timedOut: true });
        return;
      }
      resolve({ ok: code === 0, stdout, stderr, code });
    });
  });
}

/** Run one of the tools/*.py scripts and capture output. */
export function runTool(
  script: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void } = {}
): Promise<ToolRunResult> {
  const scriptPath = path.join(TOOLS_ROOT, script);
  return runCommand(resolvedPython(), [scriptPath, ...args], opts);
}

function nextCutVersion(project: string): number {
  const cutsDir = path.join(projectDir(project), "cuts");
  if (!fs.existsSync(cutsDir)) return 1;
  const versions = fs
    .readdirSync(cutsDir)
    .map((f) => /-v(\d+)\.(mp4|mov)$/i.exec(f)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

/**
 * Runs the full existing pipeline exactly as documented in /build:
 * build_cut.py -> extract.sh -> ffmpeg concat -> verify_cut.py ->
 * compare_to_reference.py. Meant to be fired without awaiting the promise —
 * the caller gets a jobId immediately and polls lib/jobs.ts for progress,
 * since a real ffmpeg + whisper pass on a full video can run for minutes.
 * Does not implement /build's "fix and retry on verify failure" loop —
 * a verify FAIL is reported honestly in the log and scorecard, not
 * auto-corrected, since guessing a new in-point without seeing the footage
 * is exactly the kind of call CLAUDE.md says needs a human.
 */
/**
 * Transcription as a background job.
 *
 * This used to run inline inside the POST handler: the request stayed open for
 * the whole Whisper pass (3.5 minutes on 4K footage), so the fetch timed out,
 * the user hit the button again, and a second Whisper started on top of the
 * first. Two of those at once is what took this machine down. Now it goes
 * through the same single-job queue as a build.
 */
export async function runTranscribeJob(jobId: string, project: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const avail = checkAvailability();
  if (!avail.python3 || !avail.ffmpeg || !avail.fasterWhisper) {
    failJob(jobId, `pipeline tools not available (python3: ${avail.python3}, ffmpeg: ${avail.ffmpeg}, faster-whisper: ${avail.fasterWhisper})`);
    return;
  }
  const beatsData = loadBeatsForSource(project);
  if (!beatsData) {
    failJob(jobId, `no project '${project}'`);
    return;
  }
  const rawPath = path.join(projectDir(project), beatsData.source);
  if (!fs.existsSync(rawPath)) {
    failJob(jobId, `raw footage not found at ${beatsData.source}`);
    return;
  }
  const workDir = path.join(projectDir(project), "work");
  fs.mkdirSync(workDir, { recursive: true });

  log("transcribing (faster-whisper, this is the slow step)...");
  const t = await runTool("transcribe.py", [rawPath, "-o", path.join(workDir, "transcript.json")], { onLine: log });
  if (!t.ok) {
    failJob(jobId, "transcribe.py failed — see log");
    return;
  }
  log("mapping silence (-28dB, for trimming pauses inside a line)...");
  const sm = await runTool("silence_map.py", [rawPath, "-o", path.join(workDir, "silence.txt")], { onLine: log });
  if (!sm.ok) {
    failJob(jobId, "silence_map.py failed — see log");
    return;
  }
  // Stricter map used only for snapping beat edges. At -28dB a soft trailing
  // consonant reads as silence and snapping to it clips the word.
  log("mapping true silence (-50dB, for edge snapping)...");
  await runTool("silence_map.py", [rawPath, "--noise=-50dB", "--min-dur", "0.06", "-o", path.join(workDir, "silence-strict.txt")], { onLine: log });

  log("done — transcript and silence maps written");
  finishJob(jobId);
}

/** Propose the graphics for a cut. Whisper over the finished file, so it goes
 *  through the same single-job queue as everything else heavy. */
export async function runPlanGraphicsJob(jobId: string, project: string, cutFile: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const dir = projectDir(project);
  const cut = path.join(dir, "cuts", cutFile);
  log("transcribing the cut to find where graphics belong...");
  const res = await runTool(
    "plan_graphics.py",
    [cut, "-o", path.join(dir, "work", "graphics.json")],
    { onLine: log }
  );
  if (!res.ok) {
    failJob(jobId, "plan_graphics.py failed — see log");
    return;
  }
  finishJob(jobId);
}

/** Burn the enabled graphics into a new file. The cut itself is never
 *  overwritten -- graphics land beside it as their own version. */
export async function runRenderGraphicsJob(jobId: string, project: string, cutFile: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const dir = projectDir(project);
  const cut = path.join(dir, "cuts", cutFile);
  const out = path.join(dir, "cuts", cutFile.replace(/\.mp4$/i, "") + "-graphics.mp4");
  log("rendering motion graphics...");
  const res = await runTool(
    "motion_graphics.py",
    [cut, path.join(dir, "work", "graphics.json"), "-o", out],
    { onLine: log }
  );
  if (!res.ok || !fs.existsSync(out)) {
    failJob(jobId, "motion_graphics.py failed — see log");
    return;
  }
  log(`wrote ${path.basename(out)}`);
  finishJob(jobId, path.basename(out));
}

/** Build the scrubbing proxy. One pass over the source, so it queues like the
 *  other heavy work. */
export async function runSourceProxyJob(jobId: string, project: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const res = await runTool("make_source_proxy.py", [projectDir(project)], { onLine: log });
  if (!res.ok) { failJob(jobId, "make_source_proxy.py failed — see log"); return; }
  finishJob(jobId);
}

/** Draft the beat list from the transcript -- the step between transcribing
 *  and having something to review. */
export async function runDraftBeatsJob(jobId: string, project: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const dir = projectDir(project);
  if (!fs.existsSync(path.join(dir, "work", "transcript.json"))) {
    failJob(jobId, "transcribe the footage first");
    return;
  }
  log("scoring every take and picking the winners...");
  const res = await runTool("draft_beats.py", [projectDir(project), "--force"], { onLine: log });
  if (!res.ok) {
    failJob(jobId, "draft_beats.py failed — see log");
    return;
  }
  finishJob(jobId);
}

/**
 * Everything, end to end, from dropped footage to a cut you can watch.
 *
 * Transcribe, draft the beats, make the scrubbing proxy, build the cut. Each
 * step already exists and is already guarded; this runs them in order under
 * ONE job so the queue shows a single continuous bar rather than four
 * disconnected ones, and so a drop of raw footage just gets on with it.
 *
 * Sub-step progress is mapped into a band, so the bar only ever moves
 * forward: transcription is the long pole and gets nearly half the bar.
 */
const PHASES: { step: string; from: number; to: number; label: string }[] = [
  { step: "transcribe",   from: 0,  to: 45,  label: "Transcribing" },
  { step: "draft-beats",  from: 45, to: 56,  label: "Choosing the takes" },
  { step: "source-proxy", from: 56, to: 74,  label: "Shrinking for smooth playback" },
  { step: "build",        from: 74, to: 100, label: "Snipping" },
];

export async function runAutoPipelineJob(jobId: string, project: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const avail = checkAvailability();
  if (!avail.python3 || !avail.ffmpeg || !avail.fasterWhisper) {
    failJob(jobId, "the editing tools aren't set up on this machine");
    return;
  }

  // Skip whatever is already done. That makes this safe to fire whenever a
  // project looks unfinished -- reopening a half-processed import picks up
  // where it stopped instead of redoing an hour of work.
  const dir = projectDir(project);
  const done = (step: string) => {
    if (step === "transcribe") return fs.existsSync(path.join(dir, "work", "transcript.json"));
    if (step === "draft-beats") {
      try {
        const bj = JSON.parse(fs.readFileSync(path.join(dir, "beats.json"), "utf8"));
        return Array.isArray(bj?.beats) && bj.beats.length > 0;
      } catch {
        return false;
      }
    }
    if (step === "source-proxy") return fs.existsSync(path.join(dir, "work", "source-proxy.mp4"));
    if (step === "build") {
      const cuts = path.join(dir, "cuts");
      return fs.existsSync(cuts) &&
        fs.readdirSync(cuts).some((f) => /\.(mp4|mov)$/i.test(f) && !/-graphics\.mp4$/i.test(f));
    }
    return false;
  };

  for (const phase of PHASES) {
    if (done(phase.step)) {
      log(`${phase.label} — already done, skipping`);
      appendLog(jobId, `PROGRESS ${phase.to}`);
      continue;
    }
    // a sub-step's own PROGRESS is remapped into this phase's slice of the bar
    const relay = (line: string) => {
      const m = /^PROGRESS\s+(\d{1,3})\s*$/.exec(line.trim());
      if (m) {
        const inner = Math.max(0, Math.min(100, Number(m[1])));
        const overall = phase.from + ((phase.to - phase.from) * inner) / 100;
        appendLog(jobId, `PROGRESS ${Math.round(overall)}`);
        return;
      }
      log(line);
    };

    log(`${phase.label}…`);
    appendLog(jobId, `PROGRESS ${phase.from}`);

    let ok = true;
    if (phase.step === "transcribe") ok = await stepTranscribe(project, relay);
    else if (phase.step === "draft-beats") ok = await stepDraftBeats(project, relay);
    else if (phase.step === "source-proxy") ok = await stepSourceProxy(project, relay);
    else if (phase.step === "build") {
      // review render: 720p is what you watch to make decisions, and it is
      // minutes rather than tens of minutes on this machine
      const built = await buildCut(project, relay, { proxy: true });
      if (built) { appendLog(jobId, "PROGRESS 100"); finishJob(jobId, built); return; }
      ok = false;
    }

    if (!ok) {
      failJob(jobId, `${phase.label} failed — see the log`);
      return;
    }
  }
  finishJob(jobId);
}

/** The build itself. Returns the cut's filename, or null on failure, so it
 *  can be one phase of a longer run as well as a job of its own. */
async function buildCut(
  project: string,
  log: (line: string) => void,
  opts: { proxy?: boolean } = {}
): Promise<string | null> {
  const avail = checkAvailability();
  if (!avail.python3 || !avail.ffmpeg) {
    log(`build failed: ${`pipeline tools not available in this environment (python3: ${avail.python3}, ffmpeg: ${avail.ffmpeg})`}`);
    return null;
  }

  const projAbs = projectDir(project);
  const workDir = path.join(projectDir(project), "work");

  // build_cut snaps beat edges against the strict silence map; generate it if
  // the project predates that step, otherwise it silently falls back to the
  // -28dB map and leaves dead air at the joins.
  const strictPath = path.join(workDir, "silence-strict.txt");
  const beatsData = loadBeatsForSource(project);
  if (!fs.existsSync(strictPath) && beatsData) {
    const rawPath = path.join(projectDir(project), beatsData.source);
    if (fs.existsSync(rawPath)) {
      log("mapping true silence for edge snapping (-50dB)...");
      await runTool("silence_map.py", [rawPath, "--noise=-50dB", "--min-dur", "0.06", "-o", strictPath], { onLine: log });
    }
  }

  log("building edit list (build_cut.py)...");
  const build = await runTool("build_cut.py",
    opts.proxy ? ["--project", projAbs, "--proxy"] : ["--project", projAbs],
    { onLine: log });
  if (!build.ok) {
    log(`build failed: ${"build_cut.py failed — see log"}`);
    return null;
  }

  const extractSh = path.join(workDir, "extract.sh");
  if (!fs.existsSync(extractSh)) {
    log(`build failed: ${"build_cut.py did not produce work/extract.sh"}`);
    return null;
  }

  // extract.sh is one ffmpeg call per clip, so clips finished over clips
  // total is honest progress rather than a spinner.
  const totalClips = fs.readFileSync(extractSh, "utf8")
    .split("\n").filter((l) => l.startsWith("ffmpeg")).length;
  let doneClips = 0;
  log(`extracting ${totalClips} clips...`);
  const extract = await runCommand("bash", ["-x", extractSh], {
    onLine: (line) => {
      if (line.startsWith("+ ffmpeg")) {
        doneClips += 1;
        // extraction is the long half of a build; stitching is the rest
        if (totalClips) log(`PROGRESS ${Math.min(92, Math.round((doneClips / totalClips) * 90))}`);
        log(`snipping clip ${doneClips} of ${totalClips}`);
        return;
      }
      if (line.startsWith("+ ")) return;      // the rest of the shell trace
      log(line);
    },
  });
  if (!extract.ok) {
    log(extract.timedOut
      ? `build failed: extraction was killed after clip ${doneClips} of ${totalClips}`
      : `build failed: extracting clip ${doneClips + 1} of ${totalClips} failed — see log`);
    return null;
  }

  const version = nextCutVersion(project);
  const cutFileName = `${project}-v${version}.mp4`;
  const cutRelPath = path.join(projAbs, "cuts", cutFileName);
  fs.mkdirSync(path.join(projectDir(project), "cuts"), { recursive: true });

  log("PROGRESS 94");
  log(`stitching final cut (${cutFileName})...`);
  const concat = await runCommand(
    resolvedFfmpeg(),
    ["-y", "-f", "concat", "-safe", "0", "-i", path.join(projAbs, "work", "concat.txt"), "-c", "copy", cutRelPath],
    { onLine: log }
  );
  if (!concat.ok) {
    log(`build failed: ${"ffmpeg concat failed — see log"}`);
    return null;
  }

  await runChecksAndCache(project, cutFileName, cutRelPath, log);
  return cutFileName;
}

export async function runBuildJob(jobId: string, project: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const cut = await buildCut(project, log);
  if (!cut) { failJob(jobId, "build failed — see log"); return; }
  finishJob(jobId, cut);
}

/** The newest render on disk. The scorecard describes a particular cut, so
 *  re-checking has to name the same file the review screen is playing. */
export function latestCut(project: string): string | null {
  const cutsDir = path.join(projectDir(project), "cuts");
  if (!fs.existsSync(cutsDir)) return null;
  let best: { name: string; v: number } | null = null;
  for (const f of fs.readdirSync(cutsDir)) {
    const v = /-v(\d+)\.(mp4|mov)$/i.exec(f)?.[1];
    if (v === undefined) continue;
    if (!best || Number(v) > best.v) best = { name: f, v: Number(v) };
  }
  return best?.name ?? null;
}

/**
 * Re-run the two checks against the cut that already exists.
 *
 * The checks used to run in exactly one place -- the tail of a build -- so a
 * check that came back wrong stayed wrong until somebody re-rendered. That is
 * minutes of 4K encoding to recompute two numbers read off files that had not
 * changed. It also meant a bug in one of the two tools was invisible until the
 * next build, which is how the pacing metric sat on "needs a built cut to
 * compare" while the cut was sitting right there.
 */
export async function runCheckJob(jobId: string, project: string): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const cut = latestCut(project);
  if (!cut) { failJob(jobId, "nothing has been built yet — there is no cut to check"); return; }
  try {
    log(`checking ${cut}...`);
    await runChecksAndCache(project, cut, path.join(projectDir(project), "cuts", cut), log);
    finishJob(jobId, cut);
  } catch (e) {
    failJob(jobId, e instanceof Error ? e.message : String(e));
  }
}

/* ---- the auto pipeline's other phases, as plain steps ---- */

async function stepTranscribe(project: string, log: (l: string) => void): Promise<boolean> {
  const dir = projectDir(project);
  const beats = loadBeatsForSource(project);
  if (!beats) return false;
  const raw = path.join(dir, beats.source);
  if (!fs.existsSync(raw)) { log("the footage isn't on this machine"); return false; }
  fs.mkdirSync(path.join(dir, "work"), { recursive: true });
  const t = await runTool("transcribe.py", [raw, "-o", path.join(dir, "work", "transcript.json")], { onLine: log });
  if (!t.ok) return false;
  log("mapping the pauses...");
  const sm = await runTool("silence_map.py", [raw, "-o", path.join(dir, "work", "silence.txt")], { onLine: log });
  if (!sm.ok) return false;
  await runTool("silence_map.py",
    [raw, "--noise=-50dB", "--min-dur", "0.06", "-o", path.join(dir, "work", "silence-strict.txt")],
    { onLine: log });
  return true;
}

async function stepDraftBeats(project: string, log: (l: string) => void): Promise<boolean> {
  const r = await runTool("draft_beats.py", [projectDir(project), "--force"], { onLine: log });
  return r.ok;
}

async function stepSourceProxy(project: string, log: (l: string) => void): Promise<boolean> {
  const r = await runTool("make_source_proxy.py", [projectDir(project)], { onLine: log });
  return r.ok;
}


/**
 * Runs the two expensive checks (verify_cut.py transcribes the whole cut with
 * Whisper; compare_to_reference.py reads the EDL) and caches the results
 * against the cut they describe, so the review screen can render them
 * instantly instead of blocking a page load on Whisper.
 */
export async function runChecksAndCache(
  project: string,
  cutFileName: string,
  cutRelPath: string,
  log: (line: string) => void = () => {}
): Promise<void> {
  const { parseVerifyCutOutput, parseCompareToReferenceOutput } = await import("./scorecard");
  const { updateReviewState } = await import("./reviewState");

  log("verifying no repeated phrases (verify_cut.py)...");
  const verify = await runTool("verify_cut.py", [cutRelPath], { onLine: log });
  const repeats = parseVerifyCutOutput(verify.stdout);
  if (!verify.ok) {
    log("VERIFY FAILED — a phrase repeats in this cut. It was still rendered; fix that beat's in-point and rebuild.");
  }

  log("comparing against house style (compare_to_reference.py)...");
  const cmp = await runTool("compare_to_reference.py", ["--project", projectDir(project)], { onLine: log });
  const pacing = parseCompareToReferenceOutput(cmp.stdout);

  updateReviewState(project, (s) => {
    s.checks = {
      cutFile: cutFileName,
      computedAt: new Date().toISOString(),
      metrics: [repeats, pacing],
    };
  });
}

/** Minimal beats.json read used by the build job to locate the source file
 * without pulling in the whole beats module. */
function loadBeatsForSource(project: string): { source: string } | null {
  try {
    const p = path.join(projectDir(project), "beats.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as { source: string };
  } catch {
    return null;
  }
}

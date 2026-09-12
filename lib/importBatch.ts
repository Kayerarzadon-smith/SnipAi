import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_ROOT, projectDir, listProjectNames } from "./paths";
import { isVideoName } from "./videoFiles";
import { probeClip, type ClipProbe } from "./clipProbe";
import { joinClips, joinRefusal, orderProbes } from "./stitch";
import {
  proposeGroups,
  type ClipForGrouping,
  type ClipTranscript,
  type Seam,
} from "./grouping";
import { appendLog, failJob, finishJob } from "./jobs";
import { runTool, runPipelinePhases } from "./pipeline";
import { saveBeats } from "./beats";

/**
 * A batch of dropped clips, from bytes on disk to confirmed projects.
 * (DOCKET M0.8, R5 — the import restructure)
 *
 * ## Why the import had to be turned inside out
 *
 * Deciding which clips are one interrupted TikTok needs their transcripts,
 * and transcribing needs the bytes on the server. The old flow created a
 * project per file the moment the bytes arrived, which is the decision this
 * milestone exists to stop making blind. So the bytes land in a **staging**
 * area belonging to no project, get analysed there, and only become projects
 * once he has seen the proposal and said yes.
 *
 *   POST /api/import                     -> a batch id
 *   POST /api/import/<id>/files          -> one clip, streamed to staging
 *   POST /api/import/<id>/analyse        -> a job: probe, transcribe, propose
 *   GET  /api/import/<id>                -> the proposal, for the tray
 *   POST /api/import/<id>/confirm        -> a job: join, create, build
 *   DELETE /api/import/<id>              -> staging is thrown away
 *
 * Nothing about the batch is a decision: `analyse` proposes and stops.
 *
 * ## Whisper runs twice for a joined video, and once for a standalone
 *
 * A group of several clips is transcribed twice: once per clip while
 * proposing, then once over the joined file. That is deliberate and it is the
 * expensive choice. The seams land MID-WORD -- he is cut off saying "and
 * there's—" and restarts with "and there's this serum" -- and a transcript
 * assembled from per-clip transcripts with an offset keeps that half-word as
 * two fragments, which is the exact problem joining exists to solve. A fresh
 * pass over the joined file hears one whole word.
 *
 * A group of ONE clip is transcribed once. Nothing is joined, so the file the
 * project gets is byte-for-byte the file that was transcribed in staging, and
 * its transcript is carried across rather than recomputed. On a 4-core i5
 * that is the difference between minutes and minutes doubled, for free and
 * with no correctness cost.
 *
 * Carrying a transcript across is only safe because `lib/pipeline.ts` no
 * longer treats "transcript.json exists" as "the transcribe step is done"
 * (ledger S31): that step also writes the two silence maps `draft_beats.py`
 * and `build_cut.py` depend on, and skipping them would have shown up as
 * worse beats rather than as a missing file.
 */

/* ---- where staging lives ------------------------------------------------ */

/**
 * Beside `projects/`, never inside it. A half-uploaded batch must not be
 * visible to `listProjectNames()`, to the dashboard, or to the trash.
 */
export const STAGING_ROOT = path.join(DATA_ROOT, ".staging");

/** A batch id is a path segment and is checked like one. */
const BATCH_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;

export function assertValidBatchId(id: string): void {
  if (!BATCH_ID.test(id)) throw new Error(`invalid batch id: ${id}`);
}

export function batchDir(id: string): string {
  assertValidBatchId(id);
  return path.join(STAGING_ROOT, id);
}

/**
 * Where one staged clip lives.
 *
 * The name is reduced to a basename and then to the same safe alphabet the
 * importer has always used, and the result is checked to be inside the batch
 * directory afterwards as well -- belt and braces, because this one takes a
 * string that came off the network.
 */
export function stagedPath(id: string, fileName: string): string {
  const dir = batchDir(id);
  const safe = safeFileName(fileName);
  const full = path.resolve(dir, "clips", safe);
  if (!full.startsWith(path.resolve(dir, "clips") + path.sep)) {
    throw new Error(`staged file escapes its batch: ${fileName}`);
  }
  return full;
}

export function safeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  // "..", "." and "" are all path, not name
  return /^\.+$/.test(base) || base === "" ? "clip" : base;
}

function transcriptPath(id: string, fileName: string): string {
  return path.join(batchDir(id), "transcripts", `${safeFileName(fileName)}.json`);
}

/* ---- what a batch is ---------------------------------------------------- */

export type StagedFile = { name: string; sizeBytes: number };

export type BatchStatus =
  | "collecting"
  | "analysing"
  | "proposed"
  | "importing"
  | "imported"
  | "failed";

/** One proposed project, which is what a card in the tray is. */
export type ProposedProject = {
  /** what it would be called, and what it WILL be called -- collisions with
   *  existing projects are resolved here, not discovered at confirm time */
  project: string;
  /** staged file names, in filmed order */
  files: string[];
  totalDurationSec: number | null;
  /** why these clips are together, in plain English. Empty for a lone clip */
  joinedBy: TraySeam[];
  /** why this is not part of the group before it. Null for the first card */
  separatedBy: TraySeam | null;
  /** why these cannot be joined after all, with what to do about it */
  blocker: string | null;
  interleaved: boolean;
};

/**
 * What the tray is told about one seam.
 *
 * Everything the person needs to judge the guess, and nothing that is only
 * the rule's working.
 */
export type TraySeam = {
  from: string;
  to: string;
  verdict: string;
  /** -1..1. Persisted so a run's own evidence records what it decided by */
  score: number;
  /** strong enough to act on without asking him */
  confident: boolean;
  /** the reason that actually decided it (C37) */
  decidedBy: string;
  reasons: string[];
};

export type Batch = {
  id: string;
  createdAt: string;
  status: BatchStatus;
  files: StagedFile[];
  /** the analyse or confirm job, whichever ran last */
  jobId?: string;
  error?: string;
  proposal?: {
    basis: string;
    projects: ProposedProject[];
      /** seams the rule could not call CONFIDENTLY -- unsure, or a verdict too
     *  weak to act on without asking. See grouping.ts's needsYourEye. */
    needsYourEye: TraySeam[];
    /** clips whose transcript could not be read, so the seam had nothing to
     *  go on. Named, because a silent degradation here is a silent wrong
     *  grouping */
    notTranscribed: string[];
  };
  imported?: { project: string; clips: number; cutFile?: string }[];
};

function batchFile(id: string): string {
  return path.join(batchDir(id), "batch.json");
}

export function readBatch(id: string): Batch | null {
  try {
    return JSON.parse(fs.readFileSync(batchFile(id), "utf8")) as Batch;
  } catch {
    return null;
  }
}

/** Atomic, for the same reason lib/jobs.ts is: every route re-reads this file
 *  and a half-written one is a crash rather than a stale answer. */
export function writeBatch(b: Batch): void {
  const dir = batchDir(b.id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `batch.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(b, null, 2));
  fs.renameSync(tmp, batchFile(b.id));
}

export function createBatch(): Batch {
  /* randomUUID, not Date.now(): two drops inside the same millisecond are
     rare and the consequence -- two batches sharing a staging directory and
     each deleting the other's clips -- is not one to leave to luck. */
  const id = `b-${randomUUID().slice(0, 18)}`;
  const b: Batch = { id, createdAt: new Date().toISOString(), status: "collecting", files: [] };
  fs.mkdirSync(path.join(batchDir(id), "clips"), { recursive: true });
  writeBatch(b);
  return b;
}

export function recordStagedFile(id: string, fileName: string, sizeBytes: number): Batch | null {
  const b = readBatch(id);
  if (!b) return null;
  const name = safeFileName(fileName);
  b.files = [...b.files.filter((f) => f.name !== name), { name, sizeBytes }];
  b.status = "collecting";
  writeBatch(b);
  return b;
}

export function discardBatch(id: string): void {
  fs.rmSync(batchDir(id), { recursive: true, force: true });
}

/**
 * Staging that nobody came back for.
 *
 * A browser closed mid-import leaves gigabytes of clips in a directory no
 * screen will ever show again. Swept on the way in to a new batch rather than
 * on a timer, because there is no daemon here to run a timer.
 */
export function sweepAbandonedBatches(olderThanMs = 24 * 60 * 60 * 1000): string[] {
  const swept: string[] = [];
  if (!fs.existsSync(STAGING_ROOT)) return swept;
  for (const entry of fs.readdirSync(STAGING_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !BATCH_ID.test(entry.name)) continue;
    const b = readBatch(entry.name);
    const at = b ? Date.parse(b.createdAt) : NaN;
    const age = Number.isFinite(at) ? Date.now() - at : Infinity;
    if (b?.status === "importing" || b?.status === "analysing") continue;
    if (age > olderThanMs) {
      discardBatch(entry.name);
      swept.push(entry.name);
    }
  }
  return swept;
}

/* ---- analysing: probe, transcribe, propose ------------------------------ */

export type AnalyseDeps = {
  probe: (file: string) => Promise<ClipProbe>;
  /** writes a transcript for one staged clip, or returns null if it could
   *  not be produced. Whisper, in the shipping configuration */
  transcribe: (file: string, out: string, log: (l: string) => void) => Promise<ClipTranscript | null>;
};

const realDeps: AnalyseDeps = {
  probe: probeClip,
  transcribe: async (file, out, log) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const r = await runTool("transcribe.py", [file, "-o", out], { onLine: log });
    if (!r.ok) return null;
    try {
      const t = JSON.parse(fs.readFileSync(out, "utf8"));
      return Array.isArray(t) ? (t as ClipTranscript) : null;
    } catch {
      return null;
    }
  },
};

/**
 * A seam as the tray receives it.
 *
 * `score`, `confident` and `decidedBy` were being dropped here (ledger S38),
 * so the tray got a bare verdict and a sentence and he could not tell a 0.95
 * "same" from a -0.1 "separate" -- the two read identically on screen. The
 * score is carried because the persisted proposal is the only durable record
 * of a run that costs nineteen minutes of transcription; the tray renders the
 * English, not the number.
 *
 * `signals` is deliberately still left off: it is the rule's working, it has
 * no reader, and S37 will change its shape.
 */
function trayseam(s: Seam): TraySeam {
  return {
    from: s.from,
    to: s.to,
    verdict: s.verdict,
    score: s.score,
    confident: s.confident,
    decidedBy: s.decidedBy,
    reasons: s.reasons,
  };
}

/**
 * Work out what to propose, and say so in the batch file.
 *
 * Probing is seconds; transcription is the slow pole and gets the bar. Every
 * clip is transcribed, including the ones a gap of hours has already
 * separated -- the transcript is not wasted work, it is the thing the project
 * will be built from if the clip ends up standing alone.
 */
export async function analyseBatch(
  jobId: string,
  id: string,
  deps: AnalyseDeps = realDeps
): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const b = readBatch(id);
  if (!b) {
    failJob(jobId, `no import batch ${id}`);
    return;
  }
  if (b.files.length === 0) {
    failJob(jobId, "nothing was uploaded to look at");
    return;
  }

  b.status = "analysing";
  b.jobId = jobId;
  delete b.error;
  writeBatch(b);

  try {
    log(`looking at ${b.files.length} clip${b.files.length === 1 ? "" : "s"}…`);
    const probes: ClipProbe[] = [];
    for (const f of b.files) {
      probes.push(await deps.probe(stagedPath(id, f.name)));
    }
    appendLog(jobId, "PROGRESS 8");

    /* Transcribe in filmed order, so the log reads the way the tray will. */
    const { ordered } = orderProbes(probes);
    const transcripts = new Map<string, ClipTranscript | null>();
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      log(`listening to ${p.name} (${i + 1} of ${ordered.length})…`);
      const t = await deps.transcribe(p.path, transcriptPath(id, p.name), (l) => {
        /* a tool's own PROGRESS is this clip's share of the bar, not the
           whole bar -- five clips each reaching 100 would otherwise drive it
           to 100 five times */
        const m = /^PROGRESS\s+(\d{1,3})\s*$/.exec(l.trim());
        if (!m) { log(l); return; }
        const inner = Math.max(0, Math.min(100, Number(m[1])));
        const share = 88 / ordered.length;
        appendLog(jobId, `PROGRESS ${Math.round(8 + share * (i + inner / 100))}`);
      });
      if (!t) log(`could not make out any speech in ${p.name} — the seams either side of it will be a question rather than an answer`);
      transcripts.set(p.name, t);
    }
    appendLog(jobId, "PROGRESS 96");

    const clips: ClipForGrouping[] = ordered.map((probe) => ({
      probe,
      transcript: transcripts.get(probe.name) ?? null,
    }));
    const proposal = proposeGroups(clips);

    /* A name has to be free, and free ACROSS the batch as well as against the
       library: two groups whose first clips are IMG_9901.MOV and
       IMG_9901-1.MOV both want "img-9901". Settled here so the tray shows the
       name the import will really use. */
    const taken = new Set(listProjectNames());
    const seamBetween = (from: string, to: string) =>
      proposal.seams.find((s) => s.from === from && s.to === to) ?? null;

    const projects: ProposedProject[] = proposal.groups.map((g, i) => {
      const previous = i > 0 ? proposal.groups[i - 1] : null;
      const split = previous
        ? seamBetween(previous.clips[previous.clips.length - 1].name, g.clips[0].name)
        : null;
      const project = freeName(g.projectName, taken);
      taken.add(project);
      return {
        project,
        files: g.clips.map((c) => c.name),
        totalDurationSec: g.totalDurationSec,
        joinedBy: g.joinedBy.map(trayseam),
        separatedBy: split ? trayseam(split) : null,
        blocker: g.clips.length > 1 ? joinRefusal(g.clips) : null,
        interleaved: g.interleaved,
      };
    });

    b.status = "proposed";
    b.proposal = {
      basis: proposal.basis,
      projects,
      needsYourEye: proposal.needsYourEye.map(trayseam),
      notTranscribed: [...transcripts.entries()].filter(([, t]) => t === null).map(([n]) => n),
    };
    writeBatch(b);

    log(
      `proposing ${projects.length} project${projects.length === 1 ? "" : "s"} from ${b.files.length} clips`
    );
    appendLog(jobId, "PROGRESS 100");
    finishJob(jobId);
  } catch (err) {
    b.status = "failed";
    b.error = err instanceof Error ? err.message : String(err);
    writeBatch(b);
    failJob(jobId, b.error);
  }
}

/** "img-9901" if it is free, else "img-9901-2", "img-9901-3"… */
export function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 64);
}

/* ---- confirming: join, create, build ------------------------------------ */

export type ConfirmGroup = { project: string; files: string[] };

export type ConfirmDeps = {
  join: typeof joinClips;
  /** the pipeline for one project, over its slice of this job's bar */
  pipeline: typeof runPipelinePhases;
};

const realConfirmDeps: ConfirmDeps = { join: joinClips, pipeline: runPipelinePhases };

/**
 * What he confirmed, checked against what was actually staged.
 *
 * Every staged clip has to appear exactly once. A clip in two groups would be
 * imported twice and then deleted from under the second; a clip in none would
 * be silently thrown away with the staging directory, which is the same shape
 * of loss as deleting footage. Both are refused here, by name.
 */
export function validateGroups(
  b: Batch,
  groups: ConfirmGroup[]
): { ok: true; groups: ConfirmGroup[] } | { ok: false; error: string } {
  if (!Array.isArray(groups) || groups.length === 0) return { ok: false, error: "no groups to import" };

  const staged = new Set(b.files.map((f) => f.name));
  const seen = new Map<string, number>();
  for (const g of groups) {
    if (!Array.isArray(g.files) || g.files.length === 0) {
      return { ok: false, error: `"${g.project}" has no clips in it` };
    }
    for (const f of g.files) {
      const name = safeFileName(f);
      if (!staged.has(name)) return { ok: false, error: `${f} was never uploaded to this batch` };
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
  }
  const twice = [...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  if (twice.length) return { ok: false, error: `${twice.join(", ")} is in more than one project` };
  const missing = [...staged].filter((n) => !seen.has(n));
  if (missing.length) {
    return { ok: false, error: `${missing.join(", ")} would be thrown away — put it in a project or remove it from the batch` };
  }

  const names = new Set<string>();
  const existing = new Set(listProjectNames());
  const out: ConfirmGroup[] = [];
  for (const g of groups) {
    const asked = typeof g.project === "string" ? g.project.trim() : "";
    if (!/^[a-z0-9-]{1,64}$/.test(asked)) {
      return { ok: false, error: `"${asked}" is not a usable project name — lowercase letters, numbers and dashes` };
    }
    if (existing.has(asked)) return { ok: false, error: `there is already a project called ${asked}` };
    if (names.has(asked)) return { ok: false, error: `two of these projects are both called ${asked}` };
    names.add(asked);
    out.push({ project: asked, files: g.files.map(safeFileName) });
  }
  return { ok: true, groups: out };
}

/**
 * Turn the confirmed grouping into projects, and build each one.
 *
 * One job, not one per project, because the machine can only do one of these
 * at a time anyway -- Whisper and ffmpeg each want every core, and two at once
 * is what took this Mac down. One job means one honest bar across the whole
 * import instead of four that fight each other, and it is the reason the old
 * "fire a pipeline POST per uploaded file" shape could not be kept: every POST
 * after the first came back 409 and was swallowed, so a drop of five clips
 * built one project and quietly abandoned the rest.
 *
 * A group that fails does not stop the ones after it. Losing the second TikTok
 * because the first would not join is not a trade anybody would choose.
 */
export async function confirmBatch(
  jobId: string,
  id: string,
  requested: ConfirmGroup[],
  deps: ConfirmDeps = realConfirmDeps
): Promise<void> {
  const log = (line: string) => appendLog(jobId, line);
  const b = readBatch(id);
  if (!b) {
    failJob(jobId, `no import batch ${id}`);
    return;
  }
  const checked = validateGroups(b, requested);
  if (!checked.ok) {
    b.status = "proposed";
    b.error = checked.error;
    writeBatch(b);
    failJob(jobId, checked.error);
    return;
  }
  const groups = checked.groups;

  b.status = "importing";
  b.jobId = jobId;
  delete b.error;
  b.imported = [];
  writeBatch(b);

  const share = 100 / groups.length;
  const failures: string[] = [];
  let lastCut: string | undefined;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const from = share * i;
    const dir = projectDir(g.project);
    appendLog(jobId, `PROGRESS ${Math.round(from)}`);

    try {
      for (const sub of ["raw", "cuts", "work"]) {
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
      }

      let sourceName: string;
      if (g.files.length === 1) {
        /* One clip: move it, and bring its transcript with it. The bytes are
           the same bytes -- nothing is joined, nothing is re-encoded -- so
           the transcript made while proposing is the transcript of this exact
           file, and Whisper does not need to hear it twice. A rename, not a
           copy, so a 1.8GB clip costs nothing and the disk never holds two. */
        sourceName = g.files[0];
        moveInto(stagedPath(id, sourceName), path.join(dir, "raw", sourceName));
        const staged = transcriptPath(id, sourceName);
        if (fs.existsSync(staged)) {
          fs.copyFileSync(staged, path.join(dir, "work", "transcript.json"));
          log(`${g.project}: reusing the transcript from the import — same file, same words`);
        }
      } else {
        /* Several clips: join them, then transcribe the joined file from
           scratch later in the pipeline. The seams land mid-word, and a
           transcript stitched from the parts would keep each half-word as its
           own fragment -- which is the problem joining exists to solve. */
        sourceName = `${g.project}.mov`;
        log(`${g.project}: joining ${g.files.length} clips…`);
        const joined = await deps.join(
          g.files.map((f) => stagedPath(id, f)),
          path.join(dir, "raw", sourceName),
          { log }
        );
        if (!joined.ok) {
          throw new Error(joined.error);
        }
        log(
          `${g.project}: ${joined.actualSec.toFixed(1)}s from ${g.files.length} clips, no re-encode` +
            (joined.dataStreamsDropped ? ` (${joined.dataStreamsDropped} camera data tracks dropped)` : "")
        );
        for (const f of g.files) fs.rmSync(stagedPath(id, f), { force: true });
      }

      saveBeats(g.project, {
        source: `raw/${sourceName}`,
        notes:
          g.files.length > 1
            ? `Imported by SnipAi from ${g.files.length} clips joined end to end: ${g.files.join(", ")}.`
            : "Imported by SnipAi — beats.json not drafted yet.",
        beats: [],
      });

      b.imported = [...(b.imported ?? []), { project: g.project, clips: g.files.length }];
      writeBatch(b);

      /* The rest of the bar for this project is the ordinary pipeline. It is
         run here rather than POSTed per project because only one heavy job may
         run at a time, and this IS that job. */
      const r = await deps.pipeline(jobId, g.project, { from: from + share * 0.1, to: share * (i + 1) });
      if (!r.ok) {
        failures.push(`${g.project}: ${r.error}`);
      } else if (r.cutFile) {
        lastCut = r.cutFile;
        b.imported = (b.imported ?? []).map((im) =>
          im.project === g.project ? { ...im, cutFile: r.cutFile } : im
        );
        writeBatch(b);
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      log(`${g.project}: ${why}`);
      failures.push(`${g.project}: ${why}`);
      /* A project that never got its footage is an empty shell on the
         dashboard. Take it away again -- but only if this is the failure that
         created it and there is nothing in it. */
      if (isEmptyShell(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /* Staging goes only when every clip in it has found a home. A failed join
     leaves his footage exactly where it was, which is the difference between
     "try again" and "re-shoot". */
  const leftovers = b.files.filter((f) => fs.existsSync(stagedPath(id, f.name)));
  if (leftovers.length === 0) {
    discardBatch(id);
  } else {
    b.status = failures.length ? "failed" : "imported";
    b.error = failures.join("; ") || undefined;
    writeBatch(b);
  }

  if (failures.length === groups.length) {
    failJob(jobId, failures.join("; "));
    return;
  }
  if (failures.length) log(`some of this import did not finish: ${failures.join("; ")}`);
  appendLog(jobId, "PROGRESS 100");
  finishJob(jobId, lastCut);
}

/** Rename where it can, copy where it cannot -- the staging area and the
 *  library are normally the same volume, but SNIPAI_DATA can put them on
 *  different ones and EXDEV is not a reason to lose an import. */
function moveInto(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}

function isEmptyShell(dir: string): boolean {
  try {
    const raw = path.join(dir, "raw");
    return fs.existsSync(dir) && (!fs.existsSync(raw) || fs.readdirSync(raw).length === 0);
  } catch {
    return false;
  }
}

/** Only footage, and the same list everything else uses. */
export function refuseFile(fileName: string): string | null {
  if (!isVideoName(fileName)) return `${fileName || "that file"} isn't a video`;
  return null;
}

/**
 * Free bytes where staging lives, for refusing an upload before it starts
 * rather than half way through.
 *
 * The same check the old importer did, moved to staging: running out of room
 * mid-write answers the browser while it is still sending, and the browser
 * reports the early close as a dropped connection. null when the filesystem
 * will not say, in which case the write below still fails, just later.
 */
export function freeBytes(): number | null {
  try {
    fs.mkdirSync(STAGING_ROOT, { recursive: true });
    const vfs = fs.statfsSync(STAGING_ROOT);
    return Number(vfs.bavail) * Number(vfs.bsize);
  } catch {
    return null;
  }
}

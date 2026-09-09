import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./paths";

export type JobStatus = "running" | "done" | "error";

export type Job = {
  id: string;
  project: string;
  step: string;
  status: JobStatus;
  log: string[];
  startedAt: string;
  finishedAt?: string;
  error?: string;
  resultCutFile?: string;
  /** 0-100 where a step can say how far along it is, else undefined. */
  progress?: number;
  /** seconds left, extrapolated from how long the work so far actually took */
  etaSeconds?: number;
  /** what the step is doing right now, in words */
  stage?: string;
};

// In-memory job store — fine for a single local dev-server process. A real
// multi-process deployment would need this in the review-state.json or a
// proper queue instead.
const jobs = new Map<string, Job>();

// Jobs survive a restart. A 4K render runs for many minutes; if the server
// restarts mid-job an in-memory Map loses all knowledge of it and the UI
// shows nothing. On a machine that has crashed twice, that is not academic.
const JOBS_FILE = path.join(STATE_ROOT, "jobs.json");

function persist(): void {
  try {
    fs.mkdirSync(STATE_ROOT, { recursive: true });
    // keep the last 40 -- enough for history, not enough to grow forever
    const recent = [...jobs.values()].slice(-40);
    // atomic: a half-written jobs.json read by another route is a crash, and
    // every route re-reads this file (Next gives each one its own module)
    const tmp = `${JOBS_FILE}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(recent, null, 2));
    fs.renameSync(tmp, JOBS_FILE);
  } catch {
    // logging state must never take down the job it is describing
  }
}

function restore(): void {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) as Job[];
    for (const job of saved) {
      // anything still "running" died with the previous process -- the child
      // process is gone, so reporting it as running would be a lie
      if (job.status === "running") {
        job.status = "error";
        job.error = "interrupted — the server restarted while this was running";
        job.finishedAt = new Date().toISOString();
      }
      jobs.set(job.id, job);
    }
  } catch {
    // a corrupt jobs file must not stop the app from starting
  }
}

restore();

/**
 * Pull in anything another route wrote.
 *
 * Next bundles this module separately into each route, so every route gets
 * its OWN copy of the map, hydrated once at import. The route that starts a
 * build sees it; a route that only reads never does -- which is why the
 * dashboard reported "no job running" while a build sat at 29%. The file is
 * the shared truth, so readers re-read it. It is a few KB and only read on
 * request, so the cost is nil.
 */
function refresh(): void {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) as Job[];
    for (const job of saved) {
      const mine = jobs.get(job.id);
      // never let a stale file resurrect a job this process has since finished
      if (mine && mine.status !== "running") continue;
      jobs.set(job.id, job);
    }
  } catch {
    // a bad read just means we answer from what we already have
  }
}

/**
 * Only one heavy job may run at a time. Whisper and ffmpeg each want every
 * core; two at once on a 4-core/8GB machine drives it into swap and locks the
 * UI. Running builds back to back is slower on paper and far better in
 * practice, because the machine stays usable throughout.
 */
export function isBusy(): boolean {
  refresh();
  for (const job of jobs.values()) {
    if (job.status === "running") return true;
  }
  return false;
}

export function runningJob(): Job | undefined {
  refresh();
  for (const job of jobs.values()) {
    if (job.status === "running") return job;
  }
  return undefined;
}

export function createJob(project: string, step: string): Job {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = { id, project, step, status: "running", log: [], startedAt: new Date().toISOString() };
  jobs.set(id, job);
  persist();
  return job;
}

export function getJob(id: string): Job | undefined {
  refresh();
  const job = jobs.get(id);
  if (!job) return undefined;
  return { ...job, etaSeconds: etaFor(job) };
}

/**
 * Seconds remaining, from how long the work so far actually took.
 *
 * Extrapolating from measured throughput rather than guessing at a duration:
 * transcription on this machine runs at whatever speed it runs at today, and
 * a figure derived from this run is right for this run.
 */
function etaFor(job: Job): number | undefined {
  if (job.status !== "running" || !job.progress || job.progress < 3) return undefined;
  const elapsed = (Date.now() - Date.parse(job.startedAt)) / 1000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return undefined;
  const remaining = (elapsed / job.progress) * (100 - job.progress);
  return Math.max(0, Math.round(remaining));
}

let lastPersist = 0;
/** Tools report progress as "PROGRESS <n>"; anything else is just log. */
const PROGRESS_RE = /^PROGRESS\s+(\d{1,3})\s*$/;

export function appendLog(id: string, line: string): void {
  const job = jobs.get(id);
  if (!job) return;

  const m = PROGRESS_RE.exec(line.trim());
  if (m) {
    // a progress report is not log noise; it never reaches the log panel
    job.progress = Math.max(0, Math.min(100, Number(m[1])));
    persist();               // progress is the whole point; write it through
    return;
  }
  job.stage = line.trim().slice(0, 120) || job.stage;
  job.log.push(line);
  // throttled: a chatty ffmpeg would otherwise write the file hundreds of
  // times a second
  const now = Date.now();
  if (now - lastPersist > 2000) {
    lastPersist = now;
    persist();
  }
}

export function finishJob(id: string, resultCutFile?: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    job.resultCutFile = resultCutFile;
    persist();
  }
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "error";
    job.error = error;
    job.finishedAt = new Date().toISOString();
    // Every other mutator writes through; this one did not. Next gives each
    // route its own module instance, so a failure recorded only in this
    // process's Map leaves every OTHER route still reading "running" off
    // disk -- and refusing the next build with a 409 forever.
    persist();
  }
}

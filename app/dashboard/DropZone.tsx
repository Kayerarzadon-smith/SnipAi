"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isVideoName, projectNameFor } from "@/lib/videoFiles";
import { useRouter } from "next/navigation";
/* Imported rather than re-declared. This file had its own copy of the wire
   shape, and the copies drifted: `score`, `confident` and `decidedBy` were
   added to the server's seam and this one still said four fields, so the tray
   could not have shown the confidence even once it was being sent (ledger
   S38). `import type` is erased at build time, so a client component may take
   it from a module that touches node:fs -- same as `review/page.tsx` does
   with `Job`. The rest of this file's local proposal types are still
   duplicates; that is a row, not a detour. */
import type { TraySeam } from "@/lib/importBatch";

type Existing = { project: string; name: string; size: number }[];

type Queued = {
  file: File;
  name: string;
  status: "ready" | "duplicate" | "uploading" | "done" | "error" | "rejected";
  duplicateOf?: string;
  message?: string;
  /** 0-100 while the bytes are moving. fetch() cannot report this at all,
   *  which is why a 1.8GB import sat on the word "importing" for minutes
   *  with no way to tell it apart from a hang. */
  pct?: number;
};

/* The shapes the server sends back. Kept narrow on purpose: the tray renders
   sentences the server wrote, and inventing its own wording here is how a
   proposal starts promising something the import does not do. */
type ProposedProject = {
  project: string;
  files: string[];
  totalDurationSec: number | null;
  joinedBy: TraySeam[];
  separatedBy: TraySeam | null;
  blocker: string | null;
  interleaved: boolean;
};
type Proposal = {
  basis: string;
  projects: ProposedProject[];
  needsYourEye: TraySeam[];
  notTranscribed: string[];
};
type BatchState = {
  batch: {
    id: string;
    status: string;
    files: { name: string; sizeBytes: number }[];
    error?: string;
    proposal?: Proposal;
    imported?: { project: string; clips: number; cutFile?: string }[];
  };
  job: { id: string; status: string; progress?: number; stage?: string;
         etaSeconds?: number; error?: string } | null;
};

/** What he can change about a proposal: which clips are in which project, and
 *  what each project is called. Everything else is derived. */
type Group = { project: string; files: string[] };

/* projectNameFor moved to lib/videoFiles.ts: a proposed GROUP of clips is
   named the same way (DOCKET M0.8), and two copies of that rule would let the
   tray promise a project name the import does not produce. */

function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function clock(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function eta(seconds?: number): string {
  if (!seconds || seconds < 5) return "";
  const m = Math.round(seconds / 60);
  return m < 1 ? "under a minute left" : m === 1 ? "about a minute left" : `about ${m} minutes left`;
}

/**
 * Send one clip to staging, with progress.
 *
 * XHR rather than fetch, for the one thing XHR still does that fetch cannot:
 * `upload.onprogress`. Without it there is no honest way to show how far a
 * multi-gigabyte import has got, and "importing..." is indistinguishable from
 * a crash -- which is exactly how it read.
 *
 * Raw body rather than multipart: the server streams it straight to disk, so
 * nothing has to hold the file in memory at either end.
 */
function upload(
  batch: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<{ ok: boolean; body: { file?: string; error?: string } }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/import/${batch}/files`);
    // headers are latin-1; a filename with an accent in it must be encoded
    xhr.setRequestHeader("x-snipai-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    // The last byte leaving the browser is not the end: the server is still
    // writing it. Saying 100% and then sitting there is the same lie in a
    // smaller window, so the row says what is actually happening.
    xhr.upload.onload = () => onProgress(100);
    const done = (ok: boolean, fallback: string) => {
      let body: { file?: string; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { body = { error: fallback }; }
      resolve({ ok, body });
    };
    xhr.onload = () => done(xhr.status >= 200 && xhr.status < 300, `import failed (${xhr.status})`);
    // XHR gives no reason for a network-level failure, so this must not claim
    // one. It used to say the connection dropped, which was the message a
    // FULL DISK produced: the server answered ENOSPC while the browser was
    // still sending, and the early close looks like a dropped connection from
    // here. The server refuses on space before the upload starts now, so that
    // case arrives as a sentence; what is left is genuinely unknown.
    xhr.onerror = () => done(false, "the import stopped before it finished");
    xhr.onabort = () => done(false, "import cancelled");
    xhr.send(file);
  });
}

/**
 * Drop footage, see what it thinks the videos are, say yes.
 *
 * The tray's instruction is **propose, do not decide** (DOCKET M0.8). Kayer is
 * interrupted mid-take -- kid, door, life -- so one TikTok reaches the app as
 * three or four clips, and he also batch-films several different TikToks in
 * one sitting. Both arrive as "a pile of clips", and getting it wrong is
 * expensive in both directions: stitching two separate videos produces a
 * garbage cut, splitting one interrupted video means re-shooting. So the app
 * says what it thinks and why, in his words, and waits.
 *
 * Nothing here decides anything either. `confirm` sends the grouping that is
 * ON SCREEN, so agreeing and regrouping are the same path -- there is no
 * branch where the proposal acts on itself.
 */
export function DropZone({
  existing,
  emptyQueue,
  summary,
}: {
  existing: Existing;
  emptyQueue: boolean;
  /** one line of state, rendered next to the import button */
  summary?: React.ReactNode;
}) {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [queued, setQueued] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"choosing" | "uploading" | "analysing" | "proposing" | "importing" | "done">("choosing");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [state, setState] = useState<BatchState | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const depth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const accept = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const all = Array.from(files);
      const isVideo = (f: File) => isVideoName(f.name);
      // Non-video files used to be filtered out silently -- drop five things,
      // see three, and never learn what happened to the other two.
      const rejected = all.filter((f) => !isVideo(f)).map((file) => ({
        file,
        name: file.name,
        status: "rejected" as const,
        message: "not a video file",
      }));
      // The picker can hand back the same file twice, and a second drop should
      // add to the queue rather than replace it. Both are deduped on name and
      // size, which is what "the same footage" means here.
      // A file with nothing in it is not importable, and the tray is where
      // that gets said. It used to be counted as ready, uploaded, and only
      // then refused -- the .txt and .jpg beside it were screened here, so
      // being told about this one last was the odd part.
      const empties = all.filter((f) => isVideo(f) && f.size === 0).map((file) => ({
        file,
        name: file.name,
        status: "rejected" as const,
        message: "is empty",
      }));
      const seen = new Set<string>();
      const vids = all.filter((f) => isVideo(f) && f.size > 0).filter((f) => {
        const key = `${f.name.toLowerCase()}:${f.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setProblem(null);
      setPhase("choosing");
      setQueued([
        ...rejected,
        ...empties,
        ...vids.map((file) => {
          // same name, or same size under a different name -- both are the
          // same footage arriving twice
          const dupe =
            existing.find((e) => e.name.toLowerCase() === file.name.toLowerCase()) ??
            (file.size > 0 ? existing.find((e) => e.size === file.size) : undefined);
          return dupe
            ? {
                file,
                name: file.name,
                status: "duplicate" as const,
                duplicateOf: dupe.project,
                message:
                  dupe.name.toLowerCase() === file.name.toLowerCase()
                    ? `already in ${dupe.project}`
                    : `same size as ${dupe.name} in ${dupe.project}`,
              }
            : { file, name: file.name, status: "ready" as const };
        }),
      ]);
    },
    [existing]
  );

  // window-wide drag tracking; depth counter avoids flicker over children
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      accept(e.dataTransfer?.files ?? null);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [accept]);

  /* A ref, not the `busy` state, because state is asynchronous.

     The button is disabled on `busy`, but React has not re-rendered yet when
     the second half of a double-click arrives — so both clicks ran the
     upload, both POSTed the same file, and the loser came back an error. */
  const working = useRef(false);

  /** Poll one batch until its job stops running. The analyse job transcribes
   *  every clip, which is minutes on this machine, so this is the same
   *  every-second poll the review screen uses rather than a held-open
   *  request. */
  const pollBatch = useCallback(async (id: string): Promise<BatchState | null> => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      let s: BatchState;
      try {
        const res = await fetch(`/api/import/${id}`, { cache: "no-store" });
        if (!res.ok) return null;
        s = (await res.json()) as BatchState;
      } catch {
        continue; // a dropped poll is not a failed import
      }
      setState(s);
      if (s.job && s.job.status !== "running") return s;
      if (!s.job) return s;
    }
  }, []);

  /** Upload everything ready, then ask the server what these clips are. */
  async function lookAtThem() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const made = await fetch("/api/import", { method: "POST" });
      const madeBody = (await made.json()) as { batch?: string; error?: string };
      if (!made.ok || !madeBody.batch) throw new Error(madeBody.error ?? "could not start the import");
      const batch = madeBody.batch;
      setBatchId(batch);
      setPhase("uploading");

      for (let i = 0; i < queued.length; i++) {
        const item = queued[i];
        if (item.status !== "ready") continue;
        setQueued((q) => q.map((x, n) => (n === i ? { ...x, status: "uploading", pct: 0 } : x)));
        const { ok, body } = await upload(batch, item.file, (pct) =>
          setQueued((q) => q.map((x, n) => (n === i ? { ...x, pct } : x))));
        setQueued((q) =>
          q.map((x, n) =>
            n === i
              ? { ...x, status: ok ? "done" : "error", pct: undefined, message: ok ? undefined : body.error }
              : x));
      }

      setPhase("analysing");
      const started = await fetch(`/api/import/${batch}/analyse`, { method: "POST" });
      if (!started.ok) {
        throw new Error((await started.json()).error ?? "could not look at these clips");
      }
      const finished = await pollBatch(batch);
      const proposal = finished?.batch.proposal;
      if (!proposal) {
        throw new Error(finished?.job?.error ?? finished?.batch.error ?? "could not work out what these clips are");
      }
      setGroups(proposal.projects.map((p) => ({ project: p.project, files: [...p.files] })));
      setPhase("proposing");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("choosing");
    } finally {
      setBusy(false);
      working.current = false;
    }
  }

  /** Say yes to what is on screen. */
  async function confirmGroups() {
    if (working.current || !batchId) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/import/${batchId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "could not start the import");
      setPhase("importing");
      router.refresh(); // the projects exist from here on; show them building
      const finished = await pollBatch(batchId);
      if (finished?.job?.status === "error") throw new Error(finished.job.error ?? "the import failed");
      setPhase("done");
      setQueued([]);
      setBatchId(null);
      setState(null);
      setGroups([]);
      router.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setPhase("proposing");
    } finally {
      setBusy(false);
      working.current = false;
    }
  }

  async function startOver() {
    if (batchId) await fetch(`/api/import/${batchId}`, { method: "DELETE" }).catch(() => {});
    setQueued([]);
    setGroups([]);
    setState(null);
    setBatchId(null);
    setProblem(null);
    setPhase("choosing");
  }

  /* ---- regrouping: the two things he can say back ---- */

  const rename = (i: number, name: string) =>
    setGroups((g) => g.map((x, n) => (n === i ? { ...x, project: name } : x)));

  /** "These two are one video." The merged project keeps the first one's name,
   *  because the first clip is what the import names a project after. */
  const mergeWithNext = (i: number) =>
    setGroups((g) => {
      if (i + 1 >= g.length) return g;
      const merged = { project: g[i].project, files: [...g[i].files, ...g[i + 1].files] };
      return [...g.slice(0, i), merged, ...g.slice(i + 2)];
    });

  /** "No, that one is its own video." Splits a project in two before clip k. */
  const splitAt = (i: number, k: number) =>
    setGroups((g) => {
      const head = g[i].files.slice(0, k);
      const tail = g[i].files.slice(k);
      if (!head.length || !tail.length) return g;
      const taken = new Set([...g.map((x) => x.project), ...existing.map((e) => e.project)]);
      let name = projectNameFor(tail[0]);
      for (let n = 2; taken.has(name); n++) name = `${projectNameFor(tail[0])}-${n}`;
      return [...g.slice(0, i), { ...g[i], files: head }, { project: name, files: tail }, ...g.slice(i + 1)];
    });

  const proposal = state?.batch.proposal ?? null;
  const sizeOf = (name: string) =>
    state?.batch.files.find((f) => f.name === name)?.sizeBytes ??
    queued.find((q) => q.name === name)?.file.size ?? 0;
  /* The proposal's own card for a group, matched on its first clip, so a
     regrouped card still shows the reasons that belong to it and never
     borrows another card's. */
  const cardFor = (g: Group) => proposal?.projects.find((p) => p.files[0] === g.files[0]) ?? null;
  const seamFor = (from: string, to: string) => {
    for (const p of proposal?.projects ?? []) {
      const hit = p.joinedBy.find((s) => s.from === from && s.to === to);
      if (hit) return hit;
      if (p.separatedBy && p.separatedBy.from === from && p.separatedBy.to === to) return p.separatedBy;
    }
    return null;
  };

  const importable = queued.filter((q) => q.status === "ready").length;
  const dupes = queued.filter((q) => q.status === "duplicate").length;
  const rejects = queued.filter((q) => q.status === "rejected").length;
  const job = state?.job ?? null;

  return (
    <>
      {/* one row: what the queue is doing, and the only way in */}
      <div className="queue-bar">
        <div className="queue-summary">{summary}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>
          Import footage
        </button>
      </div>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-target">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 16V4M12 4 7.5 8.5M12 4l4.5 4.5" />
              <path d="M3.5 15.5v2.2a2.3 2.3 0 0 0 2.3 2.3h12.4a2.3 2.3 0 0 0 2.3-2.3v-2.2" />
            </svg>
            <div className="drop-title">Drop footage to start a project</div>
            <div className="drop-sub">Drop the whole take — several clips at once is the point</div>
          </div>
        </div>
      )}

      {emptyQueue && queued.length === 0 && (
        <button className="drop-inline" onClick={() => inputRef.current?.click()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 16V4M12 4 7.5 8.5M12 4l4.5 4.5" />
            <path d="M3.5 15.5v2.2a2.3 2.3 0 0 0 2.3 2.3h12.4a2.3 2.3 0 0 0 2.3-2.3v-2.2" />
          </svg>
          <div className="drop-title">Drop your footage here</div>
          <div className="drop-sub">or click to choose — if one video came out as several clips, drop them all</div>
        </button>
      )}

      {problem && (
        <div className="import-tray">
          <div className="import-problem">✕ {problem}</div>
        </div>
      )}

      {/* ---- before he has said go: the files, as files ---- */}
      {queued.length > 0 && (phase === "choosing" || phase === "uploading") && (
        <div className="import-tray">
          <div className="import-head">
            <b>{queued.length} file{queued.length === 1 ? "" : "s"} to import</b>
            {dupes > 0 && <span className="import-dupe">{dupes} already imported</span>}
            {rejects > 0 && <span className="import-dupe">{rejects} not video</span>}
            <button className="btn btn-ghost btn-sm" onClick={startOver} disabled={busy}>Clear</button>
            <button className="btn btn-primary btn-sm" onClick={lookAtThem} disabled={busy || importable === 0}>
              {busy ? "Reading them…" : importable === 1 ? "Read this clip" : `Read these ${importable} clips`}
            </button>
          </div>
          {queued.map((q, i) => (
            <div className={`import-row ${q.status}`} key={`${q.name}-${i}`}>
              {q.status === "uploading" && (
                <span className="import-fill" style={{ width: `${q.pct ?? 0}%` }} />
              )}
              <span className="import-name mono">{q.name}</span>
              <span className="import-size mono">{mb(q.file.size)}</span>
              <span className="import-status">
                {q.status === "duplicate" && `⚠ ${q.message}`}
                {q.status === "ready" && "ready"}
                {q.status === "uploading" &&
                  (q.pct === undefined ? "copying…"
                   : q.pct < 100 ? `copying ${q.pct}%`
                   : "filing it away…")}
                {q.status === "done" && "✓ copied"}
                {q.status === "error" && `✕ ${q.message ?? "failed"}`}
                {q.status === "rejected" && `✕ ${q.message}`}
              </span>
            </div>
          ))}
          {phase === "choosing" && importable > 1 && (
            <div className="import-foot">
              Nothing is imported yet. SnipAi listens to each clip first, then shows you
              which of them it thinks are one video — you decide before anything is cut.
            </div>
          )}
        </div>
      )}

      {/* ---- listening ---- */}
      {phase === "analysing" && (
        <div className="import-tray">
          <div className="import-head">
            <b>Working out what these clips are…</b>
          </div>
          <div className="import-bar">
            <span className="import-bar-fill" style={{ width: `${job?.progress ?? 2}%` }} />
          </div>
          <div className="import-foot">
            {job?.stage ?? "listening to each clip"}
            {eta(job?.etaSeconds) ? ` — ${eta(job?.etaSeconds)}` : ""}
          </div>
          <div className="import-foot dim">
            Transcribing is the slow part. It is what tells an interrupted take from
            the next video, so it happens before anything is decided.
          </div>
        </div>
      )}

      {/* ---- the proposal ---- */}
      {phase === "proposing" && proposal && (
        <div className="import-tray">
          <div className="import-head">
            <b>
              {groups.length === 1
                ? "This looks like one video"
                : `This looks like ${groups.length} videos`}
            </b>
            <span className="import-dupe subtle">
              {state?.batch.files.length} clip{state?.batch.files.length === 1 ? "" : "s"}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={startOver} disabled={busy}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={confirmGroups} disabled={busy}>
              {busy ? "Importing…" : groups.length === 1 ? "Import it" : `Import ${groups.length} projects`}
            </button>
          </div>

          {proposal.needsYourEye.length > 0 && (
            <div className="import-eye">
              <b>Worth your eye</b>
              {proposal.needsYourEye.map((s) => (
                <div key={`${s.from}-${s.to}`} className="import-eye-row">
                  <span className="mono">{s.from} → {s.to}</span>: {s.reasons.join(". ")}.
                  {" "}{s.verdict === "same"
                    ? "Joined below, but only just — split them if they are two videos."
                    : "Kept separate for now — join them below if they are one video."}
                </div>
              ))}
            </div>
          )}

          {groups.map((g, i) => {
            const card = cardFor(g);
            /* A duration is only shown while the card is still the one that
               was proposed. The moment he merges or splits, the total the
               server measured is a total of different clips -- and a number
               that is quietly about something else is worse than no number. */
            const asProposed =
              card !== null &&
              card.files.length === g.files.length &&
              card.files.every((f, n) => f === g.files[n]);
            const total = asProposed ? card.totalDurationSec : null;
            const split = card?.separatedBy ?? null;
            return (
              <div key={`${g.project}-${i}`}>
                {i > 0 && (
                  <div className="import-split">
                    <span className="import-split-line" />
                    <span className="import-split-why">
                      {/* `decidedBy`, not `reasons[0]`. `reasons[0]` was
                          always the continuity sentence -- the same words
                          above this `separate` verdict as above the `same`
                          verdict on the seam below, with the deciding reason
                          at `reasons[1]` both times. A line that does not
                          change with the outcome explains nothing about it
                          (ledger C37). */}
                      {split ? split.decidedBy : "kept as separate videos"}
                      {split && !split.confident && (
                        <span className="import-close-call"> — a close call</span>
                      )}
                    </span>
                    <button className="btn btn-ghost btn-xs" onClick={() => mergeWithNext(i - 1)} disabled={busy}>
                      Actually one video
                    </button>
                  </div>
                )}
                <div className={`import-card${card?.blocker ? " blocked" : ""}`}>
                  <div className="import-card-head">
                    <input
                      className="import-name-input mono"
                      value={g.project}
                      onChange={(e) => rename(i, e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                      aria-label={`Name for the project made from ${g.files[0]}`}
                      disabled={busy}
                    />
                    <span className="import-card-meta">
                      {g.files.length === 1 ? "1 clip" : `${g.files.length} clips joined end to end`}
                      {total !== null ? ` · ${clock(total)}` : ""}
                    </span>
                  </div>

                  {g.files.map((f, k) => (
                    <div key={f}>
                      {k > 0 && (
                        <div className="import-seam">
                          <span className="import-seam-why">
                            {seamFor(g.files[k - 1], f)?.decidedBy ?? "joined because you said so"}
                            {seamFor(g.files[k - 1], f)?.confident === false && (
                              <span className="import-close-call"> — a close call</span>
                            )}
                          </span>
                          <button className="btn btn-ghost btn-xs" onClick={() => splitAt(i, k)} disabled={busy}>
                            Split here
                          </button>
                        </div>
                      )}
                      <div className="import-row plain">
                        <span className="import-name mono">{f}</span>
                        <span className="import-size mono">{mb(sizeOf(f))}</span>
                        <span className="import-status">
                          {k === 0 && g.files.length > 1 ? "first" : ""}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Both of these are facts about the clips the SERVER put
                      in this card, so they are only shown while that is still
                      what the card holds. */}
                  {asProposed && card.blocker && (
                    <div className="import-problem">
                      ✕ {card.blocker}
                    </div>
                  )}
                  {asProposed && card.interleaved && (
                    <div className="import-foot dim">
                      These were filmed with another video in between them.
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {proposal.notTranscribed.length > 0 && (
            <div className="import-foot dim">
              Nothing could be heard in {proposal.notTranscribed.join(", ")}, so the seams
              either side of it are a guess rather than an answer.
            </div>
          )}
        </div>
      )}

      {/* ---- building ---- */}
      {phase === "importing" && (
        <div className="import-tray">
          <div className="import-head">
            <b>Importing{state?.batch.imported?.length ? ` — ${state.batch.imported.map((im) => im.project).join(", ")}` : ""}…</b>
          </div>
          <div className="import-bar">
            <span className="import-bar-fill" style={{ width: `${job?.progress ?? 2}%` }} />
          </div>
          <div className="import-foot">
            {job?.stage ?? "joining the clips"}
            {eta(job?.etaSeconds) ? ` — ${eta(job?.etaSeconds)}` : ""}
          </div>
          <div className="import-foot dim">
            You can leave this page — it keeps going, and the queue above shows it.
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => accept(e.target.files)}
      />
    </>
  );
}

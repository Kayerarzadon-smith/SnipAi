"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isVideoName, projectNameFor } from "@/lib/videoFiles";
import { useRouter } from "next/navigation";

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

/* projectNameFor moved to lib/videoFiles.ts: a proposed GROUP of clips is
   named the same way (DOCKET M0.8), and two copies of that rule would let the
   tray promise a project name the import does not produce. */

function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Send the file as a raw body, with progress.
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
  project: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<{ ok: boolean; body: { project?: string; error?: string } }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/projects");
    xhr.setRequestHeader("x-snipai-project", project);
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
      let body: { project?: string; error?: string } = {};
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
 * Drag anywhere on the page. The zone only appears while a file is actually
 * over the window -- a permanent dropbox on a queue that already has projects
 * is dead space. When the queue is empty it renders inline instead, because
 * then dropping footage is the only thing worth doing.
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
     the second half of a double-click arrives — so both clicks ran importAll,
     both POSTed the same file, and the loser came back 409 "project already
     exists". An error row, for pressing the button the way people press
     buttons. */
  const importing = useRef(false);

  async function importAll() {
    if (importing.current) return;
    importing.current = true;
    setBusy(true);
    for (let i = 0; i < queued.length; i++) {
      const item = queued[i];
      if (item.status === "duplicate" || item.status === "done" || item.status === "rejected") continue;
      setQueued((q) => q.map((x, n) => (n === i ? { ...x, status: "uploading", pct: 0 } : x)));
      const { ok, body } = await upload(
        projectNameFor(item.name), item.file,
        (pct) => setQueued((q) => q.map((x, n) => (n === i ? { ...x, pct } : x))));

      // Dropping footage should be the whole instruction. Kick the pipeline
      // off here so it starts transcribing, drafting and cutting on its own --
      // one job, one bar, no clicking through four steps. It queues, so a
      // batch of five starts the first and the rest wait their turn.
      if (ok && body.project) {
        fetch(`/api/projects/${body.project}/pipeline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "auto" }),
        }).catch(() => {});
      }
      setQueued((q) =>
        q.map((x, n) =>
          n === i
            ? { ...x, status: ok ? "done" : "error", pct: undefined,
                message: ok ? undefined : body.error }
            : x
        )
      );
    }
    setBusy(false);
    importing.current = false;
    router.refresh();
  }

  const importable = queued.filter((q) => q.status === "ready").length;
  const dupes = queued.filter((q) => q.status === "duplicate").length;
  const rejects = queued.filter((q) => q.status === "rejected").length;

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
            <div className="drop-sub">Drop several at once — they queue up</div>
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
          <div className="drop-sub">or click to choose — several at once is fine</div>
        </button>
      )}

      {queued.length > 0 && (
        <div className="import-tray">
          <div className="import-head">
            <b>{queued.length} file{queued.length === 1 ? "" : "s"} to import</b>
            {dupes > 0 && <span className="import-dupe">{dupes} already imported</span>}
            {rejects > 0 && <span className="import-dupe">{rejects} not video</span>}
            <button className="btn btn-ghost btn-sm" onClick={() => setQueued([])} disabled={busy}>Clear</button>
            <button className="btn btn-primary btn-sm" onClick={importAll} disabled={busy || importable === 0}>
              {busy ? "Importing…" : `Import ${importable}`}
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
                {q.status === "ready" && `→ ${projectNameFor(q.name)}`}
                {q.status === "uploading" &&
                  (q.pct === undefined ? "importing…"
                   : q.pct < 100 ? `copying ${q.pct}%`
                   : "filing it away…")}
                {q.status === "done" && "✓ imported"}
                {q.status === "error" && `✕ ${q.message ?? "failed"}`}
                {q.status === "rejected" && `✕ ${q.message}`}
              </span>
            </div>
          ))}
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

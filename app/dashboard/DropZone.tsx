"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Existing = { project: string; name: string; size: number }[];

type Queued = {
  file: File;
  name: string;
  status: "ready" | "duplicate" | "uploading" | "done" | "error" | "rejected";
  duplicateOf?: string;
  message?: string;
};

/** "IMG_9817.MOV" -> "img-9817" */
function projectNameFor(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "untitled"
  );
}

function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
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
      const isVideo = (f: File) => /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(f.name);
      // Non-video files used to be filtered out silently -- drop five things,
      // see three, and never learn what happened to the other two.
      const rejected = all.filter((f) => !isVideo(f)).map((file) => ({
        file,
        name: file.name,
        status: "rejected" as const,
        message: "not a video file",
      }));
      const vids = all.filter(isVideo);
      setQueued([
        ...rejected,
        ...vids.map((file) => {
          // same name, or same size under a different name -- both are the
          // same footage arriving twice
          const dupe =
            existing.find((e) => e.name.toLowerCase() === file.name.toLowerCase()) ??
            existing.find((e) => e.size === file.size);
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

  async function importAll() {
    setBusy(true);
    for (let i = 0; i < queued.length; i++) {
      const item = queued[i];
      if (item.status === "duplicate" || item.status === "done" || item.status === "rejected") continue;
      setQueued((q) => q.map((x, n) => (n === i ? { ...x, status: "uploading" } : x)));
      const form = new FormData();
      form.append("name", projectNameFor(item.name));
      form.append("file", item.file);
      const res = await fetch("/api/projects", { method: "POST", body: form });
      const ok = res.ok;
      const body = await res.json().catch(() => ({}));

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
          n === i ? { ...x, status: ok ? "done" : "error", message: ok ? undefined : body.error } : x
        )
      );
    }
    setBusy(false);
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
              <span className="import-name mono">{q.name}</span>
              <span className="import-size mono">{mb(q.file.size)}</span>
              <span className="import-status">
                {q.status === "duplicate" && `⚠ ${q.message}`}
                {q.status === "ready" && `→ ${projectNameFor(q.name)}`}
                {q.status === "uploading" && "importing…"}
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

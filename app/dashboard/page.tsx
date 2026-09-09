import Link from "next/link";
import { summarizeAllProjects } from "@/lib/projectSummary";
import { runningJob } from "@/lib/jobs";
import { DropZone } from "./DropZone";
import RemoveProject from "./RemoveProject";
import RecentlyDeleted from "./RecentlyDeleted";
import LiveProgress from "./LiveProgress";
import FreshOnArrival from "./FreshOnArrival";

export const dynamic = "force-dynamic";

function statusPill(status: string, flaggedCount: number, hasTranscript: boolean, beatCount: number) {
  if (status === "approved") return <span className="pill good"><span className="dot" />Approved</span>;
  if (status === "needs_fixes") return <span className="pill critical"><span className="dot" />Needs fixes</span>;
  if (status === "trashed") return <span className="pill faint"><span className="dot" />Trashed</span>;
  if (beatCount === 0) return <span className="pill warn"><span className="dot" />Beat draft</span>;
  if (!hasTranscript) return <span className="pill faint"><span className="dot" />Unscored</span>;
  if (flaggedCount > 0) return <span className="pill warn"><span className="dot" />{flaggedCount} flagged</span>;
  return <span className="pill good"><span className="dot" />Ready to review</span>;
}

/** 526.4 -> "8m 46s" · 47.2 -> "47.2s" */
function dur(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

export default function DashboardPage() {
  const projects = summarizeAllProjects();
  const busy = runningJob();

  const live = projects.filter((p) => p.cutStatus !== "trashed");
  const ordered = [...projects].sort(
    (a, b) => Number(a.cutStatus === "trashed") - Number(b.cutStatus === "trashed")
  );
  const needsApproval = projects.filter((p) => p.cutStatus === "unreviewed" || p.cutStatus === "needs_fixes").length;
  const approved = projects.filter((p) => p.cutStatus === "approved").length;
  const draftBeats = projects.filter((p) => p.beatCount === 0).length;
  const totalRemoved = projects.reduce((sum, p) => sum + (p.removedSeconds ?? 0), 0);
  // every file already imported, so a re-drop can be caught before uploading
  const existingRaw = projects.flatMap((p) =>
    p.rawFiles.map((f) => ({ project: p.title, name: f.name, size: f.size }))
  );

  return (
    <>
      <FreshOnArrival />
      <section>
      <div className="page-head">
        <div>
          <h1>Production queue</h1>
          <p>Everything waiting on your review, pulled live from your projects folder.</p>
        </div>
      </div>

      <DropZone
        existing={existingRaw}
        emptyQueue={projects.length === 0}
        summary={
          <>
            <b>{projects.length}</b> project{projects.length === 1 ? "" : "s"}
            {needsApproval > 0 && <> · <b className="needs">{needsApproval} need{needsApproval === 1 ? "s" : ""} your review</b></>}
            {draftBeats > 0 && <> · {draftBeats} awaiting a beat draft</>}
            {approved > 0 && <> · {approved} approved</>}
            {totalRemoved > 0 && <> · <b className="cut-total">{dur(totalRemoved)} cut</b></>}
          </>
        }
      />

      <div className="section-head">
        <h2>Projects</h2>
        <span className="mono count">{live.length} active</span>
      </div>

      {projects.length === 0 ? (
        <div className="empty-hint">Nothing in the queue yet.</div>
      ) : (
        <div className="queue">
          {ordered.map((p) => {
            const working = busy?.project === p.name;
            const trashed = p.cutStatus === "trashed";
            return (
              <Link className={`qcard${trashed ? " trashed" : ""}`} key={p.name} href={`/projects/${p.name}/review`}>
                <div className="qcard-top">
                  <div className="thumb">
                    {p.hasRawFootage || p.cutFile ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={`/api/projects/${p.name}/poster`} alt="" loading="lazy" />
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6.5 4.8v10.4l9-5.2z" /></svg>
                    )}
                  </div>
                  <div className="meta">
                    <div className="title">{p.title}</div>
                    <div className="sub mono">
                      {p.beatCount} beats
                      {p.cutFile ? ` · ${p.cutFile}` : " · no cut built yet"}
                    </div>
                    {p.removedSeconds !== null && (
                      <div className="cut-stat mono">
                        {dur(p.sourceSeconds)} → {dur(p.cutSeconds)}
                        <span className="cut-saved">− {dur(p.removedSeconds)} cut</span>
                      </div>
                    )}
                  </div>
                  {statusPill(p.cutStatus, p.flaggedBeatLabels.length, p.hasTranscript, p.beatCount)}
                  <span className="btn btn-primary">Open</span>
                  <RemoveProject name={p.name} title={p.title} hasRawFootage={p.hasRawFootage} />
                </div>

                {!trashed && (working ? (
                  <LiveProgress project={p.name} />
                ) : (
                  <div className="progress">
                    <div className="progress-head">
                      <span className="progress-next">{p.nextStep}</span>
                      <span className="progress-pct mono">{p.progressPct}%</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${p.progressPct}%` }} />
                    </div>
                  </div>
                ))}
              </Link>
            );
          })}
        </div>
      )}

      <RecentlyDeleted />
    </section>
    </>
  );
}

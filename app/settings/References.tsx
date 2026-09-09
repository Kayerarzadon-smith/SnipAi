"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Ref = {
  file: string; bytes: number; measuredAt?: string;
  duration?: number; segments?: number; seconds_per_cut?: number; words_per_second?: number;
};
type Target = {
  duration?: number; segments?: number; seconds_per_cut?: number;
  words_per_second?: number; references_analysed?: number; updated?: string;
};

const mb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

/**
 * Videos to learn a style from.
 *
 * These aren't your footage — they're finished videos whose rhythm you want
 * to hit. Each is measured for cut rate, shot length and delivery speed, and
 * the median across them becomes the target the drafter aims at and the
 * scorecard checks against.
 */
export default function References() {
  const [refs, setRefs] = useState<Ref[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ status: string; progress?: number; stage?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/references");
    if (!res.ok) return;
    const d = await res.json();
    setRefs(d.references ?? []);
    setTarget(d.target ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    // Every refusal, not the last one. setError per file meant picking two
    // bad files reported one of them and the other vanished without a word --
    // and you cannot tell "rejected silently" from "accepted" by looking.
    const refused: string[] = [];
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/references", { method: "PUT", body: fd });
      if (!res.ok) {
        refused.push((await res.json().catch(() => ({}))).error ?? `could not add ${f.name}`);
      }
    }
    if (refused.length) setError(refused.join(" · "));
    setBusy(false);
    await load();
  }

  function watch(jobId: string) {
    const tick = async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      if (!r.ok) { setBusy(false); return; }
      const j = await r.json();
      setJob(j);
      if (j.status === "running") { setTimeout(tick, 800); return; }
      setBusy(false);
      if (j.status !== "done") setError(j.error ?? "measuring failed");
      await load();
    };
    tick();
  }

  async function measure() {
    setBusy(true); setError(null); setJob(null);
    const res = await fetch("/api/references", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "measure" }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 202) { watch(body.jobId); return; }
    setBusy(false);
    setError(body.error ?? "could not start");
  }

  async function remove(file: string) {
    await fetch("/api/references", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", file }),
    });
    await load();
  }

  const unmeasured = refs.filter((r) => !r.measuredAt).length;

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 9 }}>Videos to learn the style from</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12, lineHeight: 1.55 }}>
          Drop in finished videos whose pacing you want to hit — other people&apos;s work is fine,
          it&apos;s only measured, never used. SnipAi reads how often they cut, how long each shot
          runs and how fast the delivery is, and aims your edits at the middle of them.
        </p>
        <div className="ref-actions">
          <button className="ui-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            Add reference videos
          </button>
          <button className="ui-btn ui-btn-primary" disabled={busy || refs.length === 0} onClick={measure}>
            {busy && job ? "Measuring…" : unmeasured ? `Measure ${unmeasured} new` : "Re-measure all"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={(e) => { add(e.target.files); e.target.value = ""; }}
          />
        </div>

        {job && job.status === "running" && (
          <div className="jobbar" style={{ marginTop: 14 }}>
            <div className="jobbar-track">
              <div className="jobbar-fill" style={{ width: `${job.progress ?? 0}%` }} />
            </div>
            <div className="jobbar-row">
              <span className="jobbar-stage">{job.stage ?? "starting…"}</span>
              <span className="jobbar-num mono">{job.progress ?? 0}%</span>
            </div>
          </div>
        )}
        {error && <div className="gfx-error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {target && target.references_analysed ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginBottom: 9 }}>What SnipAi is aiming at</h3>
          <div className="ref-grid">
            <div><b>{target.seconds_per_cut ?? "—"}s</b><span>between cuts</span></div>
            <div><b>{target.segments ?? "—"}</b><span>cuts per video</span></div>
            <div><b>{target.duration ?? "—"}s</b><span>finished length</span></div>
            <div><b>{target.words_per_second ?? "—"}</b><span>words per second</span></div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
            Median of {target.references_analysed} reference
            {target.references_analysed === 1 ? "" : "s"}. Captions and music can&apos;t be measured
            from a finished file — those stay as you set them.
          </p>
        </div>
      ) : null}

      <div className="pref-group">
        <h3>References ({refs.length})</h3>
        {refs.length === 0 && (
          <div className="pref-item off"><span>None yet — add a few videos you want to sound like.</span></div>
        )}
        {refs.map((r) => (
          <div className="ref-row" key={r.file}>
            <div className="ref-name">
              {r.file}
              <span className="ref-meta mono">
                {mb(r.bytes)}
                {r.measuredAt
                  ? ` · ${r.seconds_per_cut ?? "?"}s/cut · ${r.words_per_second ?? "?"} w/s`
                  : " · not measured yet"}
              </span>
            </div>
            <button className="ui-btn ui-btn-sm ui-btn-quiet" onClick={() => remove(r.file)}>Remove</button>
          </div>
        ))}
      </div>
    </>
  );
}

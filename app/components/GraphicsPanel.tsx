"use client";

import { useCallback, useEffect, useState } from "react";

export type Graphic = {
  id: string;
  type: "definition" | "stat" | "callout" | "emphasis" | "lower_third" | "ai_overlay";
  start: number;
  end: number;
  enabled?: boolean;
  why?: string;
  verified?: boolean;
  term?: string;
  prompt?: string;
  region?: string;
  definition?: string;
  value?: string;
  caption?: string;
  text?: string;
  title?: string;
  subtitle?: string;
};

const LABEL: Record<Graphic["type"], string> = {
  definition: "Definition card",
  stat: "Stat",
  callout: "Callout",
  emphasis: "Emphasis",
  lower_third: "Lower third",
  ai_overlay: "AI shot — needs generating",
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

function headline(g: Graphic) {
  return g.region ?? g.term ?? g.value ?? g.text ?? g.title ?? "";
}

/**
 * Motion graphics, proposed and then approved.
 *
 * Nothing here is burned in until it's switched on and, for definitions,
 * confirmed -- those are claims about ingredients going onto a public product
 * video, and the drafts in the glossary have not been checked against
 * anything. Editing the wording is what marks one as yours.
 */
export default function GraphicsPanel({
  project,
  hasCut,
  refreshKey,
  onCount,
  onSeek,
  onJob,
}: {
  project: string;
  hasCut: boolean;
  /** bumped when a graphic is added elsewhere, so the list picks it up */
  refreshKey?: number;
  /** how many are proposed, so a collapsed panel can still say so */
  onCount?: (n: number | null) => void;
  onSeek: (cutTime: number) => void;
  onJob: (jobId: string) => void;
}) {
  const [graphics, setGraphics] = useState<Graphic[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [job, setJob] = useState<{ status: string; step: string; log: string[]; error?: string; resultCutFile?: string; progress?: number; stage?: string; etaSeconds?: number } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${project}/graphics`);
    if (!res.ok) return;
    const d = await res.json();
    setGraphics(d.graphics ?? []);
  }, [project]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { onCount?.(graphics === null ? null : graphics.length); },
            [graphics, onCount]);

  async function patch(id: string, p: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/projects/${project}/graphics`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, patch: p }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "could not save");
    await load();
  }

  /** Watch a job to the end, so this panel can say what is happening rather
   *  than leaving the work invisible until a file quietly appears. */
  function watch(jobId: string) {
    const tick = async () => {
      const r = await fetch(`/api/projects/${project}/pipeline/jobs/${jobId}`);
      if (!r.ok) { setBusy(false); return; }
      const j = await r.json();
      setJob(j);
      if (j.status === "running") { setTimeout(tick, 700); return; }
      setBusy(false);
      if (j.status === "failed") setError(j.error ?? "the render failed");
      await load();
    };
    tick();
  }

  async function run(action: "plan" | "render", allowUnverified = false) {
    setBusy(true);
    setError(null);
    setJob(null);
    const res = await fetch(`/api/projects/${project}/graphics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, allowUnverified }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 202) { watch(body.jobId); onJob(body.jobId); return; }
    setBusy(false);
    if (body.unverified?.length) {
      const names = body.unverified.map((u: { term?: string }) => u.term).join(", ");
      setError(`${names} still need approving below — use “Wording is right”, reword, or switch them off.`);
      return;
    }
    setError(body.error ?? `could not ${action}`);
  }

  const on = (graphics ?? []).filter((g) => g.enabled !== false && g.type !== "ai_overlay");
  const asks = (graphics ?? []).filter((g) => g.type === "ai_overlay");
  const unchecked = on.filter((g) => g.type === "definition" && g.verified === false);

  return (
    <div className="gfx">
      <div className="gfx-head">
        <div>
          <p>
            {graphics === null
              ? "Loading…"
              : graphics.length === 0
                ? "None proposed yet — SnipAi reads the finished cut and suggests where a card belongs."
                : `${on.length} of ${graphics.length - asks.length} switched on`
                  + (asks.length ? ` · ${asks.length} shot${asks.length === 1 ? "" : "s"} to generate` : "")}
          </p>
        </div>
        <div className="gfx-actions">
          <button className="ui-btn ui-btn-sm" disabled={!hasCut || busy} onClick={() => run("plan")}>
            {graphics?.length ? "Re-scan cut" : "Find graphics"}
          </button>
          <button
            className="ui-btn ui-btn-sm ui-btn-primary"
            disabled={!hasCut || busy || on.length === 0}
            onClick={() => run("render")}
          >
            Burn in {on.length ? `(${on.length})` : ""}
          </button>
        </div>
      </div>

      {job && (
        <div className={`gfx-status ${job.status}`}>
          <span className="gfx-spin" aria-hidden />
          <div>
            <b>
              {job.status === "running"
                ? job.step === "plan-graphics" ? "Reading the cut for places a graphic belongs…"
                  : "Applying graphics to the video…"
                : job.status === "done"
                  ? job.step === "plan-graphics" ? "Scan finished" : "Graphics applied"
                  : "That didn’t finish"}
            </b>
            {job.status === "running" && (
              <div className="jobbar" style={{ marginTop: 6 }}>
                <div className="jobbar-track">
                  <div className={`jobbar-fill${job.progress === undefined ? " indeterminate" : ""}`}
                       style={job.progress !== undefined ? { width: `${job.progress}%` } : undefined} />
                </div>
              </div>
            )}
            <div className="gfx-status-line mono">
              {job.status === "done" && job.resultCutFile
                ? `→ ${job.resultCutFile} — switch the player to “With graphics” to watch it`
                : (job.log?.[job.log.length - 1] ?? "starting…")}
            </div>
          </div>
        </div>
      )}

      {error && <div className="gfx-error">{error}</div>}

      {unchecked.length > 0 && (
        <div className="gfx-warn">
          <div>
            <b>
              {unchecked.length} definition{unchecked.length === 1 ? "" : "s"} still need
              {unchecked.length === 1 ? "s" : ""} your eyes:{" "}
              {unchecked.map((g) => g.term).join(", ")}
            </b>
            <div style={{ marginTop: 4 }}>
              SnipAi drafted these and they haven&apos;t been checked against any source. They&apos;d go
              on a public product video, so read each one — then approve it, reword it, or switch it off.
            </div>
          </div>
          <button
            className="ui-btn ui-btn-sm"
            title="Confirm every remaining definition as written"
            onClick={async () => {
              for (const g of unchecked) await patch(g.id, { verified: true });
            }}
          >
            I&apos;ve read them all
          </button>
        </div>
      )}

      <div className="gfx-list">
        {(graphics ?? []).map((g) => {
          const isOn = g.enabled !== false;
          const needsCheck = g.type === "definition" && g.verified === false;
          return (
            <div key={g.id} className={`gfx-item${isOn ? "" : " off"}`}>
              <label className="gfx-toggle" title={isOn ? "switched on" : "switched off"}>
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={(e) => patch(g.id, { enabled: e.target.checked })}
                />
              </label>
              <button className="gfx-time mono" onClick={() => onSeek(g.start)} title="jump to where this appears">
                {fmt(g.start)}
              </button>
              <div className="gfx-body">
                <div className="gfx-line">
                  <span className="gfx-kind">{LABEL[g.type]}</span>
                  <b>{headline(g)}</b>
                  {needsCheck && <span className="gfx-flag">unchecked</span>}
                </div>
                {g.type === "definition" && (
                  editing === g.id ? (
                    <div className="gfx-edit">
                      <textarea
                        className="textline"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={2}
                      />
                      <div className="gfx-edit-bar">
                        <button className="ui-btn ui-btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                        <button
                          className="ui-btn ui-btn-sm ui-btn-primary"
                          onClick={async () => { await patch(g.id, { definition: draft }); setEditing(null); }}
                        >
                          Save — this is my wording
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="gfx-def">{g.definition}</div>
                      <div className="gfx-defbar">
                        {needsCheck && (
                          <button
                            className="ui-btn ui-btn-sm ui-btn-primary"
                            title="Confirm this wording is right and let it be burned in"
                            onClick={() => patch(g.id, { verified: true })}
                          >
                            Wording is right
                          </button>
                        )}
                        <button
                          className="ui-btn ui-btn-quiet ui-btn-sm"
                          onClick={() => { setEditing(g.id); setDraft(g.definition ?? ""); }}
                        >
                          Reword
                        </button>
                        {!needsCheck && g.type === "definition" && (
                          <span className="gfx-ok">approved</span>
                        )}
                      </div>
                    </>
                  )
                )}
                {g.caption && g.type === "stat" && <div className="gfx-def">{g.caption}</div>}
                {g.type === "ai_overlay" && (
                  <div className="gfx-ai">
                    <div className="gfx-ai-prompt">“{g.prompt}”</div>
                    <div className="gfx-ai-note">
                      SnipAi composites video, it doesn&apos;t generate it — this is a note of
                      what you want and exactly when. Generate the shot elsewhere, then drop
                      it in and SnipAi will place it here.
                    </div>
                  </div>
                )}
                <div className="gfx-marks">
                  <span className="gfx-mark">
                    <b>in</b>
                    <button className="nudge" title="appear earlier"
                            onClick={() => patch(g.id, { start: Math.max(0, g.start - 0.25) })}>−</button>
                    <span className="mono">{fmt(g.start)}</span>
                    <button className="nudge" title="appear later"
                            disabled={g.end - g.start <= 0.65}
                            onClick={() => patch(g.id, { start: g.start + 0.25 })}>+</button>
                  </span>
                  <span className="gfx-mark">
                    <b>out</b>
                    <button className="nudge" title="leave sooner"
                            disabled={g.end - g.start <= 0.65}
                            onClick={() => patch(g.id, { end: g.end - 0.25 })}>−</button>
                    <span className="mono">{fmt(g.end)}</span>
                    <button className="nudge" title="stay longer"
                            onClick={() => patch(g.id, { end: g.end + 0.25 })}>+</button>
                  </span>
                  <span className="gfx-dur mono">on screen {(g.end - g.start).toFixed(1)}s</span>
                </div>
                {g.why && <div className="gfx-why">{g.why}</div>}
                <button
                  className="ui-btn ui-btn-quiet ui-btn-sm gfx-remove"
                  title="Remove this graphic from the plan"
                  onClick={async () => {
                    await fetch(`/api/projects/${project}/graphics`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "delete", id: g.id }),
                    });
                    await load();
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

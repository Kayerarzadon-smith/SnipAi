"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Job = {
  id: string; project: string; step: string; status: string;
  progress?: number; stage?: string; etaSeconds?: number;
};

/**
 * What the machine is doing, right now, in words.
 *
 * The verbs are derived from the actual log line the tool just printed -- not
 * a decorative cycle. If it says "Snipping" it is genuinely cutting clips.
 * The one liberty taken is rotating between the phrasings that legitimately
 * describe the current phase, so a nine-minute job doesn't sit on one frozen
 * word and read as a hang.
 */
const PHASES: { match: RegExp; words: string[] }[] = [
  { match: /transcrib/i,            words: ["Transcribing", "Listening", "Writing down every word"] },
  { match: /silence|room tone/i,    words: ["Mapping the silence", "Finding the pauses", "Listening for dead air"] },
  { match: /edit list|build_cut/i,  words: ["Planning the edit", "Choosing the takes"] },
  { match: /snipping|extract/i,     words: ["Snipping", "Cutting the clips", "Pulling the pieces"] },
  { match: /stitch|concat/i,        words: ["Stitching", "Editing it together", "Assembling the cut"] },
  { match: /graphic/i,              words: ["Drawing the graphics", "Laying on the cards"] },
  { match: /take|beat|draft/i,      words: ["Choosing the takes", "Editing", "Dropping the bad takes"] },
  { match: /render|encod|final/i,   words: ["Rendering", "Writing the file"] },
  { match: /verify|check/i,         words: ["Checking it back", "Listening for repeats"] },
  { match: /proxy|scale|transcod/i, words: ["Shrinking", "Making it quick to scrub"] },
];

function phaseFor(job: Job): string[] {
  const hay = `${job.stage ?? ""} ${job.step}`;
  for (const p of PHASES) if (p.match.test(hay)) return p.words;
  return ["Working"];
}

function finishAt(sec: number) {
  const d = new Date(Date.now() + sec * 1000);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function LiveProgress({ project }: { project: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [tick, setTick] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/jobs/running");
        if (res.ok) {
          const d = await res.json();
          const j: Job | null = d.job && d.job.project === project ? d.job : null;
          if (alive) {
            setJob((prev) => {
              if (prev && !j) router.refresh();   // it finished: redraw the card
              return j;
            });
          }
        }
      } catch { /* keep polling */ }
      if (alive) setTimeout(poll, 900);
    };
    poll();
    return () => { alive = false; };
  }, [project, router]);

  // rotate the phrasing so a long phase doesn't look frozen
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => setTick((n) => n + 1), 2400);
    return () => clearInterval(t);
  }, [job]);

  if (!job) return null;
  const words = phaseFor(job);
  const word = words[tick % words.length];
  const pct = job.progress;

  return (
    <div className="progress working">
      <div className="progress-head">
        <span className="progress-next">{word}…</span>
        <span className="progress-pct mono">
          {pct !== undefined ? `${pct}%` : ""}
          {job.etaSeconds !== undefined && (
            <span className="progress-eta"> · done ~{finishAt(job.etaSeconds)}</span>
          )}
        </span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill working${pct === undefined ? " indeterminate" : ""}`}
          style={pct !== undefined ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

"use client";

import Overlay from "@/app/components/Overlay";
import TrimWave from "@/app/components/TrimWave";
import Timeline, { layout } from "@/app/components/Timeline";
import { resolveSpanDelete } from "@/lib/timelineLayout";
import { followScroll, revealScroll, isFollowing, type ScrollRequest } from "@/lib/follow";
import GraphicsPanel from "@/app/components/GraphicsPanel";
import VoiceInput from "@/app/components/VoiceInput";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import type {
  Beat,
  ReviewState,
  Scorecard,
  CandidateTakesResult,
  CutStatus,
} from "@/lib/types";
import type { WordBoundaryFlag } from "@/lib/scorecard";
import type { Job } from "@/lib/jobs";
import type { Snapshot } from "@/lib/snapshots";

type Detail = {
  project: string;
  beats: Beat[];
  source: string;
  notes?: string;
  reviewState: ReviewState;
  cutFile: string | null;
  graphicsFile: string | null;
  sourceProxy: string | null;
  cutStale: boolean;
  hasSource: boolean;
  words: { w: string; s: number; e: number }[];
  edl: { label: string; src_start: number; src_end: number; dur: number }[];
  scorecard: Scorecard;
  wordBoundaryFlags: WordBoundaryFlag[];
  hasTranscript: boolean;
  cutTimeline?: { label: string; start: number; end: number }[];
  beatAnalysis?: Record<string, { confidence: number; attempts: number; needs_review?: boolean; why?: string[] }>;
};

const DIAGNOSIS_CHECKS = [
  "Wrong take",
  "Started too early / too late",
  "Awkward pause",
  "Repeated / stuttered",
  "Bad delivery",
  "Audio or video problem",
];

function CheckIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 10.5l4 4 8-9" /></svg>;
}
function FlagIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M10 3.5l7.5 13H2.5z" /><path d="M10 8.3v3.6" /><circle cx="10" cy="13.6" r=".35" fill="currentColor" /></svg>;
}
function DotIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="3" /></svg>;
}

/** "about 2m 40s left" reads better than 160 seconds. */
function fmtEta(sec: number) {
  if (sec < 45) return "under a minute";
  const m = Math.round(sec / 60);
  return m <= 1 ? "a minute" : `${m} minutes`;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

export default function ReviewPage({ params }: { params: { project: string } }) {
  const { project } = params;
  const [data, setData] = useState<Detail | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [level2Open, setLevel2Open] = useState(false);
  const [takePickerBeat, setTakePickerBeat] = useState<Beat | null>(null);
  const [candidates, setCandidates] = useState<CandidateTakesResult | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [learnAfterBeat, setLearnAfterBeat] = useState<string | null>(null);
  const [learnText, setLearnText] = useState("");
  const [buildJob, setBuildJob] = useState<Job | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  /* The edit file is there and unreadable -- which is a different thing from
     the project not existing, and the Queue has already said so on its card. */
  const [problem, setProblem] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [trimBeat, setTrimBeat] = useState<string | null>(null);
  const [gfxScanning, setGfxScanning] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Snapshot[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null);
  const [trimSaving, setTrimSaving] = useState(false);
  const [peaks, setPeaks] = useState<{ rate: number; peaks: number[]; rms?: number[] } | null>(null);
  /* Why there is no waveform, when there is no waveform. The fetch swallowed
     its own failure, so the audio track sat on "audio envelope loading…" for
     good -- no message, no retry, and nothing to tell a slow read of a 500MB
     file from one that had already failed twice. */
  const [peaksError, setPeaksError] = useState<string | null>(null);
  const [rawHead, setRawHead] = useState<number | null>(null);
  const [cutMediaDuration, setCutMediaDuration] = useState<number | null>(null);
  const [learned, setLearned] = useState<string[] | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [showGraphics, setShowGraphics] = useState(true);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [undo, setUndo] = useState<{ beat: Beat; at: number } | null>(null);
  const [gfxFor, setGfxFor] = useState<Beat | null>(null);
  const [gfxNonce, setGfxNonce] = useState(0);
  const [learnedOpen, setLearnedOpen] = useState(false);
  /** off switch for the automatic re-render, for when you want to cut in peace */
  const [autoApply, setAutoApply] = useState(true);
  const buildJobRef = useRef<Job | null>(null);
  /** the footage's own shape, so the player is never a letterbox */
  const [shotAspect, setShotAspect] = useState<string | null>(null);
  /** the line being spoken, and which word of it, right now */
  const [spoken, setSpoken] = useState<{ label: string; wordIx: number } | null>(null);
  /** auto-follow gives way the moment you scroll yourself: when you last took
   *  the list over, as a timestamp, asked by lib/follow's isFollowing */
  const yieldedAt = useRef(0);
  const [gfxOpen, setGfxOpen] = useState(false);
  const [gfxCount, setGfxCount] = useState<number | null>(null);

  /** Where this line sits on the finished cut -- a graphic is timed against
   *  the cut, not the source. */
  function cutSpanOf(label: string) {
    const { placed } = layout(data?.beats ?? [], data?.edl);
    const c = placed.find((p) => p.label === label);
    return c ? { start: c.at, end: c.at + c.dur } : null;
  }

  /** Park a request SnipAi can't render against the line it belongs to, so it
   *  is written down rather than quietly dropped. */
  async function saveGraphicNote(b: Beat, text: string) {
    await fetch(`/api/projects/${project}/review-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "level3_diagnosis",
        beatLabel: b.label,
        checks: ["needs-footage"],
        note: `Wanted here: ${text}`,
      }),
    });
    setGfxFor(null);
    await load();
    toast("Saved as a note on this line");
  }

  async function addGraphic(b: Beat, kind: string, copy: Record<string, string>) {
    const span = cutSpanOf(b.label);
    if (!span) { toast("that line isn't in the cut yet"); return; }
    const res = await fetch(`/api/projects/${project}/graphics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        graphic: { type: kind, start: span.start, end: Math.max(span.start + 1.2, span.end + 0.8), ...copy },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast(body.error ?? "could not add that"); return; }
    setGfxFor(null);
    setGfxNonce((n) => n + 1);
    toast(`Graphic added to “${b.text ?? b.label}”`);
  }
  /* Every edit that changes the beat list pushes the list as it was. ⌘Z pops
     one. Snapshots rather than inverse operations: a delete, a split and a
     trim undo by exactly the same move, and there is nothing to get wrong. */
  const [history, setHistory] = useState<{ beats: Beat[]; what: string }[]>([]);
  /** Returns whether it actually pushed, so the caller can take it back. It
   *  declines on an empty beat list, and a drop that assumed otherwise would
   *  eat somebody else's undo step. */
  const pushHistory = useCallback((what: string): boolean => {
    const beats = beatsRef.current;
    if (!beats.length) return false;
    setHistory((h) => [...h.slice(-24), { beats: beats.map((b) => ({ ...b })), what }]);
    return true;
  }, []);

  /** Take back the entry an edit pushed before it turned out to change
   *  nothing. Left in place it is an undo step that undoes to the state you
   *  are already in — you press ⌘Z, nothing moves, and the real edit you
   *  wanted back is one press further away than it looks.
   *
   *  Only ever called with the value pushHistory returned, so it cannot drop
   *  an entry this edit did not add. */
  const dropLastHistory = useCallback((didPush: boolean) => {
    if (didPush) setHistory((h) => h.slice(0, -1));
  }, []);

  async function undoLast() {
    const last = history[history.length - 1];
    if (!last) { toast("Nothing to undo"); return; }
    setHistory((h) => h.slice(0, -1));
    const res = await fetch(`/api/projects/${project}/pipeline`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beats: last.beats }),
    });
    if (!res.ok) { toast("could not undo that"); return; }
    const u = await res.json().catch(() => ({} as { changed?: boolean; unchanged?: string }));
    setUndo(null);
    await load();
    // undoing to the state you are already in wrote nothing; saying "Undid
    // that trim" would be the history moving while the edit did not
    toast(u.changed === false ? (u.unchanged ?? "there was nothing to undo")
                              : `Undid ${last.what}`);
    // An undo changes the edit like any other change, so the render behind it
    // is now wrong. Without this the file on disk kept the thing you undid,
    // and the queue went on advertising it as ready to post.
    if (u.changed !== false) applyEditsSoon();
  }
  /** The timeline's audio track. A long source takes a while to read, so this
   *  is fetched once up front -- and says so when it cannot be had. */
  const loadPeaks = useCallback(async () => {
    setPeaksError(null);
    try {
      const r = await fetch(`/api/projects/${project}/peaks`);
      if (!r.ok) {
        const b = await r.json().catch(() => ({} as { error?: string }));
        setPeaksError(b.error ?? `the waveform could not be read (${r.status})`);
        return;
      }
      const d = await r.json();
      setPeaks({ rate: d.rate, peaks: d.peaks, rms: d.rms });
    } catch {
      setPeaksError("the waveform could not be read");
    }
  }, [project]);

  const [snipPad, setSnipPad] = useState(1);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);

  /** Cut a highlighted stretch out of the middle of a line.
   *
   *  Splitting at both edges and dropping the middle piece is exactly what
   *  "delete this bit" means on a timeline, and it reuses the split and
   *  delete that already exist rather than inventing a third way to edit. */
  async function deleteSelection(b: Beat) {
    if (!selection || selection.to - selection.from < 0.05) {
      toast("drag across a bit more before deleting it");
      return;
    }
    const { from, to } = selection;
    // A highlight that touches an edge isn't a hole to cut, it's a shorter
    // line: move that edge in. Refusing here was wrong -- the commonest cut
    // of all is lopping the start or the end off, and it was the one case
    // the button turned down.
    const headCut = from - b.start < 0.15;
    const tailCut = b.end - to < 0.15;
    if (headCut && tailCut) {
      toast("that's the whole line — use Delete to drop it");
      return;
    }
    if (headCut || tailCut) {
      const pushed = pushHistory("trimming that edge off");
      const next = headCut ? { start: to, end: b.end } : { start: b.start, end: from };
      if (next.end - next.start < 0.15) { toast("that leaves nothing behind"); return; }
      const res0 = await fetch(`/api/projects/${project}/beats/${b.label}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: Math.round(next.start * 1000) / 1000,
          end: Math.round(next.end * 1000) / 1000,
        }),
      });
      if (!res0.ok) { toast((await res0.json().catch(() => ({}))).error ?? "could not trim it"); return; }
      const o0 = await res0.json().catch(() => ({} as { changed?: boolean; unchanged?: string }));
      if (o0.changed === false) {
        dropLastHistory(pushed);
        toast(o0.unchanged ?? "that edge is already there");
        return;
      }
      setSelection(null);
      setTrim(next);
      await load();
      toast(`Cut ${(to - from).toFixed(2)}s off the ${headCut ? "start" : "end"}`);
      learnFromEdits();
    applyEditsSoon();
      return;
    }
    const pushed = pushHistory("cutting that bit out");
    // Record WHAT was cut, not just that something was. The words inside a
    // removed stretch, and how much of it was silence, are what let the
    // drafter make the same cut on its own next time.
    const inside = (data?.words ?? []).filter((w) => w.s >= from - 0.02 && w.e <= to + 0.02);
    const pk = peaks?.peaks;
    const rate = peaks?.rate ?? 800;
    let quiet = 0;
    let total = 0;
    if (pk) {
      for (let i = Math.floor(from * rate); i < Math.floor(to * rate) && i < pk.length; i++) {
        total += 1;
        if (pk[i] < 26) quiet += 1;          // ~ -20dB, the room-tone floor
      }
    }
    fetch(`/api/projects/${project}/review-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "cut_region",
        beatLabel: b.label,
        from: Math.round(from * 1000) / 1000,
        to: Math.round(to * 1000) / 1000,
        words: inside.map((w) => w.w.trim()).filter(Boolean),
        silenceRatio: total ? Math.round((quiet / total) * 100) / 100 : 0,
      }),
    }).catch(() => {});
    /* Punch the region out of the middle of this line and let the picture
       either side close over it. This used to split the beat in two and drop
       the middle, which worked but left two rows saying the same line with a
       seam between them -- one line with a piece taken out is what it
       actually is, so that is what gets stored. */
    const holes = [...(b.holes ?? []), [from, to] as [number, number]];
    const res = await fetch(`/api/projects/${project}/beats/${b.label}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holes }),
    });
    if (!res.ok) {
      toast((await res.json().catch(() => ({}))).error ?? "could not cut there");
      return;
    }
    /* The write can succeed and change nothing: a highlight that lands inside
       footage already cut merges into the hole that is there. Clearing the
       highlight and saying "cut" was the app telling you it had done
       something it had not -- which is exactly what "I press delete and
       nothing happens" looks like from the other side of the screen. The
       highlight stays put so it can be moved, and the reason is said out
       loud. */
    const outcome = await res.json().catch(() => ({} as { changed?: boolean; unchanged?: string }));
    if (outcome.changed === false) {
      dropLastHistory(pushed);
      toast(outcome.unchanged ?? "that stretch is already cut out");
      return;
    }
    setSelection(null);
    await load();
    toast(`Cut out ${(to - from).toFixed(2)}s — the gap closed`);
    learnFromEdits();
    applyEditsSoon();
  }

  /** The triage the old sidebar list was doing: worst line first, then the
   *  next, rather than reading 35 rows to find the two that matter. */
  function nextFlagged() {
    const order = Object.entries(analysis)
      .filter(([, a]) => a.needs_review)
      .sort((a, b) => a[1].confidence - b[1].confidence)
      .map(([label]) => label);
    if (!order.length) return;
    const at = order.indexOf(selectedClip ?? "");
    const label = order[(at + 1) % order.length];
    setSelectedClip(label);
    seekToBeat(label);
    revealRow(label);
  }
  const rawRef = useRef<HTMLVideoElement | null>(null);
  const stopAt = useRef<number | null>(null);
  // Live-edit playback: the raw file plays, jumping beat to beat using the
  // CURRENT in/out points. A trim is audible immediately -- no re-render,
  // because the edit is an instruction over the source, not a baked file.
  const [liveMode, setLiveMode] = useState(false);
  const [liveIdx, setLiveIdx] = useState(0);
  // The raw player has no control bar of its own any more, so whether it is
  // running has to be state -- a ref's .paused does not re-render the button.
  const [livePlaying, setLivePlaying] = useState(false);
  const liveIdxRef = useRef(0);
  const beatsRef = useRef<Beat[]>([]);
  /** the loaded project, for the per-frame loop -- reading state there would
   *  make the callback stale between renders */
  const dataRef = useRef<Detail | null>(null);
  const trimRef = useRef<{ label: string; start: number; end: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /** Jump to a beat in whichever player is showing. In live mode that means
   *  the raw source at this beat's CURRENT in-point, so it reflects trims. */
  function seekToBeat(label: string) {
    const i = (data?.beats ?? []).findIndex((b) => b.label === label);
    if (liveMode) { if (i >= 0) playFrom(i); return; }
    const seg = data?.cutTimeline?.find((t) => t.label === label);
    if (seg && videoRef.current) {
      videoRef.current.currentTime = seg.start + 0.02;
      videoRef.current.play().catch(() => {});
    }
  }

  /* The only place on this page that moves the viewport. (ledger C22)
     Everything that wants the page to move asks lib/follow first and hands the
     answer here, so "does the person want this" is decided in one place, by
     rules that can be read and tested, instead of by each effect guessing from
     whatever it can see about the input that led to it. */
  function applyScrollRequest(req: ScrollRequest, el?: Element | null) {
    if (req.kind === "by") window.scrollBy({ top: req.top, behavior: req.behavior });
    else if (req.kind === "reveal") el?.scrollIntoView({ block: req.block, behavior: "smooth" });
  }

  /** Take me to this line -- said out loud, by the one act that means it.
   *  Keyboard only: a row you clicked is already under your cursor. */
  function revealRow(label: string) {
    const row = document.querySelector(`[data-beat="${label}"]`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    applyScrollRequest(
      revealScroll({ rowTop: r.top, rowBottom: r.bottom, viewportHeight: window.innerHeight }),
      row
    );
  }

  /* Carry the spoken line up under the player.
     Playback moves through the list faster than anyone can follow by eye, so
     the list comes to the playhead rather than the other way round. It gives
     way the moment you scroll yourself -- following someone who is reading
     somewhere else is worse than not following at all. */
  useEffect(() => {
    /* Scrolling yields the list to you. Nothing is scheduled here: when you get
       it back is a question the next line boundary asks (lib/follow's
       isFollowing), not an alarm that goes off while you are reading. The alarm
       is what Kayer reported -- it pulled the view back four seconds after he
       had stopped moving, whether or not anything was playing. */
    const yieldToUser = () => { yieldedAt.current = Date.now(); };
    window.addEventListener("wheel", yieldToUser, { passive: true });
    window.addEventListener("touchmove", yieldToUser, { passive: true });
    return () => {
      window.removeEventListener("wheel", yieldToUser);
      window.removeEventListener("touchmove", yieldToUser);
    };
  }, []);

  useEffect(() => {
    const row = spoken && document.querySelector(`[data-beat="${spoken.label}"]`);
    const stage = document.querySelector(".stage");
    const v = liveMode ? rawRef.current : videoRef.current;
    /* Both edges of each box, because following now asks for the least
       movement that brings the line into view and is bounded by the room the
       player has -- neither of which can be worked out from one edge. */
    const s = stage?.getBoundingClientRect();
    const r = row ? row.getBoundingClientRect() : null;
    applyScrollRequest(followScroll({
      // no row for it is the same as nothing being spoken: there is nowhere to go
      spokenLabel: row ? spoken!.label : null,
      following: isFollowing(Date.now(), yieldedAt.current),
      pointerDown: pointerDown.current,
      playing: !!v && !v.paused,
      stageTop: s ? s.top : null,
      stageBottom: s ? s.bottom : null,
      rowTop: r ? r.top : 0,
      rowBottom: r ? r.bottom : 0,
      viewportHeight: window.innerHeight,
    }));
  }, [spoken?.label]);   // the line changing, and nothing else

  /** Cut time -> the source frame it shows. The inverse of what the timeline
   *  does, and it has to go through the pieces: a line with a stretch taken
   *  out of it is several runs of film, and cut time skips the gap. */
  const cutToSource = useCallback((t: number): number | null => {
    const d = dataRef.current;
    if (!d) return null;
    const { pieces } = layout(d.beats, d.edl);
    for (const p of pieces) {
      if (t >= p.at && t < p.at + p.dur) {
        const f = p.dur > 0 ? (t - p.at) / p.dur : 0;
        return p.srcStart + f * (p.srcEnd - p.srcStart);
      }
    }
    return null;
  }, []);

  /** The transcript words inside one line, which are what carry the timing. */
  const wordsOf = useCallback((b: Beat) => {
    const all = dataRef.current?.words ?? [];
    return all.filter((w) => w.e > b.start && w.s < b.end);
  }, []);

  /* Edits apply themselves.
   *
   * Cutting used to leave the rendered file behind until you noticed the
   * "picture out of date" badge and pressed Apply. Every edit is a real edit;
   * having to confirm it a second time is a step that exists for the
   * renderer's benefit, not yours.
   *
   * Debounced, because a render is minutes of ffmpeg and a run of trims is
   * one edit in your head. It waits for you to stop, skips while a job is
   * already running, and never queues a second one behind the first. */
  const rebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rebuildWanted = useRef(false);
  function applyEditsSoon() {
    if (!autoApply) return;
    rebuildWanted.current = true;
    if (rebuildTimer.current) clearTimeout(rebuildTimer.current);
    rebuildTimer.current = setTimeout(async () => {
      rebuildTimer.current = null;
      if (!rebuildWanted.current) return;
      // a build already running will pick up what is on disk when it starts;
      // stacking another behind it renders the same edit twice
      if (buildJobRef.current?.status === "running") { applyEditsSoon(); return; }
      rebuildWanted.current = false;
      try {
        const res = await fetch(`/api/projects/${project}/pipeline`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "build" }),
        });
        if (res.status === 202) pollBuild((await res.json()).jobId);
      } catch { /* the badge still says the picture is behind */ }
    }, 6000);
  }
  useEffect(() => () => { if (rebuildTimer.current) clearTimeout(rebuildTimer.current); }, []);

  /* Is a mouse button down right now?
   *
   * Capture phase on window, so it is true before any React handler runs and
   * before the effects that follow the render those handlers cause. Nothing
   * may move the page while the hand is on the mouse. */
  const pointerDown = useRef(false);
  useEffect(() => {
    const down = () => { pointerDown.current = true; };
    const up = () => { pointerDown.current = false; };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("dragend", up, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("dragend", up, true);
    };
  }, []);

  /* Picking a clip on the timeline and picking its line are the same act, and
     the row lights up either way -- so the two halves of the screen never
     disagree about which line you are working on.

     Bringing that row into view is NOT part of the same act, and this is where
     an effect keyed on `selectedClip` used to try. It could not work. Every
     clip, trim handle and fade grip on the timeline selects on MOUSEDOWN, so
     it fired mid-drag and pulled the timeline out from under the cursor: "The
     screen won't stay put. I cannot work this way." The `pointerDown` guard
     added then fixed dragging and nothing else, because `click` dispatches
     after `mouseup` -- so clicking line 14 of 34 still centred it and pushed
     the player and the timeline off the top of the screen.

     The effect is gone rather than re-guarded. It was being asked a question it
     could not answer: by the time it runs, the act that changed the selection
     is over and unknowable. The two acts that really do mean "take me to that
     line" -- arrowing through the list, and N -- say so themselves, by calling
     revealRow at the point where they still know it. (ledger C22, C19) */

  /* The playhead, at screen rate rather than the decoder's.
     timeupdate fires about four times a second, so a playhead driven by it
     steps along in visible jumps while the picture runs smoothly. Reading
     currentTime once per frame costs nothing and is what makes the marker
     look attached to the video. */
  useEffect(() => {
    let raf = 0;
    let stop = false;
    const tick = () => {
      if (stop) return;
      const v = liveMode ? rawRef.current : videoRef.current;
      if (v && !v.seeking) {
        if (!v.paused) {
          if (liveMode) setRawHead(v.currentTime); else setPlayhead(v.currentTime);
        }
        /* Which word is being said, in SOURCE time.
           Resolved every frame but only written to state when it changes, so
           the highlight lands on the syllable without re-rendering the list
           sixty times a second. */
        const src = liveMode ? v.currentTime : cutToSource(v.currentTime);
        if (src !== null) {
          const beats = beatsRef.current;
          const b = beats.find((x) => src >= x.start - 0.02 && src <= x.end + 0.02);
          if (b) {
            const ws = wordsOf(b);
            let ix = -1;
            for (let i = 0; i < ws.length; i++) {
              if (src >= ws[i].s - 0.03 && src < ws[i].e + 0.03) { ix = i; break; }
              if (ws[i].s > src) break;
            }
            setSpoken((cur) =>
              cur && cur.label === b.label && cur.wordIx === ix ? cur : { label: b.label, wordIx: ix });
          } else {
            setSpoken((cur) => (cur === null ? cur : null));
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stop = true; cancelAnimationFrame(raf); };
  }, [liveMode]);

  /** The footage's own aspect, so the player frame matches the picture
   *  instead of letterboxing it inside a phone shape. */
  function noteAspect(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.currentTarget;
    if (v.videoWidth && v.videoHeight) setShotAspect(`${v.videoWidth} / ${v.videoHeight}`);
  }

  /** The edit's history, off disk -- so it survives a reload, a restart, and
   *  an edit made from anywhere other than this screen. */
  async function openHistory() {
    setHistoryOpen(true);
    setVersions(null);
    try {
      const r = await fetch(`/api/projects/${project}/snapshots`);
      setVersions(r.ok ? (await r.json()).snapshots : []);
    } catch {
      setVersions([]);
    }
  }

  async function restoreSnapshot(id: string) {
    // Putting a version back replaces the whole beat list, which is the
    // largest single change in the app -- so it is the one that most needs a
    // step back. It pushed nothing, and the toast said "this is undoable too"
    // while Cmd-Z answered "Nothing to undo". Pushed before the write, and
    // taken back if the write fails, so a refused restore leaves no step
    // behind that undoes to the state you are already in.
    const pushed = pushHistory("putting that version back");
    setRestoring(id);
    const r = await fetch(`/api/projects/${project}/snapshots`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setRestoring(null);
    if (!r.ok) {
      dropLastHistory(pushed);
      toast((await r.json().catch(() => ({}))).error ?? "could not restore that");
      return;
    }
    setVersions((await r.json()).snapshots);
    // the open trim now points at a beat that may have moved under it
    setTrimBeat(null); setTrim(null); setSelection(null);
    await load();
    setHistoryOpen(false);
    toast("Put back — and this is undoable too");
    applyEditsSoon();          // the render is of whatever was there before
  }

  /* The open snippet editor holds its own copy of the line's in and out, so
     dragging an edge is live and cheap. That copy has to give way when the
     line changes underneath it -- an undo, a Put back from History, a restore
     of an earlier version.

     It did not. Undo took the trim off the stored edit and said so, and the
     editor went on showing the undone trim as a pending change with Save trim
     armed -- so Save silently put back the very thing that had just been
     undone. Worse, every later drag was measured against that stale window: a
     selection across the line reported "4.86s highlighted" over a bar reading
     0.54s and a -4.48 trim already pending, before any button was pressed.

     Comparing against what we last SAW rather than against the editor's
     current values is what separates "the line moved underneath" from "he is
     part-way through moving it himself". A nudge in the editor changes the
     editor only, and nothing here fires. */
  const seenTrimBeat = useRef<{ label: string; start: number; end: number } | null>(null);
  useEffect(() => {
    if (!trimBeat || !data) { seenTrimBeat.current = null; return; }
    const b = data.beats.find((x) => x.label === trimBeat);
    if (!b) {
      // undo removed the line the editor is open on; there is nothing to edit
      setTrimBeat(null); setTrim(null); setSelection(null);
      trimRef.current = null; seenTrimBeat.current = null;
      return;
    }
    const prev = seenTrimBeat.current;
    seenTrimBeat.current = { label: b.label, start: b.start, end: b.end };
    if (!prev || prev.label !== b.label) return;              // just opened
    if (prev.start === b.start && prev.end === b.end) return;  // nothing moved
    setTrim({ start: b.start, end: b.end });
    setSelection(null);
  }, [data, trimBeat]);

  function openTrim(b: Beat) {
    setTrimBeat(b.label);
    setTrim({ start: b.start, end: b.end });
    setSnipPad(1);
    setSelection(null);
    setRawHead(b.start);
    scrubTo(b.start);
    if (!peaks) {
      fetch(`/api/projects/${project}/peaks`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setPeaks({ rate: d.rate, peaks: d.peaks, rms: d.rms }))
        .catch(() => {});
    }
  }

  /** Park the picture on an exact moment of the raw file, without playing.
   *  This is what makes an in/out point something you can SEE. */
  function scrubTo(t: number) {
    const v = rawRef.current;
    if (!v || !data?.hasSource) return;
    /* Positions the source; it does not take over the screen.
       This used to switch you to Original footage, and it is called by every
       scrub, nudge and handle drag -- so touching anything threw you off the
       cut you were watching. The snippet monitor mirrors this element whether
       or not it is the one on screen, so the picture you are aiming at is
       still there. */
    videoRef.current?.pause();
    v.pause();
    stopAt.current = null;
    v.currentTime = Math.max(0, t);
    setRawHead(t);
  }

  /* Audio while you drag.
   *
   * A seek is silent, so dragging the playhead across a line used to show you
   * the mouth moving with nothing coming out -- and finding the gap before a
   * word is a thing you do by ear. There is no scrub-audio primitive in a
   * video element, so this uses the only thing that makes sound: playing it.
   * Dragging forward sets the rate from how fast your hand is moving and lets
   * it run; whenever the picture drifts from the pointer, or you drag
   * backwards, it snaps back to a silent seek.
   *
   * Backwards is silent and cannot not be: playbackRate will not go negative
   * in any browser. */
  const scrubAudio = useRef<{ at: number; t: number } | null>(null);
  function scrubHeard(target: number) {
    const v = rawRef.current;
    if (!v || !data?.hasSource) return false;
    const now = performance.now();
    const last = scrubAudio.current;
    scrubAudio.current = { at: now, t: target };
    if (!last) return false;

    const dt = (now - last.at) / 1000;
    if (dt <= 0.001 || dt > 0.25) return false;       // first move, or you stopped
    const rate = (target - last.t) / dt;

    // Backwards is silent and cannot not be: playbackRate will not go negative
    // in any browser. Stationary is silent too -- there is nothing to hear.
    if (rate < 0.15) return false;

    /* Chase the pointer, do not try to sit on it.
     *
     * Zoomed out, a hand moving at any normal speed is covering ten seconds of
     * content a second, so demanding that the audio keep up exactly meant it
     * bailed on every frame and you heard nothing at all. It plays the stretch
     * you are passing over instead, at the fastest rate speech survives, and
     * only jumps when it has fallen far enough behind to be the wrong part of
     * the video. That is what scrubbing sounds like on a real deck. */
    const drift = target - v.currentTime;
    if (drift < -0.05 || drift > 1.2) {
      v.currentTime = Math.max(0, target);            // too far behind, or overshot
    }
    v.playbackRate = Math.max(0.5, Math.min(3, rate));
    if (v.paused) v.play().catch(() => {});
    return true;
  }
  function endScrubAudio() {
    scrubAudio.current = null;
    const v = rawRef.current;
    if (v) { v.pause(); v.playbackRate = 1; }
  }

  /** Nudge one edge. Negative on start = start earlier; positive on end =
   *  let the last word finish, which is the usual fix. */
  function nudge(edge: "start" | "end", by: number) {
    setTrim((t) => {
      if (!t) return t;
      const next = { ...t, [edge]: Math.max(0, Math.round((t[edge] + by) * 1000) / 1000) };
      if (next.end - next.start < 0.15) return t;
      // show the frame this edge now lands on -- a trim you can watch
      scrubTo(next[edge]);
      return next;
    });
  }

  /** Dragging a waveform handle: same idea, continuous. */
  function dragEdge(edge: "start" | "end", t: number) {
    setTrim((cur) => {
      if (!cur) return cur;
      const v = Math.max(0, Math.round(t * 1000) / 1000);
      const next = edge === "start"
        ? { ...cur, start: Math.min(v, cur.end - 0.15) }
        : { ...cur, end: Math.max(v, cur.start + 0.15) };
      scrubTo(next[edge]);
      return next;
    });
  }

  /** Play just this line, start to end. What space does while a trim is open. */
  function playSnippet() {
    const v = rawRef.current;
    if (!v || !trim || !data?.hasSource) return;
    // heard here, seen in the snippet monitor -- no need to take the screen
    videoRef.current?.pause();
    if (!v.paused) { v.pause(); return; }        // space again stops it
    // same bookkeeping the Play button does, or live playback thinks a
    // different line is on screen and jumps away mid-audition
    const i = (data?.beats ?? []).findIndex((b) => b.label === trimBeat);
    if (i >= 0) { liveIdxRef.current = i; setLiveIdx(i); }
    v.currentTime = trim.start;
    stopAt.current = trim.end;
    v.play().catch(() => {});
  }

  /** Play the RAW source across the trimmed range -- that is precisely what
   *  the in/out points refer to, so it is the only honest preview. */
  function previewTrim() {
    if (!trim || !rawRef.current) return;
    videoRef.current?.pause();
    const i = (data?.beats ?? []).findIndex((b) => b.label === trimBeat);
    if (i >= 0) { liveIdxRef.current = i; setLiveIdx(i); }
    rawRef.current.currentTime = trim.start;
    stopAt.current = trim.end;
    rawRef.current.play().catch(() => {});
  }

  async function saveTrim() {
    if (!trimBeat || !trim) return;
    pushHistory("that trim");
    setTrimSaving(true);
    const res = await fetch(`/api/projects/${project}/beats/${trimBeat}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trim),
    });
    setTrimSaving(false);
    const savedLabel = trimBeat;
    if (res.ok) {
      const r = await res.json();
      setTrimBeat(null);
      setTrim(null);
      trimRef.current = null;
      await load();
      // Play the new version immediately -- the edit is live, not pending.
      const i = beatsRef.current.findIndex((b) => b.label === savedLabel);
      if (i >= 0) playFrom(i);
      const d = r.delta;
      toast(`Trimmed ${d.start >= 0 ? "+" : ""}${d.start}s / ${d.end >= 0 ? "+" : ""}${d.end}s — playing it now`);
      learnFromEdits();
    applyEditsSoon();
    } else {
      const b = await res.json().catch(() => ({}));
      toast(b.error ?? "could not save the trim");
    }
  }

  /** Feed the correction back into the defaults. Silent when there isn't
   *  enough evidence yet, loud when something actually changed. */
  async function learnFromEdits() {
    try {
      const res = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiet: true }),
      });
      if (!res.ok) return;
      const r = await res.json();
      if (r.changed && r.learned?.length) {
        setLearned(r.learned);
      }
    } catch {
      // learning is a bonus pass; never let it break the edit
    }
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${project}`);
    if (res.ok) {
      const fresh = await res.json();
      beatsRef.current = fresh.beats ?? [];
      dataRef.current = fresh;
      setData(fresh);
      setNotFound(false);
    } else if (res.status === 422) {
      // the project is there; its edit file is not readable
      const b = await res.json().catch(() => ({} as { problem?: string }));
      setProblem(b.problem ?? "this project's edit file cannot be read");
    } else if (res.status === 404 || res.status === 400) {
      // otherwise this sits on "Loading…" forever for a project that isn't there
      setNotFound(true);
    }
  }, [project]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { void loadPeaks(); }, [loadPeaks]);
  useEffect(() => { beatsRef.current = data?.beats ?? []; dataRef.current = data; }, [data]);
  useEffect(() => { buildJobRef.current = buildJob; }, [buildJob]);
  const defaulted = useRef(false);
  useEffect(() => {
    /* Open on YOUR CUT, not on the last render.
     *
     * A render is minutes of ffmpeg, so the file can never keep up with an
     * edit -- which is why waiting on it felt like the edits were not being
     * applied. Played off the 720p proxy (53MB against 1.4GB, keyframe every
     * half second) the same beat list plays back directly, holes skipped and
     * cuts honoured, so a change is on screen the instant it is made. The
     * rendered file stays one click away for checking what actually exports. */
    if (data && !defaulted.current) {
      defaulted.current = true;
      if (data.hasSource && data.beats.length > 0) setLiveMode(true);
    }
  }, [data]);

  /* Dropping footage is the instruction. If a project still isn't cut by the
     time it's opened -- an import from before the pipeline existed, or one
     interrupted half way -- finish it rather than asking. It resumes from
     wherever it stopped, so this costs nothing when there's nothing to do. */
  const autoKicked = useRef(false);
  useEffect(() => {
    if (!data || autoKicked.current) return;
    if (!data.hasSource || data.cutFile || buildJob?.status === "running") return;
    autoKicked.current = true;
    (async () => {
      const res = await fetch(`/api/projects/${project}/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "auto" }),
      });
      if (res.status === 202) pollBuild((await res.json()).jobId);
    })().catch(() => {});
  }, [data, project, buildJob?.status]);
  useEffect(() => {
    trimRef.current = trimBeat && trim ? { label: trimBeat, ...trim } : null;
  }, [trimBeat, trim]);

  /** in/out for a beat, preferring an in-progress trim so nudges are live */
  function rangeFor(b: Beat) {
    const t = trimRef.current;
    return t && t.label === b.label ? { start: t.start, end: t.end } : { start: b.start, end: b.end };
  }

  /** The nearest point in the EDIT to a raw source time.
   *
   *  The player runs the source; the edit is a set of ranges over it. Most of
   *  the source is not in the edit -- the dead air before the first take, the
   *  ground between two takes, a stretch cut out of the middle of a line -- so
   *  "where the playhead is" and "where playback should start" are different
   *  questions.
   *
   *  Containment is checked before order, because the beat list is in EDIT
   *  order and a reorder makes it disagree with source order.
   */
  function liveSeekTarget(t: number): { index: number; time: number } | null {
    const beats = beatsRef.current;
    if (!beats.length) return null;
    for (let i = 0; i < beats.length; i++) {
      const { start, end } = rangeFor(beats[i]);
      if (t >= start && t < end) {
        const hole = (beats[i].holes ?? []).find(([hf, ht]) => t >= hf && t < ht - 0.02);
        return { index: i, time: hole ? hole[1] : t };
      }
    }
    // Not inside any line. Take the next one that starts after here, so
    // pressing play in the gap between two takes moves forward rather than
    // replaying the one just finished.
    let best = -1;
    for (let i = 0; i < beats.length; i++) {
      const { start } = rangeFor(beats[i]);
      if (start > t && (best < 0 || start < rangeFor(beats[best]).start)) best = i;
    }
    const i = best >= 0 ? best : 0;
    return { index: i, time: rangeFor(beats[i]).start };
  }

  /** Play the edit from wherever the edit currently is.
   *
   *  The raw <video> used to carry its own controls, so pressing play played
   *  the SOURCE from 0:00 -- 74 seconds of dead air on img-9817 before the
   *  first line, against a timeline that said 1:37.6. The control bar also
   *  read the source's length as the length of the cut, and it took the space
   *  bar for itself, so the app's own stop did nothing. There are no native
   *  controls on it now; this is the transport, and it is the only one.
   */
  function playLive() {
    const v = rawRef.current;
    if (!v) return;
    if (!v.paused) { v.pause(); return; }
    const target = liveSeekTarget(v.currentTime);
    if (!target) return;
    liveIdxRef.current = target.index;
    setLiveIdx(target.index);
    if (Math.abs(v.currentTime - target.time) > 0.02) v.currentTime = target.time;
    stopAt.current = null;
    v.play().catch(() => {});
  }

  function playFrom(index: number) {
    yieldedAt.current = 0;             // asking for playback asks to follow it
    const beats = beatsRef.current;
    if (!beats.length || !rawRef.current) return;
    const i = Math.max(0, Math.min(index, beats.length - 1));
    liveIdxRef.current = i;
    setLiveIdx(i);
    // this one IS the live-edit transport -- pressing Original footage is how
    // you get here, so it is the one place the switch is the point
    setLiveMode(true);
    videoRef.current?.pause();
    stopAt.current = null;
    rawRef.current.currentTime = rangeFor(beats[i]).start;
    rawRef.current.play().catch(() => {});
  }

  /* Keyboard.
     These are the bindings an editor already has in their hands -- J/K/L
     shuttle, I/O for in and out, S to split at the playhead -- so muscle
     memory from any other suite carries straight over. */
  const shuttle = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && typeof el.closest === "function" &&
          el.closest("input, textarea, [contenteditable]")) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault(); undoLast(); return;
      }
      if (e.altKey) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() !== "b") return;

      const v = rawRef.current;
      const cur = () => (liveMode ? rawRef.current : videoRef.current);
      const beats = beatsRef.current;
      const selIx = Math.max(0, beats.findIndex((b) => b.label === selectedClip));
      const k = e.key.toLowerCase();

      // ---- transport ------------------------------------------------------
      if (e.code === "Space") {
        e.preventDefault();
        if (trimBeat && trim) { playSnippet(); return; }   // audition the open line
        // Live edit has somewhere specific to start from -- see playLive.
        if (liveMode) { playLive(); return; }
        const p = cur();                 // whichever player is on screen
        if (!p) return;
        if (p.paused) p.play().catch(() => {}); else p.pause();
        return;
      }
      if (k === "l" && !e.metaKey && !e.ctrlKey) {         // shuttle forward
        e.preventDefault();
        const p = cur(); if (!p) return;
        shuttle.current = shuttle.current > 0 ? Math.min(8, shuttle.current * 2) : 1;
        p.playbackRate = shuttle.current;
        p.play().catch(() => {});
        toast(`▶ ${shuttle.current}×`, 900);
        return;
      }
      if (k === "k") {                                      // stop
        e.preventDefault();
        const p = cur(); if (!p) return;
        shuttle.current = 0; p.playbackRate = 1; p.pause();
        return;
      }
      if (k === "j") {                                      // shuttle back
        e.preventDefault();
        const p = cur(); if (!p) return;
        p.pause(); p.playbackRate = 1;
        shuttle.current = shuttle.current < 0 ? Math.max(-8, shuttle.current * 2) : -1;
        p.currentTime = Math.max(0, p.currentTime + shuttle.current * 0.4);
        if (liveMode) setRawHead(p.currentTime);
        toast(`◀ ${Math.abs(shuttle.current)}×`, 900);
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const p = cur(); if (!p) return;
        const step = e.shiftKey ? 1 : 1 / 30;               // a second, or a frame
        p.pause();
        p.currentTime = Math.max(0, p.currentTime + (e.key === "ArrowRight" ? step : -step));
        if (liveMode) setRawHead(p.currentTime);
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const i = e.key === "Home" ? 0 : beats.length - 1;
        if (beats[i]) { setSelectedClip(beats[i].label); seekToBeat(beats[i].label); revealRow(beats[i].label); }
        return;
      }

      // ---- selection ------------------------------------------------------
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!beats.length) return;
        const next = e.key === "ArrowDown"
          ? Math.min(beats.length - 1, selIx + 1)
          : Math.max(0, selIx - 1);
        setSelectedClip(beats[next].label);
        seekToBeat(beats[next].label);
        // arrowing through the list is the case the old effect was written for
        revealRow(beats[next].label);
        return;
      }

      // ---- editing --------------------------------------------------------
      if (k === "i" || k === "o") {                         // set in / out here
        const b = beats.find((x) => x.label === selectedClip);
        const p = cur();
        if (!b || !p || !liveMode) return;
        e.preventDefault();
        timelineTrim(b.label, k === "i" ? "start" : "end", p.currentTime);
        toast(k === "i" ? "In point set" : "Out point set", 1200);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k === "b") {          // ⌘B: the blade
        const p = cur();
        if (!p) return;
        e.preventDefault();
        const beats2 = beatsRef.current;
        // whichever clip the playhead is actually inside, selected or not
        const { placed } = layout(beats2, data?.edl);
        const at = liveMode ? p.currentTime : null;
        const target = at !== null
          ? beats2.find((x) => at >= x.start && at <= x.end)
          : placed.find((c) => (cutPlayhead ?? 0) >= c.at && (cutPlayhead ?? 0) < c.at + c.dur);
        const cutAt = at ?? null;
        if (!target || cutAt === null) { toast("Put the playhead inside a clip first"); return; }
        beatOp({ op: "split", label: target.label, at: cutAt }, "Cut at the playhead");
        return;
      }
      if (k === "s" && !e.metaKey && !e.ctrlKey) {          // split at the playhead
        const b = beats.find((x) => x.label === selectedClip);
        const p = cur();
        if (!b || !p || !liveMode) return;
        e.preventDefault();
        beatOp({ op: "split", label: b.label, at: p.currentTime }, "Split into two clips");
        return;
      }
      if ((e.key === "[" || e.key === "]") && selectedClip) {
        e.preventDefault();
        const b = beats.find((x) => x.label === selectedClip);
        if (!b) return;
        const by = e.shiftKey ? 0.20 : 0.05;
        if (e.key === "[") timelineTrim(selectedClip, "start", b.start - by);
        else timelineTrim(selectedClip, "end", b.end + by);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Unconditional. Falling through used to hand a bare Backspace to the
        // web view, which treats it as Back -- which is how deleting a
        // highlight ejected you to the queue mid-edit.
        e.preventDefault();
        // A highlight inside the open snippet is the most specific target
        // there is, so it wins over the selected clip.
        if (trimBeat && selection && selection.to - selection.from > 0.02) {
          const b = beats.find((x) => x.label === trimBeat);
          if (b) deleteSelection(b);
          return;
        }
        if (selectedClip) {
          const b = beats.find((x) => x.label === selectedClip);
          if (b) deleteBeat(b);
          setSelectedClip(null);
        }
        return;
      }
      if (k === "t" && selectedClip) {                      // open the trim editor
        const b = beats.find((x) => x.label === selectedClip);
        if (b) { e.preventDefault(); openTrim(b); }
        return;
      }
      if (k === "m") {                                      // marker at the playhead
        const p = cur();
        if (!p || !cutDuration) return;
        e.preventDefault();
        setLevel2Open(true);
        dropTimelineMarker(Math.round((p.currentTime / cutDuration) * 1000) / 10);
        toast("Marker dropped", 1200);
        return;
      }
      if (k === "f") { e.preventDefault(); setSelectedClip(null); return; }
      if (k === "n") { e.preventDefault(); nextFlagged(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toast(msg: string, holdMs = 2600) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), holdMs);
  }

  async function setLevel1(status: CutStatus) {
    await fetch(`/api/projects/${project}/review-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "level1", status }),
    });
    await load();
    // only two verdicts are reachable now: the third was a hand-back to
    // somebody who does not exist
    toast(status === "approved" ? "Approved — ready to post" : "Sent back to re-cut");
  }

  async function startBuild() { startStep("build"); }
  async function startTranscribe() { startStep("transcribe"); }

  /** Both heavy steps go through the same single-job queue. */
  async function startStep(step: "build" | "transcribe" | "draft-beats" | "source-proxy") {
    setBuildError(null);
    const res = await fetch(`/api/projects/${project}/pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step }),
    });
    if (res.status !== 202) {
      const body = await res.json().catch(() => ({}));
      setBuildError(body.error ?? `could not start ${step} (${res.status})`);
      return;
    }
    const { jobId } = await res.json();
    pollBuild(jobId);
  }

  function pollBuild(jobId: string) {
    const tick = async () => {
      const res = await fetch(`/api/projects/${project}/pipeline/jobs/${jobId}`);
      if (!res.ok) return;
      const job: Job = await res.json();
      setBuildJob(job);
      if (job.status === "running") {
        setTimeout(tick, 700);
      } else if (job.status === "done") {
        toast(
          job.step === "transcribe" ? "Transcribed — beats can be drafted now"
          : job.step === "plan-graphics" ? "Scanned the cut for graphics"
          : job.step === "render-graphics" ? `Graphics burned in: ${job.resultCutFile}`
          : job.step === "draft-beats" ? "Beats drafted — review them below"
          : job.step === "source-proxy" ? "Playback is smooth now"
          : `Cut built: ${job.resultCutFile}`
        );
        if (job.step === "build") { rawRef.current?.pause(); setLiveMode(false); setShowGraphics(false); }
        await load();
      } else {
        setBuildError(job.error ?? `${job.step} failed`);
      }
    };
    tick();
  }

  /** Where the raw playhead sits on the CUT's timeline. The player runs the
   *  source; the timeline measures the edit, so the two need translating. */
  const cutPlayhead = (() => {
    const beats = data?.beats ?? [];
    if (!beats.length) return null;
    if (!liveMode) return playhead;                 // rendered file: already cut time
    const { placed } = layout(beats, data?.edl);
    const c = placed[liveIdx];
    if (!c || rawHead === null) return null;
    const inside = Math.max(0, Math.min(c.dur, rawHead - c.start));
    return c.at + inside;
  })();

  /** Timeline position -> the source frame it refers to, then go there. */
  function scrubCut(cutTime: number) {
    const beats = data?.beats ?? [];
    const { placed } = layout(beats, data?.edl);
    const c = placed.find((p) => cutTime >= p.at && cutTime < p.at + p.dur) ?? placed[placed.length - 1];
    if (!c) return;
    liveIdxRef.current = c.index;
    setLiveIdx(c.index);
    const src = c.start + Math.max(0, Math.min(c.dur, cutTime - c.at));
    setSelectedClip(c.label);           // the line under the hand is the selected line
    if (!liveMode && videoRef.current) {
      // watching the render: scrub the render. Cut time is already its clock.
      videoRef.current.pause();
      videoRef.current.currentTime = Math.max(0, cutTime);
      setPlayhead(cutTime);
      scrubTo(src);                     // keep the snippet monitor in step
      return;
    }
    // if it can be heard, let it run rather than seeking on top of it
    if (scrubHeard(src)) { setRawHead(src); return; }
    scrubTo(src);
  }

  /** Dragging a clip edge on the timeline is the same edit as a trim; it just
   *  saves as you go rather than behind a form. */
  const trimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function timelineTrim(label: string, edge: "start" | "end", sourceTime: number) {
    const b = (data?.beats ?? []).find((x) => x.label === label);
    if (!b) return;
    if (!trimTimer.current) pushHistory("that trim");   // once per drag, not per frame
    const next = edge === "start"
      ? { start: Math.max(0, Math.min(sourceTime, b.end - 0.15)), end: b.end }
      : { start: b.start, end: Math.max(sourceTime, b.start + 0.15) };
    // paint immediately, persist once the drag settles
    setData((d) => d && ({
      ...d,
      beats: d.beats.map((x) => (x.label === label ? { ...x, ...next } : x)),
    }));
    scrubTo(next[edge]);
    if (trimTimer.current) clearTimeout(trimTimer.current);
    trimTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/projects/${project}/beats/${label}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: Math.round(next.start * 1000) / 1000,
          end: Math.round(next.end * 1000) / 1000,
        }),
      });
      // Cleared before anything awaits: this ref is what tells the NEXT drag
      // it is a new edit. Leaving it set meant pushHistory fired once per page
      // load, so every trim after the first was unundoable.
      trimTimer.current = null;
      if (res.ok) { await load(); learnFromEdits(); applyEditsSoon(); } else { await load(); }
    }, 420);
  }

  /** Unlock a line's audio from its picture, or lock it back. */
  async function detachAudio(label: string, range: { start: number; end: number } | null) {
    pushHistory(range ? "detaching that audio" : "relinking that audio");
    const res = await fetch(`/api/projects/${project}/beats/${label}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: range
        ? JSON.stringify({ track: "audio", start: range.start, end: range.end })
        : JSON.stringify({ track: "audio", relink: true }),
    });
    if (!res.ok) {
      toast((await res.json().catch(() => ({}))).error ?? "could not change the audio");
      return;
    }
    await load();
    toast(range ? "Audio detached — drag its edges on the audio track" : "Audio locked back to the picture");
    applyEditsSoon();
  }

  /** Ramp a line in or out. Paints immediately, saves once the drag settles. */
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setFade(label: string, edge: "in" | "out", seconds: number) {
    const key = edge === "in" ? "fadeIn" : "fadeOut";
    setData((d) => d && ({
      ...d,
      beats: d.beats.map((x) => (x.label === label ? { ...x, [key]: seconds } : x)),
    }));
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(async () => {
      await fetch(`/api/projects/${project}/beats/${label}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: Math.round(seconds * 1000) / 1000 }),
      });
      await load();
      learnFromEdits();
    applyEditsSoon();
    }, 400);
  }

  /** Same as a picture trim, but on the audio track. */
  const audioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function audioTrim(label: string, edge: "start" | "end", sourceTime: number) {
    const b = (data?.beats ?? []).find((x) => x.label === label);
    if (!b) return;
    const aStart = b.audioStart ?? b.start;
    const aEnd = b.audioEnd ?? b.end;
    const next = edge === "start"
      ? { start: Math.max(0, Math.min(sourceTime, aEnd - 0.15)), end: aEnd }
      : { start: aStart, end: Math.max(sourceTime, aStart + 0.15) };
    setData((d) => d && ({
      ...d,
      beats: d.beats.map((x) =>
        x.label === label ? { ...x, audioStart: next.start, audioEnd: next.end } : x),
    }));
    scrubTo(next[edge]);
    if (audioTimer.current) clearTimeout(audioTimer.current);
    audioTimer.current = setTimeout(async () => {
      await fetch(`/api/projects/${project}/beats/${label}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: "audio",
          start: Math.round(next.start * 1000) / 1000,
          end: Math.round(next.end * 1000) / 1000,
        }),
      });
      await load();
      applyEditsSoon();
    }, 420);
  }

  /** Drop a line, no questions. One undo, offered in the toast. */
  /* Lines currently being deleted. A second click while the first request is
     still out sent a second delete for a beat that no longer existed, so an
     impatient double-press ended with the error toast "no beat
     'under-eyes-its'" -- an internal label, presented as a failure -- followed
     by the success toast for the delete that did work. The spec asks for this
     exact test, and already states the rule for the importer: double-clicking
     must act once, not twice. */
  const deleting = useRef(new Set<string>());

  async function deleteBeat(b: Beat) {
    if (deleting.current.has(b.label)) return;
    deleting.current.add(b.label);
    try {
      await deleteBeatOnce(b);
    } finally {
      deleting.current.delete(b.label);
    }
  }

  async function deleteBeatOnce(b: Beat) {
    pushHistory(`deleting “${b.text ?? b.label}”`);
    const res = await fetch(`/api/projects/${project}/beats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "delete", label: b.label }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast(body.error ?? "could not delete that line"); return; }
    if (selectedClip === b.label) setSelectedClip(null);
    await load();
    setUndo({ beat: b, at: Date.now() });
    applyEditsSoon();
    toast(`Cut “${b.text ?? b.label}”`, 9000);
    setTimeout(() => setUndo((u) => (u && u.beat.label === b.label ? null : u)), 9000);
  }

  /** Put a deleted line back where it was. */
  async function undoDelete() {
    if (!undo) return;
    const beats = [...(data?.beats ?? [])];
    const idx = beats.findIndex((x) => x.start > undo.beat.start);
    beats.splice(idx < 0 ? beats.length : idx, 0, undo.beat);
    const res = await fetch(`/api/projects/${project}/pipeline`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beats }),
    });
    setUndo(null);
    if (!res.ok) { toast("could not put it back"); return; }
    await load();
    toast(`Restored “${undo.beat.text ?? undo.beat.label}”`);
    applyEditsSoon();
  }

  /** Take a marked stretch of the timeline out of the cut.
   *
   *  One drag can clip the tail of one line, swallow the next, and bite the
   *  head off a third. resolveSpanDelete works that out against the pieces the
   *  cut is actually made of; the server applies the lot in one write, so a
   *  span that is bad anywhere changes nothing. */
  async function cutSpan(from: number, to: number) {
    if (!data || to - from <= 0.02) return;
    const { pieces } = layout(data.beats, data.edl);
    const edits = resolveSpanDelete(pieces, data.beats, from, to);
    if (!edits.length) { toast("nothing under that selection"); return; }
    const pushed = pushHistory("cutting that stretch out");
    const res = await fetch(`/api/projects/${project}/beats`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "cut_span", edits, span: { from, to } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast(body.error ?? "could not cut that"); return; }
    // the same no-op the snippet editor has: a span landing entirely inside
    // footage already removed resolves to the holes that are already there
    if (body.changed === false) {
      dropLastHistory(pushed);
      toast(body.unchanged ?? "that stretch is already cut out");
      return;
    }
    setSelectedClip(null);
    await load();
    const dropped = (body.dropped ?? []).length;
    toast(`Cut ${(to - from).toFixed(2)}s out${dropped ? ` — ${dropped} line${dropped > 1 ? "s" : ""} gone` : ""}`);
    learnFromEdits();
    applyEditsSoon();
  }

  /** Read one line and card it if it earns one.
   *
   *  Scoped to that line's words off the existing transcript, so it answers
   *  immediately -- the whole-cut scan runs Whisper over the render and is the
   *  wrong tool for "what belongs here". */
  async function generateGraphicFor(label: string) {
    if (!data) return;
    const b = data.beats.find((x) => x.label === label);
    if (!b) return;
    const { placed } = layout(data.beats, data.edl);
    const at = placed.find((c) => c.label === label);
    if (!at) return;
    setGfxScanning(label);
    const res = await fetch(`/api/projects/${project}/graphics`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "scan_line",
        from: b.start, to: b.end,
        // source time -> cut time, for this clip
        shift: at.at - b.start,
      }),
    });
    setGfxScanning(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast(body.error ?? "could not read that line"); return; }
    const n = (body.added ?? []).length;
    setGfxNonce((n) => n + 1);      // the panel reloads on this
    toast(n ? `${n} graphic${n > 1 ? "s" : ""} added to that line` : (body.reason ?? "nothing on that line to card"));
  }

  async function beatOp(payload: Record<string, unknown>, done: string) {
    pushHistory(String(payload.op ?? "that change"));
    const res = await fetch(`/api/projects/${project}/beats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast(body.error ?? "could not apply that"); return; }
    await load();
    applyEditsSoon();
    toast(done);
  }

  /* How long the edit runs.
   *
   * This used to prefer the rendered FILE's duration, which is a number about
   * the last build, not about the edit in front of you. Cut ten seconds out
   * and the header kept reporting the old length until you re-rendered --
   * which reads exactly like the edit did not save. It reports the edit now,
   * and holes come out of it: a line with a stretch removed is shorter, and
   * the old sum ignored that entirely.
   *
   * The rendered file's length is still used for the rendered-cut player,
   * where it is the honest number. */
  const beatsDuration = (data?.beats ?? []).reduce((sum, b) => {
    const holes = (b.holes ?? []).reduce(
      (n, [f, t]) => n + Math.max(0, Math.min(t, b.end) - Math.max(f, b.start)), 0);
    return sum + Math.max(0, (b.end - b.start) - holes);
  }, 0);
  const cutDuration = liveMode || cutMediaDuration === null ? beatsDuration : cutMediaDuration;

  async function clearMarkers() {
    await fetch(`/api/projects/${project}/review-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "level2_clear" }),
    });
    await load();
  }

  /** Markers are a scratch list; dropping one you misplaced shouldn't mean
   *  clearing the lot. */
  async function removeMarker(index: number) {
    const keep = (data?.reviewState.timelineMarkers ?? []).filter((_, i) => i !== index);
    await fetch(`/api/projects/${project}/review-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "level2_clear" }),
    });
    for (const m of keep) {
      await fetch(`/api/projects/${project}/review-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "level2_marker", atPct: m.atPct }),
      });
    }
    await load();
  }

  async function dropTimelineMarker(pct: number) {
    await fetch(`/api/projects/${project}/review-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "level2_marker", atPct: pct }),
    });
    await load();
  }

  async function openTakePicker(beat: Beat) {
    setTakePickerBeat(beat);
    setCandidates(null);
    setCandidatesError(null);
    setSelectedCandidateId(null);
    setCandidatesLoading(true);
    const res = await fetch(`/api/projects/${project}/beats/${beat.label}/candidates`);
    setCandidatesLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setCandidatesError(body.error === "candidate scan unavailable"
        ? "Can't scan for candidate takes — this needs work/transcript.json and work/silence.txt for this project (not present on this machine)."
        : body.error ?? "candidate scan failed");
      return;
    }
    const result: CandidateTakesResult = await res.json();
    setCandidates(result);
    setSelectedCandidateId(result.recommendedId);
  }

  async function approveTakePick() {
    if (!takePickerBeat || !selectedCandidateId) return;
    const res = await fetch(`/api/projects/${project}/beats/${takePickerBeat.label}/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: selectedCandidateId }),
    });
    if (res.ok) {
      const pickedLabel = takePickerBeat.label;
      setTakePickerBeat(null);
      await load();
      setLearnAfterBeat(pickedLabel);
      applyEditsSoon();          // a different take is a different in and out
    }
  }


  async function saveLearning() {
    if (!learnText.trim()) { setLearnAfterBeat(null); setLearnText(""); return; }
    await fetch(`/api/learnings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: learnText.trim() }),
    });
    setLearnAfterBeat(null);
    setLearnText("");
    toast("Saved to your preferences");
  }

  if (problem) {
    return (
      <section>
        <div className="empty-state">
          <b>{project}</b> is here, but its edit file can&apos;t be read.
          <div className="mono" style={{ marginTop: 10, color: "var(--text-faint)" }}>{problem}</div>
          <div style={{ marginTop: 14, fontSize: "12.5px", color: "var(--text-faint)" }}>
            The footage and every earlier version are untouched — the beat list is one
            file. Put a version back from History, or repair{" "}
            <span className="mono">projects/{project}/beats.json</span> by hand.
          </div>
          <div style={{ marginTop: 14 }}>
            <Link href="/dashboard" style={{ color: "var(--accent)" }}>Back to the queue</Link>
          </div>
        </div>
      </section>
    );
  }

  if (notFound) {
    return (
      <section>
        <div className="empty-state">
          No project called <b>{project}</b>.{" "}
          <Link href="/dashboard" style={{ color: "var(--accent)" }}>Back to the queue</Link>
        </div>
      </section>
    );
  }
  if (!data) {
    return <section><div className="empty-state">Loading…</div></section>;
  }

  // a beat is flagged if it clips a word OR the drafter scored it below the bar
  const analysis = data.beatAnalysis ?? {};
  const flaggedLabels = new Set([
    ...data.wordBoundaryFlags.map((f) => f.beatLabel),
    ...Object.entries(analysis).filter(([, a]) => a.needs_review).map(([label]) => label),
  ]);
  const flaggedCount = flaggedLabels.size;
  // With a graphics render present, that IS the finished video -- so it plays
  // by default, and the clean cut stays one click away.
  const playFile = showGraphics && data.graphicsFile ? data.graphicsFile : data.cutFile;
  const videoSrc = playFile ? `/api/media/${project}/cuts/${playFile}` : null;

  return (
    <section>
      <div className="review-top">
        <div>
          <div className="breadcrumb"><Link href="/dashboard">Queue</Link> / <span>{data.project}</span></div>
          <div className="review-title">{data.project} {playFile ? `— ${playFile}` : "— no cut built"}</div>
          <div className="review-agent">{data.beats.length} beats · {data.hasTranscript ? "transcript available" : "no transcript on this machine"}</div>
        </div>
        <div className="review-top-right">
          <div className="hdr-meters">
            <button
              className={`score-chip${scoreOpen ? " open" : ""}`}
              title="Quality check — click for the breakdown"
              onClick={() => setScoreOpen((v) => !v)}
            >
              <b>{data.scorecard.overall ?? "—"}</b><span>/100</span>
            </button>
            {flaggedCount > 0 ? (
              <button className="pill warn pill-btn" onClick={nextFlagged}
                      title="Jump to the next line that needs a call">
                <span className="dot" />{flaggedCount} of {data.beats.length} need a call
                <span className="pill-go">next →</span>
              </button>
            ) : data.hasTranscript
              ? <span className="pill good"><span className="dot" />All beats clean</span>
              : <span className="pill faint"><span className="dot" />Unscored — no transcript</span>}
          </div>
          {scoreOpen && (
            <div className="score-pop">
              {data.scorecard.metrics.map((m) => (
                <div className="metric" key={m.key}>
                  <span className="mname">{m.label}</span>
                  <span className="mval mono">{m.value ?? "—"}{m.value !== null ? "%" : ""}</span>
                  <span className="mbar"><div style={{
                    width: `${m.value ?? 0}%`,
                    background: (m.value ?? 0) >= 85 ? "var(--good, #2e9e6b)" : "var(--warn)",
                  }} /></span>
                </div>
              ))}
              <p className="score-src">{data.source}</p>
            </div>
          )}
          <div className="verdict">
            <button
              className="btn btn-ghost"
              title="Every version of this edit, and a way back to any of them"
              onClick={openHistory}
            >
              History
            </button>
            <button
              className="btn btn-primary"
              disabled={!data.cutFile}
              title={data.cutFile ? undefined : "build a cut before approving it"}
              onClick={() => setLevel1("approved")}
            >
              Approve
            </button>
            <button className="btn btn-critical" onClick={() => setLevel1("trashed")}>Trash</button>
          </div>
        </div>
      </div>

      <div className="stage">
          <div className="player-modes">
            <button
              className={`pm${liveMode ? " active" : ""}`}
              disabled={!data.hasSource || data.beats.length === 0}
              title={
                !data.hasSource ? "the raw file isn't on this machine"
                  : data.beats.length === 0 ? "no lines drafted yet — nothing to play"
                  : "Your edit as it stands, played off the footage. Every change shows at once."
              }
              onClick={() => playFrom(liveIdx)}
            >
              Your cut
            </button>
            {data.cutFile && (
              <button
                className={`pm${!liveMode && !(showGraphics && data.graphicsFile) ? " active" : ""}`}
                title="The exported file. Trails your edit by a render; use it to check the final output."
                onClick={() => { setShowGraphics(false); rawRef.current?.pause(); setLiveMode(false); }}
              >
                {data.graphicsFile ? "Rendered · clean" : "Rendered file"}
              </button>
            )}
            <label className="auto-apply"
                   title="Re-export a few seconds after you stop editing. What you are watching is already current either way.">
              <input type="checkbox" checked={autoApply}
                     onChange={(e) => setAutoApply(e.target.checked)} />
              Keep the exported file current
            </label>
            {!data.cutFile && data.beats.length > 0 && buildJob?.status !== "running" && (
              <button
                className="ui-btn ui-btn-sm pm-apply"
                disabled={!data.hasSource}
                title="Render the edit to a file you can post"
                onClick={startBuild}
              >
                Build it now
              </button>
            )}
            {data.graphicsFile && (
              <button
                className={`pm${!liveMode && showGraphics ? " active" : ""}`}
                title="The cut with your motion graphics burned in"
                onClick={() => { setShowGraphics(true); rawRef.current?.pause(); setLiveMode(false); }}
              >
                With graphics
              </button>
            )}

            {data.hasSource && !data.sourceProxy && data.beats.length > 0 && (
              <button
                className="ui-btn ui-btn-sm pm-apply"
                disabled={buildJob?.status === "running"}
                title="Make a small copy of the footage so playback doesn't hitch at each cut"
                onClick={() => startStep("source-proxy")}
              >
                {buildJob?.status === "running" && buildJob.step === "source-proxy"
                  ? "Making it smooth…"
                  : "Make playback smooth"}
              </button>
            )}
            {/* Edits apply themselves, so this is only worth showing when you
                have turned that off -- otherwise it is a button asking you to
                confirm something already under way. */}
            {data.cutStale && !autoApply && (
              <button
                className="ui-btn ui-btn-sm ui-btn-primary pm-apply"
                disabled={buildJob?.status === "running" || !data.hasSource || data.beats.length === 0}
                title="Re-render the cut so the file matches your edits"
                onClick={startBuild}
              >
                {buildJob?.status === "running" && buildJob.step === "build"
                  ? "Applying…"
                  : "Apply now"}
              </button>
            )}
            <span className="pm-note">
              {liveMode
                ? (data.sourceProxy
                    ? "Your edit, played straight off the original footage — every trim applies instantly."
                    : "Your edit, played off the original footage. Cuts may hitch until you make playback smooth.")
                : !liveMode && showGraphics && data.graphicsFile
                  ? "Your motion graphics, burned in. “Clean cut” is the same edit without them."
                : !data.hasSource
                  ? "The raw footage isn't on this machine — it's still in iCloud. Download it and Live edit will work."
                  : videoSrc
                  ? data.cutStale
                    ? "This file was rendered before your latest trims — rebuild to bake them in."
                    : "The rendered file, matching your current edit."
                  : data.beats.length === 0
                    ? "No beats drafted yet, so there is no edit to play."
                    : "Nothing rendered yet — Live edit plays the cut without waiting for a render."}
            </span>
          </div>

          <div
            className="player"
            style={shotAspect ? ({ ["--shot-aspect" as string]: shotAspect } as React.CSSProperties) : undefined}
          >
            {/* Live edit: the raw source, played beat to beat using the CURRENT
                in/out points. Nothing is rendered, so a trim is audible the
                moment it is made -- the timeline is instructions over the
                source, not a baked file. */}
            <video
              ref={rawRef}
              // the scrubbing proxy when it exists: identical timeline, far
              // faster seeks, so beat-to-beat playback doesn't hitch
              src={data.hasSource
                ? `/api/media/${project}/${data.sourceProxy ?? data.source}`
                : undefined}
              // No native controls: they play the source, not the edit. The
              // transport below reads the cut's clock instead.
              preload="metadata"
              style={liveMode ? undefined : { display: "none" }}
              onLoadedMetadata={noteAspect}
              onPlay={() => setLivePlaying(true)}
              onPause={() => setLivePlaying(false)}
              onEnded={() => setLivePlaying(false)}
              onTimeUpdate={(e) => {
                const v = e.target as HTMLVideoElement;
                setRawHead(v.currentTime);

                /* Skipping a cut stretch belongs to PLAYBACK, not to the
                   playhead in general.
                   
                   This ran on every timeupdate, and a scrub fires timeupdate
                   too — so putting the playhead inside a stretch you had
                   already cut teleported it to the far edge, under your
                   cursor, while you were dragging. That is the "it keeps on
                   auto-snapping, I didn't do that" in Kayer's recording: not
                   the selection quantising (nothing here quantises) but the
                   picture jumping away from where he put it.
                   
                   Paused, the playhead is his. He is looking at the waveform
                   deciding where to cut, and the footage either side of a hole
                   is exactly what he needs to see. */
                const skipHoles = !v.paused;

                // previewing a single trimmed range
                if (stopAt.current !== null) {
                  if (skipHoles) {
                    const openBeat = beatsRef.current.find((x) => x.label === trimBeat);
                    for (const [hf, ht] of openBeat?.holes ?? []) {
                      if (v.currentTime >= hf && v.currentTime < ht - 0.02) { v.currentTime = ht; return; }
                    }
                  }
                  if (v.currentTime >= stopAt.current) {
                    v.pause(); stopAt.current = null;
                  }
                  return;
                }
                if (!liveMode) return;
                // While a trim is open the playhead belongs to the trim. Without
                // this the beat-to-beat advance fires on the frame you just
                // scrubbed to and throws you into the next line.
                if (trimBeat) return;
                const beats = beatsRef.current;
                const cur = beats[liveIdxRef.current];
                if (!cur) return;
                // A stretch cut out of the middle of this line has to be
                // jumped, or live playback still shows the thing you deleted.
                // Only while it is playing -- see above.
                if (skipHoles) {
                  for (const [hf, ht] of cur.holes ?? []) {
                    if (v.currentTime >= hf && v.currentTime < ht - 0.02) {
                      v.currentTime = ht;
                      return;
                    }
                  }
                }
                // Running past the end of a line and picking up the next one
                // is PLAYBACK, exactly as hole-skipping above is, and it was
                // the half of this that stayed ungated. Paused, a seek fires
                // timeupdate too -- so putting the playhead down past the end
                // of whichever line the player last had threw it forward to
                // the start of the following one, under the cursor, while the
                // hand was still on the mouse. Same defect as the holes, same
                // rule: paused, the playhead is his.
                if (!skipHoles) return;
                const { end } = rangeFor(cur);
                if (v.currentTime >= end) {
                  const next = liveIdxRef.current + 1;
                  if (next >= beats.length) { v.pause(); return; }   // end of the edit
                  liveIdxRef.current = next;
                  setLiveIdx(next);
                  v.currentTime = rangeFor(beats[next]).start;   // skip the junk between takes
                }
              }}
            />
            {/* Nothing is drawn over the picture. Which line is playing shows
                in the beat list, which is already highlighting it. */}
            <span className="player-grip" />

            {/* The transport for Live edit. It reads the CUT's clock: the
                control bar this replaces read the source's, so a 7.9s edit
                announced itself as 0:13 and a 1:37 edit as 8:46. Scrubbing is
                the timeline underneath, which is already the working surface
                and is measured in the same clock. */}
            {liveMode && data.hasSource && data.beats.length > 0 && (
              <div className="live-transport">
                <button
                  type="button"
                  className="lt-play"
                  onClick={playLive}
                  aria-label={livePlaying ? "Pause" : "Play your cut"}
                  title={livePlaying ? "Pause — or press space" : "Play your cut — or press space"}
                >
                  {livePlaying ? (
                    <svg viewBox="0 0 12 14" aria-hidden="true"><rect x="1" y="1" width="3.5" height="12" rx="1" /><rect x="7.5" y="1" width="3.5" height="12" rx="1" /></svg>
                  ) : (
                    <svg viewBox="0 0 12 14" aria-hidden="true"><path d="M1.5 1.3 11 7 1.5 12.7Z" /></svg>
                  )}
                </button>
                <span className="lt-time mono">
                  {fmtTime(cutPlayhead ?? 0)}<span className="lt-sep">/</span>{fmtTime(cutDuration)}
                </span>
                <span className="lt-line">{data.beats[liveIdx]?.text ?? ""}</span>
              </div>
            )}

            {videoSrc && (
              <>
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  preload="metadata"
                  style={liveMode ? { display: "none" } : undefined}
                  onLoadedMetadata={(e) => {
                    const d = (e.target as HTMLVideoElement).duration;
                    if (Number.isFinite(d) && d > 0) setCutMediaDuration(d);
                    noteAspect(e);
                  }}
                  onTimeUpdate={(e) => setPlayhead((e.target as HTMLVideoElement).currentTime)}
                />
              </>
            )}
            {!liveMode && !videoSrc && (
              <div className="empty">
                <FlagIcon />
                <div>
                  {data.hasSource && data.beats.length === 0 ? (
                    <>
                      <b>Nothing to cut yet.</b><br />
                      The footage is here, but no beat list has been drafted from it —
                      that&apos;s the step that decides what the edit keeps.
                    </>
                  ) : data.hasSource ? (
                    <>
                      <b>No render yet.</b><br />
                      Switch to Live edit to watch it now, or build the file to post.
                    </>
                  ) : (
                    <>
                      <b>The raw footage isn&apos;t on this machine.</b><br />
                      {data.source} is still in iCloud. Download it in Finder and both
                      Live edit and Build will work — the beat list below is unaffected.
                    </>
                  )}
                </div>
                {data.hasSource && data.hasTranscript && data.beats.length === 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={buildJob?.status === "running"}
                    onClick={() => startStep("draft-beats")}
                  >
                    {buildJob?.status === "running" && buildJob.step === "draft-beats"
                      ? "Drafting…"
                      : "Draft the beat list"}
                  </button>
                )}
                {data.hasSource && !data.hasTranscript && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={buildJob?.status === "running"}
                    onClick={startTranscribe}
                  >
                    {buildJob?.status === "running" && buildJob.step === "transcribe"
                      ? "Transcribing…"
                      : "Transcribe the footage"}
                  </button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={buildJob?.status === "running" || !data.hasSource || data.beats.length === 0}
                  title={
                    !data.hasSource ? "the raw file isn't on this machine"
                      : data.beats.length === 0 ? "no beats to build from yet"
                      : undefined
                  }
                  onClick={startBuild}
                >
                  {buildJob?.status === "running"
                    ? buildJob.step === "build" ? "Building…" : "Waiting…"
                    : "Build cut"}
                </button>
              </div>
            )}
          </div>
      </div>

      {/* The edit itself, full width under the player -- the timeline is the
          working surface, so it gets the whole window rather than a column. */}
      {data.beats.length > 0 && (
        <div className="tl-wrap">
          <Timeline
            clips={data.beats}
            edl={data.edl}
            peaks={peaks?.peaks ?? null}
            rms={peaks?.rms ?? null}
            peakRate={peaks?.rate ?? 400}
            peaksError={peaksError}
            onRetryPeaks={loadPeaks}
            pictureStale={data.cutStale}
            stripUrlFor={
              data.cutFile
                ? (from, to, frames) =>
                    `/api/projects/${project}/filmstrip?of=cut&aspect=tall` +
                    `&start=${from.toFixed(2)}&end=${to.toFixed(2)}&count=${frames}`
                : null
            }
            stripCovers={null}
            playCutTime={cutPlayhead}
            selected={selectedClip}
            onSelect={setSelectedClip}
            onScrub={scrubCut}
            onTrim={timelineTrim}
            onDelete={(label) => {
              const b = data.beats.find((x) => x.label === label);
              beatOp({ op: "delete", label }, `Removed “${b?.text ?? label}”`);
              setSelectedClip(null);
            }}
            onSplit={(label, at) => beatOp({ op: "split", label, at }, "Split into two clips")}
            onReorder={(order) => beatOp({ op: "reorder", order }, "Moved that line")}
            onCutSpan={cutSpan}
            onScrubEnd={endScrubAudio}
            onGenerateGraphic={generateGraphicFor}
            generatingGraphic={gfxScanning}
            onDetach={detachAudio}
            onTrimAudio={audioTrim}
            onFade={setFade}
          />
          {/* Graphics belong to the thing they sit on, not to a panel of their
              own halfway down the page. Folded away by default so the cut has
              the room. */}
          <details className="gfx-fold" open={gfxOpen}
                   onToggle={(e) => setGfxOpen((e.target as HTMLDetailsElement).open)}>
            <summary>
              Motion graphics
              {gfxCount !== null && <span className="gfx-count mono">{gfxCount}</span>}
            </summary>
            <GraphicsPanel
              project={project}
              hasCut={!!data.cutFile}
              refreshKey={gfxNonce}
              onSeek={scrubCut}
              onJob={(jobId) => pollBuild(jobId)}
              onCount={setGfxCount}
            />
          </details>
        </div>
      )}

          {buildJob && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginBottom: 8 }}>
              {buildJob.step === "transcribe" ? "Transcribe" : "Build"} job{" "}
              {buildJob.status === "running" ? "(running)" : buildJob.status === "done" ? "(done)" : "(failed)"}
            </h3>
            <div className="mono" style={{ fontSize: 11.5, maxHeight: 160, overflowY: "auto", color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
              {buildJob.log.slice(-30).join("\n")}
            </div>
          </div>
        )}
        {buildError && (
          <div className="flag-note" style={{ marginTop: 12 }}>
            <FlagIcon /><div>{buildError}</div>
          </div>
        )}


        {level2Open && (
          <div className="timeline-wrap">
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Mark where it goes wrong
            </div>
            <p className="timeline-help">
              This strip is the whole cut, end to end. Click the moment that
              bothers you and SnipAi keeps a marker there — it&apos;s a pointer for
              the fix, not the fix itself. To change what a line actually keeps,
              use <b>Trim</b> on that line below.
            </p>
            <div
              className="timeline"
              style={
                data.cutFile
                  ? {
                      backgroundImage:
                        `url(/api/projects/${project}/filmstrip?of=cut&aspect=tall&count=22` +
                        `${cutMediaDuration ? `&end=${cutMediaDuration.toFixed(2)}` : ""})`,
                    }
                  : undefined
              }
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = ((e.clientX - rect.left) / rect.width) * 100;
                dropTimelineMarker(Math.round(pct * 10) / 10);
              }}
            >
              {/* where the cut is actually playing */}
              {!liveMode && cutDuration > 0 && (
                <div className="timeline-head" style={{ left: `${(playhead / cutDuration) * 100}%` }} />
              )}
              {data.reviewState.timelineMarkers.map((m, i) => (
                <button
                  type="button"
                  key={i}
                  className="timeline-mark"
                  style={{ left: `${m.atPct}%` }}
                  title={`marker at ${fmtTime((m.atPct / 100) * cutDuration)} — click to remove`}
                  onClick={(e) => { e.stopPropagation(); removeMarker(i); }}
                />
              ))}
            </div>
            <div className="timeline-scale">
              <span>0:00</span>
              <span className="mono">{data.reviewState.timelineMarkers.length} marker{data.reviewState.timelineMarkers.length === 1 ? "" : "s"}</span>
              <span>{fmtTime(cutDuration)}</span>
            </div>
            {data.reviewState.timelineMarkers.length > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button className="btn btn-sm btn-ghost" onClick={clearMarkers}>
                  Remove all markers
                </button>
              </div>
            )}
          </div>
        )}

      <div className="beats">
          <div className="beats-head">
            <h2>Lines</h2>
            <span className="eyebrow">
              {data.hasTranscript
                ? `${data.beats.length - flaggedCount} clean · ${flaggedCount} needs a call`
                : `${data.beats.length} lines · unscored, no transcript`}
            </span>
          </div>
          {data.beats.length === 0 && (
            <div className="empty-hint" style={{ padding: "22px 4px" }}>
              No beats drafted yet. SnipAi needs a transcript first, then it drafts the
              beat list — that&apos;s the edit you review here.
            </div>
          )}
          <div>
            {data.beats.map((b, i) => {
              const flagged = flaggedLabels.has(b.label);
              const statusClass = !data.hasTranscript ? "unscored" : flagged ? "flag" : "ok";
              const seg = data.cutTimeline?.find((t) => t.label === b.label);
              const isPlaying = liveMode ? i === liveIdx : (!!seg && playhead >= seg.start && playhead < seg.end);
              return (
                <div key={`${b.label}-${i}`} className="beat-wrap">
                {/* A <button> may not contain other controls. It did, which
                    left Trim/Bad take/Note unreachable by keyboard and made a
                    screen reader read the whole row as one run-on label. */}
                <div
                  className={`beat ${statusClass}${isPlaying ? " playing" : ""}`
                    + (trimBeat === b.label ? " open" : "")
                    + (selectedClip === b.label ? " selected" : "")}
                  data-beat={b.label}
                  role="button"
                  tabIndex={0}
                  /* Picking a line asks to follow it again -- but never moves
                     the page to it: the row you clicked is under your cursor,
                     so it is already on screen by definition. */
                  onClick={() => { yieldedAt.current = 0; setSelectedClip(b.label); seekToBeat(b.label); }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;   // let the inner buttons act
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedClip(b.label); seekToBeat(b.label);
                    }
                  }}
                >
                  <span className="num">{i + 1}</span>
                  <span className="tc">{fmtTime(b.start)}</span>
                  <span className="txt">
                    {/* The line as spoken is the thing being reviewed. The
                        label is a filename for build_cut.py, not a title. */}
                    {spoken?.label === b.label ? (
                      /* Only the line being spoken is split into words. Every
                         other row stays a single node, so following the
                         playback costs one row's worth of work, not the list's. */
                      <b className="txt-live">
                        {wordsOf(b).map((w, wi) => (
                          <span key={wi} className={wi === spoken.wordIx ? "wd on" : "wd"}>
                            {w.w}
                          </span>
                        ))}
                      </b>
                    ) : b.text ? <b>{b.text}</b> : <b>{b.label.replace(/-/g, " ")}</b>}
                    {b.holes?.length ? (
                      <span className="beat-hole mono"
                            title={`${b.holes.length} stretch${b.holes.length > 1 ? "es" : ""} cut out of the middle of this line`}>
                        &minus;{b.holes.reduce((n, h) => n + (h[1] - h[0]), 0).toFixed(2)}s
                      </span>
                    ) : null}
                    {analysis[b.label] && (
                      <span className="beat-conf mono">
                        {Math.round(analysis[b.label].confidence * 100)}%
                        {analysis[b.label].attempts > 1 ? ` · ${analysis[b.label].attempts} takes` : ""}
                      </span>
                    )}
                  </span>
                  <span className="beat-actions">
                    <button
                      type="button"
                      className="beat-act"
                      title="Trim the in/out points of this line"
                      aria-label={`Trim ${b.label.replace(/-/g, " ")}`}
                      onClick={(e) => { e.stopPropagation(); openTrim(b); }}
                    >Trim</button>
                    <button
                      type="button"
                      className="beat-act"
                      title="Look at the other takes of this line"
                      aria-label={`Other takes of ${b.label.replace(/-/g, " ")}`}
                      onClick={(e) => { e.stopPropagation(); openTakePicker(b); }}
                    >Takes</button>
                    <button
                      type="button"
                      className="beat-act"
                      title="Put a motion graphic on this line"
                      aria-label={`Add a graphic to ${b.text ?? b.label}`}
                      onClick={(e) => { e.stopPropagation(); setGfxFor(b); }}
                    >Graphic</button>
                    <button
                      type="button"
                      className="beat-act bad"
                      title="Cut this line out of the video"
                      aria-label={`Delete ${b.text ?? b.label}`}
                      onClick={(e) => { e.stopPropagation(); deleteBeat(b); }}
                    >Delete</button>
                    <span className="status">
                      {statusClass === "flag" ? <FlagIcon /> : statusClass === "ok" ? <CheckIcon /> : <DotIcon />}
                    </span>
                  </span>
                </div>
                {trimBeat === b.label && trim && (
                  <div className="trim-row" key={`${b.label}-trim`}>
                    <TrimWave
                      peaks={peaks?.peaks ?? null}
                      rms={peaks?.rms ?? null}
                      rate={peaks?.rate ?? 400}
                      start={trim.start}
                      end={trim.end}
                      viewStart={Math.max(0, b.start - snipPad)}
                      viewEnd={b.end + snipPad}
                      words={data.words}
                      playhead={rawHead}
                      monitorFor={data.hasSource ? rawRef : undefined}
                      selection={selection}
                      holes={b.holes ?? null}
                      onSelectRange={setSelection}
                      onZoom={(d) => setSnipPad((v) => Math.max(0.5, Math.min(15, v + d)))}
                      canZoomIn={snipPad > 0.5}
                      canZoomOut={snipPad < 15}
                      stripUrl={
                        data.hasSource
                          ? `/api/projects/${project}/filmstrip?of=source` +
                            `&start=${Math.max(0, b.start - snipPad).toFixed(2)}` +
                            `&end=${(b.end + snipPad).toFixed(2)}` +
                            `&count=${Math.min(40, Math.round(8 + snipPad * 4))}`
                          : null
                      }
                      onScrub={scrubTo}
                      onDragEdge={dragEdge}
                    />
                    {/* The drafter's in/out is not the only take that exists.
                        Opening the window up reaches the ones either side --
                        the second and third "here" it cut off. */}
                    {selection && selection.to - selection.from > 0.02 && (
                      <div className="snip-actions">
                        <span className="snip-selinfo">
                          {(selection.to - selection.from).toFixed(2)}s highlighted
                        </span>
                        <button className="ui-btn ui-btn-sm ui-btn-danger"
                                onClick={() => deleteSelection(b)}>
                          Cut this bit out
                        </button>
                        <button className="ui-btn ui-btn-sm"
                                onClick={() => setTrim({ start: selection.from, end: selection.to })}>
                          Keep only this
                        </button>
                        <button className="ui-btn ui-btn-quiet ui-btn-sm"
                                onClick={() => setSelection(null)}>Clear</button>
                      </div>
                    )}
                    {/* Just the moves: play, cut a bit out, save. The window is
                        zoomed by scrolling the wave, and the edges are dragged on
                        it -- neither needs a row of numbers. */}
                    <span className="trim-read mono">
                      {fmtTime(trim.start)} – {fmtTime(trim.end)}
                      <b>{(trim.end - trim.start).toFixed(2)}s</b>
                      {(() => {
                        const d = (trim.end - trim.start) - (b.end - b.start);
                        return Math.abs(d) > 0.001
                          ? <span className="trim-delta">{d > 0 ? "+" : ""}{d.toFixed(2)}</span>
                          : null;
                      })()}
                    </span>
                    <button
                      className="ui-btn ui-btn-sm"
                      disabled={!data.hasSource}
                      title="Play just this line — or press space"
                      onClick={previewTrim}
                    >Play</button>
                    <button className="ui-btn ui-btn-sm ui-btn-quiet" onClick={() => { setTrimBeat(null); setTrim(null); setSelection(null); }}>Cancel</button>
                    <button className="ui-btn ui-btn-sm ui-btn-primary" onClick={saveTrim} disabled={trimSaving}>
                      {trimSaving ? "Saving…" : "Save trim"}
                    </button>
                  </div>
                )}
                </div>
                );
            })}
          </div>
        </div>

      {/* VERSION HISTORY */}
      {historyOpen && (
        <Overlay onClose={() => setHistoryOpen(false)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <div>
                <h3>Version history</h3>
                <p>
                  A copy is kept every time the edit changes. Undo only reaches back
                  as far as this page has been open — this reaches back further.
                </p>
              </div>
              <button className="modal-close" onClick={() => setHistoryOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              {versions === null && <div className="empty-state">Reading the history…</div>}
              {versions?.length === 0 && (
                <div className="empty-state">
                  <b>Nothing to go back to yet.</b><br />
                  A version is kept from your next edit onwards.
                </div>
              )}
              {versions?.map((snap, i) => (
                <div className="ver" key={snap.id}>
                  <span className="ver-when mono" title={snap.takenAt}>
                    {new Date(snap.takenAt).toLocaleTimeString([], {
                      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
                    })}
                  </span>
                  <span className="ver-what">
                    <span className="ver-reason">
                      {snap.reason}
                      {i === 0 && <span className="ver-tag">most recent</span>}
                    </span>
                    {/* what the edit WAS at this point -- the thing that tells
                        two same-named versions apart */}
                    <span className="ver-state mono">
                      {snap.beats} beats · {fmtTime(snap.duration)}
                    </span>
                  </span>
                  <button
                    className="ui-btn ui-btn-sm"
                    disabled={restoring !== null}
                    title="Put the edit back to how it was before this change"
                    onClick={() => restoreSnapshot(snap.id)}
                  >
                    {restoring === snap.id ? "Putting back…" : "Put back"}
                  </button>
                </div>
              ))}
            </div>
            {!!versions?.length && (
              <div className="modal-foot">
                <span className="ver-note">
                  Putting one back keeps a copy of where you are now, so this is
                  never a one-way door.
                </span>
              </div>
            )}
          </div>
        </Overlay>
      )}

      {gfxFor && (
        <Overlay onClose={() => setGfxFor(null)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <div>
                <h3>Graphic for this line</h3>
                <p>{gfxFor.text ?? gfxFor.label.replace(/-/g, " ")}</p>
              </div>
              <button className="modal-close" onClick={() => setGfxFor(null)}>✕</button>
            </div>
            <GraphicPicker beat={gfxFor} onPick={addGraphic} onNote={saveGraphicNote} />
          </div>
        </Overlay>
      )}

      {/* LEVEL 3 modal */}

      {/* TAKE PICKER modal */}
      {takePickerBeat && (
        <Overlay onClose={() => setTakePickerBeat(null)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <div>
                <h3>{takePickerBeat.label.replace(/-/g, " ")}</h3>
                <p>{candidates ? `Region ${candidates.region.start.toFixed(1)}–${candidates.region.end.toFixed(1)}s — pick the read that looks right, or keep the top pick.` : "Scanning source region for candidate takes…"}</p>
              </div>
              <button className="modal-close" onClick={() => setTakePickerBeat(null)}>✕</button>
            </div>
            <div className="modal-body">
              {candidatesLoading && <div className="empty-state">Scanning…</div>}
              {candidatesError && (
                <div className="flag-note">
                  <FlagIcon /><div>{candidatesError}</div>
                </div>
              )}
              {candidates?.candidates.map((c) => (
                <div key={c.id} className={`take${selectedCandidateId === c.id ? " picked" : ""}`} onClick={() => setSelectedCandidateId(c.id)}>
                  <div className="take-head">
                    <span className="tlabel">{c.id.replace("take-", "Take ")} · {(c.confidence * 100).toFixed(0)}%</span>
                    <span className="ttime">{c.start.toFixed(2)}–{c.end.toFixed(2)}</span>
                  </div>
                  <div className="take-quote">&quot;{c.text}&quot;</div>
                  {c.flags.map((f) => (
                    <span className="take-flag" key={f} style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>⚠ {f.replace(/_/g, " ")}</span>
                  ))}
                  {c.id === candidates.recommendedId && (
                    <span className="take-flag" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>TOP PICK · {(c.confidence * 100).toFixed(0)}% confidence</span>
                  )}
                  {selectedCandidateId === c.id && (
                    <div className="why-list">
                      {c.why.map((w, i) => (
                        <div key={i} className={w.ok ? "yes" : "warn"}>{w.ok ? "✓" : "⚠"} {w.label}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setTakePickerBeat(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={!selectedCandidateId} onClick={approveTakePick}>Approve this pick</button>
            </div>
          </div>
        </Overlay>
      )}

      {/* LEARNING CAPTURE modal */}
      {learnAfterBeat !== null && (
        <Overlay onClose={() => { setLearnAfterBeat(null); setLearnText(""); }}>
          <div className="modal">
            <div className="modal-head">
              <div><h3>Anything worth remembering?</h3><p>Optional — skip if the pick was right.</p></div>
              <button className="modal-close" onClick={() => { setLearnAfterBeat(null); setLearnText(""); }}>✕</button>
            </div>
            <div className="modal-body">
              <textarea
                className="textline"
                placeholder="e.g. this one's technically clean but I look flat at the end — use the take where I'm more animated, even with the pause"
                value={learnText}
                onChange={(e) => setLearnText(e.target.value)}
              />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => { setLearnAfterBeat(null); setLearnText(""); }}>Just fix this one</button>
              <button className="btn btn-primary" onClick={saveLearning}>Save preference</button>
            </div>
          </div>
        </Overlay>
      )}

      {toastMsg && (
        <div className="toast show">
          <CheckIcon /><span>{toastMsg}</span>
          {undo && <button className="toast-undo" onClick={undoDelete}>Undo</button>}
        </div>
      )}

      {/* It learns on every edit, so announcing it on every edit is noise --
          it interrupts the cutting to tell you about the cutting. It stays
          available in Settings, where you can read the rules and turn any of
          them off; this card now only appears when you ask for it. */}
      {learned && learnedOpen && (
        <div className="learned-card">
          <div className="learned-head">
            <b>SnipAi learned from that</b>
            <button onClick={() => { setLearned(null); setLearnedOpen(false); }} aria-label="dismiss">✕</button>
          </div>
          <ul>
            {learned.map((l, i) => <li key={i} className="mono">{l}</li>)}
          </ul>
          <p>New videos will be cut this way from now on — you should have to fix this less.</p>
        </div>
      )}
    </section>
  );
}

const RENDERABLE = /\b(card|caption|text|title|label|word|number|stat|percent|define|definition|call ?out|lower third|subtitle)\b/i;

function GraphicPicker({
  beat,
  onPick,
  onNote,
}: {
  beat: Beat;
  onPick: (b: Beat, kind: string, copy: Record<string, string>) => void;
  onNote: (b: Beat, text: string) => void;
}) {
  const said = (beat.text ?? "").replace(/[.,]$/, "");
  const [kind, setKind] = useState("emphasis");
  const [spoken, setSpoken] = useState("");
  const [a, setA] = useState(said.split(" ").slice(0, 3).join(" "));
  const [b, setB] = useState("");

  const FIELDS: Record<string, { one: string; two?: string; hintOne: string; hintTwo?: string }> = {
    ai_overlay:  { one: "Where on you", two: "What should it look like",
                   hintOne: "e.g. my neck · under my eyes · my jawline",
                   hintTwo: "e.g. aged about 80, everything else unchanged" },
    emphasis:    { one: "Word or phrase", hintOne: "lands big in the middle of frame" },
    callout:     { one: "Label", hintOne: "slides in from the left — “BEFORE”, “DAY 1”" },
    stat:        { one: "Number", two: "Caption", hintOne: "e.g. 92%", hintTwo: "e.g. saw firmer skin" },
    definition:  { one: "Term", two: "Meaning", hintOne: "e.g. EGF", hintTwo: "what it means, in your words" },
    lower_third: { one: "Title", two: "Subtitle", hintOne: "e.g. Medicube NAD+", hintTwo: "e.g. Firming Serum" },
  };
  const f = FIELDS[kind];
  const keys: Record<string, [string, string?]> = {
    emphasis: ["text"], callout: ["text"], stat: ["value", "caption"],
    definition: ["term", "definition"], lower_third: ["title", "subtitle"],
    ai_overlay: ["region", "prompt"],
  };

  return (
    <>
      <div className="modal-body">
        <VoiceInput onText={(t) => { setA(t); setSpoken(t); }} />
        {spoken && !RENDERABLE.test(spoken) && kind !== "ai_overlay" && (
          <div className="gfx-cant">
            <b>That sounds like a shot, not a caption.</b>
            <div>
              SnipAi composites video, it doesn&apos;t generate it — so it can&apos;t make that
              clip. Record it as an <b>AI shot</b> and it keeps the description and the
              exact timing, ready for whatever generates it.
            </div>
            <button className="ui-btn ui-btn-sm" onClick={() => { setKind("ai_overlay"); setB(spoken); }}>
              Make it an AI shot request
            </button>
          </div>
        )}
        {kind === "ai_overlay" && (
          <div className="gfx-cant">
            <b>This is a request, not something SnipAi renders.</b>
            <div>
              It records what you want and exactly when — this line, to the frame.
              Generate the shot elsewhere, drop the file in, and SnipAi places it here.
            </div>
          </div>
        )}
        <div className="gfx-kinds">
          {Object.keys(FIELDS).map((k) => (
            <button key={k} className={`ui-btn ui-btn-sm${kind === k ? " ui-btn-primary" : ""}`}
                    onClick={() => setKind(k)}>
              {k === "lower_third" ? "Lower third"
              : k === "ai_overlay" ? "AI shot"
              : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
        <label className="gfx-field">
          <span>{f.one}</span>
          <input className="field" value={a} placeholder={f.hintOne} onChange={(e) => setA(e.target.value)} />
        </label>
        {f.two && (
          <label className="gfx-field">
            <span>{f.two}</span>
            <input className="field" value={b} placeholder={f.hintTwo} onChange={(e) => setB(e.target.value)} />
          </label>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={() => onPick(beat, kind, {})} disabled>
          &nbsp;
        </button>
        <button
          className="btn btn-primary"
          disabled={!a.trim()}
          onClick={() => {
            const [k1, k2] = keys[kind];
            const copy: Record<string, string> = { [k1]: a.trim() };
            if (k2) copy[k2] = b.trim();
            onPick(beat, kind, copy);
          }}
        >
          {kind === "ai_overlay" ? "Save this request" : "Add to this line"}
        </button>
      </div>
    </>
  );
}

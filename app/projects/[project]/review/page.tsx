"use client";

import Overlay from "@/app/components/Overlay";
import TrimWave from "@/app/components/TrimWave";
import Timeline, { layout } from "@/app/components/Timeline";
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
  const [diagnosisBeat, setDiagnosisBeat] = useState<Beat | null>(null);
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
  const [playhead, setPlayhead] = useState(0);
  const [trimBeat, setTrimBeat] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Snapshot[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null);
  const [trimSaving, setTrimSaving] = useState(false);
  const [peaks, setPeaks] = useState<{ rate: number; peaks: number[]; rms?: number[] } | null>(null);
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
  const pushHistory = useCallback((what: string) => {
    const beats = beatsRef.current;
    if (!beats.length) return;
    setHistory((h) => [...h.slice(-24), { beats: beats.map((b) => ({ ...b })), what }]);
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
    setUndo(null);
    await load();
    toast(`Undid ${last.what}`);
  }
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
      pushHistory("trimming that edge off");
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
      setSelection(null);
      setTrim(next);
      await load();
      toast(`Cut ${(to - from).toFixed(2)}s off the ${headCut ? "start" : "end"}`);
      learnFromEdits();
      return;
    }
    pushHistory("cutting that bit out");
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
    setSelection(null);
    await load();
    toast(`Cut out ${(to - from).toFixed(2)}s — the gap closed`);
    learnFromEdits();
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
    document.querySelector(`[data-beat="${label}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const rawRef = useRef<HTMLVideoElement | null>(null);
  const stopAt = useRef<number | null>(null);
  // Live-edit playback: the raw file plays, jumping beat to beat using the
  // CURRENT in/out points. A trim is audible immediately -- no re-render,
  // because the edit is an instruction over the source, not a baked file.
  const [liveMode, setLiveMode] = useState(false);
  const [liveIdx, setLiveIdx] = useState(0);
  const liveIdxRef = useRef(0);
  const beatsRef = useRef<Beat[]>([]);
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
    setRestoring(id);
    const r = await fetch(`/api/projects/${project}/snapshots`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setRestoring(null);
    if (!r.ok) { toast((await r.json().catch(() => ({}))).error ?? "could not restore that"); return; }
    setVersions((await r.json()).snapshots);
    // the open trim now points at a beat that may have moved under it
    setTrimBeat(null); setTrim(null); setSelection(null);
    await load();
    setHistoryOpen(false);
    toast("Put back — and this is undoable too");
  }

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
    setLiveMode(true);
    videoRef.current?.pause();
    v.pause();
    stopAt.current = null;
    v.currentTime = Math.max(0, t);
    setRawHead(t);
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
    setLiveMode(true);
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
    setLiveMode(true);            // show it, don't just play audio behind a hidden element
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
      setData(fresh);
      setNotFound(false);
    } else if (res.status === 404 || res.status === 400) {
      // otherwise this sits on "Loading…" forever for a project that isn't there
      setNotFound(true);
    }
  }, [project]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // the timeline's audio track needs this; fetch it once, up front
    fetch(`/api/projects/${project}/peaks`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPeaks({ rate: d.rate, peaks: d.peaks, rms: d.rms }))
      .catch(() => {});
  }, [project]);
  useEffect(() => { beatsRef.current = data?.beats ?? []; }, [data]);
  const defaulted = useRef(false);
  useEffect(() => {
    if (data && !defaulted.current) { defaulted.current = true; if (!data.cutFile && data.hasSource && data.beats.length > 0) setLiveMode(true); }
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

  function playFrom(index: number) {
    const beats = beatsRef.current;
    if (!beats.length || !rawRef.current) return;
    const i = Math.max(0, Math.min(index, beats.length - 1));
    liveIdxRef.current = i;
    setLiveIdx(i);
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
        if (!v) return;
        setLiveMode(true);
        if (v.paused) { videoRef.current?.pause(); v.play().catch(() => {}); } else v.pause();
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
        if (beats[i]) { setSelectedClip(beats[i].label); seekToBeat(beats[i].label); }
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
    toast(
      status === "approved" ? "Approved — ready to post" :
      status === "needs_fixes" ? "Marked as needing fixes" :
      "Sent back to re-cut"
    );
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
    scrubTo(c.start + Math.max(0, Math.min(c.dur, cutTime - c.at)));
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
      if (res.ok) { await load(); learnFromEdits(); } else { await load(); }
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
    }, 420);
  }

  /** Drop a line, no questions. One undo, offered in the toast. */
  async function deleteBeat(b: Beat) {
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
    toast(done);
  }

  /** Length of the built cut. Read off the file itself where possible: the
   *  beat maths comes to 2:17 where the render is 1:58, because build_cut
   *  snaps every edge inward against the silence map. */
  const beatsDuration = (data?.beats ?? []).reduce((sum, b) => sum + Math.max(0, b.end - b.start), 0);
  const cutDuration = cutMediaDuration ?? beatsDuration;

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
    }
  }

  async function submitDiagnosis(checks: string[], note: string) {
    if (!diagnosisBeat) return;
    await fetch(`/api/projects/${project}/review-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "level3_diagnosis", beatLabel: diagnosisBeat.label, checks, note }),
    });
    await load();
    if (checks.includes("Wrong take")) {
      const beat = diagnosisBeat;
      setDiagnosisBeat(null);
      openTakePicker(beat);
    } else {
      toast("Saved");
      setDiagnosisBeat(null);
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
            <button
              className="btn btn-ghost"
              onClick={() => { setLevel2Open(true); setLevel1("needs_fixes"); }}
            >
              Needs fixes
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
                  : data.beats.length === 0 ? "no beats drafted yet — nothing to play"
                  : "Your edit played straight off the original footage"
              }
              onClick={() => playFrom(liveIdx)}
            >
              Original footage
            </button>
            {data.cutFile && (
              <button
                className={`pm${!liveMode && !(showGraphics && data.graphicsFile) ? " active" : ""}`}
                onClick={() => { setShowGraphics(false); rawRef.current?.pause(); setLiveMode(false); }}
              >
                {data.graphicsFile ? "Clean cut" : "Rendered cut"}
              </button>
            )}
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
            {data.cutStale && (
              <button
                className="ui-btn ui-btn-sm ui-btn-primary pm-apply"
                disabled={buildJob?.status === "running" || !data.hasSource || data.beats.length === 0}
                title="Re-render the cut so the file matches your edits"
                onClick={startBuild}
              >
                {buildJob?.status === "running" && buildJob.step === "build"
                  ? "Applying…"
                  : "Apply edits to the render"}
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

          <div className="player">
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
              controls={liveMode}
              preload="metadata"
              style={liveMode ? undefined : { display: "none" }}
              onTimeUpdate={(e) => {
                const v = e.target as HTMLVideoElement;
                setRawHead(v.currentTime);

                // previewing a single trimmed range
                if (stopAt.current !== null) {
                  const openBeat = beatsRef.current.find((x) => x.label === trimBeat);
                  for (const [hf, ht] of openBeat?.holes ?? []) {
                    if (v.currentTime >= hf && v.currentTime < ht - 0.02) { v.currentTime = ht; return; }
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
                for (const [hf, ht] of cur.holes ?? []) {
                  if (v.currentTime >= hf && v.currentTime < ht - 0.02) {
                    v.currentTime = ht;
                    return;
                  }
                }
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
            {liveMode && data.beats.length > 0 && (
              <span className="frame-tag live">
                LIVE · beat {liveIdx + 1}/{data.beats.length} · {data.beats[liveIdx]?.label.replace(/-/g, " ")}
              </span>
            )}

            {videoSrc && (
              <>
                {!liveMode && <span className="frame-tag">{playFile}</span>}
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  preload="metadata"
                  style={liveMode ? { display: "none" } : undefined}
                  onLoadedMetadata={(e) => {
                    const d = (e.target as HTMLVideoElement).duration;
                    if (Number.isFinite(d) && d > 0) setCutMediaDuration(d);
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
            onDetach={detachAudio}
            onTrimAudio={audioTrim}
            onFade={setFade}
          />
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


        {data.reviewState.cutStatus !== "unreviewed" && (
          <div className="flag-note info" style={{ marginTop: 12 }}>
            <DotIcon />
            <div>Current status: <b>{data.reviewState.cutStatus.replace("_", " ")}</b></div>
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

      <GraphicsPanel
        project={project}
        hasCut={!!data.cutFile}
        refreshKey={gfxNonce}
        onSeek={scrubCut}
        onJob={(jobId) => pollBuild(jobId)}
      />

      <div className="beats">
          <div className="beats-head">
            <h2>Beats — as cut</h2>
            <span className="eyebrow">
              {data.hasTranscript
                ? `${data.beats.length - flaggedCount} clean · ${flaggedCount} needs a call`
                : `${data.beats.length} beats · unscored, no transcript`}
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
              const diagnosed = !!data.reviewState.beatDiagnoses[b.label];
              const statusClass = !data.hasTranscript ? "unscored" : flagged ? "flag" : "ok";
              const seg = data.cutTimeline?.find((t) => t.label === b.label);
              const isPlaying = liveMode ? i === liveIdx : (!!seg && playhead >= seg.start && playhead < seg.end);
              return (
                <div key={`${b.label}-${i}`} className="beat-wrap">
                {/* A <button> may not contain other controls. It did, which
                    left Trim/Bad take/Note unreachable by keyboard and made a
                    screen reader read the whole row as one run-on label. */}
                <div
                  className={`beat ${statusClass}${isPlaying ? " playing" : ""}${trimBeat === b.label ? " open" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => (liveMode || seg ? seekToBeat(b.label) : setDiagnosisBeat(b))}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;   // let the inner buttons act
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (liveMode || seg) seekToBeat(b.label); else setDiagnosisBeat(b);
                    }
                  }}
                >
                  <span className="num">{i + 1}</span>
                  <span className="tc">{fmtTime(b.start)}</span>
                  <span className="txt">
                    {/* The line as spoken is the thing being reviewed. The
                        label is a filename for build_cut.py, not a title. */}
                    {b.text ? <b>{b.text}</b> : <b>{b.label.replace(/-/g, " ")}</b>}
                    {diagnosed ? " (noted)" : ""}
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
                    <button
                      type="button"
                      className="beat-act"
                      title="Tell SnipAi what was wrong"
                      aria-label={`Note on ${b.label.replace(/-/g, " ")}`}
                      onClick={(e) => { e.stopPropagation(); setDiagnosisBeat(b); }}
                    >Note</button>
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
      {diagnosisBeat && (
        <DiagnosisModal
          beat={diagnosisBeat}
          flag={data.wordBoundaryFlags.find((f) => f.beatLabel === diagnosisBeat.label) ?? null}
          onClose={() => setDiagnosisBeat(null)}
          onSubmit={submitDiagnosis}
        />
      )}

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

      {/* The thing he's actually after: proof it got the message, and that
          the next video starts closer to right. */}
      {learned && (
        <div className="learned-card">
          <div className="learned-head">
            <b>SnipAi learned from that</b>
            <button onClick={() => setLearned(null)} aria-label="dismiss">✕</button>
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

function DiagnosisModal({
  beat,
  flag,
  onClose,
  onSubmit,
}: {
  beat: Beat;
  flag: WordBoundaryFlag | null;
  onClose: () => void;
  onSubmit: (checks: string[], note: string) => void;
}) {
  const [checks, setChecks] = useState<string[]>([]);
  const [note, setNote] = useState("");

  function toggle(c: string) {
    setChecks((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  }

  return (
    <Overlay onClose={onClose}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <h3>What&apos;s wrong with this line?</h3>
            <p>{beat.text ?? beat.label.replace(/-/g, " ")}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {flag ? (
            <div className="flag-note">
              <FlagIcon />
              <div><b>AI detected a potential problem.</b> This beat&apos;s {flag.edge} sits {flag.distanceSec.toFixed(2)}s inside the word &quot;{flag.nearWord}&quot;. Did it sound cut off?</div>
            </div>
          ) : (
            <div className="flag-note info">
              <DotIcon />
              <div>No automatic flag on this beat — tell SnipAi what you&apos;re seeing.</div>
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Select all that apply</div>
            {DIAGNOSIS_CHECKS.map((c) => (
              <label className="check-row" key={c}>
                <input type="checkbox" checked={checks.includes(c)} onChange={() => toggle(c)} />
                {c}
              </label>
            ))}
            <textarea className="textline" placeholder="Or just say it in your own words…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={checks.length === 0 && !note.trim()}
            onClick={() => onSubmit(checks, note)}
          >
            Save
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Pick what kind of graphic goes on a line, and write its copy.
 *  Defaults are seeded from the line itself so the common case is two clicks. */
/** Words that mean "put text on screen", which is what SnipAi can actually
 *  render. Anything else spoken here is asking for footage it cannot make. */
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

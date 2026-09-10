"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type { Clip, EdlPiece, Piece, Placed } from "@/lib/timelineLayout";
import type { Clip, EdlPiece, Piece, Placed } from "@/lib/timelineLayout";
import { layout, baseLabel, reorderTo } from "@/lib/timelineLayout";
export { layout };

const ZOOMS = [10, 16, 25, 40, 64, 100, 160, 260];   // pixels per second

/**
 * The edit, laid out in time.
 *
 * Two tracks over one ruler: the picture on top, the audio underneath. The
 * audio is the one that matters for a tight cut -- you can see the consonant
 * end and the silence start, which is the difference between trimming by eye
 * and trimming by guesswork. Everything is drawn from the beat list, so an
 * edit shows up here the moment it's made, with nothing rendered.
 */
export default function Timeline({
  clips,
  edl,
  peaks,
  rms,
  peakRate,
  peaksError,
  onRetryPeaks,
  stripUrlFor,
  stripCovers,
  playCutTime,
  selected,
  onSelect,
  onScrub,
  onTrim,
  onDelete,
  onSplit,
  onDetach,
  onTrimAudio,
  onFade,
  onReorder,
  onCutSpan,
  onScrubEnd,
  onGenerateGraphic,
  generatingGraphic,
}: {
  clips: Clip[];
  edl?: EdlPiece[];
  peaks: number[] | null;
  rms?: number[] | null;
  peakRate: number;
  /** why there is no waveform, if there is not going to be one */
  peaksError?: string | null;
  onRetryPeaks?: () => void;
  /** builds a filmstrip URL for a window of the cut, at a frame count that
   *  suits the zoom -- a fixed strip stretched across the whole timeline
   *  smears every face the moment you zoom in */
  stripUrlFor: ((start: number, end: number, frames: number) => string) | null;
  /** seconds of cut the strip covers (its own length, which may be stale) */
  stripCovers: number | null;
  /** playhead in cut time, or null when nothing is playing */
  playCutTime: number | null;
  selected: string | null;
  onSelect: (label: string | null) => void;
  onScrub: (cutTime: number) => void;
  onTrim: (label: string, edge: "start" | "end", sourceTime: number) => void;
  onDelete: (label: string) => void;
  onSplit: (label: string, sourceTime: number) => void;
  /** null relinks the audio to the picture */
  onDetach: (label: string, range: { start: number; end: number } | null) => void;
  onTrimAudio: (label: string, edge: "start" | "end", sourceTime: number) => void;
  onFade: (label: string, edge: "in" | "out", seconds: number) => void;
  /** the whole beat list, in its new order */
  onReorder: (order: string[]) => void;
  /** take a stretch of the cut out, in cut seconds */
  onCutSpan: (from: number, to: number) => void;
  /** the hand let go: stop any audio the scrub was playing */
  onScrubEnd?: () => void;
  /** read one line and put a card on it if it earns one */
  onGenerateGraphic: (label: string) => void;
  generatingGraphic: string | null;
}) {
  const [zoomIx, setZoomIx] = useState(2);
  const zoomIxRef = useRef(2);
  useEffect(() => { zoomIxRef.current = zoomIx; }, [zoomIx]);
  const pps = ZOOMS[zoomIx];
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLCanvasElement | null>(null);
  /* The anchor is captured at mousedown and never recomputed.
     The delta used to be measured against the clip's live position, which
     moves as you trim -- so each frame added the previous frame's move again
     and the in-point ran away, collapsing the clip to its 0.15s floor before
     you could let go. Pointer position is absolute; the maths has to be too. */
  const [drag, setDrag] = useState<{
    label: string; edge: "start" | "end"; track: "video" | "audio";
    fromCut: number; fromSrc: number;
  } | null>(null);
  const [fading, setFading] = useState<{ label: string; edge: "in" | "out" } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  /* Moving a clip and scrubbing start from the same gesture: a press on a clip
     is a scrub until the pointer travels far enough to mean something else.
     Deciding by distance rather than by a modifier key means neither has to be
     discovered. */
  const [moving, setMoving] = useState<{
    label: string; fromX: number; at: number; dur: number; dx: number; live: boolean;
  } | null>(null);
  /** index in the current order the clip would land BEFORE */
  const [dropAt, setDropAt] = useState<number | null>(null);
  /** a marked stretch of the cut, in cut seconds, waiting for Delete */
  const [span, setSpan] = useState<{ from: number; to: number } | null>(null);
  const [marking, setMarking] = useState<{ anchor: number; moved: boolean } | null>(null);
  /* Only the visible slice of film is fetched, at one thumbnail per ~44px.
     That keeps every frame at its own aspect however far you zoom in, and
     keeps the image small however long the cut is. */
  const [strip, setStrip] = useState<{ url: string; from: number; to: number } | null>(null);
  const [scrollX, setScrollX] = useState(0);
  /* Where the mouse actually is while dragging.
     The playhead used to be driven by the video's timeupdate, which fires a
     few times a second and lands on decoded frames -- so it trailed the
     cursor and appeared to snap. Drawing from the pointer instead makes it
     land exactly where you let go, with nothing to wait for. */
  const [dragHead, setDragHead] = useState<number | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);

  const { placed, pieces, total } = useMemo(() => layout(clips, edl), [clips, edl]);

  // Once the beat list and the EDL disagree, the rendered pictures no longer
  // sit where the clips do. Say so rather than showing a strip that quietly
  // lies about which frame is where.
  const stripStale = useMemo(() => {
    if (!edl || !edl.length) return false;
    const known = new Set(clips.map((c) => c.label));
    const inEdl = new Set(edl.map((e) => baseLabel(e.label, known)));
    return clips.some((c) => !inEdl.has(c.label)) || [...inEdl].some((l) => !known.has(l));
  }, [clips, edl]);
  const width = Math.max(320, total * pps);

  const cutTimeAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(total, (clientX - r.left + el.scrollLeft) / pps));
    },
    [pps, total]
  );

  /** cut time -> which beat, and where inside its source range */
  const resolve = useCallback(
    (t: number) => {
      const p = pieces.find((c) => t >= c.at && t < c.at + c.dur) ?? pieces[pieces.length - 1];
      if (!p) return null;
      const clip = placed.find((c) => c.label === p.beatLabel) ?? placed[0];
      return { clip, sourceTime: p.srcStart + Math.max(0, Math.min(p.dur, t - p.at)) };
    },
    [pieces, placed]
  );

  // ---- audio track ---------------------------------------------------------
  /* Only the visible slice is drawn.
     The canvas used to span the whole timeline: at 260px/s that is a
     57,000 x 236 device-pixel surface -- 13.5 MILLION pixels, past what some
     browsers will even allocate, and every zoom redrew all of it. Sizing it
     to the viewport and offsetting it by the scroll makes the work constant
     however long the cut is or how far in you zoom. */
  useEffect(() => {
    const cv = audioRef.current;
    const el = scrollRef.current;
    if (!cv || !el) return;

    let raf = 0;
    const draw = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      const viewW = el.clientWidth;
      const h = (cv.parentElement as HTMLElement | null)?.clientHeight ?? 0;
      // the first paint can land before layout; try again next frame rather
      // than leaving the browser's default 300x150 canvas on screen
      if (!viewW || !h) { raf = requestAnimationFrame(draw); return; }
      cv.style.width = `${viewW}px`;
      cv.style.height = `${h}px`;
      cv.width = Math.round(viewW * dpr);
      cv.height = Math.round(h * dpr);
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!peaks) return;

      const css = getComputedStyle(document.documentElement);
      const wave = css.getPropertyValue("--tl-wave").trim() || "#3fd8e8";
      const waveSel = css.getPropertyValue("--tl-wave-sel").trim() || "#9ff4ff";
      const mid = cv.height / 2;
      const half = mid - 2 * dpr;

      const left = el.scrollLeft;
      const tFrom = left / pps;
      const tTo = (left + viewW) / pps;

      // one ceiling for the whole track, so clip A and clip B stay comparable
      let ceil = 1;
      const lively: number[] = [];
      for (const c of pieces) {
        const a = Math.max(0, Math.floor(c.srcStart * peakRate));
        const b = Math.min(peaks.length - 1, Math.ceil(c.srcEnd * peakRate));
        for (let i = a; i <= b; i += 4) {              // sampled: this is only a scale
          if (peaks[i] > ceil) ceil = peaks[i];
          if (peaks[i] > 0) lively.push(peaks[i]);
        }
      }
      lively.sort((a, b) => a - b);
      const floor = lively.length ? lively[Math.floor(lively.length * 0.25)] : 0;
      const range = Math.max(1, ceil - floor);
      const amp = (v: number) =>
        Math.pow(Math.max(0, Math.min(1, (v - floor) / range)), 0.5) * half;

      for (const c of pieces) {
        if (c.at + c.dur < tFrom || c.at > tTo) continue;    // off screen
        const sel = c.beatLabel === selected;
        const x0 = Math.floor((c.at * pps - left) * dpr);
        const x1 = Math.ceil(((c.at + c.dur) * pps - left) * dpr);
        const from = Math.max(0, x0);
        const to = Math.min(cv.width, x1);
        for (let x = from; x < to; x++) {
          const tIn = ((x - x0) / Math.max(1, x1 - x0)) * c.dur;
          const s0 = Math.floor((c.srcStart + tIn) * peakRate);
          const s1 = Math.max(s0 + 1, Math.floor((c.srcStart + tIn + 1 / (pps * dpr)) * peakRate));
          let hi = 0;
          let hiR = 0;
          for (let i = s0; i < s1 && i < peaks.length; i++) {
            if (peaks[i] > hi) hi = peaks[i];
            if (rms && rms[i] > hiR) hiR = rms[i];
          }
          ctx.fillStyle = sel ? waveSel : wave;
          const ap = amp(hi);
          ctx.globalAlpha = sel ? 0.62 : 0.5;
          ctx.fillRect(x, mid - ap, 1, Math.max(1, ap * 2));
          if (rms) {
            const ar = amp(hiR);
            ctx.globalAlpha = 1;
            ctx.fillRect(x, mid - ar, 1, Math.max(1, ar * 2));
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    schedule();
    el.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // the pane can resize without the window doing so
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [peaks, rms, peakRate, pieces, pps, selected]);

  // ---- edge dragging -------------------------------------------------------
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const t = cutTimeAt(e.clientX);
      const c = placed.find((p) => p.label === drag.label);
      if (!c) return;
      if (drag.track === "audio") {
        const aStart = c.audioStart ?? c.start;
        const aEnd = c.audioEnd ?? c.end;
        // the audio clip's own on-screen extent, which may sit outside the picture
        const aAt = c.at + (aStart - c.start);
        const aAtEnd = aAt + (aEnd - aStart);
        void aAt; void aAtEnd;
        onTrimAudio(drag.label, drag.edge, drag.fromSrc + (t - drag.fromCut));
        return;
      }
      // absolute, from where the grab started: source + how far the hand moved
      onTrim(drag.label, drag.edge, drag.fromSrc + (t - drag.fromCut));
    };
    const up = () => setDrag(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, cutTimeAt, placed, onTrim]);

  /* Dragging a clip's corner ramps it in or out.
     The grips were drawn, they were draggable, and `fading` was set and then
     read by nothing -- so the fade handle did nothing at all. The length is
     how far the pointer sits from the clip's own edge, capped at half the
     clip so a ramp cannot run past its own middle. */
  useEffect(() => {
    if (!fading) return;
    const move = (e: MouseEvent) => {
      const c = placed.find((x) => x.label === fading.label);
      if (!c) return;
      const t = cutTimeAt(e.clientX);
      const from = fading.edge === "in" ? t - c.at : c.at + c.dur - t;
      const capped = Math.max(0, Math.min(from, c.dur / 2));
      onFade(fading.label, fading.edge, Math.round(capped * 100) / 100);
    };
    const up = () => setFading(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [fading, placed, cutTimeAt, onFade]);

  /* Cmd/Ctrl + wheel zooms, keeping whatever is under the pointer under the
     pointer -- zooming to the container's left edge throws you off the part
     you were looking at. Passive:false because the browser's own page zoom
     has to be prevented. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const atX = e.clientX - r.left + el.scrollLeft;
      const time = atX / ZOOMS[zoomIxRef.current];
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.max(0, Math.min(ZOOMS.length - 1, zoomIxRef.current + dir));
      if (next === zoomIxRef.current) return;
      zoomIxRef.current = next;
      setZoomIx(next);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, time * ZOOMS[next] - (e.clientX - r.left));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollX(el.scrollLeft);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stripUrlFor || !total) return;
    const el = scrollRef.current;
    const viewW = el?.clientWidth ?? 900;
    // a margin either side so a small scroll doesn't blank the track
    const from = Math.max(0, scrollX / pps - 2);
    const to = Math.min(total, (scrollX + viewW) / pps + 2);
    if (to - from < 0.2) return;
    const frames = Math.max(6, Math.min(110, Math.round(((to - from) * pps) / 44)));
    const t = setTimeout(() => {
      setStrip({ url: stripUrlFor(from, to, frames), from, to });
    }, 90);          // settle after a zoom or a flick of the scrollbar
    return () => clearTimeout(t);
  }, [stripUrlFor, scrollX, pps, total]);

  /* Marking a stretch of the cut on the audio track.
     The audio is where the dead space is visible, so that is where you point
     at it. Drag to mark, Delete to take it out, click to clear. */
  useEffect(() => {
    if (!marking) return;
    const onMove = (e: MouseEvent) => {
      const t = cutTimeAt(e.clientX);
      if (!marking.moved && Math.abs(t - marking.anchor) < 0.02) return;
      if (!marking.moved) setMarking({ ...marking, moved: true });
      setSpan({ from: Math.min(marking.anchor, t), to: Math.max(marking.anchor, t) });
    };
    const onUp = () => {
      if (marking && !marking.moved) setSpan(null);     // a plain click clears
      setMarking(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [marking, cutTimeAt]);

  /* Delete takes the marked stretch out. Bound on the window rather than the
     track so it works wherever the pointer went after the drag, and swallowed
     unconditionally so a bare Backspace never reaches the web view, which
     reads one as Back. */
  useEffect(() => {
    if (!span) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, [contenteditable]")) return;
      if (e.key !== "Delete" && e.key !== "Backspace") {
        if (e.key === "Escape") setSpan(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (span.to - span.from > 0.02) onCutSpan(span.from, span.to);
      setSpan(null);
    };
    // capture, so this runs before the review screen's own Delete handler
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [span, onCutSpan]);

  /* Dragging the playhead.
     setScrubbing(true) was set on mousedown and nothing ever followed the
     pointer, so the playhead could be placed but not dragged. It follows the
     hand now, and reports every position so the picture keeps up. */
  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: MouseEvent) => {
      const t = cutTimeAt(e.clientX);
      setDragHead(t);           // drawn from the pointer, never from the decoder
      onScrub(t);
      // dragging past the edge walks the view along with you
      const el = scrollRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (e.clientX > r.right - 40) el.scrollLeft += 14;
        else if (e.clientX < r.left + 40) el.scrollLeft -= 14;
      }
    };
    const onUp = () => { setScrubbing(false); setDragHead(null); onScrubEnd?.(); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [scrubbing, cutTimeAt, onScrub, onScrubEnd]);

  /* Dragging a clip to a new place in the cut.
     The gesture starts as a scrub; six pixels of travel is what separates
     "put the playhead here" from "move this line". */
  useEffect(() => {
    if (!moving) return;
    const MOVE_THRESHOLD = 6;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - moving.fromX;
      const live = moving.live || Math.abs(dx) > MOVE_THRESHOLD;
      if (!live) return;
      if (!moving.live) setScrubbing(false);        // it was never a scrub
      // where would it land? the gap nearest the pointer
      const t = cutTimeAt(e.clientX);
      let at = placed.length;
      for (let i = 0; i < placed.length; i++) {
        if (t < placed[i].at + placed[i].dur / 2) { at = i; break; }
      }
      setMoving({ ...moving, dx, live: true });
      setDropAt(at);
    };
    const onUp = () => {
      if (moving.live && dropAt !== null) {
        const next = reorderTo(placed.map((c) => c.label), moving.label, dropAt);
        if (next) onReorder(next);
      }
      setMoving(null);
      setDropAt(null);
      setScrubbing(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [moving, dropAt, placed, cutTimeAt, onReorder]);

  // keep the playhead in view while it runs
  useEffect(() => {
    /* Never fight the hand that's dragging.
     *
     * This checked `scrubbing` only, which is set when you drag the PLAYHEAD.
     * Dragging a trim handle, moving a clip, pulling a fade grip or marking a
     * range are four other ways to have hold of the timeline, and during
     * playback this fired for all of them -- jumping scrollLeft by half a
     * screen while the clip you were dragging was under the cursor. */
    if (scrubbing || drag || moving || fading || marking) return;
    if (playCutTime === null || !scrollRef.current) return;
    const el = scrollRef.current;
    const x = playCutTime * pps;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    }
  }, [playCutTime, pps, scrubbing, drag, moving, fading, marking]);

  const ticks = useMemo(() => {
    const step = pps > 120 ? 1 : pps > 50 ? 2 : pps > 22 ? 5 : 10;
    const out: number[] = [];
    for (let t = 0; t <= total; t += step) out.push(t);
    return out;
  }, [pps, total]);

  /* Only build DOM for clips you can actually see. At 260px/s a two-minute
     cut is 28,000px wide; rendering every clip and its handles off-screen is
     work nobody benefits from. */
  const viewW = scrollRef.current?.clientWidth ?? 1200;
  const onScreen = (at: number, dur: number) =>
    at + dur >= scrollX / pps - 2 && at <= (scrollX + viewW) / pps + 2;

  const sel = placed.find((p) => p.label === selected) ?? null;
  const detachedOf = (label: string) => {
    const c = placed.find((p) => p.label === label);
    return c ? c.audioStart !== undefined && c.audioEnd !== undefined : false;
  };
  const selDetached = sel ? sel.audioStart !== undefined && sel.audioEnd !== undefined : false;
  const fitted = total * pps <= (scrollRef.current?.clientWidth ?? 0) + 4;

  return (
    <div className="tl">
      <div className="tl-bar">
        <div className="tl-bar-left">
          <span className="tl-title">Timeline</span>
          <button className="tl-keys" onClick={() => setKeysOpen((v) => !v)}>
            shortcuts
          </button>
          <span className="tl-meta mono">
            {clips.length} clips · {fmt(total)}
          </span>
          {span && span.to - span.from > 0.02 && (
            <span className="tl-hint">
              {(span.to - span.from).toFixed(2)}s marked &mdash; <b>Delete</b> to cut it out
            </span>
          )}
          {stripStale && (
            <span className="tl-stale" title="The picture is from the last render; the clips and audio are current.">
              picture out of date
            </span>
          )}
        </div>
        <div className="tl-bar-right">
          {sel && (
            <>
              <span className="tl-selname">{sel.text ?? sel.label.replace(/-/g, " ")}</span>
              <button
                className="ui-btn ui-btn-sm"
                title="Split this clip at the playhead"
                onClick={() => {
                  if (playCutTime === null) return;
                  const r = resolve(playCutTime);
                  if (r && r.clip.label === sel.label) onSplit(sel.label, r.sourceTime);
                }}
              >
                Split
              </button>
              <button
                className="ui-btn ui-btn-sm"
                title={selDetached
                  ? "Lock this line's audio back to its picture"
                  : "Unlock this line's audio so it can be trimmed on its own"}
                onClick={() =>
                  onDetach(sel.label, selDetached ? null : { start: sel.start, end: sel.end })
                }
              >
                {selDetached ? "Relink audio" : "Detach audio"}
              </button>
              <button
                className="ui-btn ui-btn-sm"
                disabled={generatingGraphic !== null}
                title="Read this line and put a card on it if it earns one"
                onClick={() => onGenerateGraphic(sel.label)}
              >
                {generatingGraphic === sel.label ? "Reading…" : "Generate graphic"}
              </button>
              <button
                className="ui-btn ui-btn-sm ui-btn-danger"
                title="Remove this clip from the cut"
                onClick={() => onDelete(sel.label)}
              >
                Delete
              </button>
              <span className="tl-sep" />
            </>
          )}
          <button
            className="ui-btn ui-btn-sm"
            title={fitted ? "Zoom in on the selected clip" : "Fit the whole cut in the window"}
            onClick={() => {
              const el = scrollRef.current;
              if (fitted && sel && el) {
                // zoom to the selection and centre it
                const want = Math.max(0, Math.min(ZOOMS.length - 1,
                  ZOOMS.findIndex((z) => sel.dur * z > el.clientWidth * 0.6)));
                setZoomIx(want < 0 ? ZOOMS.length - 1 : want);
                requestAnimationFrame(() => {
                  el.scrollLeft = Math.max(0, sel.at * ZOOMS[want] - el.clientWidth / 4);
                });
              } else if (el) {
                // fit: the widest step that still shows everything
                let best = 0;
                for (let i = 0; i < ZOOMS.length; i++) if (total * ZOOMS[i] <= el.clientWidth) best = i;
                setZoomIx(best);
                el.scrollLeft = 0;
              }
            }}
          >
            {fitted && sel ? "Zoom to clip" : "Fit"}
          </button>
          <span className="tl-sep" />
          <button
            className="ui-btn ui-btn-icon"
            disabled={zoomIx === 0}
            title="Zoom out (⌘ + scroll)"
            onClick={() => setZoomIx((z) => Math.max(0, z - 1))}
          >
            −
          </button>
          <span className="tl-zoom mono">{pps}px/s</span>
          <button
            className="ui-btn ui-btn-icon"
            disabled={zoomIx === ZOOMS.length - 1}
            title="Zoom in (⌘ + scroll)"
            onClick={() => setZoomIx((z) => Math.min(ZOOMS.length - 1, z + 1))}
          >
            +
          </button>
        </div>
      </div>

      {keysOpen && (
        <div className="tl-keysheet">
          {[
            ["Space", "play / pause — auditions the open line"],
            ["J K L", "shuttle back / stop / forward (press again to go faster)"],
            ["← →", "step one frame · shift = one second"],
            ["↑ ↓", "previous / next clip"],
            ["I O", "set the in / out point at the playhead"],
            ["S", "split the selected clip at the playhead"],
            ["drag corner", "fade a clip in or out"],
            ["[ ]", "nudge in / out · shift = 0.2s"],
            ["T", "open the trim editor on the selected clip"],
            ["M", "drop a marker at the playhead"],
            ["N", "jump to the next line that needs a call"],
            ["Delete", "cut the selected clip"],
            ["⌘B", "cut the clip at the playhead"],
            ["⌘Z", "undo"],
            ["⌘ scroll", "zoom the timeline"],
            ["Home End", "first / last clip"],
          ].map(([k, what]) => (
            <div className="tl-key" key={k}>
              <kbd>{k}</kbd><span>{what}</span>
            </div>
          ))}
        </div>
      )}

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width }}>
          {/* ruler */}
          <div
            className={`tl-ruler${scrubbing ? " scrubbing" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();          // otherwise the browser text-selects
              setScrubbing(true);
              const t = cutTimeAt(e.clientX);
              setDragHead(t);
              onScrub(t);
            }}
          >
            {ticks.map((t) => (
              <span key={t} className="tl-tick" style={{ left: t * pps }}>
                <i />
                <b className="mono">{fmt(t)}</b>
              </span>
            ))}
            {span && span.to - span.from > 0.001 && (
              <div className="tl-span ghost" style={{ left: span.from * pps, width: (span.to - span.from) * pps }} />
            )}
            {/* where it will land, drawn in the gap it will fall into */}
            {dropAt !== null && moving?.live && (
              <span
                className="tl-drop"
                style={{
                  left: (dropAt >= placed.length
                    ? placed[placed.length - 1].at + placed[placed.length - 1].dur
                    : placed[dropAt].at) * pps,
                }}
              />
            )}
          </div>

          {/* video track */}
          <div
            className="tl-track tl-video"
            onMouseDown={(e) => {
              // only the gaps between clips: a press on a clip is the clip's
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              const t0 = cutTimeAt(e.clientX);
              setMarking({ anchor: t0, moved: false });
              setSpan({ from: t0, to: t0 });
            }}
          >
            {strip ? (
              <div
                className="tl-strip"
                style={{
                  backgroundImage: `url(${strip.url})`,
                  left: strip.from * pps,
                  width: (strip.to - strip.from) * pps,
                  opacity: stripStale ? 0.35 : undefined,
                }}
              />
            ) : (
              <div className="tl-strip tl-strip-empty" />
            )}
            {placed.filter((c) => onScreen(c.at, c.dur)).map((c) => (
              <div
                key={c.label}
                className={`tl-clip${c.label === selected ? " selected" : ""}`
                  + (moving?.live && moving.label === c.label ? " moving" : "")}
                style={{
                  left: c.at * pps,
                  width: Math.max(2, c.dur * pps),
                  // the clip follows the hand, so the drag is something you watch
                  transform: moving?.live && moving.label === c.label
                    ? `translateX(${moving.dx}px)` : undefined,
                }}
                onMouseDown={(e) => {
                  /* Shift marks a range instead of moving the clip, and it is
                     checked BEFORE the handle guard: clips butt together, so
                     a good part of the picture track is trim handle, and
                     shift-dragging from one of those spots used to do nothing
                     at all. A plain drag on picture stays "move this line" --
                     that is what dragging a clip means everywhere -- while on
                     the audio track, where nothing is draggable, a plain drag
                     marks a range. */
                  if (e.shiftKey) {
                    e.preventDefault();
                    const t0 = cutTimeAt(e.clientX);
                    setMarking({ anchor: t0, moved: false });
                    setSpan({ from: t0, to: t0 });
                    return;
                  }
                  if ((e.target as HTMLElement).closest(".tl-handle")) return;
                  e.preventDefault();
                  onSelect(c.label);
                  setScrubbing(true);
                  setMoving({ label: c.label, fromX: e.clientX, at: c.at, dur: c.dur,
                              dx: 0, live: false });
                  const t = cutTimeAt(e.clientX);
                  setDragHead(t);
                  onScrub(t);
                }}
                title={c.text ?? c.label}
              >
                {/* fade ramps, drawn over the clip like an editor draws them */}
                {(c.fadeIn ?? 0) > 0 && (
                  <span className="tl-fade in" style={{ width: Math.max(2, (c.fadeIn ?? 0) * pps) }} />
                )}
                {(c.fadeOut ?? 0) > 0 && (
                  <span className="tl-fade out" style={{ width: Math.max(2, (c.fadeOut ?? 0) * pps) }} />
                )}
                <span
                  className="tl-fadegrip left"
                  title="drag in for a fade in"
                  style={{ left: Math.max(0, (c.fadeIn ?? 0) * pps) }}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(c.label); setFading({ label: c.label, edge: "in" }); }}
                />
                <span
                  className="tl-fadegrip right"
                  title="drag in for a fade out"
                  style={{ right: Math.max(0, (c.fadeOut ?? 0) * pps) }}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(c.label); setFading({ label: c.label, edge: "out" }); }}
                />
                <span className="tl-cliplabel">{c.text ?? c.label.replace(/-/g, " ")}</span>
                <span
                  className="tl-handle tl-handle-l"
                  title="drag to trim the in-point"
                  onMouseDown={(e) => { if (e.shiftKey) return; e.preventDefault(); e.stopPropagation(); onSelect(c.label); setDrag({ label: c.label, edge: "start", track: "video", fromCut: cutTimeAt(e.clientX), fromSrc: c.start }); }}
                />
                <span
                  className="tl-handle tl-handle-r"
                  title="drag to trim the out-point"
                  onMouseDown={(e) => { if (e.shiftKey) return; e.preventDefault(); e.stopPropagation(); onSelect(c.label); setDrag({ label: c.label, edge: "end", track: "video", fromCut: cutTimeAt(e.clientX), fromSrc: c.end }); }}
                />
              </div>
            ))}
          </div>

          {/* audio track */}
          <div
            className="tl-track tl-audio"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest(".tl-handle")) return;
              e.preventDefault();
              const t = cutTimeAt(e.clientX);
              setMarking({ anchor: t, moved: false });
              setSpan({ from: t, to: t });
            }}
          >
            {/* pinned to the viewport; the track scrolls under it */}
            <canvas
              ref={audioRef}
              className="tl-audio-canvas"
              style={{ left: scrollX }}
            />
            {/* Locked audio just marks where each piece sits. */}
            {pieces.filter((c) => !detachedOf(c.beatLabel) && onScreen(c.at, c.dur)).map((c, i) => (
              <div
                key={`${c.beatLabel}-${i}`}
                className={`tl-aclip${c.beatLabel === selected ? " selected" : ""}`}
                style={{ left: c.at * pps, width: Math.max(2, c.dur * pps) }}
                onMouseDown={() => onSelect(c.beatLabel)}
                title={c.beatLabel.replace(/-/g, " ")}
              />
            ))}
            {/* Detached audio is its own clip with its own handles, and it is
                allowed to sit outside the picture -- that overlap IS the
                J- or L-cut. */}
            {placed.filter((c) => detachedOf(c.label)).map((c) => {
              const aStart = c.audioStart ?? c.start;
              const aEnd = c.audioEnd ?? c.end;
              const left = (c.at + (aStart - c.start)) * pps;
              const w = Math.max(3, (aEnd - aStart) * pps);
              const lead = Math.round((c.start - aStart) * 1000);
              return (
                <div
                  key={`det-${c.label}`}
                  className={`tl-aclip detached${c.label === selected ? " selected" : ""}`}
                  style={{ left, width: w }}
                  title={`${c.label.replace(/-/g, " ")} — audio ${lead > 0 ? `leads by ${lead}ms` : lead < 0 ? `trails by ${-lead}ms` : "aligned"}`}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest(".tl-handle")) return;
                    onSelect(c.label);
                  }}
                >
                  <span
                    className="tl-handle tl-handle-l"
                    title="drag the audio in-point"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(c.label); setDrag({ label: c.label, edge: "start", track: "audio", fromCut: cutTimeAt(e.clientX), fromSrc: (c.audioStart ?? c.start) }); }}
                  />
                  <span
                    className="tl-handle tl-handle-r"
                    title="drag the audio out-point"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(c.label); setDrag({ label: c.label, edge: "end", track: "audio", fromCut: cutTimeAt(e.clientX), fromSrc: (c.audioEnd ?? c.end) }); }}
                  />
                </div>
              );
            })}
            {/* "loading…" forever is the app failing quietly, which is the one
                thing it is meant never to do. Say which of the two it is. */}
            {!peaks && (peaksError
              ? <span className="tl-audio-empty tl-audio-failed">
                  {peaksError}
                  {onRetryPeaks && (
                    <button type="button" className="tl-audio-retry" onClick={onRetryPeaks}>
                      try again
                    </button>
                  )}
                </span>
              : <span className="tl-audio-empty">audio envelope loading…</span>)}
            {span && span.to - span.from > 0.001 && (
              <div className="tl-span" style={{ left: span.from * pps, width: (span.to - span.from) * pps }}>
                <span className="tl-span-len mono">{(span.to - span.from).toFixed(2)}s · delete</span>
              </div>
            )}
          </div>

          {(dragHead ?? playCutTime) !== null && (
            <div
              className={`tl-playhead live${scrubbing ? " dragging" : ""}`}
              style={{ left: (dragHead ?? playCutTime ?? 0) * pps }}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setScrubbing(true); }}
              title="drag to scrub"
            >
              <i />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(r < 10 ? 1 : 1).padStart(4, "0")}`;
}

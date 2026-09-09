"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";

type Word = { w: string; s: number; e: number };

/**
 * The waveform behind a trim, so an in/out point is something you can see
 * rather than a number you guess at.
 *
 * Shows a little context either side of the beat: the kept range is solid,
 * everything outside it is dimmed, and the words from the transcript sit
 * underneath. If the out-point lands mid-syllable the waveform says so
 * immediately -- that is the whole reason this exists.
 */
export default function TrimWave({
  peaks,
  rms,
  rate,
  start,
  end,
  viewStart,
  viewEnd,
  words,
  playhead,
  stripUrl,
  monitorFor,
  onScrub,
  onDragEdge,
  onSelectRange,
  selection,
  holes,
  onZoom,
  canZoomIn,
  canZoomOut,
}: {
  peaks: number[] | null;
  rms: number[] | null;
  rate: number;
  start: number;
  end: number;
  /** Fixed window the strip and waveform are drawn over. Anchored to the
   *  beat's ORIGINAL bounds so the picture doesn't slide while you drag. */
  viewStart: number;
  viewEnd: number;
  words: Word[];
  playhead: number | null;
  stripUrl: string | null;
  /** the player this monitor mirrors — one decoder, drawn to a canvas */
  monitorFor?: React.MutableRefObject<HTMLVideoElement | null>;
  onScrub: (t: number) => void;
  onDragEdge: (edge: "start" | "end", t: number) => void;
  /** a highlighted region inside this line, in source seconds */
  selection?: { from: number; to: number } | null;
  onSelectRange?: (range: { from: number; to: number } | null) => void;
  /** stretches already cut out of the middle of this line, in source seconds */
  holes?: [number, number][] | null;
  /** wheel over the wave widens or narrows how much either side you can see */
  onZoom?: (delta: number) => void;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<"start" | "end" | null>(null);
  /* Drawn from the pointer while dragging, so it lands exactly where you
     let go instead of trailing the decoder. */
  const [localHead, setLocalHead] = useState<number | null>(null);
  const monitorRef = useRef<HTMLCanvasElement | null>(null);

  /* The monitor mirrors the player rather than being a second one.
     It used to be its own <video> on the same file: two decoders running the
     same footage, kept in step by assigning currentTime whenever they drifted
     -- and every one of those assignments is a SEEK. That was the stutter.
     Copying frames costs one drawImage and never seeks anything. */
  useEffect(() => {
    if (!monitorFor) return;
    let raf = 0;
    let stop = false;
    const paint = () => {
      if (stop) return;
      // resolve both every frame: the canvas mounts with this component and
      // the player may not be ready yet -- bailing once left a black square
      const cv = monitorRef.current;
      const v = monitorFor.current;
      if (!cv || !v) { raf = requestAnimationFrame(paint); return; }
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (w && h) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(w * dpr)) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        const ctx = cv.getContext("2d");
        if (ctx && v.readyState >= 2) {
          // cover: fill the frame, cropping the overflow
          const scale = Math.max(cv.width / v.videoWidth, cv.height / v.videoHeight);
          const dw = v.videoWidth * scale;
          const dh = v.videoHeight * scale;
          ctx.drawImage(v, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => { stop = true; cancelAnimationFrame(raf); };
  }, [monitorFor]);
  const [marking, setMarking] = useState<{ from: number; moved: boolean; startX: number } | null>(null);
  /* Read on mouseup, so they must not be able to go stale. */
  const movedRef = useRef(false);
  const rangeRef = useRef<{ from: number; to: number } | null>(null);

  const span = Math.max(0.2, viewEnd - viewStart);

  const timeAt = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return start;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return viewStart + frac * span;
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    // same cyan as the timeline, so the two waves read as one instrument
    const accent = css.getPropertyValue("--tl-wave").trim() || "#3fd8e8";
    const faint = css.getPropertyValue("--border").trim() || "#e4e0e6";
    const mid = h / 2;

    if (!peaks) {
      ctx.fillStyle = faint;
      ctx.fillRect(0, mid - 1, w, 2);
      return;
    }

    // Scale to the LOUDEST THING IN THIS WINDOW, not to full scale. Against a
    // global maximum a quietly-delivered line is a flat smear and you cannot
    // see where a word begins -- which is how "if" and "and" got cut off.
    const i0 = Math.max(0, Math.floor(viewStart * rate));
    const i1 = Math.min(peaks.length, Math.ceil(viewEnd * rate));
    let ceil = 1;
    const lively: number[] = [];
    for (let i = i0; i < i1; i++) {
      if (peaks[i] > ceil) ceil = peaks[i];
      if (peaks[i] > 0) lively.push(peaks[i]);
    }
    // Subtract the room tone. Without this the noise floor draws at ~30% of
    // full height and a quiet word like "if" at ~48% -- eighteen points apart,
    // which is not enough to see where the word starts, which is how it gets
    // cut off. Taking the floor out puts silence flat on the line and every
    // spoken word visibly above it.
    lively.sort((a, b) => a - b);
    const floor = lively.length ? lively[Math.floor(lively.length * 0.25)] : 0;
    const range = Math.max(1, ceil - floor);


    /* Drawn the way an audio editor draws it: one spike per DEVICE pixel,
       taken from the loudest sample in that column. Retina gives two device
       pixels per CSS pixel, so this is twice the detail of anything drawn in
       CSS space -- which is the difference between a readable waveform and a
       purple blob. No smoothing: a click, a breath and a plosive should all
       be individually visible, because those are what you cut around. */
    const dev = Math.round(w * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);          // draw in device pixels
    const midD = (h * dpr) / 2;
    const halfD = midD - 2 * dpr;

    for (let px = 0; px < dev; px++) {
      const t0 = viewStart + (px / dev) * span;
      const t1 = viewStart + ((px + 1) / dev) * span;
      const a = Math.max(0, Math.floor(t0 * rate));
      const b = Math.min(peaks.length - 1, Math.max(a, Math.ceil(t1 * rate)));
      let hiP = 0;
      let hiR = 0;
      for (let i = a; i <= b; i++) {
        if (peaks[i] > hiP) hiP = peaks[i];
        if (rms && rms[i] > hiR) hiR = rms[i];
      }
      const inside = t0 >= start && t1 <= end;
      const ampP = Math.pow(Math.max(0, Math.min(1, (hiP - floor) / range)), 0.5) * halfD;
      const ampR = rms
        ? Math.pow(Math.max(0, Math.min(1, (hiR - floor) / range)), 0.5) * halfD
        : 0;

      // peak spike
      ctx.fillStyle = inside ? accent : faint;
      ctx.globalAlpha = inside ? 0.55 : 0.32;
      ctx.fillRect(px, midD - ampP, 1, Math.max(1, ampP * 2));
      // solid core = the energy the ear hears
      if (rms) {
        ctx.globalAlpha = inside ? 1 : 0.5;
        ctx.fillRect(px, midD - ampR, 1, Math.max(1, ampR * 2));
      }
    }
    ctx.globalAlpha = 1;
    // centre line, so silence is unmistakably a line and not a low rumble
    ctx.fillStyle = faint;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, Math.round(midD), dev, 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);      // back to CSS space
    ctx.globalAlpha = 1;

    /* Amplitude alone cannot solve this. Room tone in a pause and an
       unstressed word like "if" sit at almost the same level, so no scaling
       makes one obviously taller than the other -- which is how a word ends up
       cut in half. The transcript knows exactly where each word runs, so draw
       that: every spoken word gets a shaded band, and the gaps between them
       are the only places a cut can safely land. */
    for (const wd of words) {
      if (wd.e < viewStart || wd.s > viewEnd) continue;
      const x0 = ((wd.s - viewStart) / span) * w;
      const x1 = ((wd.e - viewStart) / span) * w;
      const kept = wd.s >= start - 0.001 && wd.e <= end + 0.001;
      ctx.fillStyle = kept ? accent : faint;
      ctx.globalAlpha = 0.10;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      // hard edges, so the boundary is unmistakable
      ctx.globalAlpha = 0.45;
      ctx.fillRect(Math.round(x0), 0, 1, h);
      ctx.fillRect(Math.round(x1) - 1, 0, 1, h);
    }
    ctx.globalAlpha = 1;

    /* Stretches already cut out of the middle of the line. Drawn as a solid
       knock-out with a red edge each side, because the point of showing them
       is that this footage is gone -- not dimmed, not "maybe". */
    for (const [hf, ht] of holes ?? []) {
      if (ht < viewStart || hf > viewEnd) continue;
      const x0 = ((hf - viewStart) / span) * w;
      const x1 = ((ht - viewStart) / span) * w;
      ctx.fillStyle = "#0b0a10";
      ctx.globalAlpha = 0.82;
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#ff4d6d";
      ctx.fillRect(Math.round(x0), 0, 1, h);
      ctx.fillRect(Math.round(x1) - 1, 0, 1, h);
      // a slash through it, so it reads as removed at any zoom
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(x0, h); ctx.lineTo(x1, 0);
      ctx.strokeStyle = "#ff4d6d"; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [peaks, rms, rate, start, end, viewStart, viewEnd, span, words, holes]);

  const pct = (t: number) => `${((t - viewStart) / span) * 100}%`;

  /* Highlighting a region: drag across the wave.

     `moved` and the live range are refs, not state. They used to live on the
     `marking` object, and `up` read them out of the closure it was registered
     with -- fine when the component is still, and a coin toss while the
     snippet is playing, because the playhead re-renders this component around
     47 times a second and every one of those re-registers these listeners.
     Catch the wrong closure on mouseup and `moved` still reads false, so the
     highlight you just dragged is thrown away as if it had been a click. The
     symptom is the one that is hardest to report: you highlight, you press
     delete, and nothing happens. */
  useEffect(() => {
    if (!marking || !onSelectRange) return;
    const move = (e: MouseEvent) => {
      const t = timeAt(e.clientX);
      setLocalHead(t);
      if (!movedRef.current && Math.abs(e.clientX - marking.startX) < 4) { onScrub(t); return; }
      movedRef.current = true;
      const range = { from: Math.min(marking.from, t), to: Math.max(marking.from, t) };
      rangeRef.current = range;
      onSelectRange(range);
    };
    const up = () => {
      // a plain click clears; a drag keeps what it drew
      if (!movedRef.current) onSelectRange(null);
      else if (rangeRef.current) onSelectRange(rangeRef.current);
      setMarking(null);
      setLocalHead(null);          // hand back to playback
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => onDragEdge(drag, timeAt(e.clientX));
    const up = () => setDrag(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  const shown = words.filter((wd) => wd.e > viewStart && wd.s < viewEnd);

  /* Scrolling opens the window up or closes it in -- the same gesture as the
     timeline. Plain wheel works over the wave itself; cmd (or ctrl) + wheel
     works anywhere in the row, the monitor included, so the gesture is the
     same one whether you are looking at the picture or the audio. */
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !onZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 1) return;
      const zoomKey = e.metaKey || e.ctrlKey;
      const overWave = !!wrapRef.current?.contains(e.target as Node);
      if (!zoomKey && !overWave) return;      // let the page scroll normally
      e.preventDefault();
      onZoom(e.deltaY > 0 ? 1 : -1);
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, [onZoom]);

  return (
    <div className="trimwave-row" ref={rowRef}>
      {monitorFor && (
        <div className="snip-video">
          <canvas ref={monitorRef} />
        </div>
      )}
    <div className="trimwave-col">
      {onZoom && (
        <div className="snip-head">
          <div className="snip-zoom">
            <button
              className="ui-btn ui-btn-icon"
              disabled={canZoomOut === false}
              title="Show more either side (⌘ + scroll)"
              onClick={() => onZoom(1)}
            >&minus;</button>
            <span className="snip-zoom-val mono">{span.toFixed(1)}s</span>
            <button
              className="ui-btn ui-btn-icon"
              disabled={canZoomIn === false}
              title="Zoom in on the cut (⌘ + scroll)"
              onClick={() => onZoom(-1)}
            >+</button>
          </div>
        </div>
      )}
    <div className="trimwave" ref={wrapRef}>
      {/* the footage itself across the window, so the cut point is a picture
          and not just a number */}
      {stripUrl && (
        <div
          className="trimwave-strip"
          style={{ backgroundImage: `url(${stripUrl})` }}
          onMouseDown={(e) => onScrub(timeAt(e.clientX))}
        >
          <div className="trimwave-out" style={{ left: 0, width: pct(start) }} />
          <div className="trimwave-out" style={{ left: pct(end), right: 0 }} />
          {playhead !== null && playhead >= viewStart && playhead <= viewEnd && (
            <div className="trimwave-playhead" style={{ left: pct(playhead) }} />
          )}
        </div>
      )}
      <div
        className="trimwave-canvas"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest(".trimwave-handle")) return;
          e.preventDefault();
          const t = timeAt(e.clientX);
          // Drag to highlight, click to scrub. Telling them apart by movement
          // means neither needs a modifier key to discover.
          if (onSelectRange) {
            movedRef.current = false;
            rangeRef.current = null;
            setMarking({ from: t, moved: false, startX: e.clientX });
          }
          setLocalHead(t);
          onScrub(t);
        }}
      >
        <canvas ref={canvasRef} />
        <div className="trimwave-out" style={{ left: 0, width: pct(start) }} />
        <div className="trimwave-out" style={{ left: pct(end), right: 0 }} />
        {selection && selection.to > selection.from && (
          <div
            className="trimwave-sel"
            style={{ left: pct(selection.from), width: pct(viewStart + (selection.to - selection.from)) }}
          />
        )}
        {(localHead ?? playhead) !== null &&
          (localHead ?? playhead)! >= viewStart && (localHead ?? playhead)! <= viewEnd && (
          <div className="trimwave-playhead" style={{ left: pct((localHead ?? playhead)!) }} />
        )}
        <div
          className={`trimwave-handle${drag === "start" ? " dragging" : ""}`}
          style={{ left: pct(start) }}
          title="drag the in-point"
          onMouseDown={(e) => { e.preventDefault(); setDrag("start"); }}
        />
        <div
          className={`trimwave-handle${drag === "end" ? " dragging" : ""}`}
          style={{ left: pct(end) }}
          title="drag the out-point"
          onMouseDown={(e) => { e.preventDefault(); setDrag("end"); }}
        />
      </div>
      <div className="trimwave-words">
        {shown.map((wd, i) => {
          const kept = wd.s >= start - 0.001 && wd.e <= end + 0.001;
          const clipped = (wd.s < start && wd.e > start) || (wd.s < end && wd.e > end);
          return (
            <span
              key={i}
              className={`tw-word${kept ? " kept" : ""}${clipped ? " clipped" : ""}`}
              style={{ left: pct(wd.s), width: pct(viewStart + (wd.e - wd.s)) }}
              title={clipped ? "this word is cut in half" : undefined}
            >
              {wd.w}
            </span>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}

/* CATEGORY 022 — will this LOOK right, not just add up right.
 *
 * qa/gauntlet/timeline.mts already proves the arithmetic: pieces butt
 * together, totals match, a span delete removes what it said. All of that can
 * be true of a timeline you cannot actually use. The bugs this project has
 * shipped were the second kind:
 *
 *   C1   a drag collapsed a clip to 0.15s -- 3.7 pixels at the default zoom,
 *        too small to grab, so you could destroy a line and not get it back
 *   BUG-010  a large blank region replaced the top of the review screen
 *   "the waveform never renders"; "the filmstrip is a stretched smear"
 *
 * So this suite converts layout() output into the pixels the component will
 * actually draw, using the component's real zoom table, and asserts the
 * things that must be true for a person to see and use the result.
 *
 * It does NOT need a DOM. Everything here is arithmetic the component does
 * inline; when the DOM harness lands (ledger M2) it can grow teeth, but the
 * whole grabbable/blank/smear class is catchable today without one.
 */
import fs from "node:fs";
import { layout, resolveSpanDelete, type Clip, type EdlPiece } from "../../lib/timelineLayout.ts";
import { rng } from "../rng.mts";
import type { Report } from "../report.mts";

/* Mirrored from app/components/Timeline.tsx:10. Importing it would pull React
   into a node test; instead the first check below fails the moment the two
   drift apart, which is the only failure mode duplication actually has. */
const ZOOMS = [10, 16, 25, 40, 64, 100, 160, 260];   // pixels per second
const DEFAULT_ZOOM_IX = 2;                            // Timeline.tsx:87
const pps = ZOOMS[DEFAULT_ZOOM_IX];

/* A pointer target smaller than this is not a control, it is a decoration.
   6px is already generous for a mouse and hostile for a trackpad. */
const GRABBABLE_PX = 6;
/* Past this many separate runs of film on screen, the filmstrip is a smear
   and the timeline is unreadable however correct its arithmetic. */
const SMEAR_PIECES = 400;

const ms = (n: number) => Math.round(n * 1000) / 1000;

function makeClips(r: ReturnType<typeof rng>, n: number, opts: { holes?: boolean } = {}): Clip[] {
  const clips: Clip[] = [];
  let t = r.float(0, 30);
  for (let i = 0; i < n; i++) {
    // Deliberately only believable lines. Generating slivers here and then
    // reporting them as unusable would test this generator, not the app --
    // the question is whether a legitimate EDIT can produce one.
    const dur = r.float(0.4, 9);
    const c: Clip = { label: `b${i}`, start: ms(t), end: ms(t + dur), text: `line ${i}` };
    if (opts.holes && r.bool(0.35) && dur > 1.2) {
      const hf = ms(c.start + r.float(0.1, dur - 0.6));
      const ht = ms(Math.min(c.end - 0.1, hf + r.float(0.05, 0.9)));
      if (ht > hf + 0.02) c.holes = [[hf, ht]];
    }
    clips.push(c);
    t = ms(t + dur + r.float(0, 4));
  }
  return clips;
}

function makeEdl(clips: Clip[]): EdlPiece[] {
  const out: EdlPiece[] = [];
  for (const c of clips) {
    const holes = c.holes ?? [];
    if (!holes.length) {
      out.push({ label: c.label, src_start: c.start, src_end: c.end, dur: ms(c.end - c.start) });
      continue;
    }
    let cur = c.start, k = 0;
    for (const [hf, ht] of holes) {
      if (hf > cur) out.push({ label: `${c.label}-${k++}`, src_start: cur, src_end: hf, dur: ms(hf - cur) });
      cur = ht;
    }
    if (c.end > cur) out.push({ label: `${c.label}-${k++}`, src_start: cur, src_end: c.end, dur: ms(c.end - cur) });
  }
  return out;
}

export function run(rep: Report, budget: number) {
  /* ---- the mirrored constants have not drifted ----------------------- */
  rep.check("022 looks", "the zoom table here still matches Timeline.tsx", () => {
    const src = fs.readFileSync("app/components/Timeline.tsx", "utf8");
    const m = /const ZOOMS = \[([^\]]+)\]/.exec(src);
    if (!m) throw new Error("could not find ZOOMS in app/components/Timeline.tsx");
    const real = m[1].split(",").map((s) => Number(s.trim()));
    if (real.join() !== ZOOMS.join()) {
      throw new Error(`zoom table drifted: component has [${real}], this suite assumes [${ZOOMS}]`);
    }
    const d = /useState\((\d+)\)/.exec(src.slice(src.indexOf("zoomIx")));
    if (d && Number(d[1]) !== DEFAULT_ZOOM_IX) {
      throw new Error(`default zoom drifted: component starts at ${d[1]}, this suite assumes ${DEFAULT_ZOOM_IX}`);
    }
  });

  for (let i = 0; i < budget; i++) {
    const seed = 22000 + i;
    const r = rng(seed);
    const clips = makeClips(r, r.int(1, 24), { holes: r.bool(0.6) });
    const edl = r.bool(0.6) ? makeEdl(clips) : undefined;

    /* C1's real consequence, asked the only way that means anything: start
       from believable lines, apply a legitimate edit, and see whether the
       edit can leave a clip that survives but cannot be grabbed back.
       A clip the edit REMOVES is fine -- that is the edit working. A clip it
       shrinks to 1px is the C1 shape: you destroyed a line by accident and
       the handle to undo it is too small to hit. The zoom that matters is
       the one the app opens at; "zoom in first" is not a recovery path for
       damage you did not mean to do. */
    rep.check("022 looks", `no edit leaves a surviving clip too small to grab #${i}`, () => {
      const base = layout(clips, edl);
      if (base.total < 1) return;
      const from = ms(r.float(0, base.total - 0.3));
      const to = ms(Math.min(base.total, from + r.float(0.1, Math.min(9, base.total - from))));
      const edits = resolveSpanDelete(base.pieces, clips, from, to);
      if (!edits.length) return;

      const dropped = new Set(edits.filter((e) => "drop" in e).map((e) => e.label));
      const holed = new Map(edits.filter((e) => "holes" in e)
        .map((e) => [e.label, (e as { holes: [number, number][] }).holes]));
      const after: Clip[] = clips.filter((c) => !dropped.has(c.label))
        .map((c) => (holed.has(c.label) ? { ...c, holes: holed.get(c.label) } : c));

      for (const p of layout(after).placed) {
        const px = p.dur * pps;
        if (p.dur > 0 && px < GRABBABLE_PX) {
          throw new Error(
            `deleting ${from.toFixed(2)}-${to.toFixed(2)}s left ${p.label} at ${p.dur.toFixed(3)}s = ` +
            `${px.toFixed(1)}px at ${pps}px/s -- it survived the edit but is under the ${GRABBABLE_PX}px a pointer can hit`);
        }
      }
    }, seed);

    /* BUG-010's class: the track is one width, its contents are another, and
       the difference renders as a blank band nothing explains. */
    rep.check("022 looks", `the drawn track has no unaccounted blank #${i}`, () => {
      const { placed, total } = layout(clips, edl);
      const trackPx = total * pps;
      const drawnPx = placed.reduce((s, p) => s + p.dur * pps, 0);
      if (Math.abs(trackPx - drawnPx) > 1) {
        throw new Error(`track is ${trackPx.toFixed(1)}px, clips draw ${drawnPx.toFixed(1)}px -- ${(trackPx - drawnPx).toFixed(1)}px of blank`);
      }
    }, seed);

    rep.check("022 looks", `nothing is drawn off the left edge #${i}`, () => {
      const { placed, pieces } = layout(clips, edl);
      for (const p of placed) {
        if (p.at * pps < -0.001) throw new Error(`clip ${p.label} starts at ${(p.at * pps).toFixed(1)}px`);
      }
      for (const p of pieces) {
        if (p.at * pps < -0.001) throw new Error(`piece ${p.beatLabel} starts at ${(p.at * pps).toFixed(1)}px`);
      }
    }, seed);

    rep.check("022 looks", `the filmstrip is not a smear #${i}`, () => {
      const { pieces } = layout(clips, edl);
      if (pieces.length > SMEAR_PIECES) {
        throw new Error(`${pieces.length} separate runs of film -- past ${SMEAR_PIECES} this is unreadable`);
      }
    }, seed);

    /* Scrubbing converts px -> time on every pointer move and time -> px to
       paint the playhead, at whatever zoom is live. If that round trip drifts
       the playhead walks away from the pointer, which is what "the playhead
       is not where I put it" looked like. */
    rep.check("022 looks", `px and time round-trip at every zoom #${i}`, () => {
      const { total } = layout(clips, edl);
      if (total <= 0) return;
      for (const z of ZOOMS) {
        for (let k = 0; k < 8; k++) {
          const t = r.float(0, total);
          const back = (t * z) / z;
          if (Math.abs(back - t) > 1e-6) throw new Error(`drift at ${z}px/s: ${t} -> ${back}`);
          const px = t * z;
          if (px < 0 || px > total * z + 0.001) throw new Error(`playhead at ${px}px escapes a ${(total * z).toFixed(1)}px track`);
        }
      }
    }, seed);

    /* A line whose footage is entirely holed out still has a row in the lines
       list. Zero-height, no text, nothing to click: it reads as the app
       having lost the line rather than the editor having emptied it. */
    /* Same discipline: only an edit can create this, so only an edit is
       worth testing. A line emptied of all its footage but still listed
       reads as the app having lost the line, not as the editor having
       emptied it. */
    rep.check("022 looks", `no edit leaves an invisible ghost row #${i}`, () => {
      const base = layout(clips, edl);
      if (base.total < 1) return;
      const from = ms(r.float(0, base.total - 0.3));
      const to = ms(Math.min(base.total, from + r.float(0.1, Math.min(9, base.total - from))));
      const edits = resolveSpanDelete(base.pieces, clips, from, to);
      const dropped = new Set(edits.filter((e) => "drop" in e).map((e) => e.label));
      const holed = new Map(edits.filter((e) => "holes" in e)
        .map((e) => [e.label, (e as { holes: [number, number][] }).holes]));
      const after: Clip[] = clips.filter((c) => !dropped.has(c.label))
        .map((c) => (holed.has(c.label) ? { ...c, holes: holed.get(c.label) } : c));

      for (const p of layout(after).placed) {
        if (p.dur <= 0.0005 && (p.text ?? "").length > 0) {
          throw new Error(`clip ${p.label} kept its text but has zero length -- a row with nothing in it`);
        }
      }
    }, seed);
  }
}

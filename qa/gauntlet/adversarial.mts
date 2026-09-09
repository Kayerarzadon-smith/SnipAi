/* CATEGORY 006/007/019 — the shapes a well-behaved generator never produces.
 *
 * Degenerate clips, stale EDLs, spans that land exactly on a boundary, and
 * the numbers that arrive when something upstream has already gone wrong.
 * The editing core has to answer every one of these without throwing, without
 * inventing time, and without emitting a beat that cannot be saved. */
import { layout, resolveSpanDelete, reorderTo, type Clip, type EdlPiece } from "../../lib/timelineLayout.ts";
import { normaliseHoles } from "../../lib/holes.ts";
import { rng } from "../rng.mts";
import type { Report } from "../report.mts";

const ms = (n: number) => Math.round(n * 1000) / 1000;

/** Every named degenerate shape, so a failure names itself. */
const SHAPES: { name: string; clips: Clip[] }[] = [
  { name: "empty beat list", clips: [] },
  { name: "one zero-length clip", clips: [{ label: "a", start: 5, end: 5 }] },
  { name: "inverted clip (end before start)", clips: [{ label: "a", start: 9, end: 4 }] },
  { name: "clip at time zero", clips: [{ label: "a", start: 0, end: 3 }] },
  { name: "negative start", clips: [{ label: "a", start: -2, end: 3 }] },
  { name: "two clips overlapping in source", clips: [
    { label: "a", start: 0, end: 5 }, { label: "b", start: 3, end: 8 }] },
  { name: "clips out of source order", clips: [
    { label: "a", start: 20, end: 25 }, { label: "b", start: 2, end: 6 }] },
  { name: "duplicate labels", clips: [
    { label: "a", start: 0, end: 3 }, { label: "a", start: 5, end: 8 }] },
  { name: "hole exactly at the head", clips: [{ label: "a", start: 1, end: 6, holes: [[1, 2]] }] },
  { name: "hole exactly at the tail", clips: [{ label: "a", start: 1, end: 6, holes: [[5, 6]] }] },
  { name: "hole spanning the whole clip", clips: [{ label: "a", start: 1, end: 6, holes: [[1, 6]] }] },
  { name: "hole entirely outside the clip", clips: [{ label: "a", start: 1, end: 6, holes: [[40, 50]] }] },
  { name: "unsorted holes", clips: [{ label: "a", start: 0, end: 10, holes: [[7, 8], [2, 3]] }] },
  { name: "overlapping holes", clips: [{ label: "a", start: 0, end: 10, holes: [[2, 6], [4, 8]] }] },
  { name: "touching holes", clips: [{ label: "a", start: 0, end: 10, holes: [[2, 4], [4, 6]] }] },
  { name: "inverted hole", clips: [{ label: "a", start: 0, end: 10, holes: [[6, 2]] }] },
  { name: "many tiny clips", clips: Array.from({ length: 300 }, (_, i) => (
      { label: `b${i}`, start: ms(i * 0.11), end: ms(i * 0.11 + 0.1) })) },
  { name: "one very long clip", clips: [{ label: "a", start: 0, end: 36000 }] },
  { name: "sub-millisecond clip", clips: [{ label: "a", start: 1, end: 1.0004 }] },
  { name: "float-drift chain", clips: Array.from({ length: 40 }, (_, i) => (
      { label: `b${i}`, start: i * 0.1, end: i * 0.1 + 0.1 })) },
];

/** EDLs that no longer describe the beats they name. */
function staleEdls(clips: Clip[]): { name: string; edl: EdlPiece[] }[] {
  const first = clips[0];
  if (!first) return [{ name: "edl for a beat list that is empty", edl: [{ label: "ghost", src_start: 0, src_end: 5, dur: 5 }] }];
  return [
    { name: "edl naming a deleted beat", edl: [{ label: "gone", src_start: 0, src_end: 4, dur: 4 }] },
    { name: "edl piece wider than its beat", edl: [
      { label: first.label, src_start: first.start - 30, src_end: first.end + 30, dur: 60 }] },
    { name: "edl dur disagreeing with its own range", edl: [
      { label: first.label, src_start: first.start, src_end: first.end, dur: 999 }] },
    { name: "edl with a negative duration", edl: [
      { label: first.label, src_start: first.start, src_end: first.end, dur: -4 }] },
    { name: "edl with zero-length pieces", edl: [
      { label: first.label, src_start: first.start, src_end: first.start, dur: 0 }] },
    { name: "suffixed piece labels for an unknown base", edl: [
      { label: "nobody-3", src_start: 0, src_end: 2, dur: 2 }] },
  ];
}

export function run(rep: Report, budget: number) {
  /* ---- layout must survive every degenerate shape ---------------------- */
  for (const shape of SHAPES) {
    rep.check("019 chaos", `layout survives: ${shape.name}`, () => {
      const { pieces, placed, total } = layout(shape.clips);
      if (!Number.isFinite(total)) throw new Error(`total is ${total}`);
      if (total < 0) throw new Error(`negative total ${total}`);
      for (const p of pieces) {
        if (!Number.isFinite(p.at) || !Number.isFinite(p.dur)) throw new Error(`non-finite piece ${JSON.stringify(p)}`);
        if (p.dur < 0) throw new Error(`negative piece duration ${p.dur}`);
      }
      for (const pl of placed) {
        if (!Number.isFinite(pl.at) || !Number.isFinite(pl.dur)) throw new Error(`non-finite clip ${JSON.stringify(pl)}`);
        if (pl.dur < 0) throw new Error(`negative clip duration ${pl.dur} on ${pl.label}`);
      }
      if (placed.length !== shape.clips.length) {
        throw new Error(`${shape.clips.length} beats in, ${placed.length} out`);
      }
    });

    for (const { name, edl } of staleEdls(shape.clips)) {
      rep.check("019 chaos", `layout survives: ${shape.name} + ${name}`, () => {
        const { total, placed } = layout(shape.clips, edl);
        if (!Number.isFinite(total) || total < 0) throw new Error(`total is ${total}`);
        for (const pl of placed) {
          if (pl.dur < 0 || !Number.isFinite(pl.dur)) throw new Error(`bad duration ${pl.dur} on ${pl.label}`);
        }
      });
    }
  }

  /* ---- spans that land exactly on the seams ---------------------------- */
  const clips: Clip[] = [
    { label: "a", start: 0, end: 4 },
    { label: "b", start: 10, end: 16, holes: [[12, 13]] },
    { label: "c", start: 20, end: 23 },
  ];
  const { pieces, total } = layout(clips);
  const edges = [0, 4, 4.0001, 6, 6.0001, 8, 9, total - 0.001, total, total + 5, -3];
  for (const from of edges) {
    for (const to of edges) {
      rep.check("013 sync-cut", `span ${from}->${to} is answered, not thrown`, () => {
        const edits = resolveSpanDelete(pieces, clips, from, to);
        if (!Array.isArray(edits)) throw new Error("not an array");
        if (to <= from && edits.length) throw new Error("an empty or backwards span produced edits");
        for (const e of edits) {
          if ("drop" in e) continue;
          const c = clips.find((x) => x.label === e.label)!;
          const r = normaliseHoles(e.holes, c);
          // whatever resolveSpanDelete emits, the server must accept -- it is
          // applied atomically, so one rejected line throws away the whole drag
          if (!r.ok) throw new Error(`emitted holes the server refuses: ${r.error} (${JSON.stringify(e.holes)})`);
        }
      });
    }
  }

  /* ---- a whole-timeline delete ---------------------------------------- */
  rep.check("013 sync-cut", "deleting the entire timeline drops every beat", () => {
    const edits = resolveSpanDelete(pieces, clips, -1, total + 1);
    const dropped = edits.filter((e) => "drop" in e).map((e) => e.label);
    for (const c of clips) {
      if (!dropped.includes(c.label)) throw new Error(`${c.label} survived a full-timeline delete`);
    }
  });

  /* ---- reorderTo, every index against every clip ----------------------- */
  const order = ["a", "b", "c", "d", "e"];
  for (const label of order) {
    for (let at = -3; at <= order.length + 3; at++) {
      rep.check("006 timeline", `reorder ${label} -> ${at}`, () => {
        const next = reorderTo(order, label, at);
        if (next === null) return;
        if (next.length !== order.length || new Set(next).size !== next.length) {
          throw new Error(`corrupted order ${JSON.stringify(next)}`);
        }
      });
    }
  }

  /* ---- hostile values into normaliseHoles ------------------------------ */
  const beat = { start: 2, end: 12 };
  const hostile: [string, unknown][] = [
    ["null", null], ["undefined", undefined], ["a number", 5], ["a string", "holes"],
    ["an object", { from: 1, to: 2 }], ["a flat array", [1, 2]],
    ["a triple", [[1, 2, 3]]], ["a single", [[1]]],
    ["NaN bounds", [[NaN, NaN]]], ["Infinity", [[0, Infinity]]],
    ["-Infinity", [[-Infinity, 5]]], ["string bounds", [["1", "2"]]],
    ["null inside", [null]], ["nested array", [[[1, 2]]]],
    ["huge list", Array.from({ length: 5000 }, (_, i) => [i * 0.001, i * 0.001 + 0.0005])],
    ["exact edges", [[2, 12]]], ["one ms wide", [[5, 5.001]]],
    ["reversed", [[9, 3]]], ["identical repeated", [[4, 5], [4, 5], [4, 5]]],
  ];
  for (const [name, raw] of hostile) {
    rep.check("019 chaos", `normaliseHoles refuses or cleans: ${name}`, () => {
      const r = normaliseHoles(raw, beat);
      if (r.ok) {
        for (const [f, t] of r.holes) {
          if (!Number.isFinite(f) || !Number.isFinite(t)) throw new Error(`accepted non-finite ${f}-${t}`);
          if (t <= f) throw new Error(`accepted empty hole ${f}-${t}`);
          if (f < beat.start - 1e-9 || t > beat.end + 1e-9) throw new Error(`accepted out-of-range ${f}-${t}`);
        }
        if (r.kept < 0.15) throw new Error(`accepted a set leaving only ${r.kept}s`);
      }
    });
  }

  /* ---- randomised degenerate mixtures ---------------------------------- */
  for (let i = 0; i < budget; i++) {
    const seed = 30000 + i;
    const r = rng(seed);
    const n = r.int(0, 12);
    const cs: Clip[] = [];
    for (let k = 0; k < n; k++) {
      const start = r.float(-5, 50);
      const end = r.bool(0.15) ? start - r.float(0, 3) : start + r.float(0, 8);   // sometimes inverted
      const c: Clip = { label: r.bool(0.1) ? "dup" : `b${k}`, start: ms(start), end: ms(end) };
      if (r.bool(0.4)) {
        c.holes = Array.from({ length: r.int(1, 3) }, () => {
          const f = ms(r.float(-2, 55));
          return [f, ms(f + r.float(-1, 4))] as [number, number];
        });
      }
      cs.push(c);
    }
    rep.check("019 chaos", `degenerate mixture #${i}`, () => {
      const { total, pieces, placed } = layout(cs);
      if (!Number.isFinite(total) || total < 0) throw new Error(`total ${total}`);
      for (const p of pieces) if (p.dur < 0 || !Number.isFinite(p.dur)) throw new Error(`piece dur ${p.dur}`);
      for (const p of placed) if (p.dur < 0 || !Number.isFinite(p.dur)) throw new Error(`clip dur ${p.dur}`);
      const f = r.float(-2, total + 2), t = f + r.float(-1, total);
      const edits = resolveSpanDelete(pieces, cs, f, t);
      if (!Array.isArray(edits)) throw new Error("span delete did not return a list");
    }, seed);
  }
}

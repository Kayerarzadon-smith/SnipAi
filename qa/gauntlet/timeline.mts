/* CATEGORY 006/007/013 — the editing core, attacked with generated edits.
 *
 * layout() and resolveSpanDelete() are the arithmetic every visible thing
 * depends on: the playhead, the filmstrip, every duration readout, and what a
 * drag-and-delete actually removes. They are pure, so they can be hit with
 * thousands of shapes instead of a handful of hand-written cases. */
import { layout, resolveSpanDelete, reorderTo, type Clip, type EdlPiece } from "../../lib/timelineLayout.ts";
import { normaliseHoles } from "../../lib/holes.ts";
import { rng } from "../rng.mts";
import type { Report } from "../report.mts";

const ms = (n: number) => Math.round(n * 1000) / 1000;
const near = (a: number, b: number, tol: number, what: string) => {
  if (Math.abs(a - b) > tol) throw new Error(`${what}: ${a.toFixed(4)} vs ${b.toFixed(4)} (tol ${tol})`);
};

/** A believable beat list: lines in source order, some with holes already. */
function makeClips(r: ReturnType<typeof rng>, n: number, opts: { holes?: boolean } = {}): Clip[] {
  const clips: Clip[] = [];
  let t = r.float(0, 30);
  for (let i = 0; i < n; i++) {
    const dur = r.float(0.4, 9);
    const c: Clip = { label: `b${i}`, start: ms(t), end: ms(t + dur), text: `line ${i}` };
    if (opts.holes && r.bool(0.35) && dur > 1.2) {
      const hf = ms(c.start + r.float(0.1, dur - 0.6));
      const ht = ms(Math.min(c.end - 0.1, hf + r.float(0.05, 0.9)));
      if (ht > hf + 0.02) c.holes = [[hf, ht]];
    }
    clips.push(c);
    t = ms(t + dur + r.float(0, 4));      // a gap of raw footage between lines
  }
  return clips;
}

/** An EDL the way build_cut writes one: pieces per beat, holes honoured. */
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
  /* ---- layout() invariants ------------------------------------------- */
  for (let i = 0; i < budget; i++) {
    const seed = 1000 + i;
    const r = rng(seed);
    const clips = makeClips(r, r.int(1, 24), { holes: r.bool(0.6) });
    const edl = r.bool(0.6) ? makeEdl(clips) : undefined;

    rep.check("006 timeline", `layout is contiguous #${i}`, () => {
      const { pieces, placed, total } = layout(clips, edl);
      let at = 0;
      for (const p of pieces) {
        near(p.at, at, 0.0011, "piece start must butt against the previous piece");
        if (p.dur < 0) throw new Error(`negative piece duration ${p.dur}`);
        at = ms(at + p.dur);
      }
      near(total, at, 0.0011, "total must equal the sum of the pieces");
      // and the clips must tile the same line without overlap or gap
      let cat = 0;
      for (const pl of placed) {
        near(pl.at, cat, 0.0011, `clip ${pl.label} must start where the last ended`);
        cat = ms(cat + pl.dur);
      }
      near(total, cat, 0.0011, "total must equal the sum of the clips");
    }, seed);

    rep.check("006 timeline", `every piece maps back into its own beat #${i}`, () => {
      const { pieces } = layout(clips, edl);
      const by = new Map(clips.map((c) => [c.label, c]));
      for (const p of pieces) {
        const c = by.get(p.beatLabel);
        if (!c) throw new Error(`piece for unknown beat ${p.beatLabel}`);
        if (p.srcEnd < p.srcStart) throw new Error(`inverted source range on ${p.beatLabel}`);
        if (p.srcStart < c.start - 0.06 || p.srcEnd > c.end + 0.06) {
          throw new Error(`piece ${p.srcStart}-${p.srcEnd} escapes beat ${c.start}-${c.end}`);
        }
      }
    }, seed);
  }

  /* ---- resolveSpanDelete: the length actually removed ------------------
     The claim under test is the one the user makes with a drag: "take these
     N seconds out of the cut." Applying the result and re-laying out must
     produce a timeline exactly N seconds shorter. */
  for (let i = 0; i < budget; i++) {
    const seed = 5000 + i;
    const r = rng(seed);
    const clips = makeClips(r, r.int(2, 14), { holes: r.bool(0.5) });
    const edl = makeEdl(clips);
    const { pieces, total } = layout(clips, edl);
    if (total < 1) { rep.record("013 sync-cut", `span delete #${i}`, "skipped", "timeline too short"); continue; }
    const from = ms(r.float(0, total - 0.3));
    const to = ms(Math.min(total, from + r.float(0.1, Math.min(9, total - from))));

    rep.check("013 sync-cut", `deleting a span removes exactly that much #${i}`, () => {
      const edits = resolveSpanDelete(pieces, clips, from, to);
      if (!edits.length) {
        if (to - from > 0.02) throw new Error(`a ${(to - from).toFixed(3)}s span resolved to no edits`);
        return;
      }
      const dropped = new Set(edits.filter((e) => "drop" in e).map((e) => e.label));
      const holed = new Map(edits.filter((e) => "holes" in e).map((e) => [e.label, (e as { holes: [number, number][] }).holes]));
      const after: Clip[] = clips.filter((c) => !dropped.has(c.label))
        .map((c) => (holed.has(c.label) ? { ...c, holes: holed.get(c.label) } : c));
      const now = layout(after).total;
      const want = ms(total - (to - from));
      // A whole line swallowed takes its remaining fragments with it, so the
      // cut can legitimately get SHORTER than asked -- never longer.
      if (now > want + 0.05) {
        throw new Error(`asked to remove ${(to - from).toFixed(3)}s, removed ${(total - now).toFixed(3)}s`);
      }
    }, seed);

    rep.check("013 sync-cut", `resolved holes are legal #${i}`, () => {
      const edits = resolveSpanDelete(pieces, clips, from, to);
      const by = new Map(clips.map((c) => [c.label, c]));
      for (const e of edits) {
        if ("drop" in e) continue;
        const c = by.get(e.label)!;
        let prev = -Infinity;
        for (const [f, t] of e.holes) {
          if (t <= f) throw new Error(`empty or inverted hole ${f}-${t} on ${e.label}`);
          if (f < prev) throw new Error(`holes out of order on ${e.label}`);
          if (f < c.start - 0.001 || t > c.end + 0.001) {
            throw new Error(`hole ${f}-${t} outside beat ${c.start}-${c.end}`);
          }
          prev = t;
        }
      }
    }, seed);
  }

  /* ---- normaliseHoles ------------------------------------------------- */
  for (let i = 0; i < Math.floor(budget / 2); i++) {
    const seed = 9000 + i;
    const r = rng(seed);
    const beat = { start: ms(r.float(0, 100)), end: 0 };
    beat.end = ms(beat.start + r.float(0.2, 12));
    const raw: [number, number][] = [];
    for (let k = 0; k < r.int(0, 5); k++) {
      const f = ms(r.float(beat.start - 1, beat.end + 1));
      raw.push([f, ms(f + r.float(-0.5, 3))]);
    }
    rep.check("006 timeline", `normaliseHoles is idempotent #${i}`, () => {
      const once = normaliseHoles(raw, beat);
      if (!once.ok) return;                     // a refusal is a valid answer
      // feeding an accepted set back in must not change it, or the same edit
      // saved twice drifts
      const twice = normaliseHoles(once.holes, beat);
      if (!twice.ok) throw new Error(`accepted holes were rejected on re-entry: ${twice.error}`);
      if (JSON.stringify(once.holes) !== JSON.stringify(twice.holes)) {
        throw new Error(`not idempotent: ${JSON.stringify(once.holes)} -> ${JSON.stringify(twice.holes)}`);
      }
      let prev = -Infinity;
      for (const [f, t] of once.holes) {
        if (t <= f) throw new Error(`empty hole ${f}-${t}`);
        if (f < prev) throw new Error("unsorted");
        if (f < beat.start - 1e-9 || t > beat.end + 1e-9) throw new Error(`hole ${f}-${t} outside ${beat.start}-${beat.end}`);
        prev = t;
      }
      // and `kept` must be what is actually left
      const removed = once.holes.reduce((n, [f, t]) => n + (t - f), 0);
      const want = (beat.end - beat.start) - removed;
      if (Math.abs(once.kept - want) > 0.002) {
        throw new Error(`kept says ${once.kept} but ${want.toFixed(3)} survives`);
      }
    }, seed);
  }

  /* ---- reorderTo ------------------------------------------------------ */
  for (let i = 0; i < Math.floor(budget / 2); i++) {
    const seed = 12000 + i;
    const r = rng(seed);
    const n = r.int(2, 12);
    const order = Array.from({ length: n }, (_, k) => `b${k}`);
    const label = r.pick(order);
    const dropAt = r.int(-2, n + 2);
    rep.check("006 timeline", `reorder keeps every clip #${i}`, () => {
      const next = reorderTo(order, label, dropAt);
      if (next === null) return;
      if (next.length !== order.length) throw new Error(`length changed ${order.length} -> ${next.length}`);
      if (new Set(next).size !== next.length) throw new Error("a clip was duplicated");
      for (const l of order) if (!next.includes(l)) throw new Error(`${l} was lost`);
    }, seed);
  }
}

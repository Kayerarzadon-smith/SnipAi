import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../lib/paths.ts";
import { splitBeat } from "../lib/splitBeat.ts";

/* What undo has to be able to do, in both directions.
 *
 * LEDGER S1 says the PATCH handler should merge a beat's extra fields back in
 * from disk when the client omits them. It must NOT: undo's whole job is to
 * restore a beat to a state it was in BEFORE an edit, and the commonest such
 * edit is cutting a hole. `pushHistory` runs before the cut, so the entry it
 * saves has no holes on that beat, and undo sends exactly that. A server that
 * merged holes back in from disk would make cutting a stretch out permanent —
 * a far worse bug than the one S1 describes, and much harder to see.
 *
 * The field loss S1 was written for is real but lives on the client: it is
 * only a bug if GET drops a field, because then the client never holds it and
 * can never send it back. That is what these tests pin. */

const P = "zz-undo-roundtrip";
const dir = path.join(PROJECTS_ROOT, P);
const clean = () => fs.rmSync(dir, { recursive: true, force: true });
const beatsFile = path.join(dir, "beats.json");
const write = (beats: unknown[]) =>
  fs.writeFileSync(beatsFile, JSON.stringify({ source: "raw/a.mov", beats }));
const read = () => JSON.parse(fs.readFileSync(beatsFile, "utf8")) as { beats: Record<string, unknown>[] };
const patch = (body: unknown) =>
  new Request("http://127.0.0.1:4737/t", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) as never;

before(() => { clean(); fs.mkdirSync(dir, { recursive: true }); });
after(clean);

describe("undo, in both directions", () => {
  test("an undo that ADDS a field back keeps it", async () => {
    write([{ label: "hook", start: 10, end: 20 }]);
    const { PATCH } = await import("../app/api/projects/[project]/pipeline/route.ts");
    const res = await PATCH(
      patch({ beats: [{ label: "hook", start: 10, end: 20, holes: [[12, 13]], audioStart: 9.2, audioEnd: 19.4, fadeIn: 0.2 }] }),
      { params: { project: P } } as never);
    assert.equal(res.status, 200);
    const b = read().beats[0];
    assert.deepEqual(b.holes, [[12, 13]]);
    assert.equal(b.audioStart, 9.2);
    assert.equal(b.fadeIn, 0.2);
  });

  test("an undo that REMOVES a hole actually removes it", async () => {
    // the state after cutting a stretch out
    write([{ label: "hook", start: 10, end: 20, holes: [[12, 13]] }]);
    const { PATCH } = await import("../app/api/projects/[project]/pipeline/route.ts");
    // what pushHistory saved BEFORE the cut: the same beat, no holes
    const res = await PATCH(patch({ beats: [{ label: "hook", start: 10, end: 20 }] }),
                            { params: { project: P } } as never);
    assert.equal(res.status, 200);
    const b = read().beats[0];
    assert.equal(b.holes, undefined,
      "undo must be able to put footage back — merging holes in from disk " +
      "would make every cut permanent");
  });
});

/* LEDGER S7 — splitting a beat copied everything onto both halves. The
   audio one is the expensive case: two halves claiming the same speech, so
   build_cut lays it down twice and the line is spoken twice in the export.
   Nothing on screen shows it until you watch the render. */
describe("splitting a beat divides what it carries", () => {
  const beat = {
    label: "hook", start: 10, end: 20, text: "the hook",
    holes: [[11, 11.5], [16, 16.5]] as [number, number][],
    audioStart: 9.2, audioEnd: 19.4, fadeIn: 0.2, fadeOut: 0.15,
  };

  test("the two halves never claim the same speech twice", () => {
    const { left, right } = splitBeat(beat, 15, "hook-b");
    assert.ok(left.audioEnd !== undefined && right.audioStart !== undefined);
    assert.equal(left.audioEnd, right.audioStart, "the halves must meet, not overlap");
    assert.ok(left.audioStart! < left.audioEnd!, "the head must be a real range");
    assert.ok(right.audioStart! < right.audioEnd!, "the tail must be a real range");
    const covered = (left.audioEnd! - left.audioStart!) + (right.audioEnd! - right.audioStart!);
    assert.ok(Math.abs(covered - (beat.audioEnd - beat.audioStart)) < 0.002,
      `the two halves cover ${covered.toFixed(3)}s of the original ${(beat.audioEnd - beat.audioStart).toFixed(3)}s`);
  });

  test("each hole goes to the half that contains it, and nowhere else", () => {
    const { left, right } = splitBeat(beat, 15, "hook-b");
    assert.deepEqual(left.holes, [[11, 11.5]]);
    assert.deepEqual(right.holes, [[16, 16.5]]);
    for (const [name, h] of [["left", left], ["right", right]] as const) {
      for (const [f, t] of h.holes ?? []) {
        assert.ok(f >= h.start && t <= h.end,
          `${name} carries a hole ${f}-${t} outside its own ${h.start}-${h.end}`);
      }
    }
  });

  test("a hole straddling the cut is divided, not duplicated", () => {
    const straddle = { label: "a", start: 0, end: 10, holes: [[4, 7]] as [number, number][] };
    const { left, right } = splitBeat(straddle, 5, "a-b");
    assert.deepEqual(left.holes, [[4, 5]]);
    assert.deepEqual(right.holes, [[5, 7]]);
  });

  test("the fade stays on the edge it was drawn on", () => {
    const { left, right } = splitBeat(beat, 15, "hook-b");
    assert.equal(left.fadeIn, 0.2, "the head keeps its fade-in");
    assert.equal(left.fadeOut, undefined, "no fade in the middle of the line");
    assert.equal(right.fadeIn, undefined, "no fade in the middle of the line");
    assert.equal(right.fadeOut, 0.15, "the tail keeps its fade-out");
  });

  test("a plain beat splits into two plain beats", () => {
    const { left, right } = splitBeat({ label: "a", start: 0, end: 10 }, 4, "a-b");
    assert.equal(left.holes, undefined);
    assert.equal(right.holes, undefined);
    assert.equal(left.audioEnd, undefined);
    assert.equal(left.end, 4);
    assert.equal(right.start, 4);
  });
});

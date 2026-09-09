import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../lib/paths.ts";
import { saveBeats, updateBeatRange } from "../lib/beats.ts";

/* REGRESSION — "I highlight a region, press delete, and nothing happens."
 *
 * Kayer reported this twice and I told him it was fixed once when it was not.
 * The first report was a real bug (a stale closure threw the highlight away on
 * mouseup). This is the second one, and it is a different fault wearing the
 * same face.
 *
 * A highlight that lands inside footage already cut merges into the hole that
 * is there. normaliseHoles returns the same list, saveBeats skips the write
 * because nothing changed, the route answers 200, and the client clears the
 * highlight and toasts "Cut out 1.22s — the gap closed".
 *
 * Every layer behaved correctly and the person watching saw their selection
 * vanish and the line stay exactly as long as it was. Skipping a no-op write
 * is right; reporting it as a cut is not. */

const P = "zz-reg-noop";
const dir = path.join(PROJECTS_ROOT, P);
const clean = () => fs.rmSync(dir, { recursive: true, force: true });
const file = path.join(dir, "beats.json");
const write = (beats: unknown[]) =>
  fs.writeFileSync(file, JSON.stringify({ source: "raw/a.mov", beats }, null, 2) + "\n");
const read = () => JSON.parse(fs.readFileSync(file, "utf8")) as { beats: Record<string, unknown>[] };
const patch = (body: unknown) =>
  new Request("http://127.0.0.1:4737/t", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) as never;
const ctx = (label: string) => ({ params: { project: P, label } }) as never;

before(() => { clean(); fs.mkdirSync(dir, { recursive: true }); });
after(clean);

describe("saveBeats says whether it wrote", () => {
  test("a real change returns true", () => {
    write([{ label: "a", start: 0, end: 5 }]);
    assert.equal(saveBeats(P, { source: "raw/a.mov", beats: [{ label: "a", start: 0, end: 6 }] } as never, "x"), true);
  });

  test("writing the same thing again returns false", () => {
    const doc = { source: "raw/a.mov", beats: [{ label: "a", start: 0, end: 6 }] };
    saveBeats(P, doc as never, "x");
    assert.equal(saveBeats(P, doc as never, "x"), false,
      "a no-op write must be reported as one, not as a success");
  });

  test("updateBeatRange reports the same way", () => {
    write([{ label: "a", start: 10, end: 20 }]);
    assert.equal(updateBeatRange(P, "a", 11, 19).changed, true);
    assert.equal(updateBeatRange(P, "a", 11, 19).changed, false,
      "trimming an edge to where it already is changed nothing");
  });
});

describe("cutting a stretch that is already cut", () => {
  // the real numbers from img-9817, beat 8
  const BEAT = { label: "just-drop-here", start: 152.559, end: 158.638,
                 holes: [[153.599, 154.853], [156.029, 157.469]] };

  test("a highlight inside an existing hole is refused as a no-op, not reported as a cut", async () => {
    write([BEAT]);
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    // 153.8 - 154.6 sits entirely inside the first hole
    const res = await PATCH(patch({ holes: [...BEAT.holes, [153.8, 154.6]] }), ctx(BEAT.label));
    assert.equal(res.status, 200);
    const body = await res.json() as { changed: boolean; unchanged?: string };
    assert.equal(body.changed, false,
      "nothing was written, and the response has to say so or the UI will claim a cut");
    assert.match(String(body.unchanged), /already cut/);
    assert.deepEqual(read().beats[0].holes, BEAT.holes, "the edit must be untouched");
  });

  test("a highlight over real footage still cuts, and says it changed", async () => {
    write([BEAT]);
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    // 155.0 - 155.6 is between the two holes: real footage
    const res = await PATCH(patch({ holes: [...BEAT.holes, [155.0, 155.6]] }), ctx(BEAT.label));
    assert.equal(res.status, 200);
    const body = await res.json() as { changed: boolean };
    assert.equal(body.changed, true);
    const holes = read().beats[0].holes as [number, number][];
    assert.equal(holes.length, 3, `expected a third hole, got ${JSON.stringify(holes)}`);
  });

  test("a highlight that only partly overlaps a hole cuts the new part", async () => {
    write([BEAT]);
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    // reaches 0.4s to the left of the first hole
    const res = await PATCH(patch({ holes: [...BEAT.holes, [153.2, 154.0]] }), ctx(BEAT.label));
    const body = await res.json() as { changed: boolean };
    assert.equal(body.changed, true);
    const holes = read().beats[0].holes as [number, number][];
    assert.equal(holes[0][0], 153.2, "the hole should now start earlier");
    assert.equal(holes[0][1], 154.853, "and end where it did");
  });

  test("re-sending the holes a beat already has changes nothing", async () => {
    write([BEAT]);
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    const res = await PATCH(patch({ holes: BEAT.holes }), ctx(BEAT.label));
    const body = await res.json() as { changed: boolean; unchanged?: string };
    assert.equal(body.changed, false);
    assert.ok(body.unchanged, "it must say why nothing happened");
  });
});

/* Round two of the feature gauntlet.
 *
 * The signal was applied to two of the route's write paths first time round.
 * The other four answered a no-op exactly as before — the same defect on a
 * different surface, including the one that matters most: the timeline's span
 * delete, which is the same user action as the snippet delete. */
describe("every write path can tell you it changed nothing", () => {
  const A = { label: "a", start: 10, end: 20, holes: [[12, 13]] as [number, number][] };
  const B = { label: "b", start: 30, end: 40 };

  const post = (body: unknown) =>
    new Request("http://127.0.0.1:4737/t", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }) as never;
  const pctx = { params: { project: P } } as never;

  test("detached audio: dragging it to where it already is", async () => {
    write([{ ...A, audioStart: 9.2, audioEnd: 19.4 }, { ...B }]);
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    const same = await (await PATCH(patch({ track: "audio", start: 9.2, end: 19.4 }), ctx("a"))).json() as { changed: boolean };
    assert.equal(same.changed, false);
    const moved = await (await PATCH(patch({ track: "audio", start: 9.0, end: 19.4 }), ctx("a"))).json() as { changed: boolean };
    assert.equal(moved.changed, true);
  });

  test("fades: setting the fade it already has", async () => {
    write([{ ...A, fadeIn: 0.2 }, { ...B }]);
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    const same = await (await PATCH(patch({ fadeIn: 0.2 }), ctx("a"))).json() as { changed: boolean };
    assert.equal(same.changed, false);
    const moved = await (await PATCH(patch({ fadeIn: 0.35 }), ctx("a"))).json() as { changed: boolean };
    assert.equal(moved.changed, true);
  });

  test("reorder: dropping a line back where it was", async () => {
    write([{ ...A }, { ...B }]);
    const { POST } = await import("../app/api/projects/[project]/beats/route.ts");
    const same = await (await POST(post({ op: "reorder", order: ["a", "b"] }), pctx)).json() as { changed: boolean };
    assert.equal(same.changed, false);
    const moved = await (await POST(post({ op: "reorder", order: ["b", "a"] }), pctx)).json() as { changed: boolean };
    assert.equal(moved.changed, true);
  });

  test("the timeline's span delete over footage already cut", async () => {
    write([{ ...A }, { ...B }]);
    const { POST } = await import("../app/api/projects/[project]/beats/route.ts");
    const same = await (await POST(post({ op: "cut_span", edits: [{ label: "a", holes: [[12, 13]] }] }), pctx)).json() as
      { changed: boolean; unchanged?: string };
    assert.equal(same.changed, false, "a span landing inside an existing hole cut nothing");
    assert.match(String(same.unchanged), /already cut/);
    const moved = await (await POST(post({ op: "cut_span", edits: [{ label: "a", holes: [[12, 13], [15, 16]] }] }), pctx)).json() as
      { changed: boolean };
    assert.equal(moved.changed, true);
  });

  test("undo to the state you are already in", async () => {
    write([{ ...A }, { ...B }]);
    const { PATCH } = await import("../app/api/projects/[project]/pipeline/route.ts");
    const same = await (await PATCH(patch({ beats: [{ ...A }, { ...B }] }), pctx)).json() as
      { changed: boolean; unchanged?: string };
    assert.equal(same.changed, false);
    assert.match(String(same.unchanged), /nothing to undo/);
    const moved = await (await PATCH(patch({ beats: [{ ...A, end: 21 }, { ...B }] }), pctx)).json() as { changed: boolean };
    assert.equal(moved.changed, true);
  });
});

describe("a no-op must not teach the tuner", () => {
  test("a trim that moved nothing records no learning signal", async () => {
    write([{ label: "hook", start: 10, end: 20 }]);
    fs.rmSync(path.join(dir, "review-state.json"), { force: true });
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    await PATCH(patch({ start: 10, end: 20 }), ctx("hook"));
    const { loadReviewState } = await import("../lib/reviewState.ts");
    const st = loadReviewState(P) as unknown as { trimEdits?: unknown[] };
    assert.equal((st.trimEdits ?? []).length, 0,
      "a zero-delta trim in the signal drags snap_lead and snap_tail toward zero, invisibly");
  });

  test("a real trim still records one", async () => {
    write([{ label: "hook", start: 10, end: 20 }]);
    fs.rmSync(path.join(dir, "review-state.json"), { force: true });
    const { PATCH } = await import("../app/api/projects/[project]/beats/[label]/route.ts");
    await PATCH(patch({ start: 10.5, end: 20 }), ctx("hook"));
    const { loadReviewState } = await import("../lib/reviewState.ts");
    const st = loadReviewState(P) as unknown as { trimEdits?: unknown[] };
    assert.equal((st.trimEdits ?? []).length, 1);
  });
});

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

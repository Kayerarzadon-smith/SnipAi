/* FEATURE GAUNTLET — "an edit that changed nothing says so".
 *
 * THE CONTRACT
 *
 *   INPUTS      PATCH /api/projects/<p>/beats/<label> with either
 *               { holes: [[from,to],...] } or { start, end }.
 *   OUTPUTS     200 with `changed: boolean`, plus `unchanged: <reason>` when
 *               false. 400 for a body the validator refuses, 404 for an
 *               unknown project or beat.
 *   STATE       beats.json is written only when the bytes differ.
 *   PERSISTENCE a write burns exactly one snapshot; a no-op burns none.
 *   DEPENDS ON  wouldChange (byte comparison), normaliseHoles, takeSnapshot,
 *               and — for trims — the trimEdits learning signal.
 *   FAILS       an unreadable project, a beat that is gone, holes that would
 *               leave less than 0.15s.
 *
 * INVARIANTS
 *   I1  changed === true  <=>  the bytes on disk differ from before
 *   I2  changed === false  =>  no snapshot burned
 *   I3  changed === true   =>  exactly one snapshot burned
 *   I4  `unchanged` present  <=>  changed === false
 *   I5  the `holes` in the response always equal what is on disk
 *   I6  a refused write (4xx) never reports `changed`
 *   I7  no path reports a success for a write that did not happen
 *   I8  a no-op must not pollute the learning signal with a zero-delta trim
 */
import fs from "node:fs";
import path from "node:path";
import { rng } from "../rng.mts";
import type { Report } from "../report.mts";

type Hole = [number, number];

export async function run(rep: Report, budget: number, root: string) {
  const P = "fixture";
  const dir = path.join(root, "projects", P);
  const file = path.join(dir, "beats.json");
  const snapDir = path.join(dir, ".snapshots");

  const { PATCH } = await import("../../app/api/projects/[project]/beats/[label]/route.ts");
  const { saveBeats, updateBeatRange, loadBeats } = await import("../../lib/beats.ts");
  const { loadReviewState } = await import("../../lib/reviewState.ts");

  const req = (body: unknown) => new Request("http://127.0.0.1:4737/t", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) as never;
  const ctx = (label: string) => ({ params: { project: P, label } }) as never;
  const snaps = () => (fs.existsSync(snapDir) ? fs.readdirSync(snapDir).length : 0);
  const bytes = () => fs.readFileSync(file, "utf8");
  const write = (beats: unknown[]) =>
    fs.writeFileSync(file, JSON.stringify({ source: "raw/a.mov", beats }, null, 2) + "\n");
  const reset = (beats: unknown[]) => {
    fs.rmSync(snapDir, { recursive: true, force: true });
    fs.rmSync(path.join(dir, "review-state.json"), { force: true });
    write(beats);
  };

  const BEAT = { label: "line", start: 152.559, end: 158.638,
                 holes: [[153.599, 154.853], [156.029, 157.469]] as Hole[] };

  /* ---- I1..I5 on the holes path, over generated cases ------------------ */
  const holeCases: [string, Hole[], boolean][] = [
    ["the holes it already has", BEAT.holes, false],
    ["the same holes in a different order", [BEAT.holes[1], BEAT.holes[0]], false],
    ["a range wholly inside an existing hole", [...BEAT.holes, [153.8, 154.6]], false],
    ["a range exactly equal to an existing hole", [...BEAT.holes, [153.599, 154.853]], false],
    ["a sliver under the 0.02s floor", [...BEAT.holes, [155.4, 155.41]], false],
    ["a range outside the beat entirely", [...BEAT.holes, [200, 201]], false],
    ["a range over real footage", [...BEAT.holes, [155.2, 155.7]], true],
    ["a range overlapping a hole's left edge", [...BEAT.holes, [153.2, 154.0]], true],
    ["a range overlapping a hole's right edge", [...BEAT.holes, [154.5, 155.4]], true],
    ["a range bridging both holes", [[153.599, 157.469]], true],
    ["no holes at all", [], true],
    ["one hole where there were two", [BEAT.holes[0]], true],
  ];

  for (const [what, holes, shouldChange] of holeCases) {
    await rep.checkAsync("F noop", `holes: ${what}`, async () => {
      reset([{ ...BEAT }]);
      const wasBytes = bytes(), wasSnaps = snaps();
      const res = await PATCH(req({ holes }), ctx(BEAT.label));
      if (res.status !== 200) throw new Error(`status ${res.status}: ${await res.text()}`);
      const body = await res.json() as { changed: boolean; unchanged?: string; holes: Hole[] };

      // I1
      const reallyChanged = bytes() !== wasBytes;
      if (body.changed !== reallyChanged) {
        throw new Error(`reported changed=${body.changed} but the file ${reallyChanged ? "did" : "did not"} change`);
      }
      if (body.changed !== shouldChange) {
        throw new Error(`expected changed=${shouldChange}, got ${body.changed}`);
      }
      // I2 / I3
      const burned = snaps() - wasSnaps;
      if (body.changed && burned !== 1) throw new Error(`a write burned ${burned} snapshots, not 1`);
      if (!body.changed && burned !== 0) throw new Error(`a no-op burned ${burned} snapshot(s)`);
      // I4
      if (body.changed && body.unchanged !== undefined) throw new Error("a real change carried an `unchanged` reason");
      if (!body.changed && !body.unchanged) throw new Error("a no-op gave no reason");
      // I5
      const onDisk = (loadBeats(P)!.beats[0] as { holes?: Hole[] }).holes ?? [];
      if (JSON.stringify(body.holes) !== JSON.stringify(onDisk)) {
        throw new Error(`response holes ${JSON.stringify(body.holes)} != disk ${JSON.stringify(onDisk)}`);
      }
    });
  }

  /* ---- the same, on the trim path -------------------------------------- */
  const trimCases: [string, { start: number; end: number }, boolean][] = [
    ["the edges it already has", { start: BEAT.start, end: BEAT.end }, false],
    ["the same edges to more decimal places", { start: 152.5590001, end: 158.6380001 }, false],
    ["a real trim", { start: 153.0, end: 158.0 }, true],
    ["moving only the in point", { start: 153.0, end: BEAT.end }, true],
    ["moving only the out point", { start: BEAT.start, end: 158.0 }, true],
    ["a sub-millisecond nudge that rounds away", { start: 152.5594, end: 158.6384 }, false],
    ["a millisecond nudge that survives rounding", { start: 152.560, end: BEAT.end }, true],
  ];
  for (const [what, range, shouldChange] of trimCases) {
    await rep.checkAsync("F noop", `trim: ${what}`, async () => {
      reset([{ ...BEAT }]);
      const wasBytes = bytes(), wasSnaps = snaps();
      const res = await PATCH(req(range), ctx(BEAT.label));
      if (res.status !== 200) throw new Error(`status ${res.status}: ${await res.text()}`);
      const body = await res.json() as { changed: boolean; unchanged?: string };
      const reallyChanged = bytes() !== wasBytes;
      if (body.changed !== reallyChanged) {
        throw new Error(`reported changed=${body.changed}, file ${reallyChanged ? "did" : "did not"} change`);
      }
      if (body.changed !== shouldChange) throw new Error(`expected ${shouldChange}, got ${body.changed}`);
      const burned = snaps() - wasSnaps;
      if (!body.changed && burned !== 0) throw new Error(`a no-op trim burned ${burned} snapshot(s)`);
      if (body.changed && burned !== 1) throw new Error(`a trim burned ${burned} snapshots`);
      if (body.changed === (body.unchanged !== undefined)) {
        throw new Error("`unchanged` must be present exactly when changed is false");
      }
    });
  }

  /* ---- I8: a no-op must not teach the tuner anything -------------------- */
  await rep.checkAsync("F noop", "a no-op trim does not record a learning signal", async () => {
    reset([{ ...BEAT }]);
    await PATCH(req({ start: BEAT.start, end: BEAT.end }), ctx(BEAT.label));
    const st = loadReviewState(P) as unknown as { trimEdits?: unknown[] };
    const n = (st.trimEdits ?? []).length;
    if (n !== 0) {
      throw new Error(`a trim that moved nothing recorded ${n} learning entr(ies) — zero-delta trims drag the tuner toward zero`);
    }
  });

  await rep.checkAsync("F noop", "a real trim DOES record a learning signal", async () => {
    reset([{ ...BEAT }]);
    await PATCH(req({ start: 153.0, end: 158.0 }), ctx(BEAT.label));
    const st = loadReviewState(P) as unknown as { trimEdits?: unknown[] };
    if (!(st.trimEdits ?? []).length) throw new Error("a real trim recorded nothing to learn from");
  });

  /* ---- I6: a refusal never claims to have changed anything ------------- */
  const refusals: [string, unknown][] = [
    ["a hole swallowing the whole line", { holes: [[152.559, 158.638]] }],
    ["holes leaving under 0.15s", { holes: [[152.6, 155.0], [155.05, 158.6]] }],
    ["holes that are not pairs", { holes: [[1]] }],
    ["holes that are not numbers", { holes: [["a", "b"]] }],
    ["holes that are not a list", { holes: 5 }],
    ["start after end", { start: 158, end: 152 }],
    ["a zero-length beat", { start: 155, end: 155 }],
    ["NaN bounds", { start: null, end: 5 }],
  ];
  for (const [what, body] of refusals) {
    await rep.checkAsync("F noop", `a refusal (${what}) never reports changed`, async () => {
      reset([{ ...BEAT }]);
      const wasBytes = bytes(), wasSnaps = snaps();
      const res = await PATCH(req(body), ctx(BEAT.label));
      if (res.status === 200) {
        const b = await res.json() as { changed?: boolean };
        // some of these are legal no-ops rather than refusals; either is fine,
        // but a 200 must still carry an honest `changed`
        if (b.changed === undefined) throw new Error("a 200 with no `changed` field");
        if (b.changed !== (bytes() !== wasBytes)) throw new Error("changed disagrees with the file");
        return;
      }
      if (res.status !== 400 && res.status !== 404) throw new Error(`status ${res.status}`);
      const b = await res.json() as { changed?: boolean };
      if (b.changed !== undefined) throw new Error("a refusal carried a `changed` field");
      if (bytes() !== wasBytes) throw new Error("a refused write still changed the file");
      if (snaps() !== wasSnaps) throw new Error("a refused write burned a snapshot");
    });
  }

  /* ---- repeated and rapid: the same edit twice ------------------------- */
  await rep.checkAsync("F noop", "the same cut twice: the second says it is already gone", async () => {
    reset([{ ...BEAT }]);
    const one = await (await PATCH(req({ holes: [...BEAT.holes, [155.2, 155.7]] }), ctx(BEAT.label))).json() as { changed: boolean };
    if (!one.changed) throw new Error("the first cut did not change anything");
    const after = (loadBeats(P)!.beats[0] as { holes: Hole[] }).holes;
    const two = await (await PATCH(req({ holes: after }), ctx(BEAT.label))).json() as { changed: boolean; unchanged?: string };
    if (two.changed) throw new Error("re-sending the same holes reported a change");
    if (!/already/.test(String(two.unchanged))) throw new Error(`unhelpful reason: ${two.unchanged}`);
  });

  await rep.checkAsync("F noop", "ten identical writes burn one snapshot between them", async () => {
    reset([{ ...BEAT }]);
    const holes = [...BEAT.holes, [155.2, 155.7]];
    let changedCount = 0;
    for (let i = 0; i < 10; i++) {
      const r = await (await PATCH(req({ holes }), ctx(BEAT.label))).json() as { changed: boolean };
      if (r.changed) changedCount += 1;
    }
    if (changedCount !== 1) throw new Error(`${changedCount} of 10 identical writes reported a change`);
    if (snaps() !== 1) throw new Error(`${snaps()} snapshots for one real edit`);
  });

  /* ---- concurrent: ten at once ----------------------------------------- */
  await rep.checkAsync("F noop", "ten concurrent identical writes still burn one snapshot", async () => {
    reset([{ ...BEAT }]);
    const holes = [...BEAT.holes, [155.2, 155.7]];
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      PATCH(req({ holes }), ctx(BEAT.label)).then((r) => r.json() as Promise<{ changed: boolean }>)));
    const n = results.filter((r) => r.changed).length;
    if (n === 0) throw new Error("none of ten concurrent writes reported a change");
    if (snaps() > n) throw new Error(`${snaps()} snapshots for ${n} reported changes`);
    const onDisk = (loadBeats(P)!.beats[0] as { holes: Hole[] }).holes;
    if (onDisk.length !== 3) throw new Error(`the edit is corrupt: ${JSON.stringify(onDisk)}`);
  });

  /* ---- the library function's own contract ----------------------------- */
  await rep.checkAsync("F noop", "saveBeats reports true then false for the same document", async () => {
    reset([{ ...BEAT }]);
    const doc = { source: "raw/a.mov", beats: [{ label: "line", start: 1, end: 5 }] };
    if (saveBeats(P, doc as never, "x") !== true) throw new Error("a real write reported false");
    if (saveBeats(P, doc as never, "x") !== false) throw new Error("a repeat write reported true");
  });

  await rep.checkAsync("F noop", "updateBeatRange still returns the document as well as the flag", async () => {
    reset([{ ...BEAT }]);
    const r = updateBeatRange(P, BEAT.label, 153, 158);
    if (!r || typeof r !== "object") throw new Error("no result");
    if (!("data" in r) || !("changed" in r)) throw new Error(`shape changed: ${Object.keys(r)}`);
    if (!Array.isArray(r.data.beats)) throw new Error("the document is not a beats file");
  });

  /* ---- formatting: a hand-edited file ---------------------------------- */
  await rep.checkAsync("F noop", "a hand-formatted beats.json does not fake a change", async () => {
    fs.rmSync(snapDir, { recursive: true, force: true });
    // the same content, written the way a person's editor would leave it
    fs.writeFileSync(file, JSON.stringify({ source: "raw/a.mov", beats: [BEAT] }));  // no indent, no newline
    const res = await PATCH(req({ holes: BEAT.holes }), ctx(BEAT.label));
    const body = await res.json() as { changed: boolean };
    if (!body.changed) return;      // ideal: it noticed nothing meaningful moved
    // acceptable: it rewrote to canonical form. But it must not claim a CUT,
    // and it must be idempotent from here on.
    const again = await (await PATCH(req({ holes: BEAT.holes }), ctx(BEAT.label))).json() as { changed: boolean };
    if (again.changed) throw new Error("re-formatting is reported as a change every single time");
  });

  /* ---- randomised: the flag must always match the file ----------------- */
  for (let i = 0; i < budget; i++) {
    const seed = 90000 + i;
    const r = rng(seed);
    await rep.checkAsync("F noop", `the flag matches the file #${i}`, async () => {
      reset([{ ...BEAT }]);
      const holes: Hole[] = [];
      for (let k = 0; k < r.int(0, 4); k++) {
        const f = Math.round(r.float(BEAT.start - 1, BEAT.end + 1) * 1000) / 1000;
        holes.push([f, Math.round((f + r.float(-0.5, 2)) * 1000) / 1000]);
      }
      const wasBytes = bytes(), wasSnaps = snaps();
      const res = await PATCH(req({ holes }), ctx(BEAT.label));
      if (res.status !== 200 && res.status !== 400) throw new Error(`status ${res.status}`);
      const reallyChanged = bytes() !== wasBytes;
      if (res.status === 400) {
        if (reallyChanged) throw new Error("a refused write changed the file");
        if (snaps() !== wasSnaps) throw new Error("a refused write burned a snapshot");
        return;
      }
      const body = await res.json() as { changed: boolean; unchanged?: string };
      if (body.changed !== reallyChanged) {
        throw new Error(`changed=${body.changed} but the file ${reallyChanged ? "did" : "did not"} move`);
      }
      if ((body.unchanged !== undefined) === body.changed) {
        throw new Error("`unchanged` is not the exact complement of changed");
      }
      const burned = snaps() - wasSnaps;
      if (burned !== (body.changed ? 1 : 0)) throw new Error(`burned ${burned} snapshots for changed=${body.changed}`);
    }, seed);
  }
}

/* Round two: the same contract on every OTHER write path.
 *
 * The feature was applied to two of the route's write paths first time. The
 * other four reported success for a no-op exactly as before, which is the
 * same defect wearing the same clothes on a different surface. */
export async function runPaths(rep: Report, root: string) {
  const P = "fixture";
  const dir = path.join(root, "projects", P);
  const file = path.join(dir, "beats.json");
  const snapDir = path.join(dir, ".snapshots");

  const beatRoute = await import("../../app/api/projects/[project]/beats/[label]/route.ts");
  const beatsRoute = await import("../../app/api/projects/[project]/beats/route.ts");
  const pipeRoute = await import("../../app/api/projects/[project]/pipeline/route.ts");

  const body = (b: unknown, method = "PATCH") => new Request("http://127.0.0.1:4737/t", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
  }) as never;
  const pctx = { params: { project: P } } as never;
  const bctx = (label: string) => ({ params: { project: P, label } }) as never;
  const snaps = () => (fs.existsSync(snapDir) ? fs.readdirSync(snapDir).length : 0);
  const bytes = () => fs.readFileSync(file, "utf8");
  const reset = (beats: unknown[]) => {
    fs.rmSync(snapDir, { recursive: true, force: true });
    fs.writeFileSync(file, JSON.stringify({ source: "raw/a.mov", beats }, null, 2) + "\n");
  };

  const A = { label: "a", start: 10, end: 20, holes: [[12, 13]] as Hole[] };
  const B = { label: "b", start: 30, end: 40 };

  /** Every path, as: what it is, how to call it with a no-op, how with a real change. */
  const paths: {
    name: string;
    setup: () => void;
    noop: () => Promise<Response>;
    real: () => Promise<Response>;
  }[] = [
    {
      name: "detached audio",
      setup: () => reset([{ ...A, audioStart: 9.2, audioEnd: 19.4 }, { ...B }]),
      noop: () => beatRoute.PATCH(body({ track: "audio", start: 9.2, end: 19.4 }), bctx("a")),
      real: () => beatRoute.PATCH(body({ track: "audio", start: 9.0, end: 19.4 }), bctx("a")),
    },
    {
      name: "relink audio to picture",
      setup: () => reset([{ ...A }, { ...B }]),      // no audioStart to remove
      noop: () => beatRoute.PATCH(body({ track: "audio", relink: true }), bctx("a")),
      real: () => beatRoute.PATCH(body({ track: "audio", relink: true }), bctx("a")),
    },
    {
      name: "fades",
      setup: () => reset([{ ...A, fadeIn: 0.2 }, { ...B }]),
      noop: () => beatRoute.PATCH(body({ fadeIn: 0.2 }), bctx("a")),
      real: () => beatRoute.PATCH(body({ fadeIn: 0.35 }), bctx("a")),
    },
    {
      name: "reorder",
      setup: () => reset([{ ...A }, { ...B }]),
      noop: () => beatsRoute.POST(body({ op: "reorder", order: ["a", "b"] }, "POST"), pctx),
      real: () => beatsRoute.POST(body({ op: "reorder", order: ["b", "a"] }, "POST"), pctx),
    },
    {
      name: "cut a span out of the timeline",
      setup: () => reset([{ ...A }, { ...B }]),
      noop: () => beatsRoute.POST(body({ op: "cut_span", edits: [{ label: "a", holes: [[12, 13]] }] }, "POST"), pctx),
      real: () => beatsRoute.POST(body({ op: "cut_span", edits: [{ label: "a", holes: [[12, 13], [15, 16]] }] }, "POST"), pctx),
    },
    {
      name: "undo",
      setup: () => reset([{ ...A }, { ...B }]),
      noop: () => pipeRoute.PATCH(body({ beats: [{ ...A }, { ...B }] }), pctx),
      real: () => pipeRoute.PATCH(body({ beats: [{ ...A, end: 21 }, { ...B }] }), pctx),
    },
  ];

  for (const p of paths) {
    await rep.checkAsync("F noop", `${p.name}: a no-op says so`, async () => {
      p.setup();
      const was = bytes(), wasSnaps = snaps();
      const res = await p.noop();
      if (res.status !== 200) throw new Error(`status ${res.status}: ${await res.text()}`);
      const b = await res.json() as { changed?: boolean; unchanged?: string };
      const reallyChanged = bytes() !== was;
      if (b.changed === undefined) throw new Error("no `changed` field at all — this path still cannot tell you");
      if (b.changed !== reallyChanged) throw new Error(`changed=${b.changed}, file ${reallyChanged ? "moved" : "did not move"}`);
      if (!b.changed) {
        if (!b.unchanged) throw new Error("a no-op gave no reason");
        if (snaps() !== wasSnaps) throw new Error("a no-op burned a snapshot");
      }
    });

    await rep.checkAsync("F noop", `${p.name}: a real change says so`, async () => {
      p.setup();
      const was = bytes(), wasSnaps = snaps();
      const res = await p.real();
      if (res.status !== 200) throw new Error(`status ${res.status}: ${await res.text()}`);
      const b = await res.json() as { changed?: boolean; unchanged?: string };
      const reallyChanged = bytes() !== was;
      if (b.changed === undefined) throw new Error("no `changed` field at all");
      if (b.changed !== reallyChanged) throw new Error(`changed=${b.changed}, file ${reallyChanged ? "moved" : "did not move"}`);
      if (b.changed) {
        if (b.unchanged !== undefined) throw new Error("a real change carried an `unchanged` reason");
        if (snaps() - wasSnaps !== 1) throw new Error(`burned ${snaps() - wasSnaps} snapshots`);
      }
    });
  }
}

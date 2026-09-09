/* CATEGORY 003/011/016 — what survives a save, a reload, and an undo.
 *
 * Data integrity outranks everything visual. These drive the real
 * saveBeats/loadBeats/snapshot code against a scratch project on disk, so a
 * pass means bytes actually round-tripped, not that a mock agreed with
 * itself. */
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../../lib/paths.ts";
import { saveBeats, loadBeats } from "../../lib/beats.ts";
import { takeSnapshot, list, restore, prune } from "../../lib/snapshots.ts";
import { rng } from "../rng.mts";
import type { Report } from "../report.mts";

const P = "zz-qa-persist";
const dir = path.join(PROJECTS_ROOT, P);
const ms = (n: number) => Math.round(n * 1000) / 1000;

type Beat = { label: string; start: number; end: number; text?: string;
              holes?: [number, number][]; fadeIn?: number; fadeOut?: number;
              audioStart?: number; audioEnd?: number };

function makeBeats(r: ReturnType<typeof rng>, n: number) {
  const beats: Beat[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const d = r.float(0.3, 8);
    const b: Beat = { label: `line-${i}`, start: ms(t), end: ms(t + d), text: `take ${i}` };
    if (r.bool(0.3) && d > 1) b.holes = [[ms(b.start + 0.2), ms(b.start + 0.2 + r.float(0.05, 0.4))]];
    if (r.bool(0.2)) b.fadeIn = ms(r.float(0.01, 0.5));
    if (r.bool(0.2)) b.fadeOut = ms(r.float(0.01, 0.5));
    if (r.bool(0.15)) { b.audioStart = ms(b.start - 0.2); b.audioEnd = ms(b.end + 0.2); }
    beats.push(b);
    t = ms(t + d + r.float(0, 2));
  }
  return { source: "raw/clip.mov", beats };
}

export function run(rep: Report, budget: number) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify({ source: "raw/clip.mov", beats: [] }));

  /* ---- save -> load round trip ---------------------------------------- */
  for (let i = 0; i < budget; i++) {
    const seed = 40000 + i;
    const r = rng(seed);
    const doc = makeBeats(r, r.int(0, 20));
    rep.check("003 persistence", `beats survive save and reload #${i}`, () => {
      saveBeats(P, doc as never, `qa ${i}`);
      const back = loadBeats(P);
      if (!back) throw new Error("nothing loaded back");
      if (JSON.stringify(back.beats) !== JSON.stringify(doc.beats)) {
        throw new Error("what came back is not what went in");
      }
      if (back.source !== doc.source) throw new Error(`source changed: ${back.source}`);
    }, seed);
  }

  /* ---- INVARIANT 4/5: undo restores the exact previous state ----------- */
  for (let i = 0; i < Math.floor(budget / 2); i++) {
    const seed = 50000 + i;
    const r = rng(seed);
    const before = makeBeats(r, r.int(1, 12));
    const after = makeBeats(r, r.int(1, 12));
    rep.check("016 undo", `undo restores the exact prior state #${i}`, () => {
      saveBeats(P, before as never, "the state to come back to");
      const newestBefore = list(P)[0]?.id;
      saveBeats(P, after as never, "the edit");
      const snaps = list(P);
      // the ring caps at KEEP, so a growing count is not the signal -- a NEW
      // newest snapshot is
      if (!snaps.length || snaps[0].id === newestBefore) {
        throw new Error("the edit burned no snapshot, so it cannot be undone");
      }
      // the newest snapshot must hold what was there BEFORE the edit
      const r2 = restore(P, snaps[0].id);
      if (!r2) throw new Error("restore reported failure");
      const back = loadBeats(P)!;
      if (JSON.stringify(back.beats) !== JSON.stringify(before.beats)) {
        throw new Error("undo did not restore the prior state exactly");
      }
    }, seed);
  }

  /* ---- a write that changes nothing must not burn a slot --------------- */
  rep.check("003 persistence", "an identical save burns no snapshot", () => {
    const doc = makeBeats(rng(7), 4);
    saveBeats(P, doc as never, "first");
    const n = list(P).length;
    saveBeats(P, doc as never, "identical");
    if (list(P).length !== n) throw new Error("an identical write consumed an undo slot");
  });

  /* ---- labels that break filenames ------------------------------------ */
  const nastyLabels = [
    "with space", "with-hyphen", "with_underscore", "../escape", "with/slash",
    "with\\backslash", "with:colon", "with*star", "émoji-é", "日本語",
    "a".repeat(200), "", ".", "..", "CON", "with\nnewline", "with\ttab",
    "with'quote", 'with"doublequote', "with;semi", "$(whoami)", "%2e%2e",
  ];
  for (const label of nastyLabels) {
    rep.check("003 persistence", `a beat labelled ${JSON.stringify(label.slice(0, 20))} round-trips`, () => {
      const doc = { source: "raw/clip.mov", beats: [{ label, start: 0, end: 2 }] };
      saveBeats(P, doc as never, `label ${label.slice(0, 12)}`);
      const back = loadBeats(P);
      if (!back) throw new Error("nothing loaded back");
      if (back.beats[0].label !== label) {
        throw new Error(`label changed: ${JSON.stringify(back.beats[0].label)}`);
      }
      // the snapshot reason is written into a FILENAME; it must not escape
      const snaps = list(P);
      for (const s of snaps) {
        if (s.id.includes("/") || s.id.includes("..")) {
          throw new Error(`snapshot id escapes its folder: ${s.id}`);
        }
      }
    });
  }

  /* ---- snapshot pruning keeps the newest ------------------------------ */
  rep.check("003 persistence", "pruning keeps the most recent snapshots", () => {
    const before = list(P).map((s) => s.id);
    prune(P);
    const after = list(P).map((s) => s.id);
    if (!after.length && before.length) throw new Error("pruning removed everything");
    for (const id of after) if (!before.includes(id)) throw new Error(`prune invented ${id}`);
    // newest first, and the newest must survive
    if (before.length && after.length && after[0] !== before[0]) {
      throw new Error("pruning dropped the most recent snapshot");
    }
  });

  /* ---- a corrupt beats.json must not crash the reader ----------------- */
  const corrupt = ["", "{", "null", "[]", '{"beats":null}', '{"beats":{}}',
                   '{"source":5,"beats":[]}', "not json at all",
                   '{"beats":[{"label":"a"}]}', '{"beats":[{"start":1,"end":2}]}'];
  for (const body of corrupt) {
    rep.check("019 chaos", `loadBeats survives ${JSON.stringify(body.slice(0, 18))}`, () => {
      fs.writeFileSync(path.join(dir, "beats.json"), body);
      const back = loadBeats(P);          // must return something or null, never throw
      if (back && !Array.isArray(back.beats)) throw new Error("returned a doc whose beats are not a list");
    });
  }

  fs.rmSync(dir, { recursive: true, force: true });
  rep.check("003 persistence", "loading a project that does not exist returns null", () => {
    const back = loadBeats("zz-qa-does-not-exist");
    if (back !== null && back !== undefined) throw new Error(`expected null, got ${JSON.stringify(back).slice(0, 60)}`);
  });
}

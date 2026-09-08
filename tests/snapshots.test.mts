import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../lib/paths.ts";
import { takeSnapshot, list, restore, prune, snapshotDir } from "../lib/snapshots.ts";
import { saveBeats, loadBeats } from "../lib/beats.ts";

const P = "_test_snapshots";
const dir = path.join(PROJECTS_ROOT, P);
const beats = (n: number) => ({ source: "x.mov", beats: [{ label: "a", start: 0, end: n }] });

before(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify(beats(1)));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("project snapshots", () => {
  test("saving beats copies the PREVIOUS state aside first", () => {
    saveBeats(P, beats(2), "widen a");
    const all = list(P);
    assert.equal(all.length, 1);
    // the snapshot must hold what was there BEFORE the write, or it is useless
    const kept = JSON.parse(fs.readFileSync(path.join(snapshotDir(P), all[0].id), "utf8"));
    assert.equal(kept.beats[0].end, 1);
    assert.equal(loadBeats(P)!.beats[0].end, 2);
  });

  test("the reason is readable back off the file name", () => {
    assert.equal(list(P)[0].reason, "widen a");
  });

  test("a write that changes nothing does not burn a slot", () => {
    const before = list(P).length;
    saveBeats(P, loadBeats(P)!, "no-op");
    assert.equal(list(P).length, before);
  });

  test("newest first", () => {
    saveBeats(P, beats(3), "again");
    const all = list(P);
    assert.ok(all[0].takenAt >= all[1].takenAt);
  });

  test("restore puts the old edit back", () => {
    const oldest = list(P).at(-1)!;      // the state where end was 1
    restore(P, oldest.id);
    assert.equal(loadBeats(P)!.beats[0].end, 1);
  });

  test("restoring is itself undoable", () => {
    assert.ok(list(P).some((s) => s.reason === "before restore"),
              "the state before a restore must be recoverable too");
  });

  test("a made-up snapshot name is refused, not resolved", () => {
    assert.throws(() => restore(P, "../../../beats.json"), /not a snapshot name/);
    assert.throws(() => restore(P, "2026-01-01T00-00-00-000__nope.json"), /no snapshot/);
  });

  test("prune keeps the newest and drops the rest", () => {
    for (let i = 10; i < 16; i++) saveBeats(P, beats(i), `edit ${i}`);
    const dropped = prune(P, 3);
    assert.equal(list(P).length, 3);
    assert.ok(dropped.length > 0);
  });

  test("a project with no beats.json yields no snapshot, and no throw", () => {
    assert.equal(takeSnapshot("_test_does_not_exist", "x"), null);
  });
});

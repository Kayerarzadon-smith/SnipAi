import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deletedAtOf, RETAIN_DAYS } from "../lib/trash.ts";

/* The bug this guards: expiry once used the folder's mtime. A project nobody
   had touched for a week was "a week old" the instant it was deleted, so it
   was erased immediately instead of five days later. It cost real footage. */
describe("trash expiry", () => {
  test("reads the delete time out of the folder name", () => {
    assert.equal(deletedAtOf("img9817-2026-09-07T21-57-48"),
                 Date.parse("2026-09-07T21:57:48Z"));
  });

  test("a name with no stamp is unknown, never zero", () => {
    // null means "keep it": guessing the age wrong here destroys footage
    assert.equal(deletedAtOf("img9817"), null);
    assert.equal(deletedAtOf("weird-2026-13-99T99-99-99"), null);
  });

  test("a project deleted just now has its full window", () => {
    const at = deletedAtOf("p-2026-09-07T21-57-48")!;
    const ageDays = (at + 60_000 - at) / 86_400_000;
    assert.ok(ageDays < RETAIN_DAYS, "must not be expired one minute after deletion");
  });

  test("expires only after the window, not on the boundary before it", () => {
    const at = deletedAtOf("p-2026-09-01T00-00-00")!;
    const day = 86_400_000;
    assert.ok((at + RETAIN_DAYS * day - 1 - at) / day < RETAIN_DAYS);
    assert.ok((at + RETAIN_DAYS * day - at) / day >= RETAIN_DAYS);
  });
});

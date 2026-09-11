import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { followScroll, revealScroll, isFollowing, FOLLOW_HOLD_MS } from "@/lib/follow";

/**
 * LEDGER C22 / CG1 -- the review page scrolls itself.
 *
 * Reported by Kayer twice in his own words ("no more scrolling when I'm not
 * scrolling"), and reproduced on the native surface on 2026-09-11 with AX
 * scrollbar values: scroll the player into view and within ~4 seconds the page
 * drags itself back down to the lines list (1.0 -> 0.854 at the scroll, back to
 * 1.0 by +4.32s). It ran while PAUSED (0.655 -> 1.0 five seconds later). On a
 * 1440x900 display the player, the timeline and the lines cannot co-exist in an
 * 800pt window, so the cut plays with nothing visible. It also stole three of
 * the tester's clicks in one session, one of which opened a Trim editor on a
 * real project.
 *
 * Three call sites, one rule, one wrong guard. page.tsx:437 `scrollBy` on the
 * follow tick, :536 `scrollIntoView({block:"center"})` on `selectedClip`, and
 * :364 `scrollIntoView` in `nextFlagged`, all gated on `pointerDown.current`.
 * That predicate is wrong for all three: a wheel is not a pointer-down at all,
 * and it is already false by the time a `click` fires, because `click`
 * dispatches after `mouseup` and the capture handler at :504 has cleared it.
 * C19 (filed as "the viewport renders empty after an edit") and C20 ("the
 * timeline swallows the wheel") are both this row; C19's screenshots are a
 * scrolled page, not an empty render.
 *
 * THE RULE: the page moves the viewport only when the person just asked to be
 * taken somewhere -- a key press, or a line boundary during playback they
 * started -- and never as a side effect of a click, a wheel, or a timer.
 *
 * PROOF, without a DOM harness. There is no jsdom in this repo (that is M2,
 * and it is not built), but the provable claim here is "no scroll was
 * REQUESTED", which is the stronger assertion anyway -- it does not depend on
 * what a layout engine would then have done. So the decision was lifted out of
 * the effects into lib/follow.ts, the way lib/timelineLayout.ts holds the
 * timeline's arithmetic for the same reason, and the tests below ask it
 * directly. The second half of the file guards the wiring: the page may not
 * reach window.scrollBy or Element.scrollIntoView anywhere except through the
 * single executor that these rules feed.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PAGE = path.join(ROOT, "app", "projects", "[project]", "review", "page.tsx");
const src = fs.readFileSync(PAGE, "utf8");

/** A window 800pt tall with the player on screen and the spoken row below it. */
function onScreen(over: Partial<Parameters<typeof followScroll>[0]> = {}) {
  return {
    spokenLabel: "beat_07", following: true, pointerDown: false, playing: true,
    stageTop: 120, stageBottom: 420, rowTop: 800, rowBottom: 857, viewportHeight: 800, ...over,
  };
}

// ---- the rule -----------------------------------------------------------

test("C22: a paused project never moves the page", () => {
  // The tester's second measurement: 0.655 -> 1.0 five seconds after a scroll,
  // with playback stopped. `spoken` survives a pause -- the raf loop at :560
  // keeps resolving which line the playhead sits in and only guards setPlayhead
  // on `!v.paused` -- so "the line being spoken" is a leftover, and following a
  // leftover means nothing at all.
  const req = followScroll(onScreen({ playing: false }));
  assert.equal(req.kind, "none", `paused, and the page still asked to scroll: ${JSON.stringify(req)}`);
});

test("C22: the page never scrolls to a place the player is not in", () => {
  // This is the 1.0 at +4.32s. `want` is the stage's bottom edge plus 12 -- "just
  // below the player, which is where your eyes already are". With the player
  // scrolled off the top, that edge is NEGATIVE, so the arithmetic faithfully
  // computes a position further down the page and drags the lines list back over
  // the player. Following cannot carry the line up under a player that is not
  // there; the only correct answer is to leave the viewport alone.
  const req = followScroll(onScreen({ stageBottom: -120, rowTop: 40 }));
  assert.equal(req.kind, "none", `the player was off screen and the page still scrolled: ${JSON.stringify(req)}`);
});

test("C22: with the player in view and the video running, the line still comes to the playhead", () => {
  /* The feature is not being deleted. Playback the person started may carry the
     spoken line up under the player -- that is what it is for.

     AMENDED 2026-09-11 (ledger C28). This asserted the exact target
     `rowTop - (stageBottom + 12)`, and that expectation was the defect: it is
     a destination, not a distance, so twenty lines into a cut it asked for a
     1,700px scroll and took the player off the top of the window with it. The
     tester measured the stage leaving the viewport 3.3 seconds into playback
     and never coming back. What this test is for is that following still
     happens at all; HOW FAR is C28's file, which asserts the value against the
     geometry it was measured in. */
  const req = followScroll(onScreen());
  assert.equal(req.kind, "by", "following stopped working entirely");
});

test("C22: a hand on the mouse still freezes the page", () => {
  // The guard that was already there is right as far as it goes -- every clip,
  // trim handle and fade grip selects on MOUSEDOWN. "The screen won't stay put.
  // I cannot work this way." It just never covered a wheel.
  assert.equal(followScroll(onScreen({ pointerDown: true })).kind, "none");
});

test("C22: once you have scrolled, the list is yours", () => {
  assert.equal(followScroll(onScreen({ following: false })).kind, "none");
});

test("C22: following resumes by asking the clock, not by firing four seconds later", () => {
  // The mechanism of the headline symptom. The old code set a 4s timer that
  // bumped state so the effect would re-run and "pull the list back now, rather
  // than waiting for the next line". That is a scroll nobody asked for, arriving
  // after you have stopped moving -- which is exactly what "the screen won't stay
  // put" means. Resuming is now a question the next line boundary asks, so there
  // is no moment at which the page acts on its own.
  assert.equal(isFollowing(1_000, 1_000), false, "your own scroll was ignored immediately");
  assert.equal(isFollowing(1_000 + FOLLOW_HOLD_MS - 1, 1_000), false, "the list came back early");
  assert.equal(isFollowing(1_000 + FOLLOW_HOLD_MS, 1_000), true, "the list never came back");
  assert.equal(isFollowing(9e9, 0), true, "following is off by default");
});

test("C19: bringing a row into view never centres it", () => {
  // block:"center" on row 14 of 34 puts the header, the player and the timeline
  // above the fold -- which is what the two "blank viewport" screenshots
  // actually show. A reveal moves the minimum needed and no more.
  const req = revealScroll({ rowTop: 1400, rowBottom: 1460, viewportHeight: 800 });
  assert.equal(req.kind, "reveal");
  if (req.kind === "reveal") {
    assert.equal(req.block, "nearest", "a reveal still centres the row, and the player goes off screen");
  }
});

test("C19: a row already on screen is not moved", () => {
  assert.equal(revealScroll({ rowTop: 300, rowBottom: 360, viewportHeight: 800 }).kind, "none");
});

// ---- the wiring ---------------------------------------------------------
//
// The rules above are only worth anything if the page cannot go round them.

/** The text of the `{...}` block that `startsWith` opens, braces balanced. */
function blockAt(startsWith: string): string {
  const i = src.indexOf(startsWith);
  assert.notEqual(i, -1, `page.tsx no longer contains ${JSON.stringify(startsWith)}`);
  const open = src.indexOf("{", i + startsWith.length - 1);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  assert.fail(`unbalanced braces after ${JSON.stringify(startsWith)}`);
}

test("C22: the page reaches the scrolling API in exactly one place", () => {
  const calls = [...src.matchAll(/window\.scrollBy\(|\.scrollIntoView\(/g)];
  assert.equal(calls.length, 2, `expected one scrollBy and one scrollIntoView, found ${calls.length}`);
  const executor = blockAt("function applyScrollRequest(");
  for (const c of calls) {
    const line = src.slice(0, c.index).split("\n").length;
    assert.ok(executor.includes(c[0]),
      `page.tsx:${line} moves the viewport outside applyScrollRequest: ${c[0]}`);
  }
});

test("C22: no effect scrolls because the selection changed", () => {
  // :529-538's whole premise -- work out from an effect whether the selection
  // that just happened deserves a scroll -- is unanswerable there, which is why
  // its guard was wrong. The two acts that genuinely mean "take me to this row"
  // say so at the call site instead.
  assert.doesNotMatch(src, /\}, \[selectedClip\]\);/,
    "the selection-driven scroll effect is back, and it cannot know who asked");
});

test("C22: your own scroll schedules nothing", () => {
  assert.doesNotMatch(src, /followTick/, "the four-second pull is back");
  const gate = blockAt("const yieldToUser =");
  assert.doesNotMatch(gate, /setTimeout/, "yielding the list to the user starts a timer again");
});

test("C22: clicking a line does not move the page", () => {
  // `click` dispatches after `mouseup`, so the pointerDown guard was always
  // false by the time this handler ran. Nothing here may reveal: the row you
  // clicked is under your cursor and therefore already on screen.
  const row = src.slice(src.indexOf("data-beat={b.label}"));
  const onClick = row.slice(row.indexOf("onClick="), row.indexOf("onKeyDown="));
  assert.doesNotMatch(onClick, /reveal/i, `clicking a line still scrolls the page: ${onClick.trim()}`);
});

test("C22: the keyboard can still take you to a row", () => {
  // The case the original comment says this was written for: "keyboard
  // selection (arrows, N) still brings the row into view".
  const keys = blockAt("const onKey = (e: KeyboardEvent)");
  assert.match(keys, /revealRow\(/, "arrowing through the lines no longer follows them");
  assert.match(blockAt("function nextFlagged()"), /revealRow\(/, "N no longer takes you to the flagged line");
});

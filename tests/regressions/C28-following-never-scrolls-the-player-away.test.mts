import test from "node:test";
import assert from "node:assert/strict";

import { followScroll } from "@/lib/follow";

/**
 * LEDGER C28 -- playback following overshoots, and the player is gone in 3.3s.
 *
 * C22 stopped the page moving when nobody asked. It did not fix HOW FAR the
 * page moves when someone does. Measured on the native surface 2026-09-11,
 * press play on a project and the stage leaves the window and never returns:
 *
 *     playhead   scrollPx   stage screen-y   on screen
 *     0:00.0     0          268 .. 729       yes
 *     0:01.2     402       -183 .. 278       partly
 *     0:03.3     853       -634 .. -173      no
 *     0:54.7     853       -634 .. -173      no
 *
 * The window is screen-y 93..860. After a wheel it is worse and gets worse as
 * playback runs: destinations of 853, then 807, then 1421.
 *
 * WHY THE LAST FIX DID NOT CATCH IT, which is the point of this file. Five of
 * C22's thirteen tests assert the SHAPE of page.tsx -- that nothing reaches
 * window.scrollBy or Element.scrollIntoView outside `applyScrollRequest`. That
 * assertion still holds and is still true. The shape was right while the
 * behaviour was wrong: the executor was being asked for the wrong target. A
 * source-shape test cannot catch that by construction, so every test below
 * asserts a VALUE -- the number handed to applyScrollRequest -- and the last
 * one asserts it over a whole run rather than one call, because a runaway is a
 * property of the loop and not of any single request in it.
 *
 * THE RULE, the other half of C22's: not just WHETHER to follow, but HOW FAR.
 * Following asks for the least movement that brings the line into view, the
 * same minimum-movement reveal the keyboard path already uses -- and it may
 * never carry the player off the edge of the window it is following for.
 */

/* The measured window, in client coordinates (screen-y minus the window's own
   93px origin), so every number below is one of the tester's. */
const VIEWPORT = 860 - 93;          // 767
const STAGE_TOP = 268 - 93;         // 175
const STAGE_BOTTOM = 729 - 93;      // 636
/** lib/follow's own bottom margin -- a row is not "in view" flush to the fold */
const EDGE_BOTTOM = 40;

function playing(over: Partial<Parameters<typeof followScroll>[0]> = {}) {
  return {
    spokenLabel: "beat_07", following: true, pointerDown: false, playing: true,
    stageTop: STAGE_TOP, stageBottom: STAGE_BOTTOM,
    rowTop: 900, rowBottom: 957, viewportHeight: VIEWPORT, ...over,
  };
}

const asked = (r: ReturnType<typeof followScroll>) => (r.kind === "by" ? r.top : 0);

test("C28: following never asks for more than brings the line into view", () => {
  /* The old arithmetic aimed the row at the player's bottom edge -- rowTop -
     (stageBottom + 12) -- which is a destination, not a distance. A line one
     row below the fold got a 252px scroll to bring it 230px up, and twenty
     lines in it got 1,700. Minimum movement is what `block:"nearest"` means
     and what revealRow already does; following is the one caller that never
     learned it. */
  const req = followScroll(playing({ rowTop: 900, rowBottom: 957 }));
  const need = 957 - (VIEWPORT - EDGE_BOTTOM);   // the foot of the line, just above the fold
  assert.equal(req.kind, "by", "following stopped working entirely");
  assert.ok(
    asked(req) <= need + 0.5,
    `following asked for ${asked(req)}px to move a line ${need}px -- it is aiming at a place, not a distance`,
  );
});

test("C28: given the room, it asks for exactly that much and no more", () => {
  // The feature is not being deleted. On a window with the player well clear of
  // the top, the whole of the minimum movement is available and it is taken.
  const req = followScroll(playing({
    stageTop: 500, stageBottom: 900, rowTop: 1400, rowBottom: 1457, viewportHeight: 1400,
  }));
  assert.equal(req.kind, "by", "following stopped working entirely");
  assert.equal(asked(req), 1457 - (1400 - EDGE_BOTTOM), "the line does not reach the fold");
});

test("C28: a follow scroll never carries the player off the top of the window", () => {
  /* 0:03.3 in the table. The row is far down the list, the old target was far
     down the page, and the stage's bottom edge landed 266px ABOVE the top of
     the window -- at which point C22's own precondition refuses to follow ever
     again, which is the 0:54.7 row: pinned, with nothing to watch. */
  const req = followScroll(playing({ rowTop: 2400, rowBottom: 2457 }));
  const after = STAGE_BOTTOM - asked(req);
  assert.ok(after > 0, `the scroll put the player's bottom edge at ${after}px, above the top of the window`);
  const top = STAGE_TOP - asked(req);
  assert.ok(top >= 0, `the scroll pushed the player ${-top}px off the top of the window`);
});

test("C28: a follow scroll never pushes the player off the bottom either", () => {
  // The same rule the other way: a line above the player asks the page to move
  // up, and a big enough ask would carry the stage out through the bottom.
  const req = followScroll(playing({ rowTop: -1800, rowBottom: -1743 }));
  const after = STAGE_TOP - asked(req);
  assert.ok(
    after < VIEWPORT,
    `the scroll put the player's top edge at ${after}px, below the bottom of a ${VIEWPORT}px window`,
  );
});

test("C28: the line already under the player is left alone", () => {
  assert.equal(followScroll(playing({ rowTop: 660, rowBottom: 717 })).kind, "none");
});

test("C28: a whole run of playback never loses the player", () => {
  /* THE ASSERTION A SOURCE-SHAPE TEST CANNOT MAKE.
   *
   * The defect is not in any one request; each one looked locally reasonable.
   * It is that the requests compound -- the executor scrolls, the geometry
   * moves, and the next line boundary computes its target from the moved
   * geometry. So this models the page and plays the whole cut through it,
   * feeding each answer back in exactly as applyScrollRequest would, and asks
   * the only question the chair asks: was the player on screen the whole time?
   *
   * The page is the measured one: 2958px tall, the stage at 175..636, the
   * lines list below the timeline, 34 rows. Under the old arithmetic this
   * reaches 853px within three boundaries and the stage never comes back.
   */
  const PAGE = 2958;
  const ROW_H = 57;
  const LIST_TOP = 1000;                       // below the stage and the timeline
  const maxScroll = PAGE - VIEWPORT;
  let scrollY = 0;
  const stageAt = () => ({ top: STAGE_TOP - scrollY, bottom: STAGE_BOTTOM - scrollY });

  const offscreen: string[] = [];
  for (let line = 0; line < 34; line++) {
    const stage = stageAt();
    const req = followScroll(playing({
      stageTop: stage.top,
      stageBottom: stage.bottom,
      rowTop: LIST_TOP + line * ROW_H - scrollY,
      rowBottom: LIST_TOP + line * ROW_H + ROW_H - scrollY,
    }));
    // exactly what the browser does with what applyScrollRequest hands it
    scrollY = Math.max(0, Math.min(maxScroll, scrollY + asked(req)));
    const now = stageAt();
    if (now.bottom <= 0 || now.top >= VIEWPORT) {
      offscreen.push(`line ${line + 1}: scrollY ${scrollY}, stage ${now.top}..${now.bottom}`);
    }
  }
  assert.deepEqual(
    offscreen, [],
    `playback scrolled the player out of the window and it is playing where he cannot see it:\n  ${offscreen.join("\n  ")}`,
  );
});

test("C28: following is bounded by the player, so it cannot run away", () => {
  // The runaway destinations the tester logged -- 853, then 807, then 1421 --
  // are a total, and a total is what nothing bounded. No single request may
  // exceed what is left of the player above the top of the window, so the sum
  // of every request in a run is bounded by where the player started.
  const req = followScroll(playing({ rowTop: 9999, rowBottom: 10056 }));
  assert.ok(
    asked(req) <= STAGE_TOP,
    `one request asked for ${asked(req)}px with only ${STAGE_TOP}px of room above the player`,
  );
});

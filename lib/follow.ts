/**
 * When the review page is allowed to move the viewport. (ledger C22 / CG1)
 *
 * Kayer has reported this screen moving under him twice, in the same words
 * both times: "no more scrolling when I'm not scrolling." The first report
 * produced a `pointerDown` guard, which was the right instinct aimed at the
 * wrong predicate -- a wheel is not a pointer-down, and by the time a `click`
 * fires the mouse button is already up, so the guard was false exactly when it
 * was needed. Guarding against the wrong input is also unfixable in principle:
 * an effect that runs after the fact cannot know who asked for the state it is
 * reacting to. So the question is asked the other way round here. Nothing may
 * move the viewport unless it can say why it is allowed to.
 *
 * THE RULE. The page moves only when the person just asked to be taken
 * somewhere: a key press, or a line boundary during playback they started.
 * Never off a click, a wheel, or a timer.
 *
 * No React in here, and nothing that touches the DOM -- these functions decide,
 * and the page carries the decision out in one place. lib/timelineLayout.ts
 * keeps the timeline's arithmetic on the same terms and for the same reason:
 * it can then be tested directly, rather than through a rendered component.
 */

export type ScrollRequest =
  | { kind: "none"; why: string }
  | { kind: "by"; top: number; behavior: "auto" | "smooth" }
  | { kind: "reveal"; block: "nearest" };

const NOTHING = (why: string): ScrollRequest => ({ kind: "none", why });

export type FollowInput = {
  /** the line under the playhead, or null when the playhead is between lines */
  spokenLabel: string | null;
  /** false while the list belongs to the user, after their own scroll */
  following: boolean;
  pointerDown: boolean;
  /** whether the video is ACTUALLY running, not whether a line is highlighted */
  playing: boolean;
  /** `.stage` edges in viewport coordinates, null when there is no stage */
  stageTop: number | null;
  stageBottom: number | null;
  rowTop: number;
  rowBottom: number;
  viewportHeight: number;
};

/** The margins a row has to clear to count as "in view", shared with
 *  revealScroll so the two callers mean the same thing by it. */
const EDGE_TOP = 60;
const EDGE_BOTTOM = 40;
/** A line carried up to the player sits just under it, not against it. */
const UNDER_STAGE = 12;

/**
 * Carry the spoken line up under the player.
 *
 * Playback moves through the list faster than anyone can follow by eye, so the
 * list comes to the playhead rather than the other way round. Every condition
 * below is a case where that sentence stops being true.
 */
export function followScroll(i: FollowInput): ScrollRequest {
  if (!i.spokenLabel) return NOTHING("no line is being spoken");
  if (!i.following) return NOTHING("the list is the user's until their scroll expires");
  if (i.pointerDown) return NOTHING("a hand is on the mouse");
  /* Paused is not a slower kind of playing. The playhead still sits inside a
     line when you stop, so `spoken` stays set and the old code went on
     following it -- moving the page of a project nobody was playing, which is
     the case the tester measured at 0.655 -> 1.0 with the video stopped. */
  if (!i.playing) return NOTHING("the video is not playing");
  /* "Just below the player" is only a place if the player is on screen. Once
     the stage has scrolled off the top its bottom edge is negative, and the
     arithmetic below faithfully computes a target further DOWN the page --
     which is how following ended up dragging the lines list back over the
     player and playing the cut where he could not see it. Following cannot
     carry a line up to something that is not there. */
  if (i.stageBottom !== null && (i.stageBottom <= 0 || i.stageBottom >= i.viewportHeight)) {
    return NOTHING("the player is not on screen to carry the line up to");
  }

  /* HOW FAR, which is the half C22 left out.
   *
   * This used to compute a DESTINATION -- put the row's top edge 12px under
   * the player -- and hand the difference to scrollBy. A destination is not a
   * distance. Twenty lines into the cut the row is 1,700px down the page, so
   * "bring it under the player" is a 1,700px scroll, and the player it was
   * being brought under went with it: measured on the native surface, the
   * stage left the window 3.3 seconds into playback and pinned 266px above the
   * fold for the remaining 51 seconds. The cut played where he could not see
   * it, which is the sentence this whole rule exists to prevent.
   *
   * revealScroll had it right all along and following never learned it: move
   * the least that brings the line into view. `block:"nearest"`, in numbers,
   * against a band that starts under the player rather than at the top of the
   * window -- because under the player is where his eyes already are. */
  const bandTop = i.stageBottom === null ? EDGE_TOP : i.stageBottom + UNDER_STAGE;
  const bandBottom = i.viewportHeight - EDGE_BOTTOM;
  let delta: number;
  if (i.rowBottom > bandBottom) {
    // up far enough to clear the fold -- or, for a line taller than the band,
    // only as far as its own top edge, or it would vanish under the player
    delta = Math.min(i.rowBottom - bandBottom, Math.max(0, i.rowTop - bandTop));
  } else if (i.rowTop < bandTop) {
    delta = i.rowTop - bandTop;                        // negative: out from under the player
  } else {
    return NOTHING("the line is already in view");
  }

  /* And the bound that makes a runaway impossible rather than unlikely.
   *
   * Every request above is small, but they compound: the page scrolls, the
   * geometry moves, and the next line boundary measures the moved geometry.
   * The tester logged the totals -- 853px, then 807, then 1421 -- and nothing
   * in the old code was ever summing them. Following exists to carry a line to
   * the player, so it may never spend more room than the player has: at most
   * the gap above it going up, at most the gap below it coming back. The sum
   * of a whole run is then bounded by where the player started, and the thing
   * being followed for cannot be the thing that gets scrolled away. */
  if (i.stageTop !== null && i.stageBottom !== null) {
    const roomUp = Math.max(0, i.stageTop);                       // before its top edge clears the window
    const roomDown = Math.max(0, i.viewportHeight - i.stageBottom); // before its foot leaves the bottom
    delta = Math.max(-roomDown, Math.min(roomUp, delta));
  }

  if (Math.abs(delta) < 6) return NOTHING("already there");
  return { kind: "by", top: delta, behavior: Math.abs(delta) > 400 ? "auto" : "smooth" };
}

export type RevealInput = {
  rowTop: number;
  rowBottom: number;
  viewportHeight: number;
};

/**
 * Bring a row the person asked for into view -- and move no further than that.
 *
 * It used to centre the row. On row 14 of 34 that puts the header, the player
 * and the timeline above the fold, which is what the two screenshots filed as
 * "the viewport renders empty" actually show: a scrolled page, not an empty
 * render. Being able to see the row is the whole request; the rest of the
 * screen staying where it was is the other half of it.
 */
export function revealScroll(i: RevealInput): ScrollRequest {
  const hidden = i.rowTop < EDGE_TOP || i.rowBottom > i.viewportHeight - EDGE_BOTTOM;
  return hidden ? { kind: "reveal", block: "nearest" } : NOTHING("already in view");
}

export const FOLLOW_HOLD_MS = 4000;

/**
 * Scrolling hands the list to you, but only for a moment.
 *
 * Switching following off for good meant one flick of the wheel stopped it
 * coming back, which reads as the feature being broken. Four seconds is long
 * enough to read what you scrolled to and short enough that you never have to
 * ask for it back.
 *
 * This is a QUESTION, deliberately, and not a timer. The timer it replaces did
 * not merely resume following when it fired -- it pulled the view back to the
 * spoken line, by its own comment, "rather than waiting for the next line". So
 * you scrolled somewhere to read it, stopped, and four seconds later the page
 * moved on its own. Asked as a question, resuming has no moment of its own: the
 * next line boundary finds following switched back on, and if the video is
 * stopped, nothing ever comes of it.
 */
export function isFollowing(now: number, yieldedAt: number, holdMs = FOLLOW_HOLD_MS): boolean {
  return now - yieldedAt >= holdMs;
}

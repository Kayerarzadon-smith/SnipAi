import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "../scratch.mts";

/**
 * LEDGER C30 -- the Live edit Play/Pause button received no mouse clicks.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS NOT THE OBVIOUS TEST.
 *
 * The button was there all night. It rendered, it had a handler, and `AXPress`
 * -- which bypasses hit testing -- started playback instantly. Space worked.
 * "Your cut" worked. Every test anyone would reach for first (the button
 * exists / the handler fires / the markup has the right shape) was TRUE while
 * five real clicks at its centre did nothing. That is the shape that has
 * already shipped green twice here: C22's five source-shape tests held while
 * the behaviour was wrong, and C28's did the same.
 *
 * So the claim this file proves is the one a person's mouse makes:
 *
 *     the topmost element at the Play button's centre is the Play button
 *
 * `document.elementFromPoint` answers exactly that, and nothing else does --
 * it is the same walk the browser performs to route a click. It needs a real
 * layout engine, so it runs through `tests/native/layout-probe.swift`, a
 * WKWebView the size of a window. jsdom could not answer it: jsdom has no
 * layout, so every rect is zero and every hit test is empty. This is NOT M2
 * arriving under another name, and must not grow into it -- it renders static
 * HTML with the app's real stylesheet, never a React tree.
 *
 * WHAT WAS ACTUALLY WRONG (the ledger row's diagnosis was not it).
 *
 * C30 says "the following section covers the gap". Nothing covers it.
 * `document.elementsFromPoint` at the button's centre does not contain the
 * button ANYWHERE in the chain -- not under `.tl-bar`, not under anything.
 * The button is not covered, it is CLIPPED:
 *
 *   `.stage .player` took `aspect-ratio` on the whole box, so its height was
 *   fixed at width x (1/ratio) before any child was laid out. The `<video>`
 *   at `height: 100%` then filled that height exactly, so `.live-transport`
 *   -- a flow child that comes after it -- began 1px past the box's bottom
 *   edge and was clipped away by the same rule's `overflow: hidden`. Clipped
 *   content paints nothing and hit-tests as nothing, while
 *   `getBoundingClientRect()` still reports the geometry it WOULD have had.
 *   That phantom rect is what the tester measured, and it lands in the gap
 *   between `.stage` and `.tl-wrap`, which is why probing it returned the
 *   page's own `<section>` and the timeline behind it.
 *
 * The aspect ratio belongs to the picture, not to the picture plus its
 * controls. Moving it onto the `<video>` is what the fix does, so the player
 * box has no fixed height at all any more and the class of bug -- "a child of
 * .player is laid out outside .player" -- cannot be reached again by adding a
 * second control next to the first.
 *
 * The tester's "~49px off from where it settles" is this same defect, not a
 * neighbour: 49px is exactly what was being clipped (scrollHeight 509 vs
 * clientHeight 460 = the transport's 47px, its 1px border-top, and a pixel of
 * rounding). `clippedPx` is asserted at 0 below for that reason.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PAGE = path.join(ROOT, "app", "projects", "[project]", "review", "page.tsx");
const CSS = path.join(ROOT, "app", "globals.css");
const PROBE_SRC = path.join(ROOT, "tests", "native", "layout-probe.swift");

/* ------------------------------------------------------------------ fixture
 *
 * The review screen in Live edit, from `<div className="stage">` to the
 * timeline that follows it, with the real `app/globals.css` behind it. Only
 * the ancestor chain and the class names matter to the question being asked,
 * and those are pinned against the real page by the staleness test below --
 * if someone moves the transport out of `.player`, that test says this
 * fixture has gone stale rather than letting it quietly measure a page that
 * no longer exists.
 *
 * The <video> carries no media on purpose. Measured both ways with a real
 * 1080x1920 clip loaded: identical to the tenth of a pixel, because every
 * number here comes from the stylesheet rather than from the footage.
 */
const FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="globals.css"></head>
<body>
<div class="shell">
  <nav class="rail"></nav>
  <main class="main">
    <section>
      <div class="review-top">
        <div>
          <div class="breadcrumb"><a href="#">Queue</a> / <span>img-9817</span></div>
          <div class="review-title">img-9817 &mdash; img-9817-v6.mp4</div>
          <div class="review-agent">34 beats &middot; transcript available</div>
        </div>
      </div>

      <div class="stage">
        <div class="player-modes">
          <button class="pm active">Your cut</button>
          <button class="pm">Rendered file</button>
          <label class="auto-apply"><input type="checkbox"> Keep the exported file current</label>
          <span class="pm-note">Your edit, played straight off the original footage.</span>
        </div>
        <div class="player" id="player" style="--shot-aspect: 1080 / 1920">
          <video id="raw" preload="metadata"></video>
          <span class="player-grip"></span>
          <div class="live-transport">
            <button type="button" class="lt-play" id="play" aria-label="Play your cut">
              <svg viewBox="0 0 12 14" aria-hidden="true"><path d="M1.5 1.3 11 7 1.5 12.7Z"/></svg>
            </button>
            <span class="lt-time mono">0:00.0<span class="lt-sep">/</span>2:06.8</span>
            <span class="lt-line">But just do yourself a favor</span>
          </div>
        </div>
      </div>

      <div class="tl-wrap"><div class="tl">
        <div class="tl-bar">
          <div class="tl-bar-left">
            <span class="tl-title">Timeline</span>
            <button class="tl-keys">shortcuts</button>
            <span class="tl-meta mono">34 clips &middot; 2:06.8</span>
            <span class="tl-stale">picture out of date</span>
          </div>
          <div class="tl-bar-right">
            <button class="ui-btn ui-btn-sm">Fit</button>
            <button class="ui-btn ui-btn-sm">&minus;</button>
          </div>
        </div>
        <div style="height:320px"></div>
      </div></div>
    </section>
  </main>
</div>
</body></html>`;

/* The player's width is the one thing a person can change by hand (the CSS
 * clamps it to 160-340px by window width; the resize grip can take it to the
 * 430px max-width). Every width is measured, because a hit area that only
 * works at one size is how this bug read at first -- five viewport sizes were
 * tried before anyone believed it. */
const MEASURE = `
const PLAYER_WIDTHS = [160, 225, 260, 340, 430];
const player = document.getElementById("player");
const btn = document.getElementById("play");
const desc = (el) => el ? el.tagName + (el.className && typeof el.className === "string"
  ? "." + el.className.trim().split(/\\s+/).join(".") : "") : null;
const box = (sel) => {
  const el = typeof sel === "string" ? document.querySelector(sel) : sel;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1) };
};
const out = [];
for (const wpx of PLAYER_WIDTHS) {
  player.style.width = wpx + "px";
  void document.body.offsetHeight;                       // force layout

  // Put the button's rect in the viewport before hit-testing: elementFromPoint
  // is viewport-relative and answers null outside it, and a 430px-wide player
  // is taller than a laptop window. The WINDOW is scrolled, never .player --
  // scrolling .player would itself reveal the clipped transport and hide the
  // very thing being measured.
  const pre = btn.getBoundingClientRect();
  window.scrollTo(0, Math.max(0, window.scrollY + pre.top - innerHeight / 2));
  void document.body.offsetHeight;

  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const probe = (y) => {
    const hit = document.elementFromPoint(cx, y);
    return { topmost: desc(hit), isButton: !!hit && (hit === btn || btn.contains(hit)) };
  };
  out.push({
    playerWidth: +player.getBoundingClientRect().width.toFixed(1),
    inViewport: r.top >= 0 && r.bottom <= innerHeight,
    playerScrollTop: player.scrollTop,
    clippedPx: player.scrollHeight - player.clientHeight,
    player: box(player), stage: box(".stage"),
    transport: box(".live-transport"), button: box(btn),
    nextSectionTop: box(".tl-wrap").top,
    centre: probe(r.top + r.height / 2),
    justInsideTopEdge: probe(r.top + 4),   // the tester's sixth click
    chainAtCentre: document.elementsFromPoint(cx, r.top + r.height / 2).map(desc),
  });
}
return out;
`;

type Case = {
  playerWidth: number; inViewport: boolean; playerScrollTop: number; clippedPx: number;
  player: { top: number; bottom: number; h: number };
  stage: { top: number; bottom: number; h: number };
  transport: { top: number; bottom: number; h: number };
  button: { top: number; bottom: number; h: number };
  nextSectionTop: number;
  centre: { topmost: string | null; isButton: boolean };
  justInsideTopEdge: { topmost: string | null; isButton: boolean };
  chainAtCentre: (string | null)[];
};

let probeBin: string | null = null;
function probe(width: number, height: number): Case[] {
  const dir = scratchDir("c30");
  if (!probeBin) {
    const bin = path.join(dir, "layout-probe");
    const built = spawnSync("swiftc", ["-O", PROBE_SRC, "-o", bin], { encoding: "utf8" });
    assert.equal(
      built.status, 0,
      `tests/native/layout-probe.swift did not compile -- this claim cannot be ` +
      `checked without it, and a skip here would be silently permanent:\n${built.stderr}`
    );
    probeBin = bin;
  }
  fs.writeFileSync(path.join(dir, "page.html"), FIXTURE);
  fs.writeFileSync(path.join(dir, "measure.js"), MEASURE);
  fs.copyFileSync(CSS, path.join(dir, "globals.css"));
  const run = spawnSync(
    probeBin,
    [path.join(dir, "page.html"), path.join(dir, "measure.js"), String(width), String(height)],
    { encoding: "utf8", timeout: 60_000 }
  );
  assert.equal(run.status, 0, `layout-probe failed at ${width}x${height}:\n${run.stderr}`);
  return JSON.parse(run.stdout.trim());
}

const VIEWPORTS: [number, number][] = [[1024, 700], [1440, 900]];

/* -------------------------------------------------------------------------
 * The assertion. A presence test passes today; this one does not.
 * ---------------------------------------------------------------------- */
test("the topmost element at the Play button's centre is the Play button", () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const c of probe(vw, vh)) {
      const where = `${vw}x${vh}, player ${c.playerWidth}px`;
      assert.ok(c.inViewport, `${where}: the button's rect is not in the viewport, so the probe means nothing`);
      assert.equal(c.playerScrollTop, 0, `${where}: .player was scrolled, which would hide the defect`);
      assert.ok(
        c.centre.isButton,
        `${where}: clicking the centre of the Play button reaches ` +
        `${c.centre.topmost} instead. Nothing in the hit chain is the button: ` +
        `${JSON.stringify(c.chainAtCentre)}`
      );
      assert.ok(
        c.justInsideTopEdge.isButton,
        `${where}: 4px inside the button's top edge reaches ${c.justInsideTopEdge.topmost}`
      );
    }
  }
});

test("the player clips none of its own controls", () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const c of probe(vw, vh)) {
      const where = `${vw}x${vh}, player ${c.playerWidth}px`;
      // 49px of clipped overflow is the whole defect, and the same 49px the
      // tester saw the transport "settle" by.
      assert.equal(
        c.clippedPx, 0,
        `${where}: ${c.clippedPx}px of .player's content is clipped away by its own overflow:hidden`
      );
      assert.ok(
        c.transport.bottom <= c.player.bottom + 0.5,
        `${where}: the transport ends at ${c.transport.bottom} but the player box ends at ${c.player.bottom}`
      );
    }
  }
});

test("the stage is as tall as what is inside it, so the next section starts below the transport", () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const c of probe(vw, vh)) {
      const where = `${vw}x${vh}, player ${c.playerWidth}px`;
      assert.ok(
        c.stage.bottom >= c.transport.bottom - 0.5,
        `${where}: .stage ends at ${c.stage.bottom} while its own transport runs to ${c.transport.bottom}`
      );
      assert.ok(
        c.nextSectionTop >= c.transport.bottom,
        `${where}: the timeline starts at ${c.nextSectionTop}, above the transport's bottom at ${c.transport.bottom}`
      );
    }
  }
});

/* -------------------------------------------------------------------------
 * Staleness guard. NOT the proof -- the proof is above. This only says that
 * the fixture still describes the real page, so a green run above cannot mean
 * "the copy I measured is fine" about a page that has since changed.
 * ---------------------------------------------------------------------- */
test("the fixture still matches the page: the transport is a child of .player", () => {
  const src = fs.readFileSync(PAGE, "utf8");
  const playerAt = src.indexOf('className="player"');
  const transportAt = src.indexOf('className="live-transport"');
  const stageAt = src.indexOf('className="stage"');
  assert.ok(playerAt > 0 && transportAt > 0 && stageAt > 0, "the page no longer has .stage / .player / .live-transport");
  assert.ok(
    stageAt < playerAt && playerAt < transportAt,
    "the transport is no longer inside .player inside .stage -- " +
    "tests/regressions/C30-*.test.mts's fixture is stale, re-derive it from the page"
  );
  assert.ok(
    /className="lt-play"/.test(src),
    "the Play button is no longer .lt-play -- the fixture and the stylesheet disagree with the page"
  );
});

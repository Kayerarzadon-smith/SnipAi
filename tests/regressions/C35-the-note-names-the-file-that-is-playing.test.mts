import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  liveSource, renderedSource, playingSource, playerNote,
  type PlayerFiles, type PlayerMode, type ShowingFile,
} from "@/lib/playerCopy";

/**
 * LEDGER C35 -- the player says you are watching your original footage. You
 * are watching a 720p proxy.
 *
 * `review/page.tsx:1860` handed the live `<video>`:
 *
 *     `/api/media/${project}/${data.sourceProxy ?? data.source}`
 *
 * and `:1831`, thirty lines above it, captioned that same mode:
 *
 *     data.sourceProxy
 *       ? "Your edit, played straight off the original footage — every trim applies instantly."
 *       : "Your edit, played off the original footage. Cuts may hitch until you make playback smooth."
 *
 * The branch that claims the ORIGINAL is exactly the branch where the PROXY is
 * playing. `tools/make_source_proxy.py` writes a 720p H.264 copy (`--height`
 * defaults to 720) off 4K source, and the same toolbar's own button at `:1805`
 * calls that file "a small copy of the footage" -- so the screen contradicted
 * itself inside one component.
 *
 * Why it is not cosmetic: he reviews focus and skin detail on a skincare
 * product. A 720p downscale presented as the original means he can approve a
 * soft cut or reject a sharp one.
 *
 * WRONG SENTENCE, NOT WRONG BEHAVIOUR. The proxy belongs on the live path:
 * dense keyframes are what make a beat-to-beat seek land instantly, and
 * putting the original back there would trade a false sentence for an editor
 * that hitches at every cut. The first test below pins the proxy in place for
 * that reason, so this file cannot be "fixed" by reverting it.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS NOT A STRING TEST.
 *
 * C22's own regression encoded the bug's arithmetic as its expected value and
 * shipped green over a live defect, so the assertion here is a relationship
 * rather than a sentence:
 *
 *     the note's `showing` may name the file that is playing, or name no file
 *     at all -- never a different file
 *
 * swept over every combination of the seven inputs the page derives both from
 * (128 states, both modes). The proxy case fails that on the old copy because
 * `playingSource` says "proxy" while the note says "original", whatever
 * either of them is worded like. `"unstated"` exists because some notes are
 * about something other than the picture -- "the raw footage isn't on this
 * machine" explains why Live edit is unavailable -- and those are honest; it
 * is naming the WRONG file that C35 was.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PAGE = path.join(ROOT, "app", "projects", "[project]", "review", "page.tsx");
const PROXY_TOOL = path.join(ROOT, "ugc-edit-system", "tools", "make_source_proxy.py");

/* Every state the page can be in, as far as these two answers are concerned.
   Seven independent booleans-or-null over both modes; `source` is always
   present because beats.json cannot exist without it. */
function everyState(): { f: PlayerFiles; m: PlayerMode }[] {
  const out: { f: PlayerFiles; m: PlayerMode }[] = [];
  for (const hasSource of [true, false])
    for (const sourceProxy of ["work/source-proxy.mp4", null])
      for (const cutFile of ["img-9817-v6.mp4", null])
        for (const graphicsFile of ["img-9817-gfx.mp4", null])
          for (const cutStale of [true, false])
            for (const beatCount of [34, 0])
              for (const liveMode of [true, false])
                for (const showGraphics of [true, false])
                  out.push({
                    f: { hasSource, source: "IMG_9817.MOV", sourceProxy, cutFile, graphicsFile, cutStale, beatCount },
                    m: { liveMode, showGraphics },
                  });
  return out;
}

const STATES = everyState();

function describe(f: PlayerFiles, m: PlayerMode): string {
  return `live=${m.liveMode} gfx=${m.showGraphics} hasSource=${f.hasSource} ` +
    `proxy=${!!f.sourceProxy} cut=${!!f.cutFile} gfxFile=${!!f.graphicsFile} ` +
    `stale=${f.cutStale} beats=${f.beatCount}`;
}

/* -------------------------------------------------------------------------
 * First, the behaviour that is CORRECT and must stay. If this file ever gets
 * "fixed" by putting the original back on the live path, this fails.
 * ---------------------------------------------------------------------- */
test("C35: Live edit still plays the proxy when there is one -- that is not the bug", () => {
  const f: PlayerFiles = {
    hasSource: true, source: "IMG_9817.MOV", sourceProxy: "work/source-proxy.mp4",
    cutFile: "img-9817-v6.mp4", graphicsFile: null, cutStale: false, beatCount: 34,
  };
  assert.equal(liveSource(f).mediaPath, "work/source-proxy.mp4",
    "the live path stopped using the scrubbing proxy -- every cut will hitch again");
  assert.equal(liveSource(f).kind, "proxy");
  assert.equal(liveSource({ ...f, sourceProxy: null }).mediaPath, "IMG_9817.MOV",
    "with no proxy made, Live edit plays the original -- that is the honest fallback");
  assert.equal(liveSource({ ...f, sourceProxy: null }).kind, "original");
});

test("C35: and the proxy really is a downscale, which is the whole reason the claim mattered", () => {
  /* Read off the tool rather than asserted, so a later change to the proxy's
     size cannot leave this file arguing about a number nobody uses. */
  const src = fs.readFileSync(PROXY_TOOL, "utf8");
  const m = /--height[\s\S]{0,80}?default=(\d+)/.exec(src);
  assert.ok(m, "make_source_proxy.py no longer has a --height default -- re-derive C35's premise");
  assert.ok(
    Number(m![1]) < 2160,
    `the proxy is ${m![1]}p, which is not smaller than the 4K source -- if the proxy ` +
    `is full resolution now, "original footage" would be a defensible thing to say`
  );
});

/* -------------------------------------------------------------------------
 * The headline. Swept, and about the relationship rather than the words.
 * ---------------------------------------------------------------------- */
test("C35: no note names a file other than the one that is playing", () => {
  const wrong: string[] = [];
  for (const { f, m } of STATES) {
    const playing: ShowingFile = playingSource(f, m).kind;
    const { text, showing } = playerNote(f, m);
    if (showing !== "unstated" && showing !== playing) {
      wrong.push(`${describe(f, m)}\n    playing=${playing} but the note claims ${showing}: "${text}"`);
    }
  }
  assert.deepEqual(
    wrong, [],
    `${wrong.length} of ${STATES.length} player states describe a file other than the one on screen:\n  ` +
    wrong.slice(0, 6).join("\n  ")
  );
});

test("C35: the sentence shown while the proxy plays does not claim the original", () => {
  /* The second half, and it needs to be separate: `showing` is a label, and a
     label can be corrected while the words underneath still lie. This asks
     the words directly -- but only in the one direction that can be wrong, so
     it is not a comparison of a string with itself. */
  for (const { f, m } of STATES) {
    if (playingSource(f, m).kind !== "proxy") continue;
    const { text } = playerNote(f, m);
    assert.ok(
      !/\boriginal\b/i.test(text),
      `a 720p copy is playing and the note says: "${text}" (${describe(f, m)})`
    );
  }
});

test("C35: the proxy and the original are not described with the same sentence", () => {
  /* They were, near enough: both branches led with "played ... off the
     original footage" and differed only in what followed. Two files, two
     sentences. */
  const base: PlayerFiles = {
    hasSource: true, source: "IMG_9817.MOV", sourceProxy: "work/source-proxy.mp4",
    cutFile: "img-9817-v6.mp4", graphicsFile: null, cutStale: false, beatCount: 34,
  };
  const live: PlayerMode = { liveMode: true, showGraphics: false };
  assert.notEqual(
    playerNote(base, live).text,
    playerNote({ ...base, sourceProxy: null }, live).text,
    "the same sentence is shown whether the proxy or the original is playing"
  );
});

test("C35: a note that states nothing about the picture is talking about something else", () => {
  /* "unstated" is the escape hatch this file allows, so it may not become a
     way to say nothing everywhere. Every state where a file IS playing and the
     note is unstated has to have a reason -- here, exactly one: Live edit is
     unavailable and the note explains why instead of narrating the render. */
  const unstated = STATES.filter(({ f, m }) => playerNote(f, m).showing === "unstated");
  assert.ok(unstated.length > 0, "the 'no raw footage' note lost its text");
  for (const { f, m } of unstated) {
    assert.ok(
      !f.hasSource && !m.liveMode,
      `${describe(f, m)}: the note names no file, and there is no missing-footage reason for it`
    );
  }
});

/* -------------------------------------------------------------------------
 * Staleness guards. Not the proof -- they only keep the proof pointed at the
 * page that ships.
 * ---------------------------------------------------------------------- */
test("C35: the page takes both the src and the note from this module", () => {
  const src = fs.readFileSync(PAGE, "utf8");
  for (const fn of ["liveSource(", "playerNote("]) {
    assert.ok(src.includes(fn), `review/page.tsx does not call ${fn} -- the sweep above is checking code the page no longer runs`);
  }
  assert.ok(
    !/sourceProxy \?\?/.test(src),
    "review/page.tsx resolves `sourceProxy ?? source` itself again -- that expression and the " +
    "caption drifting apart IS C35"
  );
  /* And the note holds no sentence of its own. Matching on the words would
     match the comment in page.tsx that quotes the old caption for the next
     reader, so this pins the shape: `.pm-note` renders playerNote's text and
     nothing else. Any literal back in there is outside the sweep above. */
  assert.ok(
    /<span className="pm-note">\{playerNote\(/.test(src),
    "the .pm-note span is composing its own sentence again instead of rendering playerNote's"
  );
});

test("C35: the toolbar still calls the proxy a copy, so the screen agrees with itself", () => {
  /* The contradiction was two rows apart: the note said original, the button
     that MAKES the proxy said "a small copy of the footage". That button's
     honesty is load-bearing now -- it is the sentence the note was corrected
     to agree with. */
  const src = fs.readFileSync(PAGE, "utf8");
  assert.ok(
    /copy of the footage/.test(src),
    "the 'Make playback smooth' button no longer describes the proxy as a copy"
  );
});

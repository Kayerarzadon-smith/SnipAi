/**
 * Which file the review player is handed, and what the sentence above it says
 * about that file. One module, because they were two independent expressions
 * over the same field and they drifted apart. (ledger C35)
 *
 * `review/page.tsx` read:
 *
 *     src={`/api/media/${project}/${data.sourceProxy ?? data.source}`}     // :1860
 *
 * and, thirty lines above it:
 *
 *     data.sourceProxy
 *       ? "Your edit, played straight off the original footage — every trim applies instantly."
 *       : "Your edit, played off the original footage. Cuts may hitch until you make playback smooth."
 *
 * Both branches claimed the original, and the FIRST one is the branch where a
 * 720p H.264 downscale is playing -- `tools/make_source_proxy.py --height`
 * defaults to 720, off 4K source. The same toolbar's own button, twenty rows
 * up, calls that file "a small copy of the footage", so the screen contradicted
 * itself inside one component.
 *
 * The proxy is not the defect and must not be removed: dense keyframes are
 * what make a beat-to-beat seek instant, and taking the original back onto
 * the live path trades a false sentence for an editor that hitches at every
 * cut. Only the claim was wrong.
 *
 * So the note carries `showing` -- which file its sentence is making a claim
 * about -- beside the text. `"unstated"` is for a note that talks about
 * something other than the picture (why Live edit is unavailable, say), and is
 * the only way a note may fail to name the file that is playing. Naming the
 * WRONG one is what C35 was, and a test over every combination of these
 * inputs now makes it unreachable rather than proof-read.
 */

/** What is actually on screen, as a kind of file rather than a path. */
export type ShowingFile = "original" | "proxy" | "rendered" | "graphics" | "nothing";

export type PlayerFiles = {
  /** the raw file is on this machine and has a nonzero size */
  hasSource: boolean;
  /** project-relative path to the raw file, e.g. "IMG_9817.MOV" */
  source: string;
  /** project-relative path to the 720p scrubbing copy, when it has been made */
  sourceProxy: string | null;
  /** filename inside cuts/, e.g. "img-9817-v6.mp4" */
  cutFile: string | null;
  graphicsFile: string | null;
  /** the rendered file predates the current beats */
  cutStale: boolean;
  beatCount: number;
};

export type PlayerMode = {
  liveMode: boolean;
  showGraphics: boolean;
};

export type PlayerSource = {
  /** path under `/api/media/<project>/`, or null when there is nothing to play */
  mediaPath: string | null;
  kind: ShowingFile;
};

/**
 * The file Live edit plays. The proxy when it exists -- identical timeline and
 * identical timestamps, so every in/out point still means what it meant.
 */
export function liveSource(f: PlayerFiles): PlayerSource {
  if (!f.hasSource) return { mediaPath: null, kind: "nothing" };
  if (f.sourceProxy) return { mediaPath: f.sourceProxy, kind: "proxy" };
  return { mediaPath: f.source, kind: "original" };
}

/**
 * The file the other modes play. With a graphics render present that IS the
 * finished video, so it wins when it is selected.
 */
export function renderedSource(f: PlayerFiles, m: PlayerMode): PlayerSource {
  const playFile = m.showGraphics && f.graphicsFile ? f.graphicsFile : f.cutFile;
  if (!playFile) return { mediaPath: null, kind: "nothing" };
  return {
    mediaPath: `cuts/${playFile}`,
    kind: playFile === f.graphicsFile ? "graphics" : "rendered",
  };
}

/** Whatever is on screen right now, in whichever mode. */
export function playingSource(f: PlayerFiles, m: PlayerMode): PlayerSource {
  return m.liveMode ? liveSource(f) : renderedSource(f, m);
}

export type PlayerNote = {
  text: string;
  /** the file this sentence makes a claim about, or "unstated" if it makes none */
  showing: ShowingFile | "unstated";
};

export function playerNote(f: PlayerFiles, m: PlayerMode): PlayerNote {
  if (m.liveMode) {
    /* Live edit can be entered from the keyboard (`playFrom` via the shortcut
       handlers), and those are not gated on `hasSource` the way the "Your cut"
       button is. So with the footage still in iCloud this branch ran with an
       empty `<video>` and announced the original footage over a blank player.
       Same defect as the proxy case, one row along. */
    if (!f.hasSource) {
      return {
        text: "The raw footage isn't on this machine, so there's nothing for Live edit to play.",
        showing: "nothing",
      };
    }
    /* The claim C35 was about. A 720p copy is on screen, so the sentence says
       720p -- and points at the rendered file WITHOUT promising a resolution,
       because `lib/pipeline.ts:462` builds the cut with `--proxy` on the auto
       path and full-res only on a standalone build. "The one that ships" is
       true of that file either way; "full resolution" would not be. */
    if (f.sourceProxy) {
      return {
        text: f.cutFile
          ? "Your edit, played off a 720p copy so every trim is instant — not the finished picture. The rendered file is the one that ships."
          : "Your edit, played off a 720p copy so every trim is instant — not the finished picture. Build the cut to see the file that ships.",
        showing: "proxy",
      };
    }
    return {
      text: "Your edit, played off the original footage. Cuts may hitch until you make playback smooth.",
      showing: "original",
    };
  }
  if (m.showGraphics && f.graphicsFile) {
    return {
      text: "Your motion graphics, burned in. “Clean cut” is the same edit without them.",
      showing: "graphics",
    };
  }
  if (!f.hasSource) {
    return {
      text: "The raw footage isn't on this machine — it's still in iCloud. Download it and Live edit will work.",
      showing: "unstated",
    };
  }
  if (renderedSource(f, m).mediaPath) {
    return f.cutStale
      ? { text: "This file was rendered before your latest trims — rebuild to bake them in.", showing: "rendered" }
      : { text: "The rendered file, matching your current edit.", showing: "rendered" };
  }
  if (f.beatCount === 0) {
    return { text: "No beats drafted yet, so there is no edit to play.", showing: "nothing" };
  }
  return {
    text: "Nothing rendered yet — Live edit plays the cut without waiting for a render.",
    showing: "nothing",
  };
}

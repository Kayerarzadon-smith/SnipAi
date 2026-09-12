import type { ClipProbe } from "@/lib/clipProbe";
import type { ClipForGrouping } from "@/lib/grouping";

/**
 * Building a clip the grouping rule can read: a probe plus a transcript.
 *
 * Shared because C37's and S38's files need the same three-clip shape off his
 * own run, and a third hand-rolled copy of `probe()` is exactly how the two
 * incomplete `ClipProbe` fixtures came to exist in the first place -- each
 * missing `videoDurationSec`/`videoRawDurationSec`, each feeding
 * `analyseBatch -> joinRefusal`, and neither typechecked until N18.
 * One builder means the next field added to `ClipProbe` is one edit.
 */

/** IMG_0060's real creation_time, so the gaps below are his. */
export const T0 = Date.UTC(2026, 8, 9, 11, 59, 35);
export const at = (minutes: number): number => T0 + minutes * 60_000;

export function probe(name: string, startMs: number, durationSec: number): ClipProbe {
  return {
    path: `/tmp/${name}`,
    name,
    durationSec,
    rawDurationSec: durationSec,
    /* Equal on purpose: measured on all eight of his real clips, the video
       track is identical with and without its edit list. Present at all
       because absent is not null -- see S34. */
    videoDurationSec: durationSec,
    videoRawDurationSec: durationSec,
    creationTimeMs: startMs,
    video: { codec: "hevc", width: 3840, height: 2160, fps: 30, rotation: -90 },
    audio: { codec: "aac", sampleRate: 48000, channels: "stereo" },
    dataStreams: 4,
  };
}

/** Lines of speech in the shape `transcribe.py` writes, laid end to end. */
export function transcript(lines: string[]): { segs: ClipForGrouping["transcript"]; endsAt: number } {
  let t = 1.2;
  const segs = lines.map((text) => {
    const words = text.trim().split(/\s+/);
    const start = t;
    const ws = words.map((w) => {
      const s = t;
      t += 0.28;
      return { w: ` ${w}`, s: Number(s.toFixed(2)), e: Number(t.toFixed(2)) };
    });
    const end = t;
    t += 0.6;
    return { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: ` ${text}`, words: ws };
  });
  return { segs, endsAt: t };
}

export function clip(name: string, startMs: number, lines: string[]): ClipForGrouping {
  const { segs, endsAt } = transcript(lines);
  return { probe: probe(name, startMs, Number((endsAt + 0.6).toFixed(2))), transcript: segs };
}

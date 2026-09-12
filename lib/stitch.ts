import fs from "node:fs";
import path from "node:path";
import { runCommand, resolvedFfmpeg } from "./pipeline";
import {
  probeClip, editListTrimSec, videoEditListTrimSec, reorderAllowanceSec,
  formatOverheadSec, type ClipProbe,
} from "./clipProbe";

/**
 * One interrupted TikTok, joined back into one recording. (DOCKET M0.8, R5a)
 *
 * Kayer never shoots a single file. He is interrupted -- kid, door, life --
 * stops recording, and restarts where he left off, so one video reaches the
 * app as three or four clips. The cheap route is to join them at import,
 * before any stage runs: everything downstream then sees one continuous
 * recording and needs no change at all, and the take picker spans every clip
 * for free, which is the behaviour he wants (a line said better in clip 3
 * beating the one in clip 1).
 *
 * Deliberately NOT done here: making `beats.json`'s `source` a list. That is
 * R5b, it touches 68 call sites, and it buys nothing for the way he shoots.
 *
 * This module is the foundation only -- ordering and joining. Deciding WHICH
 * clips belong to one video (the gap heuristic plus transcript continuity)
 * and proposing that grouping in the import tray are the next slice, and
 * they call in here once they have an answer.
 */

export type OrderBasis = "creation_time" | "filename";

/**
 * The trailing number in a filename, which is how a camera numbers a roll:
 * IMG_9817 < IMG_9818. Only ever a fallback -- see orderProbes.
 */
function filenameNumber(name: string): number | null {
  const stem = name.replace(/\.[^.]*$/, "");
  const m = /(\d+)\s*$/.exec(stem);
  return m ? Number(m[1]) : null;
}

/**
 * Put a batch into the order it was filmed in.
 *
 * By `creation_time`, stamped by the camera at capture. It is immutable, it
 * survives copying and renaming, and it puts seven files chosen in any order
 * into the exact sequence they were shot.
 *
 * **Drop order is never consulted, for anything.** Not as a primary key and
 * not as a tiebreaker: the comparison below is total and depends only on
 * facts read off the files, so the same set of clips sorts the same way no
 * matter which order they arrived in. That is the whole point -- a flipped
 * pair has to be impossible, not merely unlikely.
 *
 * When a clip carries no usable stamp the batch falls back to filename
 * numbering *as a whole*. Sorting some clips by time and the rest by number
 * would interleave two incomparable keys and produce an order nobody can
 * explain; one key every file has is deterministic and can be shown to him.
 */
export function orderProbes(probes: ClipProbe[]): { ordered: ClipProbe[]; basis: OrderBasis } {
  const basis: OrderBasis =
    probes.length > 0 && probes.every((p) => p.creationTimeMs !== null)
      ? "creation_time"
      : "filename";

  const ordered = [...probes].sort((a, b) => {
    if (basis === "creation_time") {
      const d = (a.creationTimeMs ?? 0) - (b.creationTimeMs ?? 0);
      if (d !== 0) return d;
    }
    // two clips stamped the same second still have to order stably, and a
    // camera roll numbers them for us
    const na = filenameNumber(a.name);
    const nb = filenameNumber(b.name);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    if (na !== null && nb === null) return -1;
    if (na === null && nb !== null) return 1;
    // last resort, still a fact about the files rather than about the drop
    return a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
  });

  return { ordered, basis };
}

export async function orderClipFiles(
  files: string[]
): Promise<{ ordered: ClipProbe[]; basis: OrderBasis }> {
  const probes = await Promise.all(files.map((f) => probeClip(f)));
  return orderProbes(probes);
}

/**
 * Why two clips cannot be stream-copied into one, in words, or null if they
 * can. `-c copy` needs the streams to be the same shape end to end; a
 * mismatch does not fail loudly, it produces a file that plays the first
 * clip and then garbage.
 */
export function joinBlocker(a: ClipProbe, b: ClipProbe): string | null {
  if (!a.video || !b.video) return `${(!a.video ? a : b).name} has no video track`;
  if (!a.audio || !b.audio) return `${(!a.audio ? a : b).name} has no audio track`;
  const v: [string, unknown, unknown][] = [
    ["video codec", a.video.codec, b.video.codec],
    ["frame size", `${a.video.width}x${a.video.height}`, `${b.video.width}x${b.video.height}`],
    ["frame rate", a.video.fps, b.video.fps],
    ["rotation", a.video.rotation, b.video.rotation],
    ["audio codec", a.audio.codec, b.audio.codec],
    ["sample rate", a.audio.sampleRate, b.audio.sampleRate],
    ["channels", a.audio.channels, b.audio.channels],
  ];
  for (const [what, x, y] of v) {
    if (x !== y) return `${a.name} and ${b.name} disagree on ${what} (${x} vs ${y})`;
  }
  return null;
}

/**
 * Why this group cannot be joined, in a sentence a person can act on, or null
 * if it can.
 *
 * One definition, used twice on purpose: the tray calls it while proposing a
 * group, so a blocker is on screen BEFORE he confirms, and `joinClips` calls
 * it again as the refusal it will not proceed past. Two copies of this
 * sentence would be two chances for the tray to promise an import that then
 * refuses itself.
 *
 * Every branch names the file, the cause, and something he can actually do.
 * The advice used to be "Re-encode it before joining", which names a thing he
 * has no button for and no reason to know the meaning of.
 */
export function joinRefusal(ordered: ClipProbe[]): string | null {
  for (let i = 1; i < ordered.length; i++) {
    const why = joinBlocker(ordered[0], ordered[i]);
    if (why) {
      return `${why}. Joining them would mean re-encoding, which on 4K takes hours and costs a generation of quality — so import them as separate projects instead.`;
    }
  }
  /* A clip trimmed without re-encoding hides its head behind an edit list,
     and the concat demuxer does not honour one -- so the hidden part comes
     back at the join and everything after it lands late. Measured: two 4s
     chunks whose edit lists hid 1.1s each joined to 9.34s instead of 8.34s,
     with 40 non-monotonic-DTS warnings and duplicated audio at the seam. */
  /* S34. This refused every clip Kayer owns.
     
     It was `editListTrimSec(p) > 1 / fps` -- 0.0333s at 30fps -- against a
     container delta that is 0.05-0.09s on all six of his 4K clips and 0.0600s
     on both files in his library. None of them was ever trimmed. It then told
     him Photos had done it and to "duplicate it in Photos and import the
     copy", which cannot work: the duplicate carries the same priming, so
     following the instruction spends the disk and returns him to this wall.
     
     The instrument was wrong, not the threshold. A container duration is the
     max across tracks, so it carries AAC priming and the audio/video length
     difference along with any real edit list -- widening it to clear 0.09s
     would pass his clips today and silently accept a 0.2s trim tomorrow,
     which is worse than the bug. The picture is where a trim shows and
     priming does not, and measured per track his footage hides 0.00s of
     picture while an `-ss -c copy` trim hides the whole 1.17s. That is a
     mechanism, not a magnitude. See clipProbe.ts for the six measurements.
     
     The one allowance is B-frame reorder delay, which is a real video edit
     list on re-encoded material (0.07s on x264 default) and is bounded by the
     reorder depth rather than chosen.
     
     The message no longer ASSERTS a cause, but it still offers the remedy.
     
     The old sentence said "was trimmed after it was filmed -- Photos does
     that" as fact, on clips nothing had touched, which is C36's defect: a
     guess presented as a diagnosis. What changed is that this branch now
     fires only when hidden PICTURE is measured, so "something took that out
     after it was filmed" is a measurement rather than a guess -- and the
     Photos duplicate is a real remedy when Photos is where the trim came
     from, because the duplicate is re-encoded and bakes the trim in. So it
     is offered conditionally instead of prescribed -- and the condition is put
     where he can answer it ("if you trimmed it there"), because he knows
     whether he did and the app never will.
     
     `tests/stitch.test.mts` already pinned the shape of this sentence -- name
     the clip, say how much, no jargon, two remedies, one of which the tray can
     carry out -- and it was right to. That test failed on the first draft of
     this fix and was NOT edited to agree with it; the sentence was rewritten
     to honour it. See the S34 row for the one judgement call inside that. */
  for (const p of ordered) {
    const hiddenPicture = videoEditListTrimSec(p);
    /* Fall back to the container floor only when the per-track measurement is
       missing. Absent is not zero: reading it as "nothing hidden" would let a
       genuinely trimmed clip through on a probe that simply failed. */
    const container = editListTrimSec(p);

    /* And when NEITHER can be measured, refuse rather than certify.
       
       Both functions used to answer 0 or NaN here instead of null, and
       `NaN > allowance` is false, so a clip nobody could measure came back as
       "no blocker" -- the guard failing OPEN on the one case it exists for. A
       guard that fails open is worse than no guard, because the row says the
       danger is handled. There is no evidence either way about this clip, and
       "I cannot tell" may not resolve to "fine". */
    if (hiddenPicture === null && container === null) {
      return `${p.name} could not be measured — SnipAi cannot tell whether any of it was cut out after filming, and a join would bring back anything that was. Import ${p.name} on its own.`;
    }

    const hidden = hiddenPicture ?? container!;
    const allowance = hiddenPicture === null ? formatOverheadSec(p) : reorderAllowanceSec(p);
    if (hidden > allowance) {
      return `${p.name} was shortened after filming: ${hidden.toFixed(2)}s of it is still in the file, just hidden. Joining brings that back and pushes everything after it late. Duplicate it in Photos and import the copy if you trimmed it there. Otherwise import ${p.name} on its own.`;
    }
  }
  return null;
}

/** A concat-demuxer list. Its `file` directive is single-quoted, so a quote
 *  in a path has to be escaped the way the shell escapes one. */
export function concatList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export type JoinOutcome =
  | {
      ok: true;
      dest: string;
      ordered: ClipProbe[];
      basis: OrderBasis;
      /** what the parts add up to, and what the joined file measures */
      expectedSec: number;
      actualSec: number;
      driftSec: number;
      dataStreamsDropped: number;
    }
  | { ok: false; error: string; ordered?: ClipProbe[] };

/**
 * Join a group of clips into one source file, losslessly.
 *
 * Stream copy, never a re-encode: his footage is 4K HEVC and re-encoding it
 * would cost an hour and a generation of quality for a file the pipeline is
 * only going to cut up anyway. The four `mebx` data tracks an iPhone writes
 * alongside the picture are mapped away -- the concat demuxer cannot carry
 * them across a join, and nothing downstream reads them.
 *
 * +faststart for the same reason the final concat in lib/pipeline.ts uses it
 * (ledger S19): the joined file is what every video surface in the app plays
 * and what the range handler serves, and a moov atom at the end of a 300MB
 * file cannot be range-requested.
 */
export async function joinClips(
  files: string[],
  dest: string,
  opts: { log?: (line: string) => void; overwrite?: boolean } = {}
): Promise<JoinOutcome> {
  const log = opts.log ?? (() => {});

  if (files.length === 0) return { ok: false, error: "nothing to join" };
  for (const f of files) {
    if (!fs.existsSync(f)) return { ok: false, error: `no such clip: ${f}` };
  }
  if (!opts.overwrite && fs.existsSync(dest)) {
    return { ok: false, error: `${dest} already exists` };
  }

  const { ordered, basis } = await orderClipFiles(files);
  log(`ordering ${ordered.length} clips by ${basis}: ${ordered.map((p) => p.name).join(" -> ")}`);

  if (ordered.length === 1) {
    return { ok: false, error: "a single clip does not need joining", ordered };
  }

  /* Caught here, by name and with a remedy, rather than after copying a
     gigabyte and discovering the total does not add up. The tray asks the
     same question while it proposes the group, so this is the second line of
     defence rather than the first place he hears about it. */
  const refusal = joinRefusal(ordered);
  if (refusal) return { ok: false, ordered, error: refusal };

  /* Refuse a join the disk cannot hold BEFORE starting it, the way the
     importer refuses an upload it cannot hold. A stream copy is the sum of
     its inputs to within a rounding error, and the machine this runs on sits
     at 96% full. */
  const inputBytes = ordered.reduce((n, p) => n + fs.statSync(p.path).size, 0);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const vfs = fs.statfsSync(path.dirname(dest));
    const free = Number(vfs.bavail) * Number(vfs.bsize);
    const headroom = 256 * 1024 * 1024;
    if (free < inputBytes + headroom) {
      const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
      return {
        ok: false,
        ordered,
        error: `not enough room to join these clips: they need ${gb(inputBytes)} and there is ${gb(free)} free`,
      };
    }
  } catch {
    /* statfs is not everywhere; the write below still fails, just later */
  }

  const listPath = `${dest}.concat.txt`;
  fs.writeFileSync(listPath, concatList(ordered.map((p) => p.path)));

  const expectedSec = ordered.reduce((n, p) => n + (p.durationSec ?? 0), 0);
  log(`joining (stream copy, no re-encode) -> ${path.basename(dest)}`);

  const run = await runCommand(
    resolvedFfmpeg(),
    [
      "-y", "-hide_banner", "-nostdin",
      "-f", "concat", "-safe", "0", "-i", listPath,
      // picture and sound only; the mebx tracks do not survive a concat
      "-map", "0:v:0", "-map", "0:a:0",
      "-c", "copy",
      "-movflags", "+faststart",
      dest,
    ],
    { onLine: log }
  );
  fs.rmSync(listPath, { force: true });

  if (!run.ok) {
    fs.rmSync(dest, { force: true });
    return { ok: false, ordered, error: `ffmpeg could not join the clips: ${run.stderr.trim().split("\n").slice(-3).join(" / ")}` };
  }

  const joined = await probeClip(dest);
  const actualSec = joined.durationSec ?? 0;
  const driftSec = actualSec - expectedSec;

  /* A stream copy that silently dropped a clip still exits 0. The parts have
     to add up, so check that they do rather than assuming it. One frame per
     part of tolerance: the audio and video tracks of each part end a few
     milliseconds apart, and those rounding errors accumulate.
     
     S35. `frame * ordered.length` alone is 0.0667s for two clips, and it does
     not account for the one source of drift this join can PREDICT. The concat
     demuxer ignores edit lists, so each part can contribute up to the media
     its own edit lists hide -- `editListTrimSec`, already measured on every
     part by the time we get here. That is a known quantity, so it is added
     rather than absorbed by a bigger round number.
     
     Measured, it is also mostly theoretical: IMG_0060 + IMG_0061 predict
     0.11s of return and actually drift 0.04s, and two synthetic clips predict
     0.14s and drift 0.02s. The hidden media largely does not come back. So
     this widens the window by what the parts could contribute at worst and by
     nothing else -- after S34, no part can carry more than the reorder
     allowance anyway, which keeps the window inside a tenth of a second for
     his footage while a dropped clip is seconds to minutes out. */
  const frame = 1 / (joined.video?.fps || 30);
  /* `?? 0` is the conservative direction, and it is chosen rather than
     convenient: an unmeasurable part contributes nothing to the window, so
     the drift check stays TIGHTER rather than being widened by a number
     nobody has. Before `editListTrimSec` could answer null this summed NaN,
     which made `tolerance` NaN and `Math.abs(drift) > NaN` false -- the same
     fail-open as the guard above, one check along. */
  const predictedReturn = ordered.reduce((n, p) => n + (editListTrimSec(p) ?? 0), 0);
  const tolerance = Math.max(frame, frame * ordered.length) + predictedReturn;
  if (Math.abs(driftSec) > tolerance) {
    /* Remove the file we just wrote. ffmpeg succeeded here -- this branch is
       reached with a COMPLETE join on disk, which for his footage is the sum
       of two 4K clips. One refused import left 546MB sitting in `raw/` with
       no beats.json to attach it to, on a machine at 98% full, and nothing
       ever collects it because no project owns it.
       
       The pre-flight check above refuses before writing and is the right
       shape; this is the post-hoc path, and a join that refuses itself must
       leave nothing behind either way. */
    fs.rmSync(dest, { force: true });
    return {
      ok: false,
      ordered,
      error: `joined file is ${actualSec.toFixed(3)}s but the parts add up to ${expectedSec.toFixed(3)}s — off by ${Math.abs(driftSec).toFixed(3)}s, past the ${tolerance.toFixed(3)}s this join can account for. Nothing was kept.`,
    };
  }

  const dataStreamsDropped = ordered.reduce((n, p) => n + p.dataStreams, 0);
  log(`joined ${ordered.length} clips into ${actualSec.toFixed(2)}s, drift ${(driftSec * 1000).toFixed(0)}ms`);

  return { ok: true, dest, ordered, basis, expectedSec, actualSec, driftSec, dataStreamsDropped };
}

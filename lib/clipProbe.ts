import path from "node:path";
import { runCommand, resolvedFfmpeg } from "./pipeline";

/**
 * What a clip is, as far as ordering and joining are concerned.
 *
 * Read off `ffmpeg -i`'s banner, because there is no ffprobe on this Mac --
 * the venv ships imageio-ffmpeg, which is the ffmpeg binary alone. The same
 * trick is already used by tools/make_source_proxy.py and tools/filmstrip.py
 * for duration; this reads a few more lines out of the same output.
 *
 * `ffmpeg -i` with no output file prints the banner and exits nonzero. That
 * is expected, so the exit code is ignored and only stderr is parsed.
 */
export type VideoFacts = {
  codec: string;
  width: number;
  height: number;
  fps: number | null;
  /** display-matrix rotation in degrees, as iPhone footage always carries */
  rotation: number;
};

export type AudioFacts = {
  codec: string;
  sampleRate: number | null;
  channels: string | null;
};

export type ClipProbe = {
  path: string;
  /** basename, which is what filename-order fallback compares */
  name: string;
  durationSec: number | null;
  /**
   * How long the file is with its edit list ignored -- i.e. how much media
   * it actually contains, as opposed to how much of it a player shows.
   *
   * These differ when something has trimmed the clip without re-encoding it:
   * the trimmed part is still in the file and an `elst` atom says to skip it.
   * That matters because the concat demuxer does NOT honour an edit list, so
   * a trimmed clip contributes its hidden head to a join and every clip after
   * it lands late. Straight-off-the-phone clips have no trimming edit list
   * (measured on IMG_9817: 0.044s, which is just AAC priming), but a clip
   * trimmed in Photos or cut with `ffmpeg -ss -c copy` does.
   *
   * null when it could not be measured, which is not the same as zero.
   */
  rawDurationSec: number | null;
  /**
   * The VIDEO track's own duration, as played and as stored.
   *
   * These are the two numbers that separate a trim from a recording, and
   * `rawDurationSec - durationSec` cannot: the container's duration is the
   * max across tracks, so it carries AAC priming and the audio/video length
   * difference along with any real edit list. Measured per track, a
   * straight-off-the-phone clip hides NOTHING from its picture (IMG_0062:
   * video 215.24 both ways, audio 215.31 -> 215.36) while a clip cut with
   * `ffmpeg -ss -c copy` hides the trim from the picture too (4.83 -> 6.00).
   *
   * null when it could not be measured, which is not the same as zero -- the
   * caller falls back to the container floor rather than assuming a trim.
   */
  videoDurationSec: number | null;
  videoRawDurationSec: number | null;
  /**
   * When the camera says it was shot, as epoch milliseconds.
   *
   * null when the file carries no usable stamp. "Usable" excludes the
   * placeholder dates muxers write when they have nothing: a 1904 QuickTime
   * epoch or a 1970 Unix one is not a capture time, it is the absence of
   * one, and sorting by it would put a stamped clip after an unstamped one
   * for no reason.
   */
  creationTimeMs: number | null;
  video: VideoFacts | null;
  audio: AudioFacts | null;
  /** the four mebx tracks an iPhone writes; counted so the join can say
   *  what it dropped rather than dropping them silently */
  dataStreams: number;
};

/** Anything stamped before this is a muxer placeholder, not a capture time. */
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);

export function parseFfmpegBanner(stderr: string, file: string): ClipProbe {
  const lines = stderr.split("\n");
  const firstStream = lines.findIndex((l) => /^\s*Stream #\d+:/.test(l));
  const containerEnd = firstStream === -1 ? lines.length : firstStream;

  /* creation_time appears once per stream as well as once for the container.
     Only the container block -- everything before the first Stream line --
     is the file's own stamp. */
  let creationTimeMs: number | null = null;
  for (let i = 0; i < containerEnd; i++) {
    const m = /^\s*creation_time\s*:\s*(\S+)/.exec(lines[i]);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (Number.isFinite(t) && t >= EARLIEST_PLAUSIBLE_MS) creationTimeMs = t;
    break;
  }

  let durationSec: number | null = null;
  const d = /Duration:\s*(\d+):(\d\d):(\d\d)\.(\d+)/.exec(stderr);
  if (d) {
    durationSec =
      Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) + Number(`0.${d[4]}`);
  }

  let video: VideoFacts | null = null;
  let audio: AudioFacts | null = null;
  let dataStreams = 0;

  for (let i = firstStream === -1 ? lines.length : firstStream; i < lines.length; i++) {
    const line = lines[i];
    const head = /^\s*Stream #\d+:\d+.*?:\s*(Video|Audio|Data|Subtitle):\s*(.*)$/.exec(line);
    if (!head) continue;
    const kind = head[1];
    const rest = head[2];

    if (kind === "Data") {
      dataStreams += 1;
      continue;
    }
    if (kind === "Video" && !video) {
      const dims = /\b(\d{2,5})x(\d{2,5})\b/.exec(rest);
      const fps = /([\d.]+)\s+fps\b/.exec(rest);
      // the side-data block belongs to this stream, so look forward only as
      // far as the next Stream line
      let rotation = 0;
      for (let j = i + 1; j < lines.length && !/^\s*Stream #\d+:/.test(lines[j]); j++) {
        const r = /rotation of\s*(-?[\d.]+)\s*degrees/.exec(lines[j]);
        if (r) { rotation = Number(r[1]); break; }
      }
      video = {
        codec: rest.split(/[\s(,]/)[0],
        width: dims ? Number(dims[1]) : 0,
        height: dims ? Number(dims[2]) : 0,
        fps: fps ? Number(fps[1]) : null,
        rotation,
      };
      continue;
    }
    if (kind === "Audio" && !audio) {
      const hz = /(\d+)\s*Hz/.exec(rest);
      const ch = /\b(mono|stereo|5\.1|7\.1|quad|\d+ channels)\b/.exec(rest);
      audio = {
        codec: rest.split(/[\s(,]/)[0],
        sampleRate: hz ? Number(hz[1]) : null,
        channels: ch ? ch[1] : null,
      };
    }
  }

  return {
    path: file,
    name: path.basename(file),
    durationSec,
    rawDurationSec: null,
    videoDurationSec: null,
    videoRawDurationSec: null,
    creationTimeMs,
    video,
    audio,
    dataStreams,
  };
}

/** Seconds of media an edit list hides from a player, or 0 if there is none. */
export function editListTrimSec(p: ClipProbe): number {
  if (p.durationSec === null || p.rawDurationSec === null) return 0;
  return Math.max(0, p.rawDurationSec - p.durationSec);
}

/* An untouched recording ALREADY has edit lists, and they already hide media.
   `editListTrimSec` sees all of it at once and therefore cannot tell a trim
   from a recording.

   MEASURED on this machine, because the numbers are the whole argument:

     Kayer's six 4K HEVC clips, straight off the phone (probes.json)
       container delta 0.05, 0.06, 0.05, 0.05, 0.09, 0.05
     IMG_0062.MOV, the same clip measured PER TRACK
       video  215.24 -> 215.24   nothing hidden from the picture
       audio  215.31 -> 215.36   0.05s of AAC priming
     a clip cut with `ffmpeg -ss 1.1 -c copy`, a real head trim
       video    4.83 ->   6.00   1.17s hidden from the picture
       audio    4.90 ->   6.02   1.12s
     x264 + AAC re-encode, no trim
       video    5.93 ->   6.00   0.07s, which is B-frame reorder

   So the picture is where a trim shows and priming does not, and that is a
   mechanism rather than a magnitude: his clips hide 0.00s of picture, not "a
   small amount". The only benign video edit list is the reorder delay a
   B-frame encoder needs, bounded by the reorder depth -- hence one derived
   allowance below rather than a threshold picked to fit his numbers.

   Why it matters that this is not just a bigger constant: a 0.2s Photos trim
   would pass any threshold set clear of his 0.09s, and is refused here. */

/** Video reorder depth to allow for. H.264/HEVC hold at most a few frames. */
const MAX_REORDER_FRAMES = 4;
/** AAC encoder priming, in samples. 1024 is standard; 2048 is the outlier. */
const MAX_AAC_PRIMING_SAMPLES = 2048;

/**
 * Seconds of PICTURE an edit list hides -- the thing a join brings back.
 *
 * null when the per-track measurement is unavailable, so a caller can fall
 * back rather than read a missing measurement as "nothing hidden".
 */
export function videoEditListTrimSec(p: ClipProbe): number | null {
  if (p.videoDurationSec === null || p.videoRawDurationSec === null) return null;
  return Math.max(0, p.videoRawDurationSec - p.videoDurationSec);
}

/** The most a B-frame encoder's reorder edit list can inherently hide. */
export function reorderAllowanceSec(p: ClipProbe): number {
  return MAX_REORDER_FRAMES * (1 / (p.video?.fps || 30));
}

/**
 * The most an untouched recording's edit lists can inherently hide from the
 * CONTAINER duration -- reorder delay plus AAC priming.
 *
 * Only used when the per-track measurement is unavailable. It is the weaker
 * instrument on purpose: it is a floor over a conflated number, where
 * `videoEditListTrimSec` measures the thing itself.
 */
export function formatOverheadSec(p: ClipProbe): number {
  const priming = p.audio?.sampleRate ? MAX_AAC_PRIMING_SAMPLES / p.audio.sampleRate : 0;
  return reorderAllowanceSec(p) + priming;
}

export async function probeClip(file: string): Promise<ClipProbe> {
  const ffmpeg = resolvedFfmpeg();
  const banner = (args: string[]) =>
    runCommand(ffmpeg, [...args, "-hide_banner", "-nostdin", "-i", file], { timeoutMs: 60_000 });

  // two reads of the same file: what a player sees, and what is really in it
  const [shown, whole] = await Promise.all([banner([]), banner(["-ignore_editlist", "1"])]);
  const probe = parseFfmpegBanner(`${shown.stderr}\n${shown.stdout}`, file);
  probe.rawDurationSec = parseFfmpegBanner(`${whole.stderr}\n${whole.stdout}`, file).durationSec;

  /* And the picture on its own, which is the measurement that can tell a trim
     from a recording (see videoEditListTrimSec). The banner cannot answer it
     -- it reports one duration for the whole file -- so the video stream is
     demuxed to nowhere and the muxer's clock is read.
     
     A stream copy to `-f null` decodes nothing; it is one pass over the
     file's video packets, seconds on a 612MB 4K clip. The import pays it once
     per clip, beside a Whisper transcription of the same clip that costs
     minutes, and it is what stands between him and a refusal on 100% of his
     footage. */
  if (probe.video) {
    const [vShown, vRaw] = await Promise.all([
      videoClock(file, []),
      videoClock(file, ["-ignore_editlist", "1"]),
    ]);
    probe.videoDurationSec = vShown;
    probe.videoRawDurationSec = vRaw;
  }
  return probe;
}

/**
 * How long the video track runs, by copying its packets to nowhere and
 * reading the muxer's final timestamp.
 *
 * Deliberately never compared against the CONTAINER duration: this clock is
 * the last packet's PTS and runs about a frame short of the duration a
 * written container reports (measured: 9.95 against 10.02 on the same join).
 * It is only ever differenced against ITSELF with and without the edit list,
 * where that offset cancels.
 */
async function videoClock(file: string, pre: string[]): Promise<number | null> {
  const r = await runCommand(
    resolvedFfmpeg(),
    [...pre, "-hide_banner", "-nostdin", "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
    { timeoutMs: 300_000 }
  );
  const all = `${r.stderr}\n${r.stdout}`.replace(/\r/g, "\n");
  let last: number | null = null;
  for (const m of all.matchAll(/time=(\d+):(\d\d):(\d\d)\.(\d+)/g)) {
    last = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
  }
  return last;
}

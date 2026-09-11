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

export async function probeClip(file: string): Promise<ClipProbe> {
  const ffmpeg = resolvedFfmpeg();
  const banner = (args: string[]) =>
    runCommand(ffmpeg, [...args, "-hide_banner", "-nostdin", "-i", file], { timeoutMs: 60_000 });

  // two reads of the same file: what a player sees, and what is really in it
  const [shown, whole] = await Promise.all([banner([]), banner(["-ignore_editlist", "1"])]);
  const probe = parseFfmpegBanner(`${shown.stderr}\n${shown.stdout}`, file);
  probe.rawDurationSec = parseFfmpegBanner(`${whole.stderr}\n${whole.stdout}`, file).durationSec;
  return probe;
}

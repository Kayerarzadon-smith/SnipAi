import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scratchDir } from "../scratch.mts";

/**
 * Ground-truth clips for S34/S35/S36, built with ffmpeg rather than copied
 * from his library.
 *
 * The whole question these rows turn on is whether a duration delta came from
 * a trim or from the format, and the only way to test that honestly is to
 * make one of each and know which is which. His footage cannot do that job:
 * it is all one case (untrimmed), it is 4K, and the disk has 4.6GB on it.
 *
 * Every clip here is a few hundred KB of `testsrc2` and a sine tone.
 */

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));

export function ffmpegBin(): string {
  const env = (process.env.SNIPAI_FFMPEG ?? "").trim();
  if (env && fs.existsSync(env)) return env;
  const venv = path.join(ROOT, "ugc-edit-system", ".venv", "bin", "ffmpeg");
  return fs.existsSync(venv) ? venv : "ffmpeg";
}

export function haveFfmpeg(): boolean {
  const bin = ffmpegBin();
  return bin !== "ffmpeg" || spawnSync("ffmpeg", ["-version"]).status === 0;
}

function run(args: string[]): void {
  const r = spawnSync(ffmpegBin(), args, { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}\n${r.stderr}`);
}

export type Kit = {
  dir: string;
  /** two clips with B-frames: a real video edit list, from reorder alone */
  reorderA: string;
  reorderB: string;
  /** no B-frames, so no video edit list at all -- shaped like his phone clips */
  phoneA: string;
  phoneB: string;
  /** phoneA cut with `-ss 1.1 -c copy`: a real trim, hidden behind an elst */
  trimmed: string;
};

/**
 * `-bf 0` is what makes `phone*` the right shape. His 4K HEVC clips hide
 * 0.00s of picture (measured per track on all six) because the camera writes
 * no reorder edit list; a default x264 encode hides 0.07s because it does.
 * Both are untrimmed, and a guard that cannot pass BOTH is calibrated to an
 * encoder rather than to the question.
 */
export function buildKit(tag = "elst"): Kit {
  const dir = scratchDir(tag);
  const make = (name: string, seconds: number, hz: number, bframes: boolean) => {
    const out = path.join(dir, name);
    run([
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", `testsrc2=size=320x240:rate=30:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=48000:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(bframes ? [] : ["-bf", "0"]),
      "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out,
    ]);
    return out;
  };
  const reorderA = make("reorder-a.mov", 6, 440, true);
  const reorderB = make("reorder-b.mov", 4, 660, true);
  const phoneA = make("phone-a.mov", 6, 440, false);
  const phoneB = make("phone-b.mov", 4, 660, false);

  /* A lossless head trim, which is what Photos does and what the guard is
     for. Same bytes, an edit list saying to skip the first 1.1s. */
  const trimmed = path.join(dir, "trimmed.mov");
  run(["-y", "-hide_banner", "-loglevel", "error", "-ss", "1.1", "-i", phoneA, "-c", "copy", trimmed]);

  return { dir, reorderA, reorderB, phoneA, phoneB, trimmed };
}

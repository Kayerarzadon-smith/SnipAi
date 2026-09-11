import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolvedFfmpeg } from "../../lib/pipeline.ts";
import { scratchDir } from "../scratch.mts";

/**
 * LEDGER S19 — lib/pipeline.ts, the ffmpeg concat step that writes cuts/*.mp4
 *
 * Every individual clip build_cut.py extracts is written with
 * -movflags +faststart. The concat step that stitches them into the file
 * that actually ships in cuts/ never was, so the real file disagreed with
 * its own pieces: a real cut (img-9817-v6.mp4) had moov at byte 513655552
 * of a 513MB file, and nothing -- not the app's own player, not a browser,
 * not a phone -- can start playing an mp4 without fetching the whole thing
 * first when the index sits at the end like that.
 *
 * Two checks: the concat step's own source still asks for faststart (so a
 * later edit can't silently drop it), and -c copy -movflags +faststart
 * against a real concatenated file actually puts moov at the front and not
 * the back. resolvedFfmpeg() is used rather than a bare "ffmpeg" for the
 * same reason lib/pipeline.ts uses it: a GUI-launched app has no PATH, and
 * this test should exercise the same resolution the app actually runs.
 *
 * This test is expected to FAIL until S19 is fixed.
 */
test("S19: the concat step asks ffmpeg for faststart", () => {
  const src = fs.readFileSync(new URL("../../lib/pipeline.ts", import.meta.url), "utf8");
  const concatCall = src.slice(src.indexOf('"-f", "concat"') - 20, src.indexOf('"-f", "concat"') + 300);
  assert.match(
    concatCall,
    /"-movflags",\s*"\+faststart"/,
    "the concat ffmpeg invocation must include -movflags +faststart"
  );
});

test("S19: -c copy -movflags +faststart actually puts moov before mdat", () => {
  const ffmpeg = resolvedFfmpeg();
  const dir = scratchDir("s19");
  const clip1 = path.join(dir, "clip1.mp4");
  const clip2 = path.join(dir, "clip2.mp4");
  const concatTxt = path.join(dir, "concat.txt");
  const out = path.join(dir, "out.mp4");

  for (const [file, freq] of [[clip1, 440], [clip2, 880]] as const) {
    execFileSync(ffmpeg, [
      "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=1",
      "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=1`,
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
      "-movflags", "+faststart", file, "-loglevel", "error",
    ]);
  }
  fs.writeFileSync(concatTxt, `file '${clip1}'\nfile '${clip2}'\n`);

  execFileSync(ffmpeg, [
    "-y", "-f", "concat", "-safe", "0", "-i", concatTxt,
    "-c", "copy", "-movflags", "+faststart", out, "-loglevel", "error",
  ]);

  const bytes = fs.readFileSync(out);
  const moovAt = bytes.indexOf(Buffer.from("moov")) - 4;
  assert.ok(
    moovAt >= 0 && moovAt < 1000,
    `moov should sit near the front of the file with +faststart, found at byte ${moovAt} of ${bytes.length}`
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

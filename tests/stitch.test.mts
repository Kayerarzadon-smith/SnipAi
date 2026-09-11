import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scratchDir } from "./scratch.mts";

/**
 * Joining one interrupted TikTok back into one recording. (DOCKET M0.8, R5a)
 *
 * Two halves:
 *   - the pure half, over a banner captured from Kayer's own IMG_9817, so the
 *     parsing keeps working without needing a 1.4GB file present;
 *   - the ffmpeg half, over clips this file generates itself. They are 320x240
 *     and a second long, so the suite stays fast and portable, but they go
 *     through exactly the same probe/order/join path his 4K HEVC does.
 *
 * SNIPAI_DATA first, dynamic import second: lib/paths.ts reads it once, at
 * import, and the fallback is his real library.
 */
const sandbox = scratchDir("stitch");
fs.mkdirSync(path.join(sandbox, "projects"), { recursive: true });
process.env.SNIPAI_DATA = sandbox;

const { parseFfmpegBanner, probeClip } = await import("@/lib/clipProbe");
const { orderProbes, joinClips, joinBlocker, concatList } = await import("@/lib/stitch");
const { checkAvailability, resolvedFfmpeg, runCommand } = await import("@/lib/pipeline");

/* The real thing: `ffmpeg -i ~/Movies/SnipAi/projects/img-9817/raw/IMG_9817.MOV`,
   verbatim, minus the version banner. */
const IMG_9817_BANNER = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_9817.MOV':
  Metadata:
    major_brand     : qt
    minor_version   : 0
    compatible_brands: qt
    creation_time   : 2026-08-19T17:18:04.000000Z
    com.apple.quicktime.make: Apple
    com.apple.quicktime.model: iPhone 16 Pro
    com.apple.quicktime.creationdate: 2026-08-19T10:18:04-0700
  Duration: 00:08:46.66, start: 0.000000, bitrate: 22725 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 3840x2160, 22544 kb/s, 30 fps, 30 tbr, 600 tbn (default)
      Metadata:
        creation_time   : 2026-08-19T17:18:04.000000Z
        handler_name    : Core Media Video
        encoder         : HEVC
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 98 kb/s (default)
      Metadata:
        creation_time   : 2026-08-19T17:18:04.000000Z
        handler_name    : Core Media Audio
  Stream #0:2[0x3](und): Data: none (mebx / 0x7862656D) (default)
      Metadata:
        creation_time   : 2026-08-19T17:18:04.000000Z
  Stream #0:3[0x4](und): Data: none (mebx / 0x7862656D), 20 kb/s (default)
  Stream #0:4[0x5](und): Data: none (mebx / 0x7862656D), 47 kb/s (default)
  Stream #0:5[0x6](und): Data: none (mebx / 0x7862656D) (default)
`;

test("a clip's facts are read off ffmpeg's banner, there being no ffprobe", () => {
  const p = parseFfmpegBanner(IMG_9817_BANNER, "/somewhere/IMG_9817.MOV");
  assert.equal(p.name, "IMG_9817.MOV");
  assert.equal(p.creationTimeMs, Date.parse("2026-08-19T17:18:04.000Z"));
  assert.ok(Math.abs((p.durationSec ?? 0) - 526.66) < 0.01, `duration ${p.durationSec}`);
  assert.deepEqual(p.video, {
    codec: "hevc", width: 3840, height: 2160, fps: 30, rotation: -90,
  });
  assert.deepEqual(p.audio, { codec: "aac", sampleRate: 48000, channels: "stereo" });
  // the four mebx tracks an iPhone writes, which the join has to map away
  assert.equal(p.dataStreams, 4);
});

test("the container's stamp is read, not the first stream's", () => {
  // same file, but the streams claim a different time. Only the container
  // block -- everything above the first Stream line -- is the capture time.
  const banner = IMG_9817_BANNER.replace(
    /creation_time   : 2026-08-19T17:18:04.000000Z\n        handler_name    : Core Media Video/,
    "creation_time   : 2011-01-01T00:00:00.000000Z\n        handler_name    : Core Media Video"
  );
  const p = parseFfmpegBanner(banner, "IMG_9817.MOV");
  assert.equal(p.creationTimeMs, Date.parse("2026-08-19T17:18:04.000Z"));
});

test("a muxer's placeholder date is not a capture time", () => {
  for (const stamp of ["1904-01-01T00:00:00.000000Z", "1970-01-01T00:00:00.000000Z"]) {
    const banner = IMG_9817_BANNER.replace("2026-08-19T17:18:04.000000Z", stamp);
    assert.equal(parseFfmpegBanner(banner, "x.MOV").creationTimeMs, null,
      `${stamp} should read as "no stamp", not as 1904`);
  }
});

/* ---- ordering: by when it was filmed, never by how it was dropped ---- */

function fakeProbe(name: string, iso: string | null): any {
  return {
    path: `/clips/${name}`, name,
    durationSec: 10,
    creationTimeMs: iso === null ? null : Date.parse(iso),
    video: { codec: "hevc", width: 3840, height: 2160, fps: 30, rotation: -90 },
    audio: { codec: "aac", sampleRate: 48000, channels: "stereo" },
    dataStreams: 4,
  };
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])
  );
}

test("a batch orders by creation_time, whatever order it arrives in", () => {
  // filenames deliberately DISAGREE with capture order, so a pass here can
  // only come from the timestamps
  const clips = [
    fakeProbe("IMG_0003.MOV", "2026-08-19T17:22:26Z"),
    fakeProbe("IMG_0001.MOV", "2026-08-19T17:22:46Z"),
    fakeProbe("IMG_0002.MOV", "2026-08-19T17:23:03Z"),
  ];
  for (const shuffled of permutations(clips)) {
    const { ordered, basis } = orderProbes(shuffled);
    assert.equal(basis, "creation_time");
    assert.deepEqual(ordered.map((c) => c.name),
      ["IMG_0003.MOV", "IMG_0001.MOV", "IMG_0002.MOV"],
      `arrival order ${shuffled.map((c) => c.name).join(",")} changed the result`);
  }
});

test("one clip with no stamp drops the whole batch to filename numbering", () => {
  const clips = [
    fakeProbe("IMG_0003.MOV", "2026-08-19T17:22:26Z"),
    fakeProbe("IMG_0001.MOV", null),
    fakeProbe("IMG_0002.MOV", "2026-08-19T17:23:03Z"),
  ];
  for (const shuffled of permutations(clips)) {
    const { ordered, basis } = orderProbes(shuffled);
    assert.equal(basis, "filename");
    assert.deepEqual(ordered.map((c) => c.name),
      ["IMG_0001.MOV", "IMG_0002.MOV", "IMG_0003.MOV"]);
  }
});

test("filename numbering compares numbers, not text", () => {
  const clips = [fakeProbe("IMG_9.MOV", null), fakeProbe("IMG_10.MOV", null)];
  // "IMG_10" sorts before "IMG_9" as text, and after it as a camera roll
  assert.deepEqual(orderProbes(clips).ordered.map((c) => c.name),
    ["IMG_9.MOV", "IMG_10.MOV"]);
  assert.deepEqual(orderProbes([...clips].reverse()).ordered.map((c) => c.name),
    ["IMG_9.MOV", "IMG_10.MOV"]);
});

test("clips stamped the same second still order the same way every time", () => {
  const clips = [
    fakeProbe("IMG_0002.MOV", "2026-08-19T17:22:26Z"),
    fakeProbe("IMG_0001.MOV", "2026-08-19T17:22:26Z"),
  ];
  assert.deepEqual(orderProbes(clips).ordered.map((c) => c.name),
    ["IMG_0001.MOV", "IMG_0002.MOV"]);
  assert.deepEqual(orderProbes([...clips].reverse()).ordered.map((c) => c.name),
    ["IMG_0001.MOV", "IMG_0002.MOV"]);
});

/* ---- refusing a join that cannot be a stream copy ---- */

test("clips that cannot be stream-copied together are refused, not re-encoded", () => {
  const a = fakeProbe("a.MOV", "2026-08-19T17:22:26Z");
  const portrait = fakeProbe("b.MOV", "2026-08-19T17:22:46Z");
  portrait.video.width = 1080; portrait.video.height = 1920;
  assert.match(joinBlocker(a, portrait) ?? "", /frame size/);

  const upright = fakeProbe("c.MOV", "2026-08-19T17:22:46Z");
  upright.video.rotation = 0;
  assert.match(joinBlocker(a, upright) ?? "", /rotation/);

  const mono = fakeProbe("d.MOV", "2026-08-19T17:22:46Z");
  mono.audio.channels = "mono";
  assert.match(joinBlocker(a, mono) ?? "", /channels/);

  assert.equal(joinBlocker(a, fakeProbe("e.MOV", "2026-08-19T17:22:46Z")), null);
});

test("a quote in a path does not break the concat list", () => {
  // build_cut.py learned this the hard way: the demuxer single-quotes each
  // path, so "kayer's clips" ends the quote and the render dies partway
  assert.equal(concatList(["/a/kayer's clips/x.MOV"]),
    "file '/a/kayer'\\''s clips/x.MOV'\n");
});

/* ---- the real thing, on clips this test makes ---- */

const have = checkAvailability();

test("three clips join into one file, in filmed order, without re-encoding",
  { skip: have.ffmpeg ? false : "no ffmpeg" }, async () => {
    const dir = scratchDir("join");
    const ff = resolvedFfmpeg();

    /* Names and stamps deliberately disagree: capture order is 03, 01, 02.
       Each clip's picture carries its own number, so "which came first" is
       a fact about the file rather than about this test's bookkeeping. */
    const plan = [
      { name: "IMG_0003.MOV", stamp: "2026-08-19T17:22:26Z", secs: 1 },
      { name: "IMG_0001.MOV", stamp: "2026-08-19T17:22:46Z", secs: 2 },
      { name: "IMG_0002.MOV", stamp: "2026-08-19T17:23:03Z", secs: 3 },
    ];
    for (const c of plan) {
      const r = await runCommand(ff, [
        "-y", "-hide_banner", "-nostdin",
        "-f", "lavfi", "-i", `testsrc=size=320x240:rate=30:duration=${c.secs}`,
        "-f", "lavfi", "-i", `sine=frequency=440:duration=${c.secs}:sample_rate=48000`,
        "-ac", "2",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-metadata", `creation_time=${c.stamp}`,
        path.join(dir, c.name),
      ], { timeoutMs: 120_000 });
      assert.ok(r.ok, `could not build ${c.name}: ${r.stderr.slice(-400)}`);
    }

    const dest = path.join(dir, "joined.mov");
    // handed over in an order that is neither capture order nor filename order
    const out = await joinClips(
      [path.join(dir, "IMG_0002.MOV"), path.join(dir, "IMG_0003.MOV"), path.join(dir, "IMG_0001.MOV")],
      dest
    );
    assert.ok(out.ok, `join failed: ${out.ok ? "" : out.error}`);
    if (!out.ok) return;

    assert.equal(out.basis, "creation_time");
    assert.deepEqual(out.ordered.map((c) => c.name),
      ["IMG_0003.MOV", "IMG_0001.MOV", "IMG_0002.MOV"]);

    // lossless: the parts add up, to within a frame
    assert.ok(Math.abs(out.driftSec) <= 3 / 30,
      `joined ${out.actualSec}s vs parts ${out.expectedSec}s`);
    assert.ok(out.actualSec > 5.5, `joined file is only ${out.actualSec}s`);

    // ... and it really was a copy: same codec, same size, no second generation
    const joined = await probeClip(dest);
    assert.equal(joined.video?.codec, "h264");
    assert.equal(joined.video?.width, 320);
    assert.equal(joined.audio?.sampleRate, 48000);

    fs.rmSync(dir, { recursive: true, force: true });
  });

test("a clip trimmed without re-encoding is refused by name, before the copy",
  { skip: have.ffmpeg ? false : "no ffmpeg" }, async () => {
    /* Measured on his own footage: two 4-second chunks whose edit lists each
       hid 1.1s joined to 9.34s instead of 8.34s, with duplicated audio at the
       seam, because the concat demuxer does not honour an edit list. A clip
       off the phone never looks like this; one trimmed in Photos does. */
    const dir = scratchDir("elst");
    const ff = resolvedFfmpeg();
    const make = (name: string, extra: string[], stamp: string) =>
      runCommand(ff, [
        "-y", "-hide_banner", "-nostdin",
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=6",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=6:sample_rate=48000",
        "-ac", "2", "-c:v", "libx264", "-preset", "ultrafast", "-g", "60",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", `creation_time=${stamp}`,
        ...extra, path.join(dir, name),
      ], { timeoutMs: 120_000 });

    assert.ok((await make("whole.mov", [], "2026-08-19T17:22:26Z")).ok);
    // a stream-copy trim: the first seconds stay in the file, hidden by an elst
    const trim = await runCommand(ff, [
      "-y", "-hide_banner", "-nostdin", "-ss", "3.5", "-i", path.join(dir, "whole.mov"),
      "-c", "copy", "-metadata", "creation_time=2026-08-19T17:22:46Z",
      path.join(dir, "trimmed.mov"),
    ], { timeoutMs: 120_000 });
    assert.ok(trim.ok, trim.stderr.slice(-400));

    const p = await probeClip(path.join(dir, "trimmed.mov"));
    assert.ok((p.rawDurationSec ?? 0) - (p.durationSec ?? 0) > 0.5,
      `expected a hidden head, got shown=${p.durationSec} raw=${p.rawDurationSec}`);

    const dest = path.join(dir, "joined.mov");
    const out = await joinClips(
      [path.join(dir, "whole.mov"), path.join(dir, "trimmed.mov")], dest);
    assert.equal(out.ok, false);
    const refusal = out.ok ? "" : out.error;
    assert.match(refusal, /trimmed\.mov/, "it has to name the clip");
    /* It used to have to say "edit list", which is the thing the person
       reading it cannot act on. What it owes him is the cause, the size of
       the problem, and two things he could do about it -- one of which the
       tray itself can do. */
    assert.match(refusal, /1\.\d\ds of it is still in the file/, "how much is hidden");
    assert.match(refusal, /Duplicate it in Photos/, "a remedy outside the app");
    assert.match(refusal, /import trimmed\.mov on its own/, "a remedy the tray can carry out");
    assert.doesNotMatch(refusal, /edit list|elst|re-encode it before/i,
      "no jargon: he has no button marked 'edit list'");
    // refused before doing the work, not after
    assert.equal(fs.existsSync(dest), false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

test("a join that would overwrite an existing file is refused", async () => {
  const dir = scratchDir("join");
  const dest = path.join(dir, "joined.mov");
  fs.writeFileSync(dest, "not yours to clobber");
  const out = await joinClips([dest, dest], dest);
  assert.equal(out.ok, false);
  assert.match(out.ok ? "" : out.error, /already exists/);
  assert.equal(fs.readFileSync(dest, "utf8"), "not yours to clobber");
  fs.rmSync(dir, { recursive: true, force: true });
});

process.on("exit", () => fs.rmSync(sandbox, { recursive: true, force: true }));

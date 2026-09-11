import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempLibrary } from "./_fixture.mts";

/**
 * LEDGER S18 — app/api/media/[...path]/route.ts:73
 *
 * A browser media stack opens a video with a range that ends past EOF -- an
 * open-ended "bytes=N-", or a plain over-long guess like "bytes=0-99999999"
 * -- and expects the server to clamp it to the file's last byte, per
 * RFC 7233. This route instead compared the raw, unclamped end against the
 * file size and refused the whole request with 416. That is the one thing
 * every video surface in the app has in common: the player, both modes, and
 * the snippet-editor monitor all open with a range shaped like this, and all
 * sat at readyState=0 forever with no error raised.
 *
 * This test is expected to FAIL until S18 is fixed.
 */
test("S18: an over-long or open-ended range is clamped to the file, not refused", async () => {
  const root = tempLibrary();
  const filePath = path.join(root, "projects", "fixture", "tiny.mp4");
  const body = Buffer.from("x".repeat(1000));
  fs.writeFileSync(filePath, body);

  const { GET } = await import("../../app/api/media/[...path]/route.ts");

  // An over-long range, well past EOF, with an in-bounds start.
  const overLong = await GET(
    new Request("http://127.0.0.1:4737/api/media/fixture/tiny.mp4", {
      headers: { range: "bytes=100-99999999" },
    }) as any,
    { params: { path: ["fixture", "tiny.mp4"] } }
  );
  assert.equal(overLong.status, 206, "an in-bounds start should still be served, not refused");
  assert.equal(
    overLong.headers.get("content-range"),
    `bytes 100-999/${body.length}`,
    "the end should clamp to the file's last byte"
  );

  // The open-ended form players use to locate a trailing moov atom.
  const openEnded = await GET(
    new Request("http://127.0.0.1:4737/api/media/fixture/tiny.mp4", {
      headers: { range: `bytes=-500` },
    }) as any,
    { params: { path: ["fixture", "tiny.mp4"] } }
  );
  assert.equal(openEnded.status, 206);
  assert.equal(openEnded.headers.get("content-range"), `bytes 500-999/${body.length}`);

  // A start genuinely past EOF is still a real error.
  const trulyOOB = await GET(
    new Request("http://127.0.0.1:4737/api/media/fixture/tiny.mp4", {
      headers: { range: "bytes=5000-6000" },
    }) as any,
    { params: { path: ["fixture", "tiny.mp4"] } }
  );
  assert.equal(trulyOOB.status, 416, "a start past EOF is not a browser-clamp case");
});

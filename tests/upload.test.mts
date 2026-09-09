import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../lib/paths.ts";
import { POST } from "../app/api/projects/route.ts";

/* Importing a phone clip.

   This used to be `await req.formData()` followed by
   `Buffer.from(await file.arrayBuffer())`: the multipart parser held the whole
   file, then a second buffer held a copy of it, then it was written. On the
   1.8GB clip Kayer dropped in, that is 3.7GB resident for one import -- the
   Mac swapped for minutes, the row said "importing..." forever, and the
   machine went down. The body is streamed to disk now, so what these tests
   pin is that the streaming path exists and behaves, not the old shape. */

// kebab-case: the route refuses anything else, so the usual "_test_" prefix
// other suites use is not available here. Cleaned up either way.
const NAME = "zz-test-upload";
const OTHERS = ["zz-test-upload-2", "zz-test-upload-3"];
const dir = path.join(PROJECTS_ROOT, NAME);
const clean = () => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const o of OTHERS) fs.rmSync(path.join(PROJECTS_ROOT, o), { recursive: true, force: true });
};

/** A raw-body upload, the way the browser sends one. */
function rawReq(project: string, filename: string, bytes: Uint8Array) {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: {
      "x-snipai-project": project,
      "x-snipai-filename": encodeURIComponent(filename),
      "content-type": "application/octet-stream",
      "content-length": String(bytes.length),
    },
    body: bytes,
    // @ts-expect-error node needs this for a stream body, browsers infer it
    duplex: "half",
  });
}

describe("importing footage", () => {
  before(clean);
  after(clean);

  test("a raw body lands on disk byte for byte", async () => {
    const bytes = new Uint8Array(256 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const res = await POST(rawReq(NAME, "IMG_1234.MOV", bytes) as never, undefined as never);
    assert.equal(res.status, 201, await res.clone().text());
    const written = fs.readFileSync(path.join(dir, "raw", "IMG_1234.MOV"));
    assert.equal(written.length, bytes.length);
    assert.ok(Buffer.from(bytes).equals(written), "the bytes must survive the trip");
  });

  test("the skeleton and beats.json come with it", () => {
    for (const sub of ["raw", "cuts", "work"]) {
      assert.ok(fs.existsSync(path.join(dir, sub)), `${sub}/ must exist`);
    }
    const b = JSON.parse(fs.readFileSync(path.join(dir, "beats.json"), "utf8"));
    assert.equal(b.source, "raw/IMG_1234.MOV");
  });

  test("a second import of the same name is refused, not merged", async () => {
    const res = await POST(rawReq(NAME, "IMG_1234.MOV", new Uint8Array(8)) as never, undefined as never);
    assert.equal(res.status, 409);
  });

  test("something that is not footage never creates a project", async () => {
    const res = await POST(rawReq("zz-test-upload-2", "notes.txt", new Uint8Array(8)) as never, undefined as never);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /isn't a video/);
    assert.equal(fs.existsSync(path.join(PROJECTS_ROOT, "zz-test-upload-2")), false,
                 "a rejected file must not leave a shell project behind");
  });

  test("a filename cannot escape the project's raw folder", async () => {
    const res = await POST(
      rawReq("zz-test-upload-3", "../../../../etc/evil.mov", new Uint8Array(8)) as never,
      undefined as never);
    assert.equal(res.status, 201);
    // basename first, then the character filter -- the traversal is gone,
    // not merely rewritten into something that still climbs
    assert.ok(fs.existsSync(path.join(PROJECTS_ROOT, "zz-test-upload-3", "raw", "evil.mov")));
    fs.rmSync(path.join(PROJECTS_ROOT, "zz-test-upload-3"), { recursive: true, force: true });
  });
});

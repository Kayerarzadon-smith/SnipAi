import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * N1 -- port 4737 does not identify our server, so the server has to say who
 * it is.
 *
 * `native/main.swift:361-364` adopts whatever is already listening on 4737 as
 * long as `serverMatchesDiskBuild()` agrees. That checks the BUILD, and the
 * build is not the thing that can hurt anyone: the DATA ROOT is. A launch
 * with `SNIPAI_DATA=<sandbox>` that adopts a server pointed at
 * ~/Movies/SnipAi silently ignores the sandbox and serves -- and edits -- the
 * real library. That happened on 2026-09-10.
 *
 * The app cannot check what the server will not tell it. No endpoint reports
 * the running server's data root: `/api/projects` returns the projects it
 * found, and a list of names says nothing about which library they came from
 * -- two libraries can hold a project of the same name, which is exactly what
 * a sandbox copy is.
 *
 * This asserts the missing half of the contract on the side where it is
 * testable: an endpoint that states, truthfully and per-request, the absolute
 * data root this process is serving. The Swift side consumes it and refuses
 * to adopt a server whose answer is not the library it was asked for.
 *
 * SNIPAI_DATA is set once, here, before the first import: lib/paths.ts reads
 * the environment at import time, so a per-test change would be read by
 * nothing. The value is deliberately un-normalised -- see the second test.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-n1-"));
fs.mkdirSync(path.join(ROOT, "projects"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "state"), { recursive: true });
process.env.SNIPAI_DATA = path.join(ROOT, "projects", "..");

test("the server reports the data root it is actually serving", async () => {
  const { GET } = await import("@/app/api/health/route");
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(
    body.dataRoot,
    path.resolve(ROOT),
    "the health endpoint must report the data root this process resolved, so " +
      "a launcher can tell our server from a stranger's on the same port"
  );
});

test("it reports the resolved root, not the raw SNIPAI_DATA string", async () => {
  // The launcher compares this against a path it resolved itself. If one side
  // compares "<root>/projects/.." and the other "<root>" they disagree while
  // naming the same directory, and the app refuses to start against its own
  // library -- a false alarm is how a safety check gets switched off.
  const { GET } = await import("@/app/api/health/route");
  const body = await (await GET()).json();

  assert.ok(path.isAbsolute(body.dataRoot), `dataRoot must be absolute: ${body.dataRoot}`);
  assert.ok(
    !body.dataRoot.includes(`..${path.sep}`) && !body.dataRoot.endsWith(".."),
    `dataRoot must be normalised, got: ${body.dataRoot}`
  );
  assert.equal(body.dataRoot, path.resolve(process.env.SNIPAI_DATA!));
});

test("the route is never prerendered, and names the process answering", async () => {
  const mod = await import("@/app/api/health/route");

  // A frozen answer would report the BUILD machine's library forever.
  // /api/jobs/running shipped exactly that way once -- see its comment -- so
  // this is written down rather than assumed.
  assert.equal(
    (mod as { dynamic?: string }).dynamic,
    "force-dynamic",
    "a prerendered health route would answer with the build-time data root -- " +
      "a confident lie, and worse than having no endpoint at all"
  );

  const body = await (await mod.GET()).json();
  // pid is what lets the launcher tell its own orphaned server (safe to stop)
  // from somebody else's (never touch).
  assert.equal(body.pid, process.pid);
});

process.on("exit", () => fs.rmSync(ROOT, { recursive: true, force: true }));

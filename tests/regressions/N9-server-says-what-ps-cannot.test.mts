import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

/**
 * N9 -- the server has to say what `ps` can no longer see.
 *
 * The launcher decides which server it may stop. Until today that decision was
 * made from outside the process: `ourOrphanPIDs()` took the listening pid, ran
 * `ps -o command= -p <pid>`, and looked for our own bundled server path in the
 * result.
 *
 * In the packaged app that can never match. The bundled server re-titles its
 * own process -- verified live against the shipped bundle, where
 * `ps -ww -o command= -p <pid>` returns exactly `next-server (v14.2.35)` with
 * no trace of `.../Resources/server/server.js`. `next dev` re-titles to the
 * identical string, so from the outside our own server and a stranger's dev
 * server are not merely similar, they are the same text.
 *
 * The consequences were all silent: `restartOrphan` was unreachable in the
 * bundle, a force-quit that orphaned a bundled server was never cleaned up,
 * and the `kLayout.bundled` branch of the quit handler was dead code. It
 * failed SAFE -- it is why the packaged app left every stranger alone -- but
 * it passed for a reason nobody intended, and a check that is right by
 * accident is one edit away from being wrong by accident.
 *
 * `process.argv[1]` survives the retitle inside the process. So ownership
 * moves to what the server states about itself, and this file pins both
 * halves: that the outside view really is blind, and that /api/health carries
 * the evidence that replaces it.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-n9-"));
fs.mkdirSync(path.join(ROOT, "projects"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "state"), { recursive: true });
process.env.SNIPAI_DATA = ROOT;

test("a retitled process hides its own path from ps, but not from argv", async () => {
  // The discovery itself, reproduced on a process we control rather than
  // asserted about Next's. If this ever stops being true, the mechanism the
  // ownership rule is built on has changed and someone should know.
  const script = path.join(ROOT, "retitles-itself.mjs");
  fs.writeFileSync(
    script,
    [
      `process.title = "next-server (v14.2.35)";`,
      `console.log(JSON.stringify({ argv1: process.argv[1] }));`,
      `setTimeout(() => {}, 5000);`,
    ].join("\n")
  );

  const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "ignore"] });
  try {
    const reported: { argv1: string } = await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("child never reported")), 10_000);
      child.stdout.on("data", (d) => {
        buf += String(d);
        const line = buf.split("\n")[0];
        if (line.trim()) {
          clearTimeout(timer);
          resolve(JSON.parse(line));
        }
      });
      child.on("error", reject);
    });

    assert.equal(
      reported.argv1,
      script,
      "process.argv[1] must survive the retitle -- it is the only place the " +
        "path still exists once the process has renamed itself"
    );

    const psOut = execFileSync("/bin/ps", ["-ww", "-o", "command=", "-p", String(child.pid)], {
      encoding: "utf8",
    });
    assert.ok(
      !psOut.includes(script),
      `ps must NOT show the path of a retitled process, or the old ownership ` +
        `test would have worked and this change would be unnecessary. ps said: ${psOut.trim()}`
    );
    assert.ok(
      psOut.includes("next-server"),
      `ps shows the title the process chose, which is the same string our own ` +
        `bundled server and a stranger's next dev both report. ps said: ${psOut.trim()}`
    );
  } finally {
    child.kill("SIGKILL");
  }
});

test("/api/health states the file the server was launched from", async () => {
  const { GET } = await import("@/app/api/health/route");
  const body = await (await GET()).json();

  assert.equal(
    body.serverPath,
    process.argv[1] ?? "",
    "the launcher compares this against the server file it would launch " +
      "itself; that is how it recognises an orphan from an earlier run of the " +
      "same bundle, now that ps cannot tell it"
  );
  assert.ok(typeof body.serverPath === "string", "serverPath is always present");
});

test("/api/health reports this run's launch token, and nothing when there is none", async () => {
  const { GET } = await import("@/app/api/health/route");

  const before = process.env.SNIPAI_LAUNCH_TOKEN;
  try {
    delete process.env.SNIPAI_LAUNCH_TOKEN;
    const anonymous = await (await GET()).json();
    assert.equal(
      anonymous.launchToken,
      "",
      "a server a PERSON started carries no token, and must report the empty " +
        "string rather than omitting the field -- the launcher treats an empty " +
        "token as proof of nothing, never as a match"
    );

    process.env.SNIPAI_LAUNCH_TOKEN = "TOKEN-FOR-THIS-RUN";
    const ours = await (await GET()).json();
    assert.equal(
      ours.launchToken,
      "TOKEN-FOR-THIS-RUN",
      "a server the wrapper spawned echoes the token it was given, which is " +
        "the only way a detached `npm start` in a dev checkout can ever be " +
        "recognised at quit time (ledger P19)"
    );
  } finally {
    if (before === undefined) delete process.env.SNIPAI_LAUNCH_TOKEN;
    else process.env.SNIPAI_LAUNCH_TOKEN = before;
  }
});

test("the ownership fields are read per request, not frozen at build", async () => {
  // force-dynamic is asserted by the N1 test; this asserts the consequence
  // that matters here -- a token set after module load is still reported.
  const { GET } = await import("@/app/api/health/route");
  process.env.SNIPAI_LAUNCH_TOKEN = "SET-LATE";
  const body = await (await GET()).json();
  delete process.env.SNIPAI_LAUNCH_TOKEN;
  assert.equal(body.launchToken, "SET-LATE");
});

process.on("exit", () => fs.rmSync(ROOT, { recursive: true, force: true }));

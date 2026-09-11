import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { scratchDir } from "../scratch.mts";

/**
 * N8 -- `launch-snipai.command` opened the browser onto somebody else's
 * library.
 *
 * `is_snipai() { curl -s "$URL/api/projects" | grep -q '"projects"'; }`, and
 * the comment defended it as checking SnipAi's own JSON rather than merely
 * that something answers. True, and insufficient: EVERY SnipAi server answers
 * "projects", including one serving a different library, so the script said
 * "Already running" and opened the dashboard of whatever was on 4737. Two
 * libraries can hold projects of the same name -- a sandbox copy is exactly
 * that case -- so a list of names settles nothing.
 *
 * This is the fourth sighting of one fallacy (N1, P19, T10, N8): the port
 * identifies nobody. The shell asks the same question the app asks now, via
 * scripts/port-occupant.sh, and this exercises that file directly -- sourcing
 * it is the only way to test a .command script's decision without running the
 * build it guards.
 *
 * The ordering half matters as much as the route, and is tested here too: a
 * server that is slow to serve /api/projects but knows who it is instantly
 * must be identified, not mistaken for an empty port (N5).
 */

const HELPER = path.resolve("scripts/port-occupant.sh");
const REPO = path.resolve(".");

/** Source the helper, probe a port, and hand back what it decided. */
function probe(port: number, env: Record<string, string> = {}) {
  const script = `
    set -u
    . "${HELPER}"
    snipai_probe_port ${port}
    echo "occupant=$SNIPAI_OCCUPANT"
    echo "root=$SNIPAI_OCCUPANT_ROOT"
    echo "pid=$SNIPAI_OCCUPANT_PID"
    echo "pids=$SNIPAI_OCCUPANT_PIDS"
  `;
  const out = execFileSync("/bin/bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const read = (k: string) =>
    out.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1) ?? "";
  return { occupant: read("occupant"), root: read("root"), pid: read("pid"), pids: read("pids") };
}

/**
 * A SnipAi-shaped server in its OWN process: fast /api/health, optionally
 * slow /api/projects.
 *
 * It has to be a separate process. The probe runs curl through execFileSync,
 * which blocks this process's event loop -- an http server living here could
 * never answer, and every case would "pass" for the wrong reason by timing
 * out. (It did, first time round: three failures, each 8.1s, exactly the curl
 * timeout.) tests/native/fake-occupant.mjs is the same stand-in the Swift
 * probe drives, so both sides are tested against one server.
 */
async function serveAs(
  dataRoot: string,
  opts: { projectsDelay?: number; health?: boolean } = {}
): Promise<{ port: number; stop: () => void }> {
  const { projectsDelay = 0, health = true } = opts;
  const args = [
    path.resolve("tests/native/fake-occupant.mjs"),
    "--port", "0",                    // the kernel picks one nobody else holds
    "--data-root", dataRoot,
    "--projects-delay", String(projectsDelay),
  ];
  if (!health) args.push("--no-health");

  const child: ChildProcess = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const port: number = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("occupant never bound a port")), 10_000);
    let buf = "";
    child.stdout!.on("data", (d) => {
      buf += String(d);
      const m = buf.match(/listening (\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("error", reject);
  });
  return { port, stop: () => child.kill("SIGKILL") };
}

test("a server on the port that serves ANOTHER library is not 'already running'", async () => {
  const theirs = scratchDir("n8-theirs");
  const server = await serveAs(theirs);
  try {
    const got = probe(server.port);
    assert.equal(got.occupant, "identified", "it answered /api/health, so it is identified");
    assert.equal(
      got.root,
      theirs,
      "the script must learn WHICH library is on the port -- `/api/projects` " +
        "returning a list of names cannot tell it, and that is how the browser " +
        "was opened onto somebody else's footage"
    );
    assert.notEqual(got.root, "", "an identified server always names its root");
  } finally {
    server.stop();
  }
});

test("a slow server is identified, not mistaken for an empty port", async () => {
  // The tester's case: /api/projects takes 4s (a cold `next dev` compiling it),
  // /api/health answers at once. The old check gave up after 2s and called the
  // port free.
  const theirs = scratchDir("n8-slow");
  const server = await serveAs(theirs, { projectsDelay: 4000 });
  try {
    const started = Date.now();
    const got = probe(server.port);
    assert.equal(got.occupant, "identified", "identity is asked first, so slowness elsewhere cannot hide it");
    assert.equal(got.root, theirs);
    assert.ok(
      Date.now() - started < 4000,
      "and it did not have to wait for the slow route to find out"
    );
  } finally {
    server.stop();
  }
});

test("a server that will not identify itself is never reported as a free port", async () => {
  // An older SnipAi build, or a program that is not SnipAi at all. Either way
  // starting a server here would die of EADDRINUSE.
  const server = await serveAs("/whatever", { health: false });
  try {
    const got = probe(server.port);
    assert.equal(got.occupant, "unidentified");
    assert.notEqual(got.occupant, "free");
    assert.ok(got.pids.trim().length > 0, `it must name what is holding the port, got: "${got.pids}"`);
  } finally {
    server.stop();
  }
});

test("a genuinely empty port is free, and answers quickly", async () => {
  // Find a port nobody has by binding and releasing one.
  const idle = createServer();
  const port: number = await new Promise((resolve) => {
    idle.listen(0, "127.0.0.1", () => resolve((idle.address() as { port: number }).port));
  });
  await new Promise<void>((r) => idle.close(() => r()));

  const started = Date.now();
  const got = probe(port);
  assert.equal(got.occupant, "free");
  assert.ok(
    Date.now() - started < 3000,
    "an empty port refuses the connection immediately, so the generous health " +
      "timeout costs an ordinary launch nothing"
  );
});

test("the expected data root is worked out the same way the server works it out", () => {
  // If these two disagree the script refuses to open the app against its own
  // library, and a check that cries wolf is one somebody switches off.
  const lib = scratchDir("n8-lib");
  const out = execFileSync(
    "/bin/bash",
    ["-c", `set -u; . "${HELPER}"; snipai_expected_data_root "${REPO}"`],
    { encoding: "utf8", env: { ...process.env, SNIPAI_DATA: path.join(lib, "projects", "..") } }
  ).trim();
  assert.equal(
    out,
    path.resolve(lib),
    "SNIPAI_DATA wins, and is flattened the way path.resolve() flattens it -- " +
      "lexically, without needing the directory to exist, which is what the " +
      "server reports back and therefore what this has to match"
  );

  const same = execFileSync(
    "/bin/bash",
    [
      "-c",
      `set -u; . "${HELPER}"; snipai_same_path "${lib}/projects/.." "${lib}" && echo yes || echo no`,
    ],
    { encoding: "utf8", env: { ...process.env } }
  ).trim();
  assert.equal(same, "yes", "two spellings of one directory must compare equal");
});

test("launch-snipai.command no longer decides on /api/projects", () => {
  const src = fs.readFileSync(path.resolve("launch-snipai.command"), "utf8");
  assert.ok(
    src.includes("port-occupant.sh"),
    "the launcher must use the shared probe, so this family is fixed in one place"
  );
  // The readiness question may still exist; deciding whether the port is FREE
  // with it may not.
  assert.ok(
    !/if\s+is_snipai;\s*then/.test(src),
    "'if is_snipai' was the line that opened the browser onto the wrong library"
  );
});

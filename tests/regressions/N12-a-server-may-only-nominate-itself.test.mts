import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "../scratch.mts";

/**
 * LEDGER N12 -- quit could SIGTERM a third party that never claimed anything,
 * and no token was needed to arrange it.
 *
 * `/api/health` let a server state its own `pid`, `serverPath` and
 * `launchToken` so the launcher can tell its OWN server (which it may stop)
 * from one a person started (which it may not). The rule read those three and
 * asked: is the pid it named one of the pids holding the port? That is not the
 * same question as: is the pid it named the process that ANSWERED.
 *
 * They come apart the moment two processes hold the port, which is ordinary
 * rather than exotic -- `127.0.0.1` and `::1` are different addresses and a
 * process may take either without the other. `lsof` reports both; our probe
 * reaches only the IPv4 one. So:
 *
 *   - a bystander on `[::1]:PORT` that is not SnipAi and says nothing;
 *   - an impostor on `127.0.0.1:PORT` answering /api/health with an empty
 *     token, the bundle's real `serverPath` -- which is not a secret, it is
 *     just where the app is installed -- and the BYSTANDER's pid.
 *
 * Reproduced 2026-09-11: on quit the app logged `Stopping our own server, pid
 * <bystander>` and SIGTERMed it. The process that lied survived; the one that
 * never spoke was signalled.
 *
 * **The asymmetry was structural and the fix is a missing call, not a missing
 * idea.** The count check ("is EVERY listener ours?") lived in
 * `listenerIsOurOrphan`, which only the LAUNCH path used. The quit path
 * (`main.swift:275`) and the restartOrphan path (`main.swift:526`) called
 * `ourListeningPIDs` directly and skipped it. The fix moves the count check
 * INTO `ourListeningPIDs`, so there is no permissive version left to call.
 *
 * That one guard is the whole fix, and the reason is worth keeping: the
 * function returns at most one pid, so requiring `ours.count == holders.count`
 * forces exactly one listener -- which is necessarily the process that answered
 * our probe. "The answerer is the pid it named" falls out of counting rather
 * than needing machinery to check it.
 *
 * WHY THIS TEST COMPILES SWIFT
 *
 * The rule is Swift, so no amount of reading TypeScript reaches it. A
 * source-shape assertion would be the exact mistake C28 records -- its suite
 * asserted the SHAPE of the scroll code, the shape stayed right, and the
 * behaviour was wrong anyway. So this drives the real `ourListeningPIDs`
 * against two real processes on one real port, and asserts on the pids it hands
 * back. Nothing is ever signalled: the harness PRINTS what the quit path would
 * SIGTERM. `tests/native/launch-decision-probe.swift` covers the same ground
 * from the Swift side with six more checks (gated by `scripts/check-launcher`);
 * this file is what puts N12 on the bug board.
 *
 * A missing toolchain is a failure, not a skip -- `scripts/check-launcher`
 * argues that at length and the same argument holds here.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const RULE = path.join(ROOT, "native", "LaunchDecision.swift");
const HEALTH = path.join(ROOT, "app", "api", "health", "route.ts");

/** Where the bundle's server lives. Deliberately a plain, guessable string:
 *  the point of N12 is that this is not a secret. */
const OUR_SERVER_PATH = "/Applications/SnipAi.app/Contents/Resources/server/server.js";
const OUR_TOKEN = "TOKEN-THIS-RUN-N12";

/** Never 4737: the real app may be running. The probe uses 4900-4960, so stay
 *  clear of it too -- both can be in a `./scripts/qa --full`. */
function freePort(): number {
  for (let p = 4962; p <= 4990; p++) {
    const r = spawnSync("/usr/sbin/lsof", [`-ti:${p}`], { encoding: "utf8" });
    if (!(r.stdout ?? "").trim()) return p;
  }
  throw new Error("no free port in 4962-4990 for the N12 reproduction");
}

const HARNESS = `import Foundation
// Prints what the quit path WOULD signal. It never signals anything.
@main struct H {
  static func main() {
    let port = Int(CommandLine.arguments[1])!
    let id = fetchServerIdentity(port: port, timeout: 4.0)
    let quit = ourListeningPIDs(port: port, identity: id,
                                ourServerPath: "${OUR_SERVER_PATH}",
                                ourLaunchToken: "${OUR_TOKEN}")
    let launch = listenerIsOurOrphan(port: port, identity: id,
                                     ourServerPath: "${OUR_SERVER_PATH}",
                                     ourLaunchToken: "${OUR_TOKEN}")
    print("holders=\\(listeningPIDs(port: port).sorted())")
    print("answeredPID=\\(id?.pid ?? -1)")
    print("answeredPath=\\(id?.serverPath ?? "")")
    print("quitWouldSignal=\\(quit.sorted())")
    print("launchSaysOurs=\\(launch)")
  }
}
`;

function buildHarness(dir: string): string {
  const main = path.join(dir, "Harness.swift");
  const bin = path.join(dir, "harness");
  fs.writeFileSync(main, HARNESS);
  const r = spawnSync("swiftc", ["-o", bin, RULE, main], { cwd: ROOT, encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `native/LaunchDecision.swift does not compile, so the ownership rule is unchecked:\n${
      (r.stdout ?? "") + (r.stderr ?? "")
    }`
  );
  assert.ok(fs.existsSync(bin), "swiftc reported success but produced no binary");
  return bin;
}

/** Start a listener and resolve once it says it is bound. */
function occupant(args: string[]): Promise<ChildProcess> {
  const script = path.join(ROOT, "tests", "native", "fake-occupant.mjs");
  const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`occupant ${args.join(" ")} never bound`)), 10_000);
    let seen = "";
    child.stdout!.on("data", (d) => {
      seen += String(d);
      if (seen.includes("listening")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function readout(bin: string, port: number): Record<string, string> {
  const r = spawnSync(bin, [String(port)], { encoding: "utf8" });
  assert.equal(r.status, 0, `harness failed:\n${(r.stdout ?? "") + (r.stderr ?? "")}`);
  return Object.fromEntries(
    (r.stdout ?? "").trim().split("\n").map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
  );
}

test("N12: a server that names somebody else's pid gets nobody signalled", async (t) => {
  const dir = scratchDir("n12");
  const port = freePort();
  let bystander: ChildProcess | undefined;
  let impostor: ChildProcess | undefined;

  t.after(() => {
    bystander?.kill("SIGKILL");
    impostor?.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const bin = buildHarness(dir);

  // The bystander: holds [::1]:PORT, is not SnipAi, claims nothing at all.
  bystander = await occupant([
    "--port", String(port), "--host", "::1", "--no-health",
    "--data-root", "/tmp/not-snipai-at-all",
  ]);
  const bystanderPID = bystander.pid!;

  // The impostor: holds 127.0.0.1:PORT -- the address the launcher probes --
  // and hands back the bystander's pid with our own bundle's server path.
  impostor = await occupant([
    "--port", String(port), "--host", "127.0.0.1",
    "--claim-pid", String(bystanderPID),
    "--server-path", OUR_SERVER_PATH,
    "--data-root", "/tmp/snipai-n12-library",
  ]);
  const impostorPID = impostor.pid!;

  const seen = readout(bin, port);

  // The preconditions ARE the finding: if two processes cannot share the port
  // on this machine, this test proves nothing and must say so rather than pass.
  const holders = seen.holders;
  assert.ok(
    holders.includes(String(bystanderPID)) && holders.includes(String(impostorPID)),
    `dual-stack occupancy did not happen -- holders ${holders}, ` +
      `bystander ${bystanderPID} on ::1, impostor ${impostorPID} on 127.0.0.1`
  );
  assert.equal(
    seen.answeredPID,
    String(bystanderPID),
    "the probe should have reached the IPv4 impostor, which names the bystander's pid"
  );
  assert.equal(
    seen.answeredPath,
    OUR_SERVER_PATH,
    "the impostor states our bundle's real server path -- no token required, it is not a secret"
  );

  // THE regression. Before the fix this was `[<bystanderPID>]` and the app
  // logged "Stopping our own server" on its way to SIGTERMing a stranger.
  assert.equal(
    seen.quitWouldSignal,
    "[]",
    `quit would have signalled ${seen.quitWouldSignal}; the bystander is pid ${bystanderPID}`
  );
  assert.ok(
    !seen.quitWouldSignal.includes(String(bystanderPID)),
    "the process that never claimed anything must never be signalled"
  );

  // All three call sites agree. This is the half that was already right, and
  // asserting it here is what makes the agreement visible rather than assumed.
  assert.equal(seen.launchSaysOurs, "false", "the launch path must refuse it too");

  assert.equal(bystander.exitCode, null, "the bystander is still alive");
  assert.equal(impostor.exitCode, null, "the impostor is still alive");
});

test("N12: a lone server that identifies itself is still ours to stop", async (t) => {
  // The fix must not disown us. If tightening ownership meant the app could no
  // longer stop its OWN orphan, it would have traded N12 for N9 -- a rule that
  // is safe because it never claims anything, which is the exact defect N9
  // records and calls "right by accident".
  const dir = scratchDir("n12b");
  const port = freePort();
  let ours: ChildProcess | undefined;
  t.after(() => {
    ours?.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const bin = buildHarness(dir);
  ours = await occupant([
    "--port", String(port), "--host", "127.0.0.1",
    "--server-path", OUR_SERVER_PATH,
    "--launch-token", OUR_TOKEN,
    "--data-root", "/tmp/snipai-n12-library",
  ]);

  const seen = readout(bin, port);
  assert.equal(seen.holders, `[${ours.pid}]`, "our server should be the only listener");
  assert.equal(
    seen.quitWouldSignal,
    `[${ours.pid}]`,
    "a sole listener carrying this run's token is ours, and quit must still stop it"
  );
  assert.equal(seen.launchSaysOurs, "true", "and the launch path agrees it is our orphan");
});

test("N12: /api/health no longer makes the safety claim that was false", () => {
  // The doc half of the row, and the reason it was not allowed to wait: this
  // sentence is what the next person reasons from, and M0.6's argument rests
  // on it. A wrong claim about what protects the footage is worse than none.
  const src = fs.readFileSync(HEALTH, "utf8");

  // The false sentence asserted the launcher's worst case without stating the
  // conditions that would have to hold for it to be true.
  const falseClaim = /worst a local process can do by echoing back a token it read here is\s+\*?\s*get itself SIGTERMed on quit instead of somebody else/;
  assert.doesNotMatch(
    src.replace(/\n\s*\*/g, " "),
    falseClaim,
    "/api/health has re-acquired the claim N12 falsified"
  );

  // And says what is actually true, in the three parts that make it true.
  const doc = src.replace(/\s+/g, " ");
  assert.match(doc, /identified itself/i, "the doc must say silence is never ownership");
  assert.match(
    doc,
    /ONE and only listener|only listener on the port/i,
    "the doc must say the named pid has to be the sole listener -- that is the part that was missing"
  );
  assert.match(doc, /launch's token|launchToken/i, "the doc must still name the token condition");
});

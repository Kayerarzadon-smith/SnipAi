import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tempLibrary, req } from "./_fixture.mts";

/**
 * LEDGER C32 -- Trash tells him the video was sent back for a re-cut. It was
 * binned.
 *
 * `review/page.tsx:1192` read:
 *
 *     toast(status === "approved" ? "Approved — ready to post" : "Sent back to re-cut")
 *
 * and `setLevel1` has exactly two callers: "approved" at :1743 and "trashed"
 * at :1747. So the else-branch is reached by the Trash button and by nothing
 * else. The comment directly above it says why -- "only two verdicts are
 * reachable now: the third was a hand-back to somebody who does not exist" --
 * which is the whole mechanism: the third verdict was removed and its
 * sentence was left sitting on the `else`, where Trash inherited it.
 *
 * WHAT TRASH ACTUALLY DOES, measured here rather than assumed.
 *
 * The ledger row calls it "destructive ... and irreversible". Both halves are
 * checked below and neither survives contact with the code:
 *
 *   - it is NOT destructive. `review-action` writes one field,
 *     `s.cutStatus = "trashed"`. No file is touched. The project directory,
 *     the beats, the transcript, the cuts and the raw footage are all exactly
 *     where they were.
 *   - it is NOT the dashboard's Delete. `DELETE /api/projects/[project]`
 *     MOVES the directory into `.trash/` and `lib/trash.ts` gives it five days
 *     (RETAIN_DAYS) and a "Put it back". `cutStatus: "trashed"` never goes
 *     near `.trash`, so that restore does not cover it -- they are two
 *     different mechanisms wearing the same word, and the copy must not
 *     borrow the safety of the one it is not.
 *   - it IS a one-way door to `unreviewed`, because no writer anywhere
 *     produces that status. But it is not a one-way door off the queue:
 *     the card stays clickable and Approve writes a status the dashboard
 *     counts as live.
 *
 * So C32 is a wrong sentence over a defensible action, and the honest
 * sentence is milder than the row feared, not harsher.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS NOT A PROOF-READ.
 *
 * Rewording a toast is the one fix in this family that can be faked: any
 * string passes a test that compares it to itself, which is how C22 shipped
 * green over a live defect. So nothing here compares a sentence to a
 * sentence. `lib/verdictCopy.ts` makes each message DECLARE what it claims --
 * work queued, queue left, files erased, restore offered -- and every claim is
 * then checked against what `review-action` measurably did to a real project
 * in a temp library. "Sent back to re-cut" fails because no job exists, not
 * because of how it is worded, and the same assertion catches the next
 * sentence that promises something the route does not do.
 *
 * Extracting the ternary is the fix, not scaffolding for the test: an inline
 * two-branch ternary over a four-valued enum is precisely how one status
 * ended up wearing another's message, and `verdictCopy`'s exhaustive switch
 * makes the fifth status a compile error instead of a silent inheritance.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PAGE = path.join(ROOT, "app", "projects", "[project]", "review", "page.tsx");
const DASHBOARD = path.join(ROOT, "app", "dashboard", "page.tsx");

const PROJECT = "fixture";
const STATUSES = ["unreviewed", "approved", "needs_fixes", "trashed"] as const;

type Observed = {
  jobsCreated: number;
  projectOnDisk: boolean;
  filesKept: string[];
  inTrashRoot: boolean;
  restorableFromTrash: boolean;
  onDashboardQueue: boolean;
};

/* ONE library for the whole file, created before the first `await import`.
   `lib/paths.ts` resolves SNIPAI_DATA once, at import, so a second
   tempLibrary() would hand back a directory the app modules never look at and
   every observation below would be read off an untouched copy of the project.
   `node --test` gives each FILE its own process, so one root per file is the
   isolation that actually applies. */
const ROOT_LIB = tempLibrary(PROJECT, [{ label: "one", start: 0, end: 2 }]);
const PROJECT_DIR = path.join(ROOT_LIB, "projects", PROJECT);
const TRASH_ROOT = path.join(ROOT_LIB, ".trash");
const JOBS_FILE = path.join(ROOT_LIB, "state", "jobs.json");

/* Enough of a project that "nothing was deleted" is a claim with something to
   be wrong about. The raw file is the one that matters -- it is the only copy
   of a shoot that cannot be re-shot. */
const CONTENTS = ["beats.json", "cuts", "source.mov", "work"];

function freshProject(): void {
  fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
  fs.rmSync(TRASH_ROOT, { recursive: true, force: true });
  fs.rmSync(JOBS_FILE, { force: true });
  fs.mkdirSync(path.join(PROJECT_DIR, "work"), { recursive: true });
  fs.mkdirSync(path.join(PROJECT_DIR, "cuts"), { recursive: true });
  fs.writeFileSync(
    path.join(PROJECT_DIR, "beats.json"),
    JSON.stringify({ source: "source.mov", beats: [{ label: "one", start: 0, end: 2 }] })
  );
  fs.writeFileSync(path.join(PROJECT_DIR, "source.mov"), "raw footage");
  fs.writeFileSync(path.join(PROJECT_DIR, "work", "transcript.json"), "{}");
  fs.writeFileSync(path.join(PROJECT_DIR, "cuts", `${PROJECT}-v1.mp4`), "cut");
  assert.deepEqual(fs.readdirSync(PROJECT_DIR).sort(), CONTENTS);
}

/**
 * Put a project through the verdict the button writes, and report what
 * actually happened to it. Every field is something a sentence in
 * `verdictCopy` might claim.
 */
async function applyVerdict(status: string): Promise<Observed> {
  freshProject();

  const { POST } = await import("@/app/api/projects/[project]/review-action/route");
  const res = await POST(req({ kind: "level1", status }, "POST"), { params: { project: PROJECT } });
  assert.equal(res.status, 200, `the route refused status '${status}', so nothing below means anything`);
  const body = await res.json();
  assert.equal(body.reviewState.cutStatus, status, `status '${status}' was not written`);

  const jobsCreated = fs.existsSync(JOBS_FILE)
    ? (JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) as unknown[]).length
    : 0;

  const { listTrash } = await import("@/lib/trash");
  const { summarizeAllProjects } = await import("@/lib/projectSummary");

  /* review-state.json is the ONE thing the verdict is allowed to add, so it is
     not counted as a survivor of "nothing was deleted". */
  const kept = fs.existsSync(PROJECT_DIR)
    ? fs.readdirSync(PROJECT_DIR).filter((f) => f !== "review-state.json").sort()
    : [];

  return {
    jobsCreated,
    projectOnDisk: fs.existsSync(PROJECT_DIR),
    filesKept: kept,
    inTrashRoot: fs.existsSync(TRASH_ROOT) && fs.readdirSync(TRASH_ROOT).length > 0,
    restorableFromTrash: listTrash().some((t) => t.project === PROJECT),
    onDashboardQueue: summarizeAllProjects()
      .filter((p) => p.cutStatus !== "trashed")          // dashboard/page.tsx:35
      .some((p) => p.name === PROJECT),
  };
}

/* -------------------------------------------------------------------------
 * The headline. Each sentence's own claims, against the route's own effects.
 * ---------------------------------------------------------------------- */
test("C32: every verdict's message claims only what the verdict actually did", async () => {
  const { verdictCopy } = await import("@/lib/verdictCopy");

  for (const status of STATUSES) {
    const said = verdictCopy(status);
    const did = await applyVerdict(status);

    assert.equal(
      said.queuesWork, did.jobsCreated > 0,
      `"${said.text}" (${status}): the message ${said.queuesWork ? "promises" : "does not mention"} ` +
      `work being done, and ${did.jobsCreated} jobs were queued. ` +
      `review-action writes review-state.json and returns; it has never started a job.`
    );
    assert.equal(
      said.deletesFiles, !did.projectOnDisk || did.filesKept.length === 0,
      `"${said.text}" (${status}): the message ${said.deletesFiles ? "says something was erased" : "says nothing was erased"}, ` +
      `and the project still holds ${JSON.stringify(did.filesKept)}`
    );
    assert.equal(
      said.offersTrashRestore, did.restorableFromTrash,
      `"${said.text}" (${status}): the message ${said.offersTrashRestore ? "offers" : "does not offer"} ` +
      `the five-day restore, and listTrash() ${did.restorableFromTrash ? "has" : "does not have"} this project. ` +
      `cutStatus is not the .trash folder -- only DELETE /api/projects/[project] moves a directory there.`
    );
    assert.equal(
      said.leavesQueue, !did.onDashboardQueue,
      `"${said.text}" (${status}): the message ${said.leavesQueue ? "says it came off" : "does not say it came off"} ` +
      `the queue, and the dashboard ${did.onDashboardQueue ? "still lists" : "drops"} it`
    );
  }
});

/* -------------------------------------------------------------------------
 * The two facts the honest sentence rests on, stated on their own so a
 * failure names which one moved.
 * ---------------------------------------------------------------------- */
test("C32: Trash deletes nothing -- it writes one field", async () => {
  const did = await applyVerdict("trashed");
  assert.ok(did.projectOnDisk, "the project directory is gone after Trash");
  assert.deepEqual(
    did.filesKept, CONTENTS,
    "Trash touched something other than review-state.json"
  );
});

test("C32: Trash does not put the project anywhere the five-day restore can find it", async () => {
  const did = await applyVerdict("trashed");
  assert.equal(did.inTrashRoot, false, ".trash gained an entry, which would change what the copy may say");
  assert.equal(
    did.restorableFromTrash, false,
    "listTrash() found the project -- if cutStatus ever does move the directory, " +
    "the message may start offering 'Recently deleted', and until then it may not"
  );
});

test("C32: Trash takes the project off the dashboard's queue, and Approve puts it back", async () => {
  assert.equal((await applyVerdict("trashed")).onDashboardQueue, false);
  assert.equal((await applyVerdict("approved")).onDashboardQueue, true,
    "Approve no longer returns a trashed project to the queue -- the copy says it does");
});

/* -------------------------------------------------------------------------
 * Structural: the shape that produced the defect cannot come back.
 * ---------------------------------------------------------------------- */
test("C32: no two verdicts share a sentence", async () => {
  const { verdictCopy } = await import("@/lib/verdictCopy");
  const seen = new Map<string, string>();
  for (const status of STATUSES) {
    const { text } = verdictCopy(status);
    const owner = seen.get(text);
    assert.equal(
      owner, undefined,
      `'${status}' and '${owner}' both say "${text}" -- that is exactly how Trash ` +
      `inherited the removed verdict's message`
    );
    seen.set(text, status);
  }
});

test("C32: the review screen no longer decides the sentence itself", () => {
  const src = fs.readFileSync(PAGE, "utf8");
  assert.ok(
    /verdictCopy\(/.test(src),
    "review/page.tsx does not call verdictCopy -- the message is being chosen somewhere " +
    "this test cannot check against what the route does"
  );
  /* The call shape, not the words: a comment in page.tsx quotes the old line
     on purpose so the next reader knows what this replaced, and a looser
     pattern would match that quotation and fail on the fix's own history. */
  assert.ok(
    !/toast\([^)]*\bstatus ===/.test(src),
    "a toast in review/page.tsx is choosing its own sentence from `status` again -- " +
    "that ternary is what let Trash inherit a removed verdict's message"
  );
});

test("C32: the dashboard still decides 'on the queue' the way this test reads it", () => {
  /* Not the proof -- the proof is above. This only says the rule the test
     borrows is still the dashboard's rule, so a green run cannot mean
     "the copy matches a queue nobody uses any more". */
  const src = fs.readFileSync(DASHBOARD, "utf8");
  assert.ok(
    /cutStatus !== "trashed"/.test(src),
    "dashboard/page.tsx no longer filters the live queue on cutStatus !== 'trashed' -- " +
    "re-derive C32's onDashboardQueue from whatever replaced it"
  );
});

import type { CutStatus } from "./types";

/**
 * What to tell him after a verdict is written, and what that sentence claims.
 *
 * This used to be a ternary inline in the review screen:
 *
 *     toast(status === "approved" ? "Approved — ready to post" : "Sent back to re-cut")
 *
 * Two branches over a four-valued enum. The third verdict -- the hand-back to
 * a person who does not exist -- was removed, and its sentence stayed behind
 * on the `else`, where the only caller left is the Trash button. So Trash
 * announced a re-cut: work being done, by someone, on a project that had just
 * been dropped off the queue with no job queued at all. (ledger C32)
 *
 * So the copy lives here, one entry per status, in a switch that a new status
 * cannot slip past -- the `never` below is a compile error, not a fallthrough
 * onto whatever sentence happens to be last. And each entry declares what its
 * sentence CLAIMS, so the claim can be checked against what the route
 * actually does to the project rather than proof-read.
 */
export type VerdictCopy = {
  /** the sentence shown once the status is on disk */
  text: string;
  /** the sentence says SnipAi is now doing work on this project */
  queuesWork: boolean;
  /** the sentence says the project has come off the dashboard's queue */
  leavesQueue: boolean;
  /** the sentence says something on disk was erased */
  deletesFiles: boolean;
  /** the sentence offers the dashboard's five-day restore */
  offersTrashRestore: boolean;
};

export function verdictCopy(status: CutStatus): VerdictCopy {
  switch (status) {
    case "approved":
      return {
        text: "Approved — ready to post",
        queuesWork: false, leavesQueue: false, deletesFiles: false, offersTrashRestore: false,
      };

    /* Measured, not assumed (see the test): `review-action` sets one field.
       No job is started, no file is touched, and the directory does NOT go to
       `.trash`, so the dashboard's five-day "Put it back" does not cover this
       -- `cutStatus: "trashed"` and Delete are two mechanisms wearing the same
       word. What it does do is drop the project out of
       `dashboard/page.tsx:35`'s live list. The way back is Approve, which is
       worth saying out loud because no button anywhere writes `unreviewed`. */
    case "trashed":
      return {
        text: "Trashed — off the queue. Nothing was deleted; Approve puts it back.",
        queuesWork: false, leavesQueue: true, deletesFiles: false, offersTrashRestore: false,
      };

    /* Unreachable from the review screen today -- the verdict button for it is
       H2, still missing -- but the route accepts it and the dashboard draws a
       pill for it, so it needs a sentence that is true rather than one
       inherited from whichever branch it lands on. It queues nothing. */
    case "needs_fixes":
      return {
        text: "Marked as needing fixes — it stays on the queue.",
        queuesWork: false, leavesQueue: false, deletesFiles: false, offersTrashRestore: false,
      };

    case "unreviewed":
      return {
        text: "Back to unreviewed — it stays on the queue.",
        queuesWork: false, leavesQueue: false, deletesFiles: false, offersTrashRestore: false,
      };
  }
  const unreachable: never = status;
  return unreachable;
}

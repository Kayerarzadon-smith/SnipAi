"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The Queue is what you actually did, not what it looked like when you left.
 *
 * The page is a server component marked force-dynamic, so it is rebuilt on
 * every REQUEST -- but navigating back to it with the rail does not
 * necessarily make a request. Next keeps the rendered payload of a visited
 * route in the client router cache for around half a minute, so approving a
 * project on the Review screen and stepping back to the Queue showed the pill
 * it had before the approval, with /api/projects already answering
 * "cutStatus":"approved" for the same project at the same moment. It came
 * right only when something else forced a redraw, which is why QA logged it
 * as intermittent -- what varies is whether anything else happened to fire.
 *
 * One refresh on arrival, which is exactly when the cached copy can be stale.
 * LiveProgress redraws while a job runs; this covers the case where no job is
 * running and the change came from somewhere else.
 */
export default function FreshOnArrival() {
  const router = useRouter();
  useEffect(() => { router.refresh(); }, [router]);
  return null;
}

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "@/lib/paths";
import { runTool, checkAvailability } from "@/lib/pipeline";

const TUNING = path.join(STATE_ROOT, "tuning.json");

function readTuning(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(TUNING, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Close the learning loop.
 *
 * Every trim and every rejected take is a labelled example: the tool put the
 * edge here, a human moved it there. learn_from_edits.py turns enough of
 * those in the same direction into a corrected default, so the next video
 * starts closer and needs less work. That is the whole point of recording
 * the edits in the first place — but it only pays off if it actually runs,
 * so the app runs it instead of waiting to be asked.
 *
 * GET  — what the edits imply, without changing anything.
 * POST — apply it. The tool's own bar is 3+ examples, 70% agreeing.
 */
export async function GET() {
  const avail = checkAvailability();
  if (!avail.python3) {
    return NextResponse.json({ error: "python3 not available", availability: avail }, { status: 503 });
  }
  const res = await runTool("learn_from_edits.py", []);
  return NextResponse.json({ report: res.stdout, tuning: readTuning() });
}

export async function POST(req: NextRequest) {
  const avail = checkAvailability();
  if (!avail.python3) {
    return NextResponse.json({ error: "python3 not available", availability: avail }, { status: 503 });
  }

  let quiet = false;
  try {
    quiet = !!(await req.json())?.quiet;
  } catch {
    // no body is fine
  }

  const before = JSON.stringify(readTuning());
  const res = await runTool("learn_from_edits.py", ["--apply"]);
  const after = readTuning();
  const changed = JSON.stringify(after) !== before;

  // Only the lines that say what moved -- the rest is the tool narrating.
  const learned = res.stdout
    .split("\n")
    .filter((l) => /->/.test(l) && !/Run with/.test(l))
    .map((l) => l.trim());

  return NextResponse.json({
    changed,
    learned,
    report: quiet ? undefined : res.stdout,
    tuning: after,
  });
}

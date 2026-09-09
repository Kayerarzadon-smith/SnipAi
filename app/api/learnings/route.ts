import { NextRequest, NextResponse } from "next/server";
import { loadLearnings, addLearning, setLearningActive, suggestCategory } from "@/lib/learnings";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

const MAX_LEN = 2000;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({ learnings: loadLearnings() });
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("body must be JSON");
  }
  if (typeof body?.text !== "string" || !body.text.trim()) {
    return bad("text required");
  }
  if (body.text.length > MAX_LEN) {
    return bad(`text must be under ${MAX_LEN} characters`);
  }
  const pref = addLearning(body.text.trim());
  return NextResponse.json({ preference: pref, suggestedCategory: suggestCategory(body.text) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: { id?: unknown; active?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("body must be JSON");
  }
  if (typeof body?.id !== "string" || !body.id) return bad("id required");
  // "yes" is not true. Without this check a junk value silently flips a rule.
  if (typeof body?.active !== "boolean") return bad("active must be true or false");

  if (!loadLearnings().some((p) => p.id === body.id)) {
    return NextResponse.json({ error: `no preference '${body.id}'` }, { status: 404 });
  }

  const all = setLearningActive(body.id as string, body.active as boolean);
  return NextResponse.json({ learnings: all });
}

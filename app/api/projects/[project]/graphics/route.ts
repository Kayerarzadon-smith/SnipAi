import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/paths";
import { loadBeats, findCutFile } from "@/lib/beats";
import { checkAvailability } from "@/lib/pipeline";
import { createJob, failJob, runningJob } from "@/lib/jobs";
import { runPlanGraphicsJob, runRenderGraphicsJob } from "@/lib/pipeline";

export type Graphic = {
  id: string;
  /** ai_overlay is a REQUEST, not something SnipAi can render: it records
   * what shot is wanted and exactly when, so it can be generated elsewhere
   * and dropped in. It is never passed to the renderer. */
  type: "definition" | "stat" | "callout" | "emphasis" | "lower_third" | "ai_overlay";
  start: number;
  end: number;
  enabled?: boolean;
  why?: string;
  verified?: boolean;
  term?: string;
  definition?: string;
  value?: string;
  caption?: string;
  text?: string;
  title?: string;
  subtitle?: string;
};

function planPath(project: string) {
  return path.join(projectDir(project), "work", "graphics.json");
}

function readPlan(project: string): { cut?: string; graphics: Graphic[] } {
  try {
    const d = JSON.parse(fs.readFileSync(planPath(project), "utf8"));
    return { cut: d.cut, graphics: Array.isArray(d.graphics) ? d.graphics : [] };
  } catch {
    return { graphics: [] };
  }
}

export async function GET(_req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;
  try {
    projectDir(project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  if (!loadBeats(project)) {
    return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
  }
  const plan = readPlan(project);
  return NextResponse.json({
    ...plan,
    hasCut: !!findCutFile(project),
    availability: checkAvailability(),
  });
}

/** Toggle a graphic on/off, or edit its copy and timing. */
export async function PATCH(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;
  let body: { id?: unknown; patch?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const plan = readPlan(project);
  const g = plan.graphics.find((x) => x.id === body.id);
  if (!g) return NextResponse.json({ error: `no graphic '${body.id}'` }, { status: 404 });

  const patch = (body.patch ?? {}) as Record<string, unknown>;
  const TEXTS = ["term", "definition", "value", "caption", "text", "title", "subtitle", "prompt", "region"];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "enabled") {
      if (typeof v !== "boolean") {
        return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
      }
      g.enabled = v;
    } else if (k === "start" || k === "end") {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: `${k} must be a positive number` }, { status: 400 });
      }
      (g as unknown as Record<string, number>)[k] = Math.round(v * 100) / 100;
    } else if (k === "verified") {
      if (typeof v !== "boolean") {
        return NextResponse.json({ error: "verified must be a boolean" }, { status: 400 });
      }
      g.verified = v;
    } else if (TEXTS.includes(k)) {
      if (typeof v !== "string" || v.length > 400) {
        return NextResponse.json({ error: `${k} must be a string under 400 chars` }, { status: 400 });
      }
      // editing a definition makes it yours, so it stops being flagged as mine
      if (k === "definition") g.verified = true;
      (g as unknown as Record<string, string>)[k] = v;
    } else {
      return NextResponse.json({ error: `cannot set '${k}'` }, { status: 400 });
    }
  }
  if (g.end - g.start < 0.4) {
    return NextResponse.json({ error: "a graphic must be on screen for at least 0.4s" }, { status: 400 });
  }

  fs.writeFileSync(planPath(project), JSON.stringify(plan, null, 1));
  return NextResponse.json({ ok: true, graphic: g });
}

/** Re-plan from the cut, or burn the enabled graphics in. */
export async function POST(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;
  let body: { action?: unknown; allowUnverified?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (body.action !== "add" && body.action !== "delete") {
    if (!findCutFile(project)) {
      return NextResponse.json({ error: "build a cut first" }, { status: 400 });
    }
  }
  const cut = findCutFile(project) ?? "";

  const avail = checkAvailability();
  if (body.action !== "add" && body.action !== "delete" && (!avail.python3 || !avail.ffmpeg)) {
    return NextResponse.json({ error: "pipeline tools not available", availability: avail }, { status: 503 });
  }
  const busy = body.action === "add" || body.action === "delete" ? null : runningJob();
  if (busy) {
    return NextResponse.json(
      { error: `already running ${busy.step} on "${busy.project}"`, runningJobId: busy.id },
      { status: 409 }
    );
  }

  if (body.action === "plan") {
    if (!avail.fasterWhisper) {
      return NextResponse.json({ error: "faster-whisper not installed" }, { status: 503 });
    }
    const job = createJob(project, "plan-graphics");
    runPlanGraphicsJob(job.id, project, cut).catch((e) =>
      failJob(job.id, e instanceof Error ? e.message : String(e)));
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  if (body.action === "add") {
    const g = (body as { graphic?: unknown }).graphic as Record<string, unknown> | undefined;
    if (!g || typeof g !== "object") {
      return NextResponse.json({ error: "graphic is required" }, { status: 400 });
    }
    const TYPES = ["definition", "stat", "callout", "emphasis", "lower_third", "ai_overlay"];
    if (typeof g.type !== "string" || !TYPES.includes(g.type)) {
      return NextResponse.json({ error: `type must be one of: ${TYPES.join(", ")}` }, { status: 400 });
    }
    if (typeof g.start !== "number" || typeof g.end !== "number" ||
        !Number.isFinite(g.start) || !Number.isFinite(g.end)) {
      return NextResponse.json({ error: "start and end must be numbers" }, { status: 400 });
    }
    // a negative start is before the video begins; it renders as a graphic
    // that is already on screen at frame one and never announced itself
    if (g.start < 0) {
      return NextResponse.json({ error: "start cannot be negative" }, { status: 400 });
    }
    if (g.end - g.start < 0.4) {
      return NextResponse.json({ error: "a graphic must be on screen at least 0.4s" }, { status: 400 });
    }
    const plan = readPlan(project);
    const id = `g${String(Date.now()).slice(-6)}`;
    const made: Graphic = {
      id,
      type: g.type as Graphic["type"],
      start: Math.round(g.start * 100) / 100,
      end: Math.round(g.end * 100) / 100,
      enabled: true,
      why: "added by hand",
      // copy is yours from the start, so it needs no separate approval
      verified: true,
      ...Object.fromEntries(
        ["term", "definition", "value", "caption", "text", "title", "subtitle", "prompt", "region"]
          .filter((k) => typeof g[k] === "string")
          .map((k) => [k, String(g[k]).slice(0, 400)])
      ),
    };
    plan.graphics.push(made);
    plan.graphics.sort((a, b) => a.start - b.start);
    fs.mkdirSync(path.dirname(planPath(project)), { recursive: true });
    fs.writeFileSync(planPath(project), JSON.stringify(plan, null, 1));
    return NextResponse.json({ ok: true, graphic: made });
  }

  if (body.action === "delete") {
    const id = (body as { id?: unknown }).id;
    if (typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const plan = readPlan(project);
    const before = plan.graphics.length;
    plan.graphics = plan.graphics.filter((x) => x.id !== id);
    if (plan.graphics.length === before) {
      return NextResponse.json({ error: `no graphic '${id}'` }, { status: 404 });
    }
    fs.writeFileSync(planPath(project), JSON.stringify(plan, null, 1));
    return NextResponse.json({ ok: true });
  }

  if (body.action === "render") {
    const plan = readPlan(project);
    const on = plan.graphics.filter((g) => g.enabled !== false && g.type !== "ai_overlay");
    if (!on.length) {
      return NextResponse.json({ error: "nothing is switched on in the plan" }, { status: 400 });
    }
    // A definition is a claim about an ingredient going onto a public product
    // video. The ones drafted here are unchecked, so they do not get burned in
    // by accident -- either edit the wording (which marks it yours) or say so.
    const unverified = on.filter((g) => g.type === "definition" && g.verified === false);
    if (unverified.length && body.allowUnverified !== true) {
      return NextResponse.json(
        {
          error: `${unverified.length} definition(s) haven't been checked`,
          unverified: unverified.map((g) => ({ id: g.id, term: g.term, definition: g.definition })),
          hint: "edit the wording to confirm it, switch it off, or resend with allowUnverified",
        },
        { status: 409 }
      );
    }
    const job = createJob(project, "render-graphics");
    runRenderGraphicsJob(job.id, project, cut).catch((e) =>
      failJob(job.id, e instanceof Error ? e.message : String(e)));
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  return NextResponse.json({ error: "action must be 'plan', 'render', 'add' or 'delete'" }, { status: 400 });
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Which cutting made this file, and is it still the cutting we have?
 *
 * `pipeline-version.json` sits beside the pipeline and carries one integer.
 * build_cut.py stamps it into work/pipeline.json on every render; the app
 * compares the two and offers "Rebuild -- the cutting has improved since this
 * was built". It is the only thing that tells Kayer a fix made after his
 * footage was cut applies to it, because every pipeline fix is forward-only.
 *
 * That integer is a hand-written claim about code, and nothing tied it to the
 * code. It rotted immediately: E1 changed how every clip is extracted and the
 * manifest still read version 2, the WORD_RESCUE value, one day later. A
 * signal nobody remembers to raise is a signal that is off.
 *
 * So the manifest now also records a digest of the files it was stamped
 * against -- every file directly inside tools/, which is deliberately a
 * directory rule and not a list, so a tool added tomorrow is covered without
 * anyone updating anything. requirements.txt is in there on purpose: the
 * pinned ffmpeg decides what a rendered frame looks like as surely as
 * build_cut.py does. `_superseded/` is a subdirectory and so falls outside,
 * which is correct -- nothing runs it. `_paths.py` is not excluded despite
 * the underscore: every tool imports it, so it is as much the cutting as
 * build_cut.py is.
 *
 * What this does NOT cover: `lib/pipeline.ts`, which renders the final
 * concat and is where S19's faststart fix lives. A change there can make an
 * existing cut wrong too, and this guard will not notice. Left out
 * deliberately -- that file is edited often for reasons that cannot touch a
 * rendered frame, and a guard that fires on every unrelated edit gets
 * reflexively dismissed, which is the failure it exists to prevent. Filed as
 * a proposed ledger row rather than solved quietly here.
 *
 * When those digests stop matching, the suite goes red and says so. It cannot
 * tell whether the change makes existing cuts wrong -- only a person knows
 * that -- but it makes the question impossible to walk past, which is the
 * whole difference between this and what was here before. Answering it is one
 * command: ./scripts/pipeline-version --bump or --restamp.
 *
 * Coarse on purpose. A docstring edit in an unrelated tool will trip it. The
 * cost of over-asking is ten seconds and a --restamp; the cost of under-asking
 * is a clipped consonant shipping in a TikTok, which is what happened.
 */

export const MANIFEST_NAME = "pipeline-version.json";

export type Manifest = {
  version: number;
  changed?: string;
  why?: string;
  tools?: Record<string, string>;
};

export type VersionStatus = {
  /** The version the installed pipeline claims, or 0 when we could not read one. */
  version: number;
  /** False means "we do not know", which is not the same as "version 0". */
  ok: boolean;
  /** Why we do not know. Present only when ok is false. */
  reason?: string;
  manifestPath: string;
};

export function manifestPath(codeRoot: string): string {
  return path.join(codeRoot, MANIFEST_NAME);
}

/**
 * Every file directly inside tools/, mapped to a short digest of its content.
 *
 * Non-recursive by design: it is the rule that decides what counts as "the
 * cutting", and a rule beats a list because a list is another thing to
 * remember. Dotfiles and directories are skipped.
 */
export function digestTools(toolsRoot: string): Record<string, string> {
  const out: Record<string, string> = {};
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(toolsRoot, { withFileTypes: true });
  } catch {
    return out;                        // no tools, nothing to describe
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isFile() || e.name.startsWith(".")) continue;
    const buf = fs.readFileSync(path.join(toolsRoot, e.name));
    out[e.name] = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  }
  return out;
}

export function readManifest(codeRoot: string): Manifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(codeRoot), "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Manifest) : null;
  } catch {
    return null;
  }
}

/**
 * The installed pipeline's version, and -- when there isn't one -- why not.
 *
 * The caller decides what to do about `ok: false`. Nothing should claim a cut
 * is stale on the strength of a manifest it could not read; equally, nothing
 * should stay silent about not being able to read it, because that silence is
 * exactly how the badge sat dead in the packaged app while both of Kayer's
 * cuts were behind.
 */
export function versionStatus(codeRoot: string): VersionStatus {
  const p = manifestPath(codeRoot);
  const m = readManifest(codeRoot);
  if (!m) {
    return fs.existsSync(p)
      ? { version: 0, ok: false, reason: `${MANIFEST_NAME} is not readable JSON`, manifestPath: p }
      : { version: 0, ok: false, reason: `no ${MANIFEST_NAME} at ${p}`, manifestPath: p };
  }
  const v = Number(m.version);
  if (!Number.isFinite(v) || v <= 0) {
    return { version: 0, ok: false, reason: `${MANIFEST_NAME} carries no usable version`, manifestPath: p };
  }
  return { version: v, ok: true, manifestPath: p };
}

export type Drift = {
  /** Files whose content moved since the manifest was stamped. */
  changed: string[];
  /** Tools that exist now and were not stamped. */
  added: string[];
  /** Tools that were stamped and are gone. */
  removed: string[];
  /** False when the manifest records no digests at all. */
  stamped: boolean;
  version: number;
  actual: Record<string, string>;
};

export function manifestDrift(codeRoot: string, toolsRoot = path.join(codeRoot, "tools")): Drift {
  const m = readManifest(codeRoot);
  const actual = digestTools(toolsRoot);
  const stampedMap = m?.tools ?? {};
  const stamped = !!m?.tools && Object.keys(stampedMap).length > 0;
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [name, hash] of Object.entries(actual)) {
    if (!(name in stampedMap)) added.push(name);
    else if (stampedMap[name] !== hash) changed.push(name);
  }
  for (const name of Object.keys(stampedMap)) if (!(name in actual)) removed.push(name);

  return {
    changed: changed.sort(),
    added: added.sort(),
    removed: removed.sort(),
    stamped,
    version: Number(m?.version) || 0,
    actual,
  };
}

/** One line per problem, empty when the manifest describes what is on disk. */
export function driftLines(d: Drift): string[] {
  const lines: string[] = [];
  if (!d.stamped) {
    lines.push("the manifest records no tool digests, so nothing ties its version to the code");
  }
  for (const n of d.changed) lines.push(`changed since version ${d.version} was stamped: ${n}`);
  for (const n of d.added) lines.push(`not covered by the manifest: ${n}`);
  for (const n of d.removed) lines.push(`stamped but no longer present: ${n}`);
  return lines;
}

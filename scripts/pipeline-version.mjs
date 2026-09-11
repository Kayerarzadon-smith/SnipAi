#!/usr/bin/env -S node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON
/**
 * The cutting's version number, and the one command that keeps it honest.
 *
 *   ./scripts/pipeline-version.mjs                  what it says, and whether it still describes the code
 *   ./scripts/pipeline-version.mjs --bump "<why>"   the cutting changed and existing cuts are now wrong
 *   ./scripts/pipeline-version.mjs --restamp        the cutting changed but no rendered file can differ
 *
 * Why this exists: pipeline-version.json is the only thing that can tell
 * Kayer a pipeline fix does not apply to footage he already cut, because
 * every pipeline fix is forward-only. It is also a hand-written integer, and
 * it was already wrong one day after it was written -- E1 changed how every
 * clip is extracted and the manifest still read 2.
 *
 * The manifest now carries a digest of every file in tools/. The suite fails
 * when they disagree, so the choice below is forced rather than remembered.
 * Both answers are one command; only one of them is silence, and silence is
 * no longer available.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  digestTools, readManifest, manifestPath, manifestDrift, driftLines,
} from "../lib/pipelineVersion.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CODE_ROOT = process.env.SNIPAI_CODE?.trim()
  ? path.resolve(process.env.SNIPAI_CODE.trim())
  : path.join(ROOT, "ugc-edit-system");
const TOOLS = path.join(CODE_ROOT, "tools");

const B = "[1m", DIM = "[2m", RED = "[31m", GRN = "[32m", OFF = "[0m";

const args = process.argv.slice(2);
const mode = args[0] ?? "--status";
const why = args.slice(1).join(" ").trim();

const existing = readManifest(CODE_ROOT);
if (!existing) {
  console.error(`${RED}no readable manifest at ${manifestPath(CODE_ROOT)}${OFF}`);
  process.exit(1);
}

function write(next) {
  // version, changed, why, tools -- in that order, because a person reads the
  // top three and a machine reads the fourth.
  const ordered = {
    version: next.version,
    changed: next.changed,
    why: next.why,
    tools: next.tools,
  };
  fs.writeFileSync(manifestPath(CODE_ROOT), JSON.stringify(ordered, null, 2) + "\n");
}

const today = new Date().toISOString().slice(0, 10);

if (mode === "--status") {
  const d = manifestDrift(CODE_ROOT, TOOLS);
  console.log(`${B}pipeline version ${existing.version}${OFF} ${DIM}(changed ${existing.changed ?? "?"})${OFF}`);
  if (existing.why) console.log(`  ${DIM}${existing.why}${OFF}`);
  const problems = driftLines(d);
  if (problems.length === 0) {
    console.log(`  ${GRN}the manifest describes the ${Object.keys(d.actual).length} files in tools/ as they are today${OFF}`);
    process.exit(0);
  }
  for (const p of problems) console.log(`  ${RED}${p}${OFF}`);
  console.log(`\n  ${DIM}Does this change make an already-rendered cut WRONG (not merely different)?${OFF}`);
  console.log(`  ${DIM}  yes -> ./scripts/pipeline-version.mjs --bump "what changed and why it matters"${OFF}`);
  console.log(`  ${DIM}  no  -> ./scripts/pipeline-version.mjs --restamp   (say why in the commit message)${OFF}`);
  process.exit(1);
}

if (mode === "--bump") {
  if (!why) {
    console.error(`${RED}--bump needs a reason: it is what the dashboard shows and what the ledger quotes${OFF}`);
    process.exit(1);
  }
  const version = Number(existing.version) + 1;
  write({ version, changed: today, why, tools: digestTools(TOOLS) });
  console.log(`${GRN}pipeline version ${existing.version} -> ${version}${OFF}`);
  console.log(`  ${DIM}every cut stamped below ${version} will now ask to be rebuilt${OFF}`);
  process.exit(0);
}

if (mode === "--restamp") {
  write({
    version: Number(existing.version),
    changed: existing.changed,
    why: existing.why,
    tools: digestTools(TOOLS),
  });
  console.log(`${GRN}re-stamped at version ${existing.version}${OFF} ${DIM}-- no existing cut is affected${OFF}`);
  console.log(`  ${DIM}say why in the commit message; the manifest's "why" still describes version ${existing.version}${OFF}`);
  process.exit(0);
}

console.error(`usage: pipeline-version.mjs [--status | --bump "<why>" | --restamp]`);
process.exit(1);

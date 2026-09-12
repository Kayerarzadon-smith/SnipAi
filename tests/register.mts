/* `registerHooks` is Node 22.15+/24 and this repo's `@types/node` is 20.14.15
   -- four majors behind the runtime it describes (checked: `node -v` is
   v24.20.0). So the type definitions genuinely do not know about it, and the
   expect-error is about the types lagging rather than about the API being
   absent. It is runtime-verified continuously: the entire suite loads through
   this file, and if `registerHooks` were missing nothing could resolve `@/` at
   all. Narrowed to this one line on purpose -- `@ts-expect-error` fails if the
   error stops happening, so a future `@types/node` bump removes it for us
   rather than leaving a stale suppression. (N18) */
// @ts-expect-error -- see above: @types/node@20 predates registerHooks
import { registerHooks } from "node:module";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { scratchDir } from "./scratch.mts";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

/**
 * No test run may reach the real library. (ledger T6)
 *
 * `lib/paths.ts:resolveDataRoot()` falls back to ~/Movies/SnipAi when
 * SNIPAI_DATA is unset and `projects/` exists there. That is right for the
 * app and lethal for a test: on 2026-09-10 it cost Kayer his entire build
 * history, because `tests/job-stage.test.mts` persists five jobs into a store
 * capped at 40 and `./scripts/qa --full` ran eight times.
 *
 * The obvious fix -- export SNIPAI_DATA from `scripts/qa` -- was rejected.
 * It is one `export` away from being forgotten by the next runner anyone
 * writes, it does nothing for `node --test` run by hand (which is how these
 * are actually run while working), and it would have quietly blinded a guard:
 * `scripts/qa`'s "learned parameters in range" check reads SNIPAI_DATA to
 * find the REAL tuning.json on purpose, and pointing that variable at a
 * throwaway makes it check an empty directory and report nothing wrong.
 *
 * So the guard goes here instead, because this file is the actual boundary:
 * every route into the suite loads it (`scripts/test`, `scripts/qa`,
 * `scripts/guard-ledger.py`, and any `node --import ./tests/register.mts`),
 * and nothing the app ships does. A run that skips it cannot resolve `@/` and
 * therefore cannot import an app module at all -- so there is no third door
 * to remember. This makes the class of bug impossible rather than fixing one
 * instance of it.
 *
 * An explicit SNIPAI_DATA always wins: `tests/regressions/_fixture.mts` sets
 * its own per-test library and must keep working. This only fills the gap
 * where there was no answer and the fallback would have picked his footage.
 */
if (!process.env.SNIPAI_DATA?.trim()) {
  const sandbox = scratchDir("testrun");
  mkdirSync(path.join(sandbox, "projects"), { recursive: true });
  mkdirSync(path.join(sandbox, "state"), { recursive: true });
  process.env.SNIPAI_DATA = sandbox;

  /* Say where the run is pointed, exactly once.
   *
   * The failure being prevented was silent -- the suite wrote his library
   * while looking like any other green run -- so "it went somewhere safe" is
   * not a thing to infer, it is a thing to state.
   *
   * Saying it once takes a little care. `node --test` runs each FILE in its
   * own child process and applies --import to the CHILDREN ONLY (checked:
   * a preload under `node --test` reports NODE_TEST_CONTEXT="child-v8" and
   * runs once per file, never in the runner itself), so this block executes
   * N times per run, not once. Each child getting its own sandbox is the
   * behaviour we want -- per-file isolation is stronger than a shared dir --
   * but seventeen identical lines is the kind of banner people learn to skip.
   *
   * The children of one run share a parent pid, and nothing else about them
   * is common: process.env mutations made by a preload are NOT inherited
   * (an externally-set variable is; an in-process one is not). So the run is
   * identified by ppid, and the first child to create the marker is the one
   * that speaks. O_EXCL makes that a race nobody can lose twice.
   *
   * The marker is deliberately NOT removed at exit. node runs the files in
   * waves, so the speaker is long gone before the last file starts; deleting
   * it on the speaker's way out let the next wave claim it and announce
   * again (observed: three banners in a seventeen-file run). Left in place,
   * it is an empty file in the OS temp dir that the system reaps, and the
   * worst a reused pid can do is make one run quieter than it should be --
   * never make one less isolated. */
  const marker = path.join(os.tmpdir(), `snipai-testrun-said-${process.ppid}`);
  let speaker = false;
  try {
    closeSync(openSync(marker, "wx"));
    speaker = true;
  } catch {
    /* another child in this run already announced it */
  }
  if (speaker) {
    process.stderr.write(`[2mSNIPAI_DATA unset -- test run sandboxed under ${os.tmpdir()}[0m\n`);
  }

  /* No teardown here any more: `scratchDir` registered it. That is the point
     of T19 -- one place removes these, so a new fixture cannot be added
     without one and this file cannot drift from the rest. */
}

/**
 * Let the tests import the app's own modules unmodified.
 *
 * Node 24 strips TypeScript types on its own, so no compiler is needed. What
 * it will not do is guess an extension: the app writes `from "./paths"`
 * because that is what the Next bundler wants, and Node's ESM resolver
 * requires `./paths.ts`. This hook fills in that one gap, and resolves the
 * `@/` alias from tsconfig, so the tests run against exactly the files that
 * ship rather than a copy compiled for testing.
 *
 * Twenty lines here instead of a test framework and its ninety dependencies.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXTS = [".ts", ".tsx", ".mts", ".js"];

function firstThatExists(base: string): string | null {
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = path.join(base, "index" + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

registerHooks({
  /* Typed by hand for the same reason as the import above: @types/node@20 has
     no `ResolveHook` to borrow. The shapes are the two fields this hook
     actually touches, not the whole documented surface -- a wider guess would
     be a claim about an API these types do not describe. */
  resolve(
    specifier: string,
    context: { parentURL?: string },
    nextResolve: (s: string, c?: { parentURL?: string }) => { url: string; shortCircuit?: boolean },
  ) {
    // "@/lib/paths" -> <root>/lib/paths, the alias tsconfig.json declares
    if (specifier.startsWith("@/")) {
      const hit = firstThatExists(path.join(ROOT, specifier.slice(2)));
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
    // "./paths" -> "./paths.ts", but only when it has no extension already
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      const from = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : ROOT;
      const hit = firstThatExists(path.resolve(from, specifier));
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
    // "next/server" -> "next/server.js". Next's package.json exports map is
    // written for a bundler; Node's resolver wants the file. Without this the
    // route handlers cannot be imported at all, and a route handler is just a
    // function over Request -- exactly the thing worth testing.
    if (!specifier.startsWith(".") && !specifier.startsWith("@/") &&
        !specifier.startsWith("node:") && specifier.includes("/") &&
        !path.extname(specifier)) {
      try {
        return nextResolve(specifier + ".js", context);
      } catch {
        // fall through to the normal resolution and let it report the problem
      }
    }
    return nextResolve(specifier, context);
  },
});

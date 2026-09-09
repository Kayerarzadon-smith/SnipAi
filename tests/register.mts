import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

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
  resolve(specifier, context, nextResolve) {
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

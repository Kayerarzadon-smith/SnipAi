/* CATEGORY 019 — every route that parses a JSON body, given JSON that is
   valid but is not an object.
 *
 * `JSON.parse("null")` succeeds. So does `7`, `[]` and `"hello"`. A handler
 * that catches only the parse error and then reads `body.something` throws a
 * TypeError on all four, which reaches the client as a 500 with a stack
 * instead of a 400 saying what was wrong. */
import type { Report } from "../report.mts";

/** Route module, exported method, and a params object it will accept. */
type Target = { file: string; methods: string[]; params: Record<string, string> };

const TARGETS: Target[] = [
  { file: "../../app/api/projects/[project]/pipeline/route.ts", methods: ["POST", "PATCH"], params: { project: "fixture" } },
  { file: "../../app/api/projects/[project]/beats/route.ts", methods: ["POST"], params: { project: "fixture" } },
  { file: "../../app/api/projects/[project]/beats/[label]/route.ts", methods: ["PATCH"], params: { project: "fixture", label: "hook" } },
  { file: "../../app/api/projects/[project]/beats/[label]/candidates/route.ts", methods: ["POST"], params: { project: "fixture", label: "hook" } },
  { file: "../../app/api/projects/[project]/snapshots/route.ts", methods: ["POST"], params: { project: "fixture" } },
  { file: "../../app/api/projects/[project]/graphics/route.ts", methods: ["POST", "PATCH"], params: { project: "fixture" } },
  { file: "../../app/api/projects/[project]/review-action/route.ts", methods: ["POST"], params: { project: "fixture" } },
  { file: "../../app/api/products/route.ts", methods: ["PATCH"], params: {} },
  { file: "../../app/api/references/route.ts", methods: ["POST", "PUT"], params: {} },
  { file: "../../app/api/trash/route.ts", methods: ["POST"], params: {} },
  { file: "../../app/api/learnings/route.ts", methods: ["POST", "PATCH"], params: {} },
];

/** Valid JSON that is not an object, plus the two shapes that are objects but
 *  carry nothing a handler is looking for. */
const BODIES: [string, string][] = [
  ["null", "null"], ["a number", "7"], ["a string", '"hello"'],
  ["an array", "[]"], ["true", "true"],
  ["an empty object", "{}"],
  ["an object of nulls", '{"op":null,"label":null,"beats":null,"id":null,"kind":null}'],
];

export async function run(rep: Report) {
  for (const t of TARGETS) {
    let mod: Record<string, unknown>;
    try { mod = await import(t.file) as Record<string, unknown>; }
    catch (e) {
      rep.blocked("019 chaos", `import ${t.file}`, (e as Error).message);
      continue;
    }
    for (const method of t.methods) {
      const fn = mod[method] as ((r: Request, c: unknown) => Promise<Response>) | undefined;
      if (typeof fn !== "function") {
        rep.blocked("019 chaos", `${method} ${t.file}`, "no such export");
        continue;
      }
      for (const [what, body] of BODIES) {
        const name = `${method} ${t.file.split("/api/")[1]} given ${what}`;
        await rep.checkAsync("019 chaos", name, async () => {
          const req = new Request("http://127.0.0.1:4737/t", {
            method, headers: { "Content-Type": "application/json" }, body,
          });
          let res: Response;
          try {
            res = await fn(req, { params: t.params });
          } catch (e) {
            throw new Error(`threw instead of answering: ${(e as Error).message}`);
          }
          if (!(res instanceof Response)) throw new Error("did not return a Response");
          if (res.status >= 500) throw new Error(`answered ${res.status}`);
        });
      }
    }
  }
}

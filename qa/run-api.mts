/* The route suites need SNIPAI_DATA set BEFORE lib/paths is first imported,
   so they run in their own process against a throwaway library. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-gauntlet-"));
fs.mkdirSync(path.join(root, "projects", "fixture"), { recursive: true });
fs.mkdirSync(path.join(root, "state"), { recursive: true });
fs.writeFileSync(path.join(root, "projects", "fixture", "beats.json"),
                 JSON.stringify({ source: "source.mov", beats: [] }));
process.env.SNIPAI_DATA = root;

const { Report } = await import("./report.mts");
const api = await import("./gauntlet/api.mts");
const bodies = await import("./gauntlet/bodies.mts");
const rep = new Report();
await api.run(rep, Number(process.env.QA_BUDGET ?? 60), root);
await bodies.run(rep);

const c = rep.counts;
console.log(`\nAPI scenarios ${rep.results.length}   pass ${c.pass}   fail ${c.fail}   blocked ${c.blocked}`);
const d = rep.distinctFailures();
if (d.length) console.log(`\n${d.length} distinct failure(s), ${c.fail} occurrence(s):\n`);
for (const f of d) console.log(`  [${f.category}] ${f.name}\n     ${f.detail}\n`);
fs.writeFileSync("qa/last-api.json", JSON.stringify({ counts: c, results: rep.results }, null, 1));
fs.rmSync(root, { recursive: true, force: true });
process.exit(d.length ? 1 : 0);

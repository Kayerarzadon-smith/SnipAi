/* The gauntlet runner. Every suite gets the same report object, so the final
   counts are one tally across everything that ran. */
import { Report } from "./report.mts";
import * as timeline from "./gauntlet/timeline.mts";
import * as adversarial from "./gauntlet/adversarial.mts";
import * as persistence from "./gauntlet/persistence.mts";
import * as scorecard from "./gauntlet/scorecard.mts";

const budget = Number(process.env.QA_BUDGET ?? 120);
const rep = new Report();
const t0 = Date.now();

await (async () => {
timeline.run(rep, budget);
adversarial.run(rep, budget);
persistence.run(rep, budget);
await scorecard.run(rep);
})();

const c = rep.counts;
console.log(`\nscenarios ${rep.results.length}   pass ${c.pass}   fail ${c.fail}   blocked ${c.blocked}   skipped ${c.skipped}   (${((Date.now()-t0)/1000).toFixed(1)}s)`);
const d = rep.distinctFailures();
if (d.length) {
  console.log(`\n${d.length} distinct failure(s), ${c.fail} occurrence(s):\n`);
  for (const f of d) console.log(`  [${f.category}] ${f.name}\n     seed ${f.seed}  ${f.detail}\n`);
}
import fs from "node:fs";
fs.writeFileSync("qa/last-run.json", JSON.stringify({ counts: c, results: rep.results }, null, 1));
process.exit(d.length ? 1 : 0);

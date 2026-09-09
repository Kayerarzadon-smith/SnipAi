/* CATEGORY 015/018 — the scorecard and the numbers on the review screen.
 *
 * These are parsed out of tool STDOUT, which means the contract is a text
 * format nobody validates. A tool that changes a word, prints a warning
 * first, or fails silently produces a number that looks fine and is not. */
import type { Report } from "../report.mts";

export async function run(rep: Report) {
  const { parseVerifyCutOutput, parseCompareToReferenceOutput } =
    await import("../../lib/scorecard.ts");

  /* ---- verify_cut.py ---------------------------------------------------- */
  const verifyCases: [string, string, (m: { value: number | null; note: string }) => void][] = [
    ["a clean cut", "PASS -- no repeated phrases.\n",
      (m) => { if (m.value === null) throw new Error("a clean cut must score"); }],
    ["a failure", "FAIL -- 13 repeated phrase(s):\n  \"not gonna lie\"\n",
      (m) => { if (!/13/.test(m.note)) throw new Error(`the count is lost: ${m.note}`); }],
    ["empty output", "", (m) => { if (m.value !== null && m.value > 0) throw new Error("scored something out of nothing"); }],
    ["a python traceback", "Traceback (most recent call last):\n  File x\nValueError: nope\n",
      (m) => { if (m.value !== null && m.value > 50) throw new Error(`a crash scored ${m.value}`); }],
    ["a warning then a pass", "UserWarning: ignore me\nPASS -- no repeated phrases.\n", () => {}],
    ["ansi colour codes", "[32mno repeated phrases[0m\n", () => {}],
    ["windows line endings", "PASS -- no repeated phrases.\r\n", () => {}],
    ["a huge output", "noise\n".repeat(50000) + "FAIL -- 2 repeated phrase(s):\n", () => {}],
  ];
  for (const [what, out, assertion] of verifyCases) {
    rep.check("015 scorecard", `verify_cut output: ${what}`, () => {
      const m = parseVerifyCutOutput(out) as { value: number | null; note: string };
      if (typeof m.note !== "string") throw new Error("no note");
      if (m.value !== null && (!Number.isFinite(m.value) || m.value < 0 || m.value > 100)) {
        throw new Error(`score out of range: ${m.value}`);
      }
      assertion(m);
    });
  }

  /* ---- compare_to_reference.py ------------------------------------------ */
  const REAL = `                     this cut  reference
  total length        110.85s     67.47s   <-- 64% off
  cuts                 53.00      34.00
  median beat           2.97s      1.95s   <-- 52% off
  seconds per cut       2.09s      1.98s

total length: 64% longer than the reference.
`;
  const compareCases: [string, string][] = [
    ["the real output", REAL],
    ["nothing out of tolerance", REAL.replace(/<-- \d+% off/g, "")],
    ["empty", ""],
    ["only a header", "                     this cut  reference\n"],
    ["a traceback", "Traceback (most recent call last):\nFileNotFoundError: house-style.json\n"],
    ["the pre-fix message", "needs a built cut to compare\n"],
    ["a 0% difference", REAL.replace(/64% off/g, "0% off")],
    ["an absurd difference", REAL.replace(/64% off/g, "999999% off")],
    ["negative numbers", REAL.replace(/110\.85/g, "-110.85")],
    ["NaN in the text", REAL.replace(/2\.97/g, "NaN")],
  ];
  for (const [what, out] of compareCases) {
    rep.check("015 scorecard", `compare_to_reference output: ${what}`, () => {
      const m = parseCompareToReferenceOutput(out) as { value: number | null; note: string };
      if (typeof m.note !== "string") throw new Error("no note");
      if (m.value !== null) {
        if (!Number.isFinite(m.value)) throw new Error(`score is ${m.value}`);
        if (m.value < 0 || m.value > 100) throw new Error(`score out of range: ${m.value}`);
      }
    });
  }

  /* ---- a score must never be invented from a crash --------------------- */
  rep.check("015 scorecard", "a crashed tool does not produce a good score", () => {
    const crash = "Traceback (most recent call last):\nOSError: no such file\n";
    const a = parseVerifyCutOutput(crash) as { value: number | null };
    const b = parseCompareToReferenceOutput(crash) as { value: number | null };
    for (const [name, m] of [["verify", a], ["compare", b]] as const) {
      if (m.value !== null && m.value >= 80) {
        throw new Error(`${name} scored ${m.value} for a crash — a green light for a tool that did not run`);
      }
    }
  });
}

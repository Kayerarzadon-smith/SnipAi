import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CODE_ROOT } from "../lib/paths.ts";
import { parseVerifyCutOutput, parseCompareToReferenceOutput } from "../lib/scorecard.ts";

/* The scorecard reads tool STDOUT with a regular expression.
 *
 * That is a contract held together by wording. Change one character in a
 * print() over in tools/ and the parser stops matching — and it does not
 * fail, it returns `value: null, note: "needs a built cut to..."`, which
 * looks exactly like "you have not built this yet". The Pacing score sat on
 * that message for weeks while the real cause was a path.
 *
 * So the literals live in one place and are checked against the tool that
 * prints them. Editing either side without the other fails here. */

const tool = (name: string) =>
  fs.readFileSync(path.join(CODE_ROOT, "tools", name), "utf8");

describe("the scorecard is coupled to what the tools actually print", () => {
  test("verify_cut.py still prints the PASS line the parser looks for", () => {
    assert.match(tool("verify_cut.py"), /"PASS -- no repeated phrases\."/,
      "verify_cut.py changed its PASS wording — parseVerifyCutOutput will silently report 'needs a built cut'");
    assert.equal(parseVerifyCutOutput("PASS -- no repeated phrases.\n").value, 100);
  });

  test("verify_cut.py still prints the FAIL line the parser looks for", () => {
    assert.match(tool("verify_cut.py"), /FAIL -- \{len\(merged\)\} repeated phrase\(s\)/,
      "verify_cut.py changed its FAIL wording — the repeat count will be lost");
    const m = parseVerifyCutOutput("FAIL -- 3 repeated phrase(s):\n");
    assert.match(m.note, /3 repeated phrase/);
    assert.equal(m.value, 25);
  });

  test("compare_to_reference.py still marks an out-of-tolerance row the same way", () => {
    assert.match(tool("compare_to_reference.py"), /<-- \{|<-- %|"<--"|<--/,
      "compare_to_reference.py no longer emits the '<--' marker the parser counts");
    const m = parseCompareToReferenceOutput("  total length  110.85s  67.47s   <-- 64% off\n");
    assert.notEqual(m.value, null, "an out-of-tolerance row must score");
    assert.ok(m.value! < 100);
  });

  test("a tool that crashed never scores as a pass", () => {
    const crash = "Traceback (most recent call last):\nFileNotFoundError: house-style.json\n";
    for (const m of [parseVerifyCutOutput(crash), parseCompareToReferenceOutput(crash)]) {
      assert.ok(m.value === null || m.value < 80,
        `a crash scored ${m.value} — a green light for a tool that did not run`);
    }
  });

  test("an unrecognised output is null, never a number", () => {
    for (const m of [parseVerifyCutOutput("something else entirely"),
                     parseCompareToReferenceOutput("something else entirely")]) {
      assert.equal(m.value, null, "an unparsed output must not invent a score");
    }
  });
});

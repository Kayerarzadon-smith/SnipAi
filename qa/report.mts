/** The gauntlet's scoreboard. Every scenario reports exactly one outcome, and
 *  "not tested" is a first-class outcome so the final report cannot quietly
 *  round a gap up into a pass. */
export type Outcome = "pass" | "fail" | "blocked" | "skipped";
export type Result = {
  id: string; category: string; name: string; outcome: Outcome;
  detail?: string; seed?: number;
};

export class Report {
  results: Result[] = [];
  private n = 0;

  record(category: string, name: string, outcome: Outcome, detail?: string, seed?: number) {
    this.n += 1;
    this.results.push({ id: `T${String(this.n).padStart(4, "0")}`, category, name, outcome, detail, seed });
  }
  /** Run a check that throws on failure. */
  check(category: string, name: string, fn: () => void, seed?: number) {
    try { fn(); this.record(category, name, "pass", undefined, seed); }
    catch (e) { this.record(category, name, "fail", (e as Error).message, seed); }
  }
  async checkAsync(category: string, name: string, fn: () => Promise<void>, seed?: number) {
    try { await fn(); this.record(category, name, "pass", undefined, seed); }
    catch (e) { this.record(category, name, "fail", (e as Error).message, seed); }
  }
  blocked(category: string, name: string, why: string) { this.record(category, name, "blocked", why); }

  get counts() {
    const c = { pass: 0, fail: 0, blocked: 0, skipped: 0 };
    for (const r of this.results) c[r.outcome] += 1;
    return c;
  }
  failures() { return this.results.filter((r) => r.outcome === "fail"); }
  /** Distinct failures — a property test that fails 300 times is one defect. */
  distinctFailures() {
    const seen = new Map<string, Result>();
    for (const f of this.failures()) {
      const key = `${f.category}::${f.name.replace(/#\d+/g, "#N")}::${(f.detail ?? "").slice(0, 80)}`;
      if (!seen.has(key)) seen.set(key, f);
    }
    return [...seen.values()];
  }
}

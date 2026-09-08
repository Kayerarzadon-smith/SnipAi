import path from "node:path";
import { STATE_ROOT, ensureStateDir } from "./paths";
import { readJson, writeJsonAtomic } from "./jsonStore";
import type { LearningPreference } from "./types";

const FILE = path.join(STATE_ROOT, "learnings.json");

// Seeded from NOTES.md's "Learning loop" section — real documented intent
// from the handoff, not invented copy.
const SEED: LearningPreference[] = [
  {
    id: "seed-expressive-delivery",
    category: "take-selection",
    text: "Prefer expressive, energetic delivery over a perfectly clean pause",
    active: true,
    source: "seed",
    createdAt: "2026-09-04T00:00:00.000Z",
  },
  {
    id: "seed-no-stitching",
    category: "cutting-rules",
    text: "Never stitch two attempts at the same sentence — split the beat or drop it instead",
    active: true,
    source: "seed",
    createdAt: "2026-09-04T00:00:00.000Z",
  },
  {
    id: "seed-pacing-reference",
    category: "pacing",
    text: "Match reference delivery speed; flag reads that run slower than house style",
    active: true,
    source: "seed",
    createdAt: "2026-09-04T00:00:00.000Z",
  },
];

export function loadLearnings(): LearningPreference[] {
  return readJson<LearningPreference[]>(FILE, SEED);
}

const CATEGORY_KEYWORDS: Record<LearningPreference["category"], string[]> = {
  "take-selection": ["take", "delivery", "expression", "energy", "clean", "flat", "animated"],
  "cutting-rules": ["cut", "stitch", "clip", "trim", "word", "beat", "pause"],
  pacing: ["pace", "pacing", "speed", "slow", "fast", "rhythm", "music"],
  other: [],
};

/** Heuristic keyword tagging, not an LLM call — a real future enhancement,
 * not something to fake as "AI learning detected" today. */
export function suggestCategory(text: string): LearningPreference["category"] {
  const lower = text.toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === "other") continue;
    if (words.some((w) => lower.includes(w))) return cat as LearningPreference["category"];
  }
  return "other";
}

export function addLearning(text: string, category?: LearningPreference["category"]): LearningPreference {
  ensureStateDir();
  const all = loadLearnings();
  const pref: LearningPreference = {
    id: `pref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: category ?? suggestCategory(text),
    text,
    active: true,
    source: "captured",
    createdAt: new Date().toISOString(),
  };
  all.push(pref);
  writeJsonAtomic(FILE, all);
  return pref;
}

export function setLearningActive(id: string, active: boolean): LearningPreference[] {
  ensureStateDir();
  const all = loadLearnings().map((p) => (p.id === id ? { ...p, active } : p));
  writeJsonAtomic(FILE, all);
  return all;
}

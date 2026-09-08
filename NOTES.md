# SnipAi — handoff notes for Claude Code

## What this is
A UGC video-editing automation system (currently a folder of Python/ffmpeg
tools driven through Claude Code — see `ugc-edit-system/`) that Kayer wants
turned into a real app called **SnipAi**: a review/approval interface that
sits on top of the existing pipeline so he can approve or correct AI-edited
video cuts without touching the terminal, JSON, or scripts directly.

Eventually SnipAi's approval engine is meant to generalize beyond video —
to a broader "AI workforce control center" reviewing work from multiple
agents (video editing, Amazon/commerce, business ops, social posting), but
the video review flow is the first module to build.

## What's included in this zip
- `ugc-edit-system/` — the existing pipeline: CLAUDE.md (the editing method/
  house style rules), README.md, SETUP.md, `.claude/commands/` (the current
  `/new-video`, `/find-takes`, `/build`, `/match-reference` slash commands),
  and `tools/*.py` (transcribe, silence-map, take-scanning, cut-building,
  verification, reference-matching). Raw/finished video and audio files were
  left out (huge, iCloud-only, not needed to understand or extend the code).
  One real example project's data is included: `projects/medicube-egf-serum/`
  (`beats.json` — the 22-beat edit list with timecodes, `SELECTS.md` — notes
  on which take was picked per beat, including one unresolved beat).
- `prototype/snipai.html` — a single-file clickable HTML/CSS/JS prototype of
  the SnipAi UI (dashboard, review screen, take-picker, learnings, agents).
  Not wired to any backend — it's a design reference for layout, interaction
  flow, and visual language (dark-first, warm gold accent, Fraunces/IBM Plex
  type pairing), built using the real Medicube EGF Serum beat data so the
  screens aren't lorem-ipsum.

## The core idea (from Kayer, verbatim intent)
> The problem isn't the underlying system. The problem is the interface.

Current pipeline: raw footage → transcribe → identify beats → find the
correct take → cut → verify → render, run through VS Code / Claude Code /
terminal / Python / JSON / ffmpeg.

Wanted: an app that hides all of that unless you want to see it, and turns
review into three levels of granularity:

1. **Level 1 — whole video.** Watch the cut, then: Approve / Needs fixes /
   Trash. Most videos should end here.
2. **Level 2 — problem sections.** If "needs fixes," scrub the timeline and
   mark roughly where it's wrong. No detailed diagnosis required yet.
3. **Level 3 — line-by-line diagnosis.** Only for marked beats: a
   checklist (wrong take / started too early or late / cut off a word /
   awkward pause / repeated / bad delivery / audio or video problem / other)
   plus a free-text box. The checklist should adapt to what the AI already
   detected (e.g. "this cut sits 0.03s from a word boundary — did the last
   word sound clipped?") rather than always being generic.

**Take picker.** For beats with multiple candidate takes (the raw footage
usually has each line said 2–5 times), show the actual candidate takes side
by side with their known issues (dead air, false start, confidence score),
let Kayer approve the AI's pick or choose a different one — this is meant to
replace the current system's `SELECTS.md`-note-with-a-timecode workflow for
ambiguous beats like Beat 7 (NAD+ benefit) in the sample project.

**Explainability.** Every AI pick should show its reasoning as a short
checklist (why this take: complete sentence, no repeated phrase, no clipped
word, cleanest audio, pacing vs. house style) with a confidence score, not
just a silent selection.

**Learning loop.** When Kayer rejects an AI pick and explains why in his own
words, the app should surface what it inferred as a durable preference
("you prefer expressive delivery over a perfectly clean pause") and let him
save it — for this agent only, or for all video agents — rather than losing
that judgment call every time.

**Autonomy policy** (replaces the current CLAUDE.md's blanket "work
autonomously, don't ask" instruction) — three tiers by AI confidence:
- 🟢 **Green** (>95% confidence, no flags, reversible): proceed automatically.
- 🟡 **Yellow** (70–95%, multiple valid creative options, or a possible
  quality issue): submit for review, don't block on it.
- 🔴 **Red** (<70%, no clean take exists, would need to rewrite content,
  or an irreversible/publish/spend action): requires explicit approval.

**Quality scorecard.** Every submitted cut gets scored before Kayer sees it
(script match, complete sentences, repeated phrases, word cutoffs, take
quality, pacing vs. house style, audio) so his attention goes to whatever
scored lowest or got flagged, not to re-checking everything from scratch.

## Proposed app structure
- **Dashboard** — queue of everything awaiting approval, grouped by urgency
  (needs approval / AI fixing in progress / completed).
- **Projects** — one per product/video: raw footage, script, takes, AI edit,
  review, approved versions.
- **Review** — the core screen: player + transcript broken into beats with
  status icons, quality scorecard sidebar, the 3-level review flow above.
- **Learnings** — the accumulated preference model, organized by category
  (take selection, cutting rules, pacing), each preference traceable to a
  real correction.
- **Agents** — eventually one roster covering all of Kayer's agents (video
  editing, Amazon, business, commerce, social), each feeding the same
  approval engine with an agent-specific review questionnaire.

## Explicit instruction from Kayer
Don't throw away the existing pipeline. Keep the transcription, take-scanning,
silence detection, style-matching, cut-building, and output-verification
logic in `ugc-edit-system/tools/` as the backend — build the approval/review
UI as a layer on top of it, not a replacement for it.

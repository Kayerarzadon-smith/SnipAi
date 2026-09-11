# SnipAi — Strategy Report

**Written 2026-09-10.** No `SNIPAI-ANALYSIS-BRIEF.md` exists in the repo, so
this document is standalone — reconciling against nothing except the code,
`DOCKET.md`, `audits/LEDGER.md`, `qa/BUGS.md`, and `audits/2026-09-08.md`.

Scope note on sourcing: `audits/LEDGER.md` explicitly warns its own
open/fixed statuses can be stale. Every status cited below that matters to a
decision was checked against the current file, not copied from the ledger —
citations point at the actual line. Where I did not re-verify a ledger row
myself, I say so.

---

## Executive summary — where this actually stands

SnipAi is a real, working, single-user Mac app with a genuinely uncommon
architecture: a Next.js 14 standalone server plus a Swift/WKWebView native
shell, driving a Python/ffmpeg/faster-whisper pipeline, **entirely offline**.
It does the hard thing — pick the best take of a talking-head line, trim dead
air, hand you a reviewable cut — and the pipeline math is the best-tested
part of the codebase: 248 automated tests (173 Node + 75 Python), all
passing as of this run (`./scripts/test`, verified live), covering undo,
split, corruption recovery, no-op detection, and edge-case timing.

But "production ready" here needs a definition, because there is no
production to be ready for yet. This is a personal tool, used by one person,
on one Mac, with no accounts and no network calls except the pipeline's own
local subprocess spawns. Everything below is graded against two different
bars: **is it solid enough for Kayer to trust with his own footage today**,
and **what would it take to hand it to someone else** — because those are
different amounts of work and the gap between them is the whole story of
this report.

The honest state, no sugar:

- **The core loop works and is tested.** Import → transcribe → draft beats →
  build → review → export is real, wired end to end, and the math bugs found
  in it (dead air left in cuts, clipped word endings, duplicate audio on
  split) have mostly been found and fixed with regression tests to prove it.
- **The review UI — the actual product idea — is the least finished part of
  the app.** `DOCKET.md`'s own M3 milestone says Level 2 of the three-level
  review flow is reachable only by pressing the `m` key, with no button
  (`qa/BUGS.md` H3). Two data-loss-adjacent bugs are still open in the
  timeline editor: a trim handle that runs away and collapses a clip to
  nothing (`app/components/Timeline.tsx:266`, ledger C1), and an undo stack
  that stops working after the first trim of a session
  (`app/projects/[project]/review/page.tsx:1017`, ledger C2). Both are
  **open today**, not historical.
- **There is no client-side test harness at all.** Every one of the 248
  automated tests exercises server logic or pipeline math. `Timeline.tsx`
  (906 lines), `review/page.tsx` (2,614 lines) and every other React
  component have zero automated coverage. `qa/BUGS.md` names this directly:
  "None of these are testable yet: there is no DOM harness in the repo."
  Nineteen-plus client bugs (C1–C21) sit in a category the test suite
  structurally cannot see.
- **Distribution is blocked by real, external things, not code.** No Apple
  Developer account means no code signing, no notarization, no handing this
  to another human without them fighting Gatekeeper. No universal binary
  means it runs under Rosetta on Apple Silicon today. These are named,
  scoped, and cheap to fix — but they are not done.
- **Roughly a third of the client is a full two-track NLE** (`Timeline.tsx`
  + `timelineLayout.ts` + `TrimWave.tsx`, ~1,540 lines) that the project's
  own house-style doc arguably contradicts — `NOTES.md` asks Level 2 review
  for "mark roughly where it's wrong, no detailed diagnosis required yet,"
  and what got built is drag-to-trim, drag-to-reorder, five zoom levels, and
  a corner-drag fade handle that **was silently broken for weeks**
  (`qa/BUGS.md` C3, since fixed per `DOCKET.md`'s Done list). This is
  `DOCKET.md`'s own B1 bloat item, and it is unresolved: "keep span-delete
  and the nudge; question reorder, fades, detached audio, five zoom levels."
- **There is no CI.** No `.github/workflows/`, no CI config of any kind
  found anywhere in the repo. The only automated gate is a 2-second
  pre-commit hook (`.githooks/pre-commit`) that runs `./scripts/qa --fast`
  and blocks only on *new* regressions against a baseline
  (`audits/.qa-baseline`) — it explicitly does not run the type check or the
  test suite. `./scripts/test` and `./scripts/qa --full` exist and are good,
  but nothing runs them except a human typing the command.

None of this is unusual for a solo-founder personal tool six weeks in. It is
unusual to call it "production ready" without naming exactly what isn't. The
rest of this report names it.

---

## 1. Production readiness assessment

### Security

There is no attack surface in the traditional sense — no auth, no accounts,
no network listener beyond `127.0.0.1` (`native/main.swift:409`,
`env["HOSTNAME"] = "127.0.0.1"`). The two things that matter for a local app
handling arbitrary files are path traversal and command injection, and both
were checked:

- **Path traversal is handled.** `lib/paths.ts:97-105`,
  `resolveMediaPath()`, resolves the requested path against `PROJECTS_ROOT`
  and rejects anything that doesn't start with it — blocking `../` and
  symlink escapes. `app/api/media/[...path]/route.ts:30-36` wraps the call
  in a try/catch that returns 403 on failure. Project names are constrained
  to `^[a-zA-Z0-9_-]+$` (`lib/paths.ts:73`), and uploaded filenames are
  reduced to a safe basename before touching disk
  (`app/api/projects/route.ts:132`: `path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_")`).
  This is solid, well-commented defensive code — better than most local
  tools bother with.
- **Command injection risk is low but not zero.** Every shell-out goes
  through `runCommand`/`runTool` in `lib/pipeline.ts`, which uses
  `spawn`/`spawnSync` with an argument array, never a shell string
  (`lib/pipeline.ts:87`: `spawn("nice", ["-n", "10", cmd, ...args], ...)`)
  — this is the correct pattern; there's no shell interpolation for an
  attacker (or a malformed filename) to exploit.
- **Upload validation exists and is reasonable.** File extension is checked
  against an allowlist shared between server and Swift
  (`lib/videoFiles.ts:16`, six containers), empty files are rejected
  (`app/api/projects/route.ts:90,153`), and disk space is pre-checked before
  the stream starts (`app/api/projects/route.ts:101-120`, refusing with 507
  if there isn't room). There is **no upper size cap** anywhere in the
  import path — a user could import a 200GB file and the only backstop is
  "does the disk have room." For a single-user tool that's a reasonable
  tradeoff, not a defect.

### Auth

None exists, by design — this is correct for a single-user local app and
changing it is not on the roadmap. If SnipAi ever became multi-user or
networked (a real product decision, not a code change), it would need: a
real auth layer (the current server trusts every request from
`127.0.0.1` unconditionally), per-user data isolation (today one
`~/Movies/SnipAi` tree serves the whole app — `lib/paths.ts:47`), and the in
-memory job queue (`lib/jobs.ts:28`, one `Map` per process, one job running
at a time by design at `lib/jobs.ts:111`) would need to become a real queue
with per-user or per-tenant scoping. None of this is small, but none of it
needs to happen for the app as it exists today.

### Error handling

This is a genuine strength, and it's the part of the codebase where the
comments read like a debugging diary — which is exactly what you want in
error-handling code. Concretely:

- `lib/requestBody.ts` — `readJsonObject()` fixed a real class of bug
  (`JSON.parse("null")` succeeds, so does `7` and `[]`, and `body.something`
  on any of those throws an uncaught TypeError that became a raw 500). It's
  applied across ten routes per `qa/BUGS.md` BUG-005.
- `lib/jobs.ts:217-229`, `failJob()` — confirmed fixed. It now calls
  `persist()` like every sibling mutator; the ledger's S2 entry
  ("`failJob` never persists") is accurate as `fixed`, and I verified the
  live code matches.
- `lib/pipeline.ts:110-201` — the timeout/watchdog logic is unusually
  thoughtful: it distinguishes "still working" from "hung" by silence
  rather than wall-clock duration (a flat timeout once killed a real
  601-second 4K build), and it **warns before killing**
  (`lib/pipeline.ts:158-165`) rather than dying silently — a fix documented
  in `qa/BUGS.md` BUG-001 and BUG-004 after it actually happened to Kayer's
  own import.
- Two **open, confirmed-current** defects worth naming plainly:
  `lib/jobs.ts:184` region and `api/projects/[project]/pipeline/route.ts:136`
  are both still exactly as the ledger describes — S1 (undo strips holes/
  fades/detached-audio fields) is a deliberate `wontfix`, reasoned through
  in `qa/BUGS.md` ("a server merging holes back in from disk would make
  every cut permanent — a worse bug"), which I think is the right call.
  S4 (`lib/pipeline.ts:149`, unbounded stdout accumulation over a 6-hour
  cap) is real and still open — a very long-running job could theoretically
  blow up memory, though in practice nothing runs anywhere near 6 hours
  today.

### Observability

There is none, and for a local-only tool that's defensible today but will
become a real liability the moment this leaves Kayer's Mac. Concretely
present: a rolling `job.log` per job (`lib/jobs.ts:12`, kept to the last 40
jobs), a raw `.snipai.log`/`.snipai-window.log` written by the launch
scripts, and that's it. No crash reporter, no telemetry, no error
aggregation. If this ships to even one other person, "it doesn't work" with
no attached log is undebuggable remotely. A real launch needs, at minimum,
an opt-in crash reporter (Sentry or similar — there are macOS-native and
Electron-adjacent SDKs that work fine in a WKWebView shell) and a "send me
the log" button in the UI, both off by default and clearly disclosed, given
the whole pitch of this product is "your footage never leaves your machine."

### CI/CD

Confirmed: **no CI configuration exists anywhere in the repo** — no
`.github/workflows/`, no `.gitlab-ci.yml`, nothing under any common CI path.
`package.json` scripts (`test`, `qa`, `qa:watch`) exist and are good; a
`postbuild` hook runs `./scripts/qa --fast` after `next build`
(`package.json:8`). The one thing that runs automatically is the
`.githooks/pre-commit` hook, and even that is deliberately narrow — it
explicitly skips the type checker and the full test suite ("It deliberately
does NOT run the type check or the test suite. Those belong in
`./scripts/qa` before you push, not in the way of every commit") and only
blocks on regressions *new* since `audits/.qa-baseline`. `./scripts/bundle-app`
does gate on `./scripts/qa --full` before producing a distributable bundle
(`scripts/bundle-app:22-26`), which is the right instinct — the one
artifact that leaves the machine gets the full pass — but that only runs
when someone runs `bundle-app`, not on every push, because there is no
"every push" here; this is a local checkout, not a hosted repo with a
remote CI runner attached.

### Data handling

Confirmed by reading the actual library on disk: `~/Movies/SnipAi/`
(`lib/paths.ts:47`), currently 8.9GB across projects on this Mac. The safety
net is genuinely layered, and it's the best-engineered part of the app:

- **Snapshots** (`lib/snapshots.ts`) — every write to `beats.json` is
  copied aside first (`snapshots.ts:88`), deduplicated so a no-op write
  doesn't burn a slot (`snapshots.ts:99-106`), capped at 60
  (`snapshots.ts:23`), and restorable — and restoring itself takes a
  snapshot first (`snapshots.ts:188`), so recovery can't strand you. All ten
  of its behaviors are covered in `tests/snapshots.test.mts`.
- **Trash** (`lib/trash.ts`) — five-day soft delete with an expiry read out
  of the folder name rather than mtime (a copy operation resets mtime,
  which would otherwise silently reset the clock — the same lesson
  `snapshots.ts:43-48` documents independently). Covered by
  `tests/trash.test.mts`.
- **Corruption handling** — `tests/corrupt-project.test.mts` covers 7
  corruption shapes; the real incident behind it (`qa/BUGS.md` BUG-002) was
  a stray comma in a hand-edited `beats.json` that used to 500 the entire
  dashboard and take every *other* project down with it. Fixed:
  `readBeats()` now distinguishes missing/broken/ok and a broken project
  stays on the queue saying what's wrong instead of vanishing.
  `review-state.json` corruption (BUG-008, ledger S10) — confirmed fixed:
  `tests/review-state-integrity.test.mts` has 17 passing cases, and I
  verified this is one of the two currently-fixed rows the pipeline test
  run corroborates.
- **What's still genuinely open**, verified live: S18 (video range
  clamping) and S19 (moov-atom/faststart on the concat step) are both
  **confirmed fixed in the current code** — I read
  `app/api/media/[...path]/route.ts:86` and it does clamp `end` to
  `stat.size - 1`, and `lib/pipeline.ts:533` does pass
  `-movflags +faststart` on the concat step. E1 (beats losing the final
  20-30ms of a word to frame quantization in `build_cut.py`'s ffmpeg call)
  has a fix written per the ledger but is explicitly **not yet confirmed
  against a real render** — I did not independently verify this one against
  real footage, and the ledger says the same.

### Scaling

Single-process, single-user, and explicitly designed around a 4-core/8GB
Mac being driven into swap by two heavy jobs at once — the whole reason
`lib/jobs.ts:111`'s `isBusy()` exists is to serialize Whisper and ffmpeg so
"the machine stays usable throughout" (comment on `lib/jobs.ts:105-110`).
Concretely:

- **Large files**: the import path streams to disk in 64KB chunks
  (`app/api/projects/route.ts:139`, via Node's `pipeline`/backpressure) —
  this was a real fix for a real incident (`audits/2026-09-08.md` S3: a
  1.4GB upload used to double-buffer through `arrayBuffer()`, ~2.8GB
  resident on an 8GB machine, OOM). Confirmed fixed for the main import
  path; **confirmed still open** for the reference-video upload path —
  `app/api/references/route.ts:84` still does
  `fs.writeFileSync(..., Buffer.from(await file.arrayBuffer()))`, buffering
  the whole file in memory, capped at 600MB
  (`references/route.ts:79`) so the blast radius is smaller than the
  original bug, but the pattern is unfixed. This matches the ledger's S3
  note exactly.
- **Long jobs**: the idle/hard-timeout watchdog in `lib/pipeline.ts:123-172`
  is well-designed (silence-based, not duration-based, with a mandatory
  warning before any kill) and is the one part of this app I'd call
  genuinely mature.
- **Concurrent jobs**: `isBusy()`/`runningJob()` enforce one heavy job at a
  time app-wide — correct for the target hardware, but confirmed **not**
  enforced everywhere: ledger S15, unverified by me directly but consistent
  with what I read, names six routes (filmstrip, poster, peaks, graphics
  scan, learn, voice) that spawn ffmpeg/Whisper without checking
  `runningJob()` first.

### Dependency health

- **Node**: `next@14.2.35`, `react@18.3.1`, `react-dom@18.3.1`
  (`package.json:16-18`). Next.js is one major version behind current
  (Next 15 has been out for a while); React 18 vs. 19 similarly. Neither is
  a security problem today, but it's technical debt that compounds — a
  standalone-output Next 14 app upgrading to 15 later is real, scoped work,
  not a version bump.
- **Python**: two direct pins, `faster-whisper==1.2.1` and
  `imageio-ffmpeg==0.6.0` (`ugc-edit-system/requirements.txt`), deliberately
  pinned with a comment explaining why: "this list is now part of what gets
  shipped inside the app bundle: an unpinned install would put a different
  transcriber in front of a person than the one the edits were tuned
  against." That's the right instinct for a bundled desktop app.
- **Install footprint is real and worth being honest about.** This is not
  `npm install` and go — it's a Python venv, `faster-whisper` (which pulls
  `ctranslate2`, `onnxruntime`, `av`, `numpy`, `tokenizers` underneath it),
  and ffmpeg via `imageio-ffmpeg` because Homebrew can't complete an
  `ffmpeg` install on this specific Mac's Tier-3 Homebrew classification
  (`ugc-edit-system/CLAUDE.md:117-123`). For Kayer, this is already set up
  and invisible. For anyone else, this is the single biggest practical
  barrier to distribution, bigger than the code-signing blocker — which is
  exactly why `scripts/bundle-app` exists.

### Distribution readiness — what `scripts/bundle-app` actually does today

I read the script rather than trusting the docket summary. It's more built
than "blocked" suggests: it downloads a relocatable, statically-linked
CPython 3.11.16 from `astral-sh/python-build-standalone`
(`scripts/bundle-app:78-97`, pinned by release date for reproducibility),
installs the pipeline's pinned dependencies into it, and bundles the Next
standalone server, the Python runtime, and (per its own comments) ffmpeg —
all into `SnipAi.app/Contents/Resources`, explicitly designed to need
nothing from `~/Projects/SnipAi` so the `.app` can be dragged anywhere. It
also gates on the full QA pass before bundling and checks for two real
failure modes that already happened once each (a self-referential copy of
the app tracing into its own output, and a GET route Next silently
prerenders into a frozen response). This is careful, first-party work, not
a stub.

What it cannot do, and what `DOCKET.md`'s Blocked table names correctly:

- **B2 — no Apple Developer account ($99/yr).** Without one, the bundle
  cannot be code-signed or notarized. Handing this `.app` to anyone else
  today means they fight Gatekeeper (right-click → Open, "Apple could not
  verify...", the works) on first launch, if it launches at all —
  `audits/2026-09-08.md` P16 also flags that the bundle currently ships
  with no `Info.plist` and requests microphone access
  (`native/main.swift:152`) with no `NSMicrophoneUsageDescription` string,
  which is a **hard TCC crash**, not a warning, the first time mic
  permission is requested on someone else's Mac. That's a code fix, cheap,
  but currently real and currently open per the audit — I did not
  independently re-verify P16 against the live `bundle-app` output, and
  flag that.
- **B3 — no auto-update (Sparkle).** Needs B2 first; otherwise a signed
  update feed has nothing to verify against.
- **B4 — no universal binary.** `scripts/bundle-app:33-38` does branch on
  `uname -m` and builds an `arm64` or `x86_64` CPython — so the *Python*
  runtime is architecture-correct — but the docket's claim that the app
  "runs today under Rosetta" on Apple Silicon is about the bundled Node
  binary/native wrapper, which I did not independently re-verify by
  running `file` against a built `.app`'s Node executable. Treating this as
  accurate per the docket, since it's a specific, checkable claim someone
  clearly already checked.

These three are exactly what they're labeled: blocked on money and
process, not on code quality. B2 in particular is a same-evening fix —
buy the account, start the 24-48hr Apple review clock, and B3/B4 become
tractable engineering tasks instead of blocked ones.

---

## 2. Competitive landscape

SnipAi's honest competitive position: **there is no direct competitor doing
"local, offline, best-take-selection for talking-head UGC" as a packaged
product.** Every named competitor below is cloud SaaS, and every one of them
solves a related but different problem — clipping long-form into short-form,
or auto-captioning, rather than picking the best recitation of a scripted
line from several takes and assembling a tight single cut. That gap is real
and it's SnipAi's actual differentiation, not a marketing angle.

| Tool | What it does | Pricing (as found) | Funding/positioning | vs. SnipAi |
|---|---|---|---|---|
| **Opus Clip** | Finds highlights in long-form video, cuts them into short clips, captions, AI virality score, auto-posts | Free (60 credits/mo); Starter $15/mo; Pro $29/mo ($14.50/mo annual) | $68M raised, SoftBank Vision Fund in Series A; 10M+ users by early 2025 | Cloud, credit-metered, built for repurposing *existing* long content, not for picking a take of a *scripted* line. No local option. |
| **Klap** | Same category as Opus — long-form → short clips, auto-reframe, virality scoring, AI dubbing in 29 languages | $17–$113/mo depending on tier | Not disclosed in search | Cloud, per-upload-minute pricing model; stronger on multi-language dubbing than SnipAi has any plan to be. |
| **Descript** | Transcript-based editing — edit the video by editing the text; strong for talking-head cleanup, "Studio Sound," overdub | $0–$65/user/mo (2025 overhaul moved from "transcription hours" to metered AI credits) | $104M raised, OpenAI Startup Fund led the $50M Series C | Closest *philosophical* cousin — transcript-driven editing of a single speaker. But it's a general editor, not opinionated about "best take of this line," and it's cloud, credit-metered, cross-platform. |
| **CapCut** | Full free editor, auto-captions, trending effects, long-to-short AI workflows | Free; Pro $9.99/mo | ByteDance-owned | The default free option and hardest to beat on price — but general-purpose, no best-take logic, mobile-first. |
| **Submagic** | Captions + B-roll + zoom + eye-contact correction, batch shorts pipeline | Starter $19/mo, Pro $39/mo (or $12/$23 annual), Business $69/mo | Not disclosed | Captioning/polish layer, not a cutting tool — usually used *after* an edit like SnipAi's, not instead of it. |
| **Veed.io** | All-in-one online editor: subtitles, voiceover, translation, AI avatars | Free (720p, watermark, 10 min cap); Lite $19/mo; Pro $49/mo | $35M from Sequoia; 10M+ MAU | Broad, general-purpose, used by brands like P&G/Pinterest — not the niche SnipAi is in. |
| **Riverside.fm** | Remote multi-track recording + "Magic Clips" AI highlight extraction | Free tier; Pro $14–$29/mo depending on source | Not disclosed | Solves the *recording* problem SnipAi doesn't touch, plus AI clipping post-record. Different point in the workflow. |
| **Vizard.ai** | Long-form → short clips, scene detection, reframing, captioning | Not fully disclosed | Palo Alto-based, founded 2021 | Same category as Opus/Klap. |
| **Creatify** | Paste a product URL → generated UGC-style ad with an AI avatar | Not checked in depth | — | Solves an adjacent but different problem: *generating* synthetic UGC from a product link, not editing *real* footage someone shot. Worth watching as the TikTok Shop-adjacent tool closest to SnipAi's audience, but it competes on "you don't need a real creator" — the opposite bet from SnipAi's, which assumes real footage exists and needs editing. |
| **Pippit** (CapCut team) | Built specifically for marketplace/TikTok Shop sellers | Not checked in depth | ByteDance-adjacent | The closest named tool to "TikTok Shop native," worth a deeper look before committing to positioning, since it's built by the team that owns the platform SnipAi's output targets. |

Two smaller, less-verified data points from search results worth flagging
rather than treating as settled: a product called "Reelify AI" markets
itself explicitly as local/offline AI clipping for Mac, and search results
mentioned an "Apple Creator Studio" as a 2026 native macOS AI tool — I could
not corroborate the latter against anything I'd call a primary source and
would not build a competitive strategy around it without checking directly;
flagging it here only so it isn't silently dropped.

**What's genuinely different about SnipAi, verified against the code, not
just the pitch:**

- **100% local, no cloud AI calls** except the one parked feature (P1, AI
  overlay generation) — and that one is inert. I checked: `graphics/route.ts`
  and `lib/imagegen.ts` exist and are wired for it, but per `DOCKET.md`
  Parked table, "he called it off after seeing the per-image cost... one
  key away," meaning there's no live API key and no calls happening. Every
  competitor above is cloud SaaS with per-minute or credit-metered pricing.
  SnipAi has **zero marginal cost per video** once the Mac has the tools
  installed — a structural cost advantage no competitor can easily match,
  because their business model *is* the cloud compute markup.
- **Built around "one clean recitation of each line," not generic
  auto-captioning.** `ugc-edit-system/CLAUDE.md`'s house style (measured
  off real reference footage: 67s finished from ~333s raw, ~34 cuts, no
  captions/overlays/PIP) is a specific, opinionated editing philosophy none
  of the above tools encode. Competitors optimize for "find the exciting
  moment in something already coherent." SnipAi optimizes for "this line
  was said five times, which take is the one worth keeping" — a genuinely
  different problem.
- **Works with irreplaceable raw footage entirely on-device** — relevant to
  anyone protective of unreleased product footage, which is exactly TikTok
  Shop affiliates working under embargo or NDA with brands.

**Honest disadvantages, also verified against the code:**

- **Mac-only, single-machine.** No web app, no Windows build, no mobile.
- **No social publishing integration.** Confirmed live:
  `app/api/connections/route.ts` and `lib/connections.ts:12-21` — all eight
  platforms (TikTok Shop, Instagram, Pinterest, Trybe, X, Snapchat,
  Facebook, Amazon Storefront) are hardcoded `not_connected`, GET-only, no
  credential fields anywhere in the app. Every competitor above ships
  direct publishing; SnipAi ships a file on disk.
- **No team/multi-user features**, which is fine for the current market
  (solo creators) but a real gap the moment "sell to an agency" comes up.
- **The core review UI — the actual product thesis — is less finished than
  the editing engine underneath it.** This is the one that should worry a
  prospective buyer or user most, because it's not a missing nice-to-have,
  it's the unfinished part of the *headline feature*.

---

## 3. Go-to-market, cost, timeline

### The real strategic fork

Three honest paths, not a recommendation disguised as an inevitability:

1. **Stay a personal tool.** Zero marginal cost, zero support burden, zero
   distribution risk. The Apple dev account and universal binary become
   optional nice-to-haves, not blockers. This is the only path where
   today's code quality — strong pipeline, half-built review UI, no CI, no
   client tests — is *already* good enough, because the only user is the
   person who can read the logs and knows which bugs to route around.
2. **Sell to solo UGC creators/affiliates as a niche Mac app.** Smallest
   step up from today. Requires: B2 (Apple dev account), fixing the
   confirmed-open client bugs (C1, C2 especially — both are trim/undo
   correctness bugs that would burn a stranger's trust on day one), some
   floor of onboarding (the Python/ffmpeg/Whisper install footprint has to
   become invisible — `scripts/bundle-app` is most of the way there but
   B2/P16 block a clean first launch), and *a* support channel, even if
   it's just an email address Kayer checks. Pricing would likely mirror the
   category: a one-time Mac App Store-style price ($40–$80) or a low
   monthly ($9–$15) undercutting every cloud competitor above on the
   strength of "no per-minute cost, keeps your footage private" — both of
   which are true today, not aspirational.
3. **Open up multi-platform / broader product.** Real product, real
   funding conversation, real team. Not a reasonable near-term goal from
   here — the code today doesn't have CI, doesn't have client tests, and
   the person doing the work is one solo builder. This path is worth
   naming so it isn't silently assumed, not because it's close.

I'd weight path 2 as the most concretely reachable "something else could
use it" outcome, if that's the goal — but path 1 is a completely legitimate
answer too, and the report shouldn't pretend otherwise.

### Cost estimate

- **Apple Developer Program: $99/yr.** The single named financial blocker.
- **Cloud costs: effectively $0**, and this is real, not a rounding error —
  every competitor in the table above has a cloud inference bill that scales
  with usage; SnipAi's only "cloud" cost would be the abandoned per-image AI
  overlay feature, which is parked. This is a durable structural advantage
  as long as the product stays local-first.
- **Solo distribution/support**, staying solo: near-zero cash cost, real
  time cost — bug reports, onboarding help, occasional "it won't install"
  triage for a stack that includes a Python venv and ffmpeg.
- **Hiring help** (even part-time or contract): the two clearest early
  hires would be (a) someone to build the DOM test harness and burn down
  C1–C21 systematically, and (b) someone to own the "another human's Mac
  is different from Kayer's Mac" installer/bundling problem, since
  `scripts/bundle-app` is careful but has already caught itself making
  the self-referential-copy and frozen-route mistakes once each — that
  class of bug scales with how many different Macs the app has to run on.

### Timeline, sequenced off the roadmap already in `DOCKET.md`

The docket's own M0–M5 sequence is sound; I'm not proposing a different
shape, just giving honest ranges instead of the docket's un-dated
milestones, and folding in the Blocked/Parked items where they actually
belong in the sequence rather than as a separate list:

| Milestone | What it needs | Realistic range |
|---|---|---|
| M0 / M0.5 (in progress) | A raw clip actually dropped through the real dashboard, on the real Mac, to confirm the E1 word-clipping fix and close out the auto-cut proof | **Tonight to this week** — per `DOCKET.md`'s own note, this is the single blocking action, not a build task |
| M-app | Watch a finished cut inside SnipAi itself | Already marked done (S18/S19 fixed and verified) |
| M1 | Trustworthy test/QA verdict | Already mostly done — T2's real cause (a silent `fail=1` in `guard-ledger.py`) is fixed; T3/T4 (two verdicts in one run, silent pipeline skip) are the residue, each a few hours |
| M2 | A DOM test harness exists, C1 and C2 go from red to green | **1–2 weeks** of focused work — `jsdom` + a render helper, then the two data-loss-adjacent bugs get real regression tests, not just line citations |
| M3 | Finish the three-level review loop (H1, H2, H3) | **2–4 weeks** — this is the actual product thesis; it deserves real time, not a squeeze |
| M4 | Decide keep/cut on every Bloat row (B1, B2, B5, B6 in the docket's bloat numbering — the timeline NLE, the graphics subsystem, the four undo mechanisms, the five settings tabs) | **An afternoon of decisions**, not engineering time — this is Kayer's call to make, not code to write, and it's overdue |
| M5 | Apple Developer account bought, universal binary, ship to one other human | **1–3 weeks** once B2 is purchased — signing/notarization setup, fixing P16 (Info.plist, mic usage string), confirming the universal build, then one real test with one real other person |

Total, if pursued in sequence with reasonable weekly effort from one person:
**roughly 6–10 weeks** from tonight to "one other human has successfully
used this app," assuming M0/M0.5 close this week as the docket already
expects. That is a real estimate with real uncertainty in both directions —
M3 in particular could run longer if the three-level review UI turns out to
need more than a UI pass once someone is actually building it out.

---

## 4. Missing features — grounded in code gaps and competitor gaps

Prioritized, cross-referencing `DOCKET.md`'s Half-built (H1–H9) list against
what the competitor table actually ships:

1. **Finish the three-level review loop (H1, H2, H3).** This is not a
   "missing feature" in the normal sense — it's the unfinished half of the
   thing the whole app exists to be. Every competitor above has *some*
   review/approval step, but none of them have SnipAi's specific three-tier
   idea (whole-video verdict → rough problem-marking → line-level
   diagnosis with an adaptive checklist). It's the actual differentiator
   and it's the least finished thing in the repo. Fix this before anything
   else on this list.
2. **Fix C1/C2 before anyone but Kayer touches the timeline.** A trim
   handle that collapses a clip to nothing and an undo stack that silently
   stops working after one use are the kind of bugs that end a stranger's
   trust in one session. Neither is hard to fix; both are confirmed open.
3. **Social publishing to at least one platform (B1).** Every named
   competitor ships this; SnipAi ships eight honestly-labeled placeholders.
   Given the product's actual audience (TikTok Shop affiliates), TikTok
   itself is the obvious first integration — and it's also the platform
   most likely to have API friction, so scope it early rather than late.
4. **A DOM test harness (M2).** Not a "feature" a user sees, but a
   precondition for shipping any of the above without regressing it —
   19+ known client bugs currently have no way to be proven fixed.
5. **The learning loop needs a ceiling and a preview (H5, ledger P2/U5).**
   This already burned Kayer once for real — `snap_tail` got learned up to
   0.881 (88× its intended value) from three trims with no cap, adding
   real dead air back into real cuts before it was caught and reset. The
   `GET /api/learn` dry-run route exists and is dead code (`U5`) —
   wiring it to an actual "preview before applying" step is the fix, and
   it's mostly plumbing that already exists.
6. **Products & links (H7, docket R2)** and **connectors (H6)** are both
   forms that write files nothing reads — not urgent for a solo tool, but
   real half-built surface that should either be finished or removed
   before anyone else sees the Settings screen.
7. **Nothing here recommends inventing team features, billing, or
   multi-tenant scaffolding.** None of the competitors' team/enterprise
   tiers are relevant to SnipAi's plausible near-term audience of solo
   creators, and building them now would be scope creep against a codebase
   that hasn't finished its single-user core loop yet.

---

## 5. Valuation

**This is rough modeling for discussion, not investment advice or a formal
valuation.** SnipAi is pre-revenue, pre-distribution, single-founder, and
has never been used by anyone but its builder. Any number below should be
read as "what would a similar situation plausibly be worth," not a
prediction.

| Scenario | Assumptions | Rough range |
|---|---|---|
| **Personal-tool-only** | Never distributed. Value is entirely the time it saves Kayer and the footage-privacy guarantee it provides him. No market transaction ever happens. | Not really a dollar figure — the honest answer is "worth what it saves him in editing hours," which is a personal-productivity number, not a company value. If forced to a number: **low four figures**, valued as the cost of hiring the equivalent editing work for a year. |
| **Niche indie Mac app** | Path 2 above is pursued: B2 purchased, C1/C2 and the client bugs fixed, real onboarding, sold at ~$9–15/mo or a one-time ~$50–80 to a few hundred to low-thousands of TikTok Shop/UGC affiliate creators over 12 months. Assume $10k–$60k ARR after a year of real distribution effort — a wide range because zero of this is validated yet. Apply a conservative solo-indie-app revenue multiple (2–4x ARR, reflecting single-founder key-person risk and no retention data). | **Roughly $20,000–$240,000** in a year, contingent on actually reaching real users — today that number is $0 because there is no distribution. |
| **Broader product / funded path** | Multi-platform, team, meaningfully differentiated at scale, real funding round. Comparable-stage competitors above (Opus Clip, Descript) raised $50–68M+ each at a startup-scale team, multi-year head start, and — critically — a business model with recurring cloud revenue that funds growth. SnipAi today has none of that: no team, no funding, no multi-platform build, no recurring revenue. | Not a credible near-term number. Naming it would misstate how far this is from that path today; the honest answer is **not currently fundable or comparable at this stage**, and shouldn't be modeled as one until path 2 has produced real users and real revenue data. |

The throughline: SnipAi's value today is almost entirely in what it does
for one person, verified and real. Everything past that is contingent on
work not yet done and users not yet reached — which is not a criticism, it's
six weeks of solo work with a working core and an honest punch list.

---

## What to actually do, starting tonight

Sequenced smallest-first, per instruction — the first step is real and
takes an evening, not a "phase":

1. **Tonight/this week — close M0/M0.5.** Drop one raw clip into the real
   dashboard on the real Mac and let the full pipeline run to completion.
   This is not a code task. `DOCKET.md` says this exact thing is the only
   remaining blocker on the currently-open milestone, and it's the cheapest
   possible next action: it's already built, it just hasn't been run for
   real yet.
2. **This week — fix C1 and C2.** Both are single-function bugs with exact
   line citations (`Timeline.tsx:266`, `review/page.tsx:1017`) and both are
   the kind of thing that would burn a stranger's first session. An hour or
   two each, easily done solo.
3. **Next 1–2 weeks — stand up the DOM test harness (M2)** and write C1/C2
   as real regression tests, not just fixed-and-hoped.
4. **An afternoon, whenever — the M4 bloat decisions.** Read `DOCKET.md`'s
   Bloat table (B1, B2, B5, B6) and write a keep/cut answer next to each
   row. This costs nothing but attention and it's been sitting open.
5. **When ready to let someone else touch it — buy the Apple Developer
   account ($99), fix P16's `Info.plist`/mic-usage-string gap, confirm the
   universal binary, and find one real other person to try it.** That's M5,
   and it's the actual "is this a product" test.

Everything else in this report — the go-to-market fork, the pricing
question, the valuation ranges — only starts to matter after that one
person has used it and it didn't break on them.

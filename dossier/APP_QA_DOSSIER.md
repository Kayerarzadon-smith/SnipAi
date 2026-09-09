# SnipAi — QA dossier

**Purpose.** Give another system enough grounded detail to construct a clean-state → build → install → regression → adversarial → stress → recovery → visual → performance → security → ship-readiness gauntlet for *this* application.

Everything below was derived by inspecting the tree at **commit `b9ee16f`** (branch `master`, working tree clean, 2026-09-09). Where the repository does not establish something, it says **UNKNOWN** rather than guessing.

Machine-readable companions live beside this file: `APP_FEATURE_MATRIX.json`, `APP_ROUTES.json`, `APP_DEPENDENCIES.json`, `APP_TEST_INVENTORY.json`, `APP_KNOWN_ISSUES.json`, `APP_ENVIRONMENT_MATRIX.json`, `APP_BUILD_PROCEDURE.md`, `APP_CLEAN_STATE_PROCEDURE.md`.

---

## 1. Application identity

| | |
|---|---|
| Name | SnipAi (`com.arzacorp.snipai`) |
| Version | 0.1.0 (`package.json`); Info.plist 0.1.0 / build 1 |
| Branch / commit | `master` / `b9ee16f61c6b2d0c1b62c24c81a5ca6105574abe` |
| Framework | Next.js 14.2.35, App Router, React 18.3.1 |
| Languages | TypeScript 5.5.4 (strict), Python 3.11, Swift, Bash |
| Runtime | Node **v24.20.0** — required, not incidental |
| Package manager | npm 11.19.0, lockfileVersion 3, 36 locked packages |
| Build | `next build` with `output: "standalone"` |
| Dev server | `next dev -p 4737 -H 127.0.0.1` |
| Production | `./scripts/bundle-app` → `SnipAi.app` (~666 MB, unsigned, x86_64) |
| Target | macOS 11.0+ desktop, single user, offline |
| Browser | its own WKWebView. No browser support matrix. |
| Dependencies | **three** at runtime: `next`, `react`, `react-dom`. Two pinned Python: `faster-whisper==1.2.1`, `imageio-ffmpeg==0.6.0`. |

**What kind of application this is.** A macOS app that turns raw talking-head footage into a cut, postable short-form video. A Swift wrapper owns a Next server on loopback and shows it in a WKWebView. Heavy work is Python + ffmpeg + Whisper, spawned as child processes. There is no database, no cloud, no account, and no network requirement.

**The three runtime dependencies are load-bearing context.** There is no state library, no test framework, no HTTP client, no UI kit, no ORM. Node 24 strips types and runs `node:test` through a 20-line resolver (`tests/register.mts`); Python uses stdlib `unittest`. A gauntlet that assumes Jest, Playwright, Prisma or Redux will be designing for a different application.

---

## 2. Architecture

```
  native/main.swift (445 lines)
    ├── spawns  Contents/Resources/node  →  Next standalone server, 127.0.0.1:4737
    ├── sets    SNIPAI_CODE, SNIPAI_PYTHON, SNIPAI_FFMPEG, HOSTNAME=127.0.0.1
    └── shows   WKWebView on that URL, always centred on the PRIMARY display

  Next 14 App Router
    ├── 5 pages          /  /dashboard  /projects/[project]/review  /settings  /connectors
    ├── 23 API routes    all force-dynamic (see §6)
    └── lib/*.ts         18 modules, pure where it matters

  lib/pipeline.ts  ──spawn──►  CPython + tools/*.py  ──spawn──►  ffmpeg
                                     └── faster-whisper (CPU int8, small.en)

  DATA_ROOT (default ~/Movies/SnipAi)
    projects/<name>/  beats.json  review-state.json  .snapshots/  raw/  cuts/  work/
    state/            jobs.json  tuning.json  learnings.json  providers.json
    reference/        house-style.json  glossary.json  products.json  sfx/
    .trash/
```

**Data flow, end to end.** Footage is streamed to `projects/<name>/raw/`. `transcribe.py` produces a word-level transcript; `silence_map.py` produces two silence maps (−28 dB coarse for pause trimming, −50 dB strict for edge snapping); `draft_beats.py` writes `beats.json` — one entry per line of script. `make_source_proxy.py` writes a 720p keyframe-dense proxy for scrubbing. `build_cut.py` reads `beats.json`, snaps edges against the strict map, walks each beat into the runs of film that survive (`walk_pieces`), and writes `edl.json` + `extract.sh` + `concat.txt`. The server runs `extract.sh` (one ffmpeg per clip) then a stream-copy concat. `verify_cut.py` and `compare_to_reference.py` score the result into `review-state.json`.

Editing writes back to `beats.json` and the cut is rebuilt. `learn_from_edits.py` reads the recorded edits and adjusts `state/tuning.json`, which `build_cut.py` then honours — **a closed loop from the user's edits back into the renderer.**

**State management.** React `useState`/`useRef` in one large client component (`review/page.tsx`, 2,297 lines) plus refs mirroring props for the rAF loop. Server state is flat JSON files, written atomically (tmp + rename). **No Redux, no Zustand, no React Query, no context providers of consequence.**

**Absent by design, and worth not testing for:** authentication, authorization, sessions, cookies, database, migrations, WebSockets, service workers, CDN, queues (beyond a single-slot in-process job registry), containers, and any third-party service. `lib/imagegen.ts` talks to image providers but **has no importer** — it is a parked, dead surface.

---

## 3. Feature inventory

28 features, fully enumerated with inputs/outputs/state/errors/tests/weaknesses in **`APP_FEATURE_MATRIX.json`**. Distribution: **P0 × 9, P1 × 9, P2 × 7, P3 × 3.**

The nine P0s — where a defect costs work or ships a bad video:

1. **Import footage** — raw-body streamed upload, XHR progress. No size cap.
2. **Auto pipeline** — four phases, one heavy job at a time, 409 if busy.
3. **beats.json** — *the* artifact. Everything else is raw footage or rebuildable.
4. **Highlight and cut a region** — holes on a beat; picture butts together.
5. **Ripple delete across the timeline** — one drag, resolved atomically.
6. **Undo (⌘Z)** — 24 in-memory entries.
7. **Version history** — 60 snapshots, restore is itself undoable.
8. **Build the cut** — EDL → per-clip extract → concat → score.
9. **Native wrapper** — owns the server and the environment contract.

**A gauntlet must not skip the small surfaces.** Keyboard: `Space` `J/K/L` `←/→` (`⇧` = 1s) `Home/End` `↑/↓` `I` `O` `S` `⌘B` `[` `]` `T` `M` `F` `N` `Delete` `Backspace` `⌘Z`. Buttons/dialogs: Trim, Takes, Graphic, Delete per line; Your cut / Rendered file; History; Approve; Trash; Fit / − / + ; Re-scan cut; Burn in; the graphic dialog with voice input; Recently deleted; the import tray. Drag interactions: clip drag, trim handles (1px), fade grips, range select, ⌘+scroll zoom, drag-and-drop import.

---

## 4. Screens and routes

Full enumeration in **`APP_ROUTES.json`** (5 pages, 23 API routes, methods and flags per route).

| Screen | Route | The interactions that matter |
|---|---|---|
| Queue / dashboard | `/dashboard` (and `/`) | import tray with per-file progress, project cards with live bars, Open, ⋯ → Delete, Recently deleted |
| Review | `/projects/[project]/review` | **the whole editor.** Player (two modes, resizable), timeline (two tracks, zoom), lines list, snippet editor, graphics fold, history drawer, scorecard, Approve/Trash |
| Settings | `/settings` | Profile, Microphone, Products + Amazon tag, Editing tools (learned rules), Reference videos |
| Connectors | `/connectors` | eight tiles, **all hard-coded `not_connected`** |
| Root | `/` | 5 lines; redirects into the dashboard |

**States to exercise on every one:** empty (no projects), loading, populated, error, a project whose `beats.json` is corrupt (must appear *with a problem*, not vanish), a project mid-job, a project with no transcript, a project with no cut.

---

## 5. User journeys

**The main one:** drop footage → auto pipeline (transcribe → draft → proxy → build) → review screen → play, trim, cut regions, split, reorder, delete lines → edits apply themselves (debounced rebuild) → Approve.

Every journey where state can go inconsistent, with the mechanism:

| Journey | Where it can break |
|---|---|
| Import → refresh mid-upload | the XHR aborts; a partial project directory can exist. The route deletes the dir on write failure, but a *client* abort is untested. |
| Job running → app quit → relaunch | `jobs.json` keeps the job `running` forever; the next build 409s. **LEDGER S2** — `failJob` never persists. |
| Edit → refresh | the 24-entry undo history is **in memory only** and is silently lost. `beats.json` survives. |
| Edit → edit → undo → edit | branching history is discarded (the tail is sliced); there is **no redo**. |
| Two edits in flight | writes are read-modify-write on a single-threaded server; the second read sees the first write. Concurrency tested at 10× in the gauntlet. |
| Build → edit during build | edits land in `beats.json` while the EDL being rendered is stale. `cutStale` exists; the interaction is untested. |
| Restore a snapshot while the trim editor is open | `setTrimBeat(null)` handles it; verify. |
| Corrupt `review-state.json` | now preserved as `.corrupt-<ts>` and reported, rather than replaced by defaults. |
| Delete a project → restore within 5 days | `RETAIN_DAYS = 5`, expiry read from the folder name. |

---

## 6. Clean-state analysis

Full procedure in **`APP_CLEAN_STATE_PROCEDURE.md`**. The three findings that matter most:

**There is no browser-side state at all.** Zero hits for `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `serviceWorker`, `caches.` across `app/` and `lib/`. An entire class of contamination does not exist here. Do not spend gauntlet budget on it.

**`SnipAi.app` is a complete second copy of the application**, gitignored, 666 MB, and **not** rebuilt by `npm run build`. Its server and its Python tools are copied in separate steps, so it can be half-current. This is the most likely way to test the wrong code.

**Next prerenders GET-only API routes.** `/api/jobs/running` shipped as a permanent `{"job":null}`, so the queue's progress bar never moved *in any build*, while working perfectly in `next dev`. All 23 routes now declare `force-dynamic` and `bundle-app` fails if it finds a prerendered route. **This class of fault is invisible in development** — a gauntlet that only tests `next dev` cannot find it.

Also: a server process that renames itself `next-server` (kill by port, not name); `.build-cache` that ignores `requirements.txt` changes; `state/tuning.json` which **changes what the renderer produces**; and `state/jobs.json` at 251 KB / 40 jobs / 379 log lines.

---

## 7. Build & deployment

Full procedure, with the exact commands, in **`APP_BUILD_PROCEDURE.md`**.

**The gap worth naming here:** the application exposes **no build stamp, version endpoint, or commit hash at runtime**. Verifying "the running app is the commit under test" is currently forensic — `lsof` the cwd of the listener, then grep the served files for a string from your change. Adding `/api/version` would make every clean-state gauntlet cheaper and is the single highest-value ship-readiness addition.

---

## 8. Test infrastructure

Full inventory in **`APP_TEST_INVENTORY.json`**. Measured at this commit:

| layer | command | count | status |
|---|---|---|---|
| TypeScript suite | `./scripts/test` | **152** tests, 27 suites | all pass |
| Bug board | `./scripts/qa --regressions` | 3 | **1 red on purpose** (S1, wontfix) |
| Python pipeline | `unittest discover` | **55** | all pass |
| Gauntlet (generated) | `qa/run.mts`, `qa/run-api.mts` | **2,640** + **416** scenarios | all pass |
| Media verification | `qa/verify_media.py`, `verify_words.py` | 10 checks/project + word coverage | manual |

**3,266 automated checks.** The 3,056 gauntlet scenarios are generated from seeds, not hand-written.

**What none of it validates:** anything rendered. There is no component render, no DOM assertion, no browser automation, no visual regression, no accessibility check, no performance budget, no coverage measurement, and **no CI**. Every UI claim in this project's history was established by a human or an agent driving the app by hand.

**Two gaps a gauntlet designer must know:** the property gauntlet and the media verifiers are **not** invoked by `./scripts/test` or `./scripts/qa` — they only run when someone runs them. And `./scripts/test` prints "all green" for the suite while reporting the bug board separately; `1 still open` under a green suite is the expected state today.

---

## 9. Known bugs and historical bugs

Complete, with reproductions, in **`APP_KNOWN_ISSUES.json`** and `qa/BUGS.md`.

- **`audits/LEDGER.md`**: 18 rows, **15 open**. S3 (no size cap), S4 (unbounded stdout and job log), S5 (CWD-relative project paths), S6 (`spawnSync` on eight GET paths), S8 (trim never re-runs `normaliseHoles`), S9 (`cutTimeline` collapses `hook-1`/`hook-2`), S11–S12 (filmstrip cache key and NaN), S13 (references credited to the wrong files), S14 (graphic id collisions), S15 (six routes spawn without the job guard), S16 (two durations for the same edit), S17 (products catalogue overwritten by a swallowed read error), S18 (416 instead of clamping).
- **15 defects found and fixed in the 2026-09-09 gauntlet**, ten of them P1 and able to lose work or ship a bad video.
- **4 open defects** beyond the ledger, including **BUG-010: the word-level highlight never renders** — line-level works, word-level produces zero elements, and the root cause is *not isolated*.
- **11 empty or comment-only catch blocks** in `app/` and `lib/`. Each is a deliberate "not worth surfacing" decision. `readJson` returning a fallback for an unparseable file was exactly this shape and caused a P1 that destroyed take picks. **Probe every one.**
- No `@ts-ignore`, one `eslint-disable-next-line`, no skipped or disabled tests.
- Known flake, fixed: a timing test failed ~1 run in 15 (200 ms cadence under a 1 s idle window). Widened and swept 15 clean runs.

---

## 10. Recent changes — where to aim regression effort

The last ten commits changed 78 files. The renderer and the write path were both touched.

**Highest regression risk, in order:**

1. **`ugc-edit-system/tools/build_cut.py`** (+87 lines) — `walk_pieces` now *clips* a detected pause to the line instead of requiring containment, a pause reaching the end moves the out-point, and touching silence rows are merged. **This changes what every render produces.** Verified: img-9817 110.31 → 97.80 s and img-9823 182.67 → 177.30 s with **zero spoken words lost**. Re-verify on any new footage.
2. **`lib/beats.ts`** — `saveBeats` and `updateBeatRange` changed signature to report whether they wrote. Every caller is affected.
3. **All 23 API routes** — `force-dynamic` added; seven had their body parsing replaced.
4. **`app/projects/[project]/review/page.tsx`** — the no-op paths, `dropLastHistory`, and the hole-skip now gated on `!v.paused`.
5. **`lib/pipeline.ts`** — a stall warning before the idle kill; a new `check` job.
6. **`make_source_proxy.py`** — `-progress pipe:1` and a real ffmpeg resolver.

---

## 11. Data integrity

**Where data lives:** `beats.json` (the edit), `review-state.json` (every decision not in beats.json — take picks, trim edits, cut regions, deleted lines, diagnoses, cached scorecard), `.snapshots/` (60 deep), `state/tuning.json` (learned parameters that change renders), `state/jobs.json`, `state/learnings.json`, `raw/` (never modified), `cuts/`, `work/` (rebuildable).

**Protections that exist:** atomic writes everywhere (`writeJsonAtomic`); a snapshot before every `beats.json` write; no-op writes skipped *and reported*; a corrupt `review-state.json` preserved as `.corrupt-<ts>` rather than replaced; a corrupt `beats.json` surfaced on the queue instead of dropping the project; project names validated to a single path segment; media paths resolved against `PROJECTS_ROOT` and rejected if they escape.

**Loss scenarios still open:**
- The **24-entry undo history is in memory** and dies on refresh. `beats.json` survives; the ability to step back does not.
- **There is no redo.** Verified: the word appears once in the repository, in a comment.
- A job left `running` by a crash blocks the next build (**S2**).
- `state/tuning.json` has no snapshot and no undo. A runaway loop has already cost 10.8 s of dead air once.
- The products catalogue can be overwritten by a swallowed read error (**S17**).

---

## 12. Performance

**Measured on this machine, at this commit:**

| operation | measurement |
|---|---|
| Upload, 700 MB | **149 MB** peak RSS streamed (was **2,169 MB** buffered — enough to swap the machine and reboot it) |
| Audio extraction from a 1.8 GB 4K source | **2 s** |
| 720p proxy transcode, 40 s of 4K | 92 progress heartbeats, longest gap **2.19 s** |
| Full 4K build, 46 clips / 98 s | several minutes |
| Playhead | **47 position updates per second** (rAF, not `timeupdate`) |
| Instant edit application | **67 ms** |
| Render vs EDL | +0.7 s over 46 pieces = half a frame per clip (quantisation, not drift) |

**Stress scenarios worth designing:** a project with 300+ beats; a 30-minute source; concurrent filmstrip requests (**S15** — twelve render at once on page load); a 6-hour job accumulating unbounded stdout (**S4**); rapid zoom and scrub during playback; a long session watching RSS; `jobs.json` growth over hundreds of jobs.

**Not instrumented at all:** memory over a long session, event-listener accumulation, React re-render counts. The rAF loop re-registers `mousemove`/`mouseup` listeners on every render *by design* (no dependency array) — worth measuring under sustained playback.

---

## 13. Security and failure modes

**Threat model is narrow and should be stated plainly:** a single-user desktop app, loopback-only, no auth, no network egress, operating on the user's own files. The realistic risks are *data loss* and *path escape*, not intrusion.

- **No authentication or authorization anywhere.** Loopback binding is the entire access control (`package.json` and `native/main.swift`). Any process on the machine can drive the API. Relaxing the bind to `0.0.0.0` would expose full read/write over the network — assert it never happens.
- **Path handling:** project names must match `^[a-z0-9-]+$` and ≤64 chars; media paths are resolved and checked against `PROJECTS_ROOT`; uploaded filenames are `basename`d then filtered. Gauntleted with traversal, encoded traversal, null bytes, RTL override, 300-char names.
- **Body handling:** all JSON routes go through `readJsonObject`, which rejects `null`, numbers, strings, arrays and non-objects. Prototype-pollution payloads tested.
- **Secrets:** image-provider keys are read from the environment or `DATA_ROOT/state/providers.json` (0600), never from the client, never logged, never written into a project. `scripts/connect-image-provider` takes the key at a hidden prompt, never as an argument. **Nothing currently uses them.**
- **Unbounded input:** the project importer has **no size cap** (the reference uploader caps at 600 MB). Streaming removed the memory hazard; disk exhaustion remains.
- **The bundle is unsigned.** Gatekeeper stops it on any other Mac.

---

## 14. Environment matrix

Full detail in **`APP_ENVIRONMENT_MATRIX.json`**. Summary: macOS 11.0+, x86_64 binaries (Apple Silicon under Rosetta only, no universal build), WKWebView, minimum window 900×600, no GPU use, no network requirement, **fully functional offline**.

Media tested: 4K HEVC `.MOV`, 30 fps, portrait 2160×3840, 1.7–1.8 GB. **Untested and worth attacking:** 24/25/29.97/50/60 fps, variable frame rate, HDR, landscape, square, audio-only, no-audio-stream, multi-track audio. Note the importer accepts `.avi`/`.mkv` while the reference uploader does not.

---

## 15. Release readiness

| area | status |
|---|---|
| Build | **PASS** — clean build, no frozen routes, bundle assembles |
| Tests | **PASS** — 152 + 55 green; 3,056 gauntlet scenarios green; bug board 1 red by design |
| Critical workflows | **PASS with evidence** — import → pipeline → cut verified end to end on two real projects, both rendering with zero dead air and zero lost words |
| Known bugs | **CONDITIONAL** — 15 ledger items open, 1 unisolated P2 (word highlight) |
| Performance | **CONDITIONAL** — the memory hazard is fixed and measured; long-session and large-project behaviour is unmeasured |
| Security | **ACCEPTABLE for the threat model**, given loopback-only and no auth by design |
| Accessibility | **NOT ASSESSED.** No a11y work, no audit, no tests. Treat as unknown, not as passing. |
| Compatibility | **FAIL for distribution** — unsigned, x86_64 only |
| Data integrity | **STRONG** — atomic writes, snapshots, no-op reporting, corrupt-file preservation. Undo history is memory-only and there is no redo. |
| Production deployment | **NOT READY** — no signing, no notarisation, no installer, no update channel, no CI |

**Preliminary assessment: NOT READY TO SHIP to anyone but the person who built it — and that is a distribution and coverage judgement, not a "the tests are red" judgement.** The tests are green. Green tests here mean the editing maths, the write paths and the route contracts are guarded; they say nothing about anything rendered, because nothing rendered is tested. The application is in good shape *for its author on his own machine*, which is exactly its current audience.

---

## 16. Risk map

Ranked by probability × severity. Each names the code and what coverage exists.

| # | Risk | P | S | Why | Code | Coverage | Test to write |
|---|---|---|---|---|---|---|---|
| 1 | **A render ships with dead air or a clipped word** | Med | **Critical** | `walk_pieces` was just changed; it decides which frames survive. Two silence bugs found here in one day. | `build_cut.py` `walk_pieces`, `snap`, `merge_touching` | 29 Python tests + `verify_media.py`/`verify_words.py` manually | Automate both verifiers on every build; add footage with a leading pause, a pause at both edges, and back-to-back holes |
| 2 | **The word-level highlight (BUG-010)** | **High** | Low | Confirmed dead; cause not isolated | `review/page.tsx` rAF `setSpoken` | none | A render test asserting `.wd` elements exist during playback |
| 3 | **A stale bundle is tested instead of the code** | **High** | High | 666 MB gitignored second copy, not rebuilt by `npm run build`, can be half-current | `scripts/bundle-app` | the frozen-route guard only | `/api/version`, then assert it in every gauntlet run |
| 4 | **A crashed job blocks all future builds** | Med | High | `failJob` never persists (S2); the job stays `running` and the next build 409s | `lib/jobs.ts:184` | `tests/regressions/S2` (passing) | Kill the server mid-build, relaunch, attempt a build |
| 5 | **Learned tuning drifts and changes renders** | Low | **Critical** | Closed loop from edits into the renderer; has run away once to 10.8 s of dead air | `learn_from_edits.py`, `state/tuning.json` | clamps + a watermark | Feed 200 synthetic edits, assert every parameter stays in `LIMITS` |
| 6 | **Disk exhaustion from an uncapped import** | Med | Med | No size cap on the project importer; 8.8 GB library from two projects | `app/api/projects/route.ts` | streaming tested, cap absent | Import until the disk is full; assert a readable error |
| 7 | **Six routes spawn ffmpeg/Whisper without the job guard** | Med | Med | Twelve filmstrips render at once on page load (S15) | filmstrip, peaks, poster, candidates | none | Load a 60-beat project and count concurrent children |
| 8 | **Filmstrip shows the previous cut's frames** | Med | Low | Cache key omits the cut file (S11); NaN reaches argv (S12) | `filmstrip/route.ts:32,59` | none | Build v2, scrub, assert frames changed |
| 9 | **Undo history lost on refresh; no redo** | **High** | Med | In-memory only, 24 entries, no redo anywhere | `review/page.tsx` `pushHistory` | round-trip tested; persistence not | Edit, refresh, assert what the user can still recover |
| 10 | **A hole ends up covering a whole beat via trim** | Low | High | Trim never re-runs `normaliseHoles` (S8) | `beats/[label]/route.ts` | none | Trim a beat inward until an existing hole spans it |
| 11 | **`hook-1`/`hook-2` collapse into one row** | Low | Med | `cutTimeline` strips any `-<digits>` (S9) | `projects/[project]/route.ts:148` | none | Name two beats `x-1`, `x-2` and assert both appear |
| 12 | **Accessibility** | Unknown | Med | Never assessed | all of `app/` | none | Keyboard-only traversal; axe over each page |

---

## 18. Self-audit

**What I corrected on the second pass.** Three things I had been prepared to assert from familiarity and then checked:

- I nearly described selection snapping as a tunable behaviour. It does not exist: `timeAt` is a linear pixel→time map and `dragEdge` rounds to the millisecond. **There is no quantisation anywhere in the editor.** A gauntlet told to "test the snap threshold" would test nothing.
- I assumed a redo existed because undo does. `grep -riE "redo"` returns **one comment**. There is no redo.
- I assumed `lib/imagegen.ts` was wired to a route. It has **no importer** — dead surface.

Also verified rather than recalled: zero browser storage, no CI configuration, no version endpoint, undo depth 24, `core.hooksPath=.githooks`, the bundle unsigned and x86_64, and every runtime test count.

**What would cause another system to build an incomplete gauntlet, if this dossier omitted it:**

1. **Testing `next dev` only.** The frozen-route class of fault is *invisible* in development and shipped a dead progress bar in every build.
2. **Not knowing the bundle is a separate artifact.** It would edit source, run tests, and "verify" against months-old code.
3. **Killing the server by process name.** It renames itself `next-server`; a stale server keeps answering on 4737.
4. **Testing against `~/Movies/SnipAi`.** That is the user's real, irreplaceable footage. Isolation via `SNIPAI_DATA` is mandatory, and `img-9817`/`img-9823` must never be touched.
5. **Trusting exit codes for renders.** A build can return 0 and produce a file with ten seconds of dead air. Only opening the media finds it — which is how the worst defect here was found.
6. **Trusting Whisper's word timings as ground truth.** They start words early by 200–400 ms; the silence map is authoritative. A checker built on the transcript alone will report ~19 phantom "missing words" per cut.
7. **Assuming green tests mean the UI works.** Nothing rendered is tested at all.
8. **Reading `./scripts/test` output as pass/fail alone.** "all green" coexists with a deliberately red bug board.
9. **Designing for web infrastructure that is not here** — auth, sessions, cookies, database, CDN, service workers, containers.
10. **Measuring with the wrong instrument.** Five instrument errors are recorded in `qa/BUGS.md`, two of which produced confident false findings. `astats reset` counts frames not seconds; the transcript is segments-with-nested-words, not words; `-ss` before `-i` is a keyframe seek; a hidden browser pane reports `innerHeight: 0`, making a working carousel look broken; and driving the `<video>` element directly bypasses the app's own transport. A gauntlet that measures wrongly manufactures defects, which costs more than missing one.

# SnipAi — test plan

Derived from `SNIPAI_QA_SPEC.md`, reconciled against the source at `b1dc3c2`.
The spec explains the app; this is the checklist. One row per assertion, each
one a thing that either happened or did not.

**How to use it.** Work top to bottom within a section. Put `P`, `F`, `B`
(blocked) or `—` (not run) in **R**, and on an `F` write the case ID into your
bug report rather than expanding the row. Priorities say what a defect would
cost: **P1** the user loses work or posts something wrong · **P2** a workflow
is broken · **P3** significant · **P4** cosmetic.

Rows marked **KNOWN** are expected to "fail" as written. They are here so the
state is confirmed each pass, not so they get filed. If a KNOWN row starts
passing, that is news — say so.

---

## SU — Setup

Do this once per pass. Everything after it assumes a throwaway library.

| ID | Step | Expected | R |
|---|---|---|---|
| SU-1 | `cd ~/Projects/SnipAi && ./scripts/test` | `all green`, and a board line reading `N still open`. One open item (S1) is correct | |
| SU-2 | `./scripts/qa --full` | completes; `1 still open` on the bug board is expected, not a failure | |
| SU-3 | `export SNIPAI_DATA=~/Movies/SnipAi/qa-sandbox-$(date +%H%M)` to an **empty** folder | set before launching, so nothing in this pass can touch real footage | |
| SU-4 | `./scripts/bundle-app` | builds `SnipAi.app` in a few minutes; `qa --full` runs as part of it | |
| SU-5 | `open SnipAi.app` | window opens on the Queue | |
| SU-6 | Open `http://127.0.0.1:4737` in a browser as well | same app; keep dev tools open — the app window hides console errors | |
| SU-7 | Copy two or three videos into a scratch folder, including one **over 1.5 GB** | source material for IM-*; never import the only copy of anything | |
| SU-8 | Note the build you are testing: `git rev-parse --short HEAD` | written at the top of the report | |

> **On a fresh `SNIPAI_DATA` the first build may behave differently from a
> warm library** — the tuning and house-style files do not exist yet. Run the
> pass once warm and once cold if you have time; cold is where `10ab9c3` found
> a `KeyError` that ended every build.

---

## QU — Queue

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| QU-1 | Opens by default | Launch | Queue is the first screen; left rail shows **Queue**, **Connectors**, **Settings** | P3 | |
| QU-2 | Heading and summary | Read the top | "Production queue" and *"N projects · N need your review · Xm Ys cut"*; the numbers match what is on screen | P3 | |
| QU-3 | Card contents | Inspect one card | thumbnail, title, beat count, cut filename, source length → cut length, status pill, **Open**, **⋯** | P3 | |
| QU-4 | Cut length is the file's | Compare the card's cut length with the actual file | they agree; the card must not report the sum of beat spans | P2 | |
| QU-5 | Live progress | Start a job, watch without refreshing | bar moves, percentage rises, verb changes, updates ≈every 2s | P2 | |
| QU-6 | Percentage never freezes | Watch a long job end to end | never sits on one unchanging word; see XC-4 for the stall warning | P2 | |
| QU-7 | Caption is a sentence | Watch the caption through a whole job | always a phrase in the app's voice — never a file path, traceback, or ffmpeg command line | P2 | |
| QU-8 | `Working…` never appears | Same run; note every occurrence | each one is a gap in the phase table in `app/dashboard/LiveProgress.tsx` — report the log line that produced it | P3 | |
| QU-9 | Status pills | Get a project into each state | Needs fixes / Ready to review / Approved / Unscored, each meaning what the spec says | P3 | |
| QU-10 | Queue reflects the last action | Make an edit, return to the Queue | shows what you just did, not the state from when you left | P3 | |
| QU-11 | Stale render is flagged | Edit a project, do not wait for the re-render, return to the Queue | the card does not call itself ready to post | P2 | |
| QU-12 | ⋯ → Delete | Delete a project | moves to a trash area; disappears from the Queue | P2 | |
| QU-13 | Recently deleted | Open it | lists the project with days remaining, kept **5 days** | P2 | |
| QU-14 | Put back | Restore it | returns intact, with its cuts and edit; and the restore is itself undoable | P1 | |
| QU-15 | Broken project stays visible | See RB-5 | — | P1 | |

---

## IM — Import

The whole product is "drop it in and walk away", so these are high value.

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| IM-1 | Import footage button | Click it | a file picker opens, filtered to `video/*` | P1 | |
| IM-2 | Drag onto the window | Drag a video over the window | a drop zone appears **only while a file is over the window** | P2 | |
| IM-3 | Tray and size | Drop two files | both listed with their sizes; button reads **Import 2** | P3 | |
| IM-4 | Copy progress | Press Import and watch a row | `copying 41%`-style percentage, and a thin bar filling along the row | P2 | |
| IM-5 | Filing phase | Watch after the last byte | `filing it away…` while the server writes | P3 | |
| IM-6 | Work starts by itself | Wait | the job starts with no further click | P1 | |
| IM-7 | Accepted types | Import `.mov` `.mp4` `.m4v` `.avi` `.mkv` `.webm` | all accepted | P2 | |
| IM-8 | Non-video refused | Add a `.txt` and a `.jpg` | row marked **not video**, refused, **no project created** | P2 | |
| IM-9 | Same file twice in one selection | Select it twice | deduped — appears **once** | P2 | |
| IM-10 | Duplicate of an existing project | Import a file matching an existing project's name | marked **duplicate**, skipped, message names the project it is already in | P2 | |
| IM-11 | Duplicate by byte size | Rename a copy and import it | same — caught by exact byte size | P3 | |
| IM-12 | Large file | Import one **over 1.5 GB** (1.72 GB is known to work) | imports; **no size limit**; the Mac stays usable | P1 | |
| IM-13 | Empty file | `touch empty.mov`, import it | refused with *"is empty"* | P3 | |
| IM-14 | Double-click Import | Click Import twice as fast as you can | imports **once**. Two projects, or a 409 in the console, is a failure | P1 | |
| IM-15 | Awkward filename | Import `my vidéo 🎬 final.mov` | accepted; saved name sanitised | P3 | |
| IM-16 | Traversal | Import a file named `../../etc/evil.mov` | saved as `evil.mov` **inside the project**, never outside | P1 | |
| IM-17 | Disk full | Fill the volume, then import | refused **before** the upload, saying so | P2 | |
| IM-18 | End state on disk | After a clean import | `~/Movies/SnipAi/projects/<name>/` holds `raw/`, `cuts/`, `work/`, `beats.json`; card on the Queue; job running | P1 | |
| IM-19 | Import during a build | Start a build, then import | see XC-5 — refused with a message naming what is running, or queued; never two heavy jobs at once | P2 | |

---

## RV — Review screen

### RV-H — Header

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| RV-H1 | Breadcrumb | Open a project | **Queue / \<project>**, then title and cut filename | P4 | |
| RV-H2 | Score button | Read it | shows `NN/100` | P3 | |
| RV-H3 | Score panel | Click it | each metric listed with a bar, including *Repeated phrases* and *Pacing vs. house style* | P3 | |
| RV-H4 | Pacing reads the house style | With a reference pair loaded | Pacing is scored against the measured target, not a constant | P3 | |
| RV-H5 | Pacing with no reference | On a fresh library with no reference pair | says there is no standard yet — **not** "in line with the reference" | P2 | |
| RV-H6 | Needs-a-call pill | Open a project with flagged lines | **"N of M need a call"** with a **next →** | P3 | |
| RV-H7 | next → jumps to the worst | Click it | playhead and selection land on the worst line, not the first | P3 | |
| RV-H8 | Clean and unscored states | Open a clean project, and one with no transcript | **"All beats clean"** / **"Unscored — no transcript"** | P3 | |
| RV-H9 | History lists versions | Open History | every saved version, each with its reason | P1 | |
| RV-H10 | Approve | Press it | pill becomes Approved; finished file is in `cuts/` | P2 | |
| RV-H11 | Trash | Press it | same path as QU-12 | P2 | |

### RV-P — Player

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| RV-P1 | Three modes | Look above the video | **Your cut**, **Rendered file**, and **With graphics** only if a graphics render exists | P3 | |
| RV-P2 | Your cut is live | Make an edit and play | the change is audible/visible immediately, with no re-render; playback jumps line to line | P1 | |
| RV-P3 | Your cut reports the cut's length | Read the duration in that mode | the length of the cut, not of the source | P3 | |
| RV-P4 | Rendered file trails | Edit, then switch to Rendered file | it says it is behind your edit | P2 | |
| RV-P5 | Resize | Drag the player's corner | resizes, and keeps the footage's shape | P3 | |
| RV-P6 | Nothing over the picture | Watch | no filename, no LIVE badge, no overlay of any kind | P4 | |
| RV-P7 | Which resolution | Look for a label | **KNOWN** (Part 5 #9) — the auto cut is 720p, Build gives full resolution, and nothing says which you are watching | P3 | |

### RV-T — Timeline

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| RV-T1 | Two tracks | Look | video on top, audio waveform below, 1px between them | P3 | |
| RV-T2 | Waveform renders | Open a project cold | the waveform draws; an empty audio track is a failure | P2 | |
| RV-T3 | Zoom controls | Use **Fit**, **−**, **+** | zoom changes and the `px/s` readout follows | P3 | |
| RV-T4 | ⌘ + scroll | Scroll with ⌘ held | zooms | P3 | |
| RV-T5 | Click to move the playhead | Click in the timeline | playhead moves there | P2 | |
| RV-T6 | Scrub with audio | Drag the playhead | **you hear audio while scrubbing**, at the speed of your hand | P2 | |
| RV-T7 | Paused playhead stays put | Pause, then click inside a stretch that is already cut | the playhead **stays where you put it** — it must not jump to the hole's edge while paused | P1 | |
| RV-T8 | Playing playhead skips holes | Play across a hole | playback skips the removed footage | P2 | |
| RV-T9 | Reorder by dragging | Drag a clip to a new position | order changes; the line list follows | P2 | |
| RV-T10 | Trim by the end handle | Drag the 1px handle at a clip's end | out-point moves, to the millisecond, with no snapping | P1 | |
| RV-T11 | Trim by the start handle | Drag the 1px handle at a clip's **start** | in-point moves by the amount you dragged; the clip must not run away or collapse to its 0.15s floor | P1 | |
| RV-T12 | Fade handle | Drag the corner grip | the clip actually ramps — check the rendered file, not just the handle | P2 | |
| RV-T13 | Mark and delete a span | Drag across empty space on the audio track, press Delete | the stretch is removed from the timeline; picture and audio resolved as one write | P1 | |
| RV-T14 | Page stays still while dragging | RV-T6, T9, T10, T11, T13 | **the page must not move** — not vertically, not horizontally | P1 | |
| RV-T15 | Selection is free-form | Mark a span and read its length | millisecond precision; no grid, no magnet | P3 | |
| RV-T16 | Filmstrip frames are current | Edit, let it rebuild, scrub | **KNOWN** (Part 5 #12) — may show the previous render's frames | P3 | |

### RV-L — Lines list

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| RV-L1 | Row contents | Inspect a row | number, timecode, the line as spoken, confidence %, take count, tick or warning | P3 | |
| RV-L2 | Playing row highlights | Play | the current row highlights and scrolls itself into view | P3 | |
| RV-L3 | Carousel yields to you | Scroll the list during playback | it stops fighting you, then resumes after ~4s | P3 | |
| RV-L4 | Row actions on hover | Hover or select a row | **Trim · Takes · Graphic · Delete** appear | P3 | |
| RV-L5 | Selection is linked both ways | Select a clip in the timeline, then a row in the list | each selects the other | P3 | |
| RV-L6 | Delete a line | Press Delete on a selected row | the line goes, the cut shortens, and the rebuild starts | P1 | |
| RV-L7 | Word-level highlight | Play a line with several words | **KNOWN** (Part 5 #1, BUG-010) — line highlighting works, word highlighting never renders | P3 | |
| RV-L8 | Repeated phrases in the cut | Read the score panel | **KNOWN** (Part 5 #10) — repeats are reported, nothing acts on them | P3 | |

---

## SN — Snippet editor (Trim)

The densest area in the app and the one with the most reported defects.

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| SN-1 | Opens inline | Press **Trim** on a row, or **T** with a row selected | opens underneath that line, the same width as the row | P3 | |
| SN-2 | Contents | Look | monitor left; filmstrip along the top; high-resolution waveform; the words under it at their spoken positions; zoom `−`/`+` with a duration readout; `in – out  duration` with **Play**, **Cancel**, **Save trim** | P3 | |
| SN-3 | Monitor plays | Press **Space** | the line plays in the monitor in real time; Space again stops | P2 | |
| SN-4 | Drag to highlight | Drag across the waveform | **`X.XXs highlighted`** appears with **Cut this bit out**, **Keep only this**, **Clear** | P1 | |
| SN-5 | Delete key cuts | Press **Delete** (and again with **Backspace**) | the stretch is removed, the gap closes, the picture either side joins up | P1 | |
| SN-6 | Button cuts the same way | Use **Cut this bit out** instead | identical result — same function behind both | P1 | |
| SN-7 | Keep only this | Highlight, press it | the line is trimmed down to just the highlight | P2 | |
| SN-8 | Edge handles | Drag either 1px edge handle | in/out point moves, millisecond precision, 0.15s floor | P2 | |
| SN-9 | Cut stretches read as gone | After a cut | dark knock-out, red edge, diagonal line through it | P3 | |
| SN-10 | Click without dragging | Single click | playhead moves; no highlight | P3 | |
| SN-11 | Sub-4px drag | Drag ~2px | treated as a click | P3 | |
| SN-12 | Highlight inside an existing cut | Highlight a stretch already cut out, press Delete | **"that stretch is already cut out"**, the highlight **stays** so you can move it, nothing changes. **Correct behaviour** | P1 | |
| SN-13 | Highlight the whole line | Select it all, press Delete | *"that's the whole line — use Delete to drop it"* | P3 | |
| SN-14 | Leave under 0.15s | Highlight almost everything | refused | P2 | |
| SN-15 | Highlight at the very start | Highlight from the in-point | becomes a trim of that edge, not a hole | P2 | |
| SN-16 | Highlight at the very end | Highlight to the out-point | same, at the other edge | P2 | |
| SN-17 | Highlight before the in-point | Highlight a region **earlier** than the in-point, press **Cut this bit out** | the line must not get **longer** | P1 | |
| SN-18 | Delete twice quickly | Press Delete twice | **one** cut, then "already cut out" | P1 | |
| SN-19 | Four Deletes in one tick | Hammer Delete on one selection | one hole, one snapshot, then "already cut out" | P1 | |
| SN-20 | ⌘Z after a cut | Press ⌘Z | **"Undid cutting that bit out"** and the line goes back **exactly** | P1 | |
| SN-21 | ⌘Z reaches inside the open editor | Cut, then ⌘Z without closing | the open editor updates too — not just the row behind it | P1 | |
| SN-22 | ⌘Z after a no-op | SN-12, then ⌘Z | **"there was nothing to undo"** — no dead step was left on the stack | P2 | |
| SN-23 | Partly-overlapping cut | Highlight a span half inside an existing hole | **KNOWN** (Part 5 #11) — only the new part is removed, but the message names the whole selection | P3 | |
| SN-24 | Second trim is undoable | Trim, save, trim again, ⌘Z | the **second** trim undoes. Every trim after the first being unundoable is a failure | P1 | |
| SN-25 | Cancel | Open, drag an edge, Cancel | closes without saving; nothing changed on disk | P2 | |
| SN-26 | Save trim | Move an edge, Save trim | the edges commit and a rebuild starts | P1 | |
| SN-27 | No-op trim | Drag an edge back to exactly where it was, Save | says so; no version burned, no undo step, no learning entry recorded | P2 | |
| SN-28 | Page stays still while dragging | SN-4 and SN-8, both | **the page must not move**, vertically or horizontally | P1 | |
| SN-29 | Editor is current after undo | Cut, ⌘Z, look at the open editor | the waveform and hole overlay match the restored state | P2 | |

---

## TK — Takes

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| TK-1 | Panel opens | Press **Takes** on a line | the other attempts at that line are listed | P2 | |
| TK-2 | Candidate media plays | Play a candidate | the file exists and plays; a missing file is a failure | P2 | |
| TK-3 | Pick a different take | Choose one, **Approve this pick** | the line changes to that take and the cut rebuilds | P1 | |
| TK-4 | Reading the panel is not a write | Open Takes on a project, close it, check `review-state.json` | take picks, trim edits and diagnoses are **unchanged**; opening the panel must never erase decisions | P1 | |
| TK-5 | Learning from picks | Override several picks, then look at future drafts | **KNOWN** (spec 2.4, DOCKET R3) — the learner is wired up and has never been taught; picking works, it just does not change future drafts yet | P3 | |

---

## GR — Graphics

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| GR-1 | Section is folded under the timeline | Look | a collapsed section, not a separate panel | P4 | |
| GR-2 | Six kinds offered | Open the dialog | definition, stat, callout, emphasis, lower third, AI overlay | P3 | |
| GR-3 | Generate for one line | Press **Graphic** on a row and generate | about a second, read off the existing transcript | P2 | |
| GR-4 | Voice box | Describe a graphic by speaking | the box accepts speech; the microphone was asked for **at launch**, not mid-sentence | P3 | |
| GR-5 | Burn in | Press **Burn in (N)** | renders to a **separate** file; the clean cut is not overwritten | P1 | |
| GR-6 | With graphics appears | After a graphics render | the third player mode shows up | P3 | |
| GR-7 | Failed render says why | Force a graphics render to fail | the real ffmpeg message is shown, not a generic failure | P2 | |
| GR-8 | Delete one graphic | Create two in quick succession, delete one | only that one goes | P2 | |
| GR-9 | AI overlay | Request one | **KNOWN** (Part 5 #7) — recorded and listed, nothing generates an image. Parked on cost | P3 | |

---

## ST — Settings

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| ST-1 | Profile | Change name and organisation, reload | saved | P3 | |
| ST-2 | Microphone | Open the section | reports the permission state truthfully | P3 | |
| ST-3 | Editing tools | Add a rule, remove a rule | both take effect and survive a reload | P2 | |
| ST-4 | Reference upload | Upload a raw video and your finished edit of it | both accepted; the app measures the difference and derives a target | P1 | |
| ST-5 | House style is used | After ST-4, re-score a cut | the Pacing metric reads off the derived target | P2 | |
| ST-6 | Reference types | Try `.mp4` `.mov` `.m4v` `.webm`, then `.avi` and `.mkv` | the first four accepted, the last two refused — **narrower than the importer**. Real inconsistency; flag it if it matters to you | P3 | |
| ST-7 | Reference cap | Upload over 600 MB | refused, saying so — while the project importer has no cap | P3 | |
| ST-8 | Right files credited | Upload two reference pairs at once, read `house-style.json` | each measurement is credited to the file it came from | P2 | |
| ST-9 | Products & links | Add product names and an affiliate tag, save | **KNOWN** (Part 5 #8) — the form saves; nothing in the app reads the file yet | P3 | |
| ST-10 | Product catalogue survives | Save products, reload, save again | the list is still there; a failed read must not write an empty catalogue over it | P1 | |

---

## CN — Connectors

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| CN-1 | Eight tiles | Open Connectors | TikTok Shop, Instagram, Pinterest, Trybe, X, Snapchat, Facebook, Amazon Storefront | P4 | |
| CN-2 | All not connected | Read them | **KNOWN** (Part 5 #6) — all eight permanently "not connected", awaiting a developer account each. **Do not file** | P4 | |

---

## KB — Keyboard

All on the Review screen. Run **KB-0 first** — if shortcuts fire while typing,
every other row is unsafe to trust.

| ID | Key | Expected | Pri | R |
|---|---|---|---|---|
| KB-0 | any | **Nothing fires while the caret is in a text box.** Type "soft" in a graphic description and confirm no split, no delete, no marker | P1 | |
| KB-1 | **Space** | play/pause; with a snippet editor open, plays that line | P2 | |
| KB-2 | **J / K / L** | shuttle back / stop / forward, doubling up to 8× | P3 | |
| KB-3 | **← / →** | one frame | P3 | |
| KB-4 | **Shift + ← / →** | one second | P3 | |
| KB-5 | **Home / End** | first / last line | P3 | |
| KB-6 | **↑ / ↓** | previous / next line | P3 | |
| KB-7 | **I / O** | set in / out at the playhead | P2 | |
| KB-8 | **S** | split the selected line at the playhead | P2 | |
| KB-9 | **⌘B** | split whichever line the playhead is inside — **in both player modes**, not only Your cut | P2 | |
| KB-10 | **[ / ]** | nudge in/out by 0.05s | P3 | |
| KB-11 | **Shift + [ / ]** | nudge by 0.20s | P3 | |
| KB-12 | **T** | open the snippet editor | P3 | |
| KB-13 | **M** | drop a marker **where the playhead is** — in Your cut as well as Rendered file | P3 | |
| KB-14 | **F** | clear the selection | P4 | |
| KB-15 | **N** | jump to the next line needing a call | P3 | |
| KB-16 | **Delete / Backspace** | delete the highlighted stretch, or the selected line | P1 | |
| KB-17 | **⌘Z** | undo | P1 | |
| KB-18 | **⌘⇧Z** | **KNOWN** — there is no redo. Does nothing | P3 | |
| KB-19 | **⌘Z** in the native window | Same as KB-17, but in the **app window**, not the browser. Historically untested; the native menu must not swallow it | P1 | |
| KB-20 | undo depth | 24 steps back | P2 | |
| KB-21 | undo after refresh | **KNOWN** — the edit survives, the undo stack does not | P3 | |

---

## XC — Behaviours that cut across everything

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| XC-1 | No render button for ordinary edits | Make any edit | the rebuild starts by itself; there is nothing to press | P1 | |
| XC-2 | Every write is snapshotted | Make several edits, open History | a version per change, each with its reason ("cutting that bit out", "trim hook", "undo"); **60** kept | P1 | |
| XC-3 | Restore, and undo the restore | Restore an old version, then ⌘Z | the restore applies, and is itself undoable | P1 | |
| XC-4 | A no-op says so | Repeat an action that changes nothing (SN-12, a reorder to the same place, a fade already set, undo with nothing to undo) | it says so. **No write, no version burned, no undo step** | P1 | |
| XC-5 | Stall warning before the kill | Make a step go quiet | at **150s**: *"still working — nothing reported for 150s. If it stays quiet for another 150s it will be stopped."* Repeats. Killed at **5 minutes** of true silence. The numbers in the sentence are computed — a step with shorter patience warns proportionally sooner | P2 | |
| XC-6 | Healthy jobs are never warned | Run a normal transcribe and a normal render | no stall warning at all — 20s of quiet is normal and must not trip it | P2 | |
| XC-7 | Only one heavy job | Ask for a second transcribe or render | refused, with a message naming what is already running | P2 | |
| XC-8 | Failed job stops saying "running" | Make a build fail | it reports failed everywhere, and the next build is not refused with a 409 | P2 | |
| XC-9 | A crash is not the caption | Make a tool throw | the traceback goes to the log; the caption stays a sentence, and the job does not claim 100% done | P2 | |
| XC-10 | Live job keeps its log | Reload the page mid-job | the log so far is still there | P3 | |
| XC-11 | Twelve filmstrips at once | Load the review page cold and watch CPU | the page must not spawn a dozen simultaneous renders | P3 | |
| XC-12 | One 500 does not disable the UI | Force a poll to 500 | build buttons keep working without a reload | P2 | |
| XC-13 | Toasts do not eat each other | Delete something (9s undo toast), then do something small | the short toast must not clear the undo toast, and the Undo button must not offer to undo a different action | P2 | |

---

## ME — Measurement: did the export actually come out right?

Part 6 ranks this first, and an export can report success and still be wrong.
**Run these against the built file, not against the UI.**

Note the real paths — the spec's `tools/verify_removals.py` does not exist
from the repo root.

| ID | Command / check | Expected | Pri | R |
|---|---|---|---|---|
| ME-1 | `python3 qa/verify_media.py <project-dir>` | all checks pass. Slow as written — it decodes 4K video to measure audio; add `-vn -map 0:a:0` to the silence pass if you are waiting | P1 | |
| ME-2 | Silent stretches | **no stretch over ~3s**, and ideally none over 1.5s at −50dB | P1 | |
| ME-3 | Black frames at the joins | none | P1 | |
| ME-4 | Streams | a video stream and an audio stream; sane fps (20–61) and resolution | P1 | |
| ME-5 | A/V length | the two stream durations within a few ms of each other | P1 | |
| ME-6 | Length vs EDL | drift no more than one frame per piece — that much is frame quantisation, not a defect | P2 | |
| ME-7 | `python3 ugc-edit-system/tools/verify_removals.py --project <project-dir>` | every interior removal below the speech floor. **Caveat:** its per-fragment `-ss` seek lands late on this footage, by up to ~85ms, so on fragments of a few tens of ms it measures the wrong audio. Treat a clean result as weak evidence until that is fixed | P1 | |
| ME-8 | `python3 qa/verify_edges.py --project <project-dir> --interiors` | no edge fragment carries speech. A flagged fragment at the end of an **abandoned take** is the next take's first word and is correct — the tool prints the line so you can tell | P1 | |
| ME-9 | `python3 qa/verify_words.py <new-dir> --against <old-dir>` | **0 words lost** against the previous build. This is the honest word-loss test; the absolute count is an upper bound only | P1 | |
| ME-10 | Watch it | Open the exported file and watch it end to end. No line spoken twice, no missing audio, no join that jars | P1 | |
| ME-11 | Split then export | Split a line with **S**, rebuild, watch | the line is spoken **once**; holes, fades and detached audio land on the correct half | P1 | |
| ME-12 | `hook-1` / `hook-2` | Have two beats whose labels differ only by a trailing number, rebuild | both survive as separate beats; they must not collapse into one | P2 | |
| ME-13 | Build at full resolution | Press Build | full resolution, not the 720p review render. Compare with the auto cut | P2 | |
| ME-14 | Pipeline changed under an old build | After any change to the cutting code, open a project built before it | **GAP** — nothing tells you the cut is stale relative to the pipeline. Rebuild before trusting any measurement of an old file | P3 | |

---

## RB — Robustness: interrupt it, corrupt it, be impatient

| ID | Case | Steps | Expected | Pri | R |
|---|---|---|---|---|---|
| RB-1 | Quit mid-render | Quit the app during a build, reopen | no half-written cut presented as finished; the job is not stuck "running" | P1 | |
| RB-2 | Refresh mid-edit | Reload the browser while an edit is in flight | the edit either landed or did not — never half of it | P1 | |
| RB-3 | Two jobs | Start two builds | XC-7 | P2 | |
| RB-4 | Close vs Quit | Click the window's close button, then use Quit | close closes the window; Quit quits the app | P3 | |
| RB-5 | Invalid `beats.json` | Edit a project's `beats.json` to broken JSON, load the Queue | the Queue **still loads**, that project appears **saying it is broken**, and every other project is unaffected | P1 | |
| RB-6 | `{"beats": null}` | Same, with valid JSON of the wrong shape | same as RB-5 — it must not throw several calls away | P1 | |
| RB-7 | Truncated `review-state.json` | Truncate it, then open **Takes** | the broken file is **kept** as `review-state.json.corrupt-<timestamp>`, the app says where it went, and your decisions are not silently replaced with defaults | P1 | |
| RB-8 | Negative or inverted EDL duration | Hand-edit one piece to a negative `dur` | the timeline does not run backwards; the beat falls back to its own extent | P2 | |
| RB-9 | Hole covering a whole beat | Trim repeatedly toward the same edge | a hole must never end up covering the entire beat | P2 | |
| RB-10 | Bad request bodies | `curl` a JSON route with `null`, `7`, `"hello"`, `[]`, `true` | a sentence and a 4xx, never a 500 with a stack | P2 | |
| RB-11 | Range past EOF | Request a media byte range beyond the file | clamped, not a 416 | P3 | |
| RB-12 | Double-click everything | Every button on every screen | one action each | P2 | |
| RB-13 | Hammer Delete | Hold it down on a selection, and on a row | one cut / one delete, then a no-op message | P1 | |
| RB-14 | Drag while playing | Start playback, then drag a clip, an edge, and a selection | no runaway, no page movement, no lost edit | P1 | |
| RB-15 | Gatekeeper on another Mac | Open the bundle elsewhere | **KNOWN** (Part 5 #13) — unsigned, blocked. Needs an Apple account | P3 | |
| RB-16 | Apple Silicon | Run on an M-series Mac | **KNOWN** (Part 5 #14) — runs under Rosetta; Intel-only build | P3 | |

---

## KG — Known-gaps register

Confirm each is still the known state. **Do not file these.** If one has
changed, that is the interesting result.

| ID | Gap | Still true? |
|---|---|---|
| KG-1 | The spoken word is not highlighted during playback (line level works) | |
| KG-2 | No captions or subtitles anywhere | |
| KG-3 | No filler-word removal ("um", "uh") | |
| KG-4 | No audio levelling, no music bed | |
| KG-5 | No redo | |
| KG-6 | All eight Connectors say "not connected" | |
| KG-7 | AI overlay generates no image | |
| KG-8 | Products & links saves but nothing reads it | |
| KG-9 | Auto cut is 720p, Build is full resolution, nothing on screen says which | |
| KG-10 | The finished cut may still contain repeated phrases | |
| KG-11 | A partly-overlapping cut reports the whole highlight length | |
| KG-12 | Filmstrip may show the previous render's frames | |
| KG-13 | Gatekeeper blocks the app on any other Mac | |
| KG-14 | Apple Silicon runs it under Rosetta | |
| KG-15 | No accessibility work has been done; screen-reader and keyboard-only support unknown | |

---

## Exit criteria

A pass is finished when:

1. `./scripts/test` is green and the bug board shows only its expected open item.
2. Every **P1** row is `P`, `B` with a reason, or filed.
3. **ME-1 through ME-10** have run against a freshly built cut, and ME-10 —
   somebody actually watching the file — has been done by a person.
4. Every KG row is confirmed, and any that changed is called out.
5. Anything not run is listed as **NOT TESTED** by ID. A gap that is named
   costs far less than one that is assumed covered.

**One rule, from the spec and worth repeating:** this app works on real,
irreplaceable footage. Test destructively against a throwaway `SNIPAI_DATA`,
never against a project that matters.

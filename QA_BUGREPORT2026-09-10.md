# SnipAi — QA bug report, 2026-09-10

**Tested against:** `SNIPAI_QA_SPEC.md` (repo `~/Projects/SnipAi`, HEAD `ffaa8bf`)
**Surfaces:** Pass 1 — command line on the machine. Pass 2 — the app's own web UI at `http://127.0.0.1:4737`, driven in Chrome.
**Projects used:** `img-9817` (34 beats) and `img-9823` (61 beats), plus a throwaway `zz-qa-broken` created and removed during testing.

**Two things to read before the table.**

1. **The native `SnipAi.app` window could not be driven.** Desktop control on this Mac was held by another Claude session for the whole run, so every GUI observation below comes from the app served at `127.0.0.1:4737` in Chrome — a surface the spec explicitly endorses (Part 7). Anything marked *browser-only* below has **not** been confirmed or ruled out in the native window, and that is the single biggest gap in this report.
2. **The reference image was never supplied.** The instructions referred to an image in `~/Downloads` but left the filename and description as unfilled placeholders, and nothing in `~/Downloads` matches a recently renamed image. No finding below is anchored to it.

**Your footage was not harmed.** `img-9817/beats.json` was backed up before destructive testing and verified byte-identical to the backup afterwards.

---

## Summary

| Bug ID | Title | Severity | Feature | Found via |
|---|---|---|---|---|
| BUG-001 | Video never loads in the player or the snippet monitor | Critical | Review screen — the editor | Both |
| BUG-002 | The rendered cut has its index at the end of the file, so it can never start streaming | High | Review screen — the editor | Terminal |
| BUG-003 | Two beat out-points clip the last consonant of the line | High | End-to-end journey | Terminal |
| BUG-004 | `./scripts/test` says "do not ship" with 173 of 173 tests passing | Medium | Running it | Terminal |
| BUG-005 | `./scripts/qa --full` contradicts itself inside a single run | Medium | Running it | Terminal |
| BUG-006 | The pipeline suite is skipped and "all green" is printed anyway | Medium | Running it | Terminal |
| BUG-007 | An empty POST to the import endpoint returns a bare 500 | Medium | Queue (the home screen) | Terminal |
| BUG-008 | Two different overall scores for the same project | Medium | Review screen — the editor | Terminal |
| BUG-009 | The flagged-line count disagrees between the queue and the review screen | Medium | Review screen — the editor | Terminal |
| BUG-010 | A large blank region replaces the top of the review screen after an edit | Medium | Review screen — the editor | GUI |
| BUG-011 | The queue counts an untranscribed project as needing review | Low | Queue (the home screen) | GUI |
| BUG-012 | The mouse wheel over the timeline does not scroll the page | Low | Review screen — the editor | GUI |
| BUG-013 | Saving an empty rule does nothing and says nothing | Low | Settings | GUI |
| BUG-014 | The launch log warns that the start command is wrong for this build | Low | Running it | Terminal |
| BUG-015 | Undocumented status pill "Beat draft" | Needs clarification | Queue (the home screen) | GUI |
| BUG-016 | The queue card shows a progress bar and percentage when no job is running | Needs clarification | Queue (the home screen) | Both |
| BUG-017 | Undocumented "Keep the exported file current" checkbox above the player | Needs clarification | Review screen — the editor | GUI |
| BUG-018 | The lines list is in source time while the timeline is in cut time | Needs clarification | Review screen — the editor | GUI |
| BUG-019 | Undocumented "Pipeline" tab in Settings | Needs clarification | Settings | GUI |
| BUG-020 | Profile is read-only with no way to change name or organisation | Needs clarification | Settings | GUI |
| BUG-021 | The spec says 165 unit tests; the suite reports 173 | Needs clarification | Running it | Terminal |

---

## Queue (the home screen)

## [BUG-007] An empty POST to the import endpoint returns a bare 500
**Feature:** Queue (the home screen)
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. With the app running, open `http://127.0.0.1:4737/dashboard` in a browser.
2. Open the browser's developer console.
3. Run: `await fetch('/api/projects', { method: 'POST', body: '', headers: {'content-type':'application/json'} })`
4. Read the status and the response body.

**Expected behavior:** Every other bad input to this app answers with a 4xx and a JSON `{"error": …}` sentence. Sending nothing is a client mistake, so it should be refused the same way — the spec's cross-cutting rule is that the app says what is wrong rather than failing silently.

**Actual behavior:** Returns **500** with a completely **empty response body** — no status text, no error JSON, nothing for the caller to show a user. This is the only endpoint out of thirteen probed that behaves this way; a malformed-but-present body on the same route correctly returns `400 {"error":"project name must be lowercase kebab-case"}`.

**Evidence:**
```
POST /api/projects  (empty body)
  -> 500 (44ms) | <empty>

POST /api/projects  (FormData with one file, no name field)
  -> 400 | {"error":"project name must be lowercase kebab-case"}
POST /api/projects/img-9817/beats  (body: "{not valid json")
  -> 400 | {"error":"body must be JSON"}
PATCH /api/projects/img-9817/pipeline  (body: "{}")
  -> 400 | {"error":"beats must be an array"}
```
No server-side stack trace was captured — the running server's request errors do not reach `.snipai.log`, which contains only the startup banner.

**Suspected area:** The import path behind **Import footage** on the queue.

---

## [BUG-011] The queue counts an untranscribed project as needing review
**Feature:** Queue (the home screen)
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open the Queue. Note the summary line: `2 projects · 2 need your review · 14m 59s cut`.
2. Create a third project folder under `~/Movies/SnipAi/projects/` containing `raw/`, `cuts/`, `work/` and a `beats.json` that is not valid JSON.
3. Reload the Queue.

**Expected behavior:** Per the spec, the summary reads *"N projects · N need your review · Xm Ys cut"*, and "need your review" means projects that are built and waiting on a human.

**Actual behavior:** The line reads `3 projects · 3 need your review · 1 awaiting a beat draft · 14m 59s cut`. The third project has no transcript, no cut, 0 beats and a status pill of "Beat draft" — it is not waiting on review, and the same line already counts it separately as "1 awaiting a beat draft". It is counted twice, once wrongly.

**Evidence:** Queue summary line, observed before and after adding the third project. Same run as BUG-015.

**Suspected area:** The summary line above the project cards on the Queue.

---

## [BUG-015] Undocumented status pill "Beat draft"
**Feature:** Queue (the home screen)
**Severity:** Needs clarification
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Create a project folder under `~/Movies/SnipAi/projects/` with `raw/`, `cuts/`, `work/` and an invalid `beats.json`.
2. Open the Queue.
3. Read the status pill on that project's card.

**Expected behavior:** The spec's status pill table lists exactly five values: *Needs fixes*, *Ready to review*, *Needs your review*, *Approved*, *Unscored*. A project with no transcript should read **Unscored**.

**Actual behavior:** The card shows a pill reading **"Beat draft"**, which is not in the spec's table. Either the pill is new and the spec is stale, or the wrong pill is being chosen for this state.

**Evidence:** Card for `Zz Qa Broken` on the Queue, pill text "Beat draft", alongside `0 beats · no cut built yet`.

**Suspected area:** The status pill on the project card, Queue.

---

## [BUG-016] The queue card shows a progress bar and percentage when no job is running
**Feature:** Queue (the home screen)
**Severity:** Needs clarification
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Open the Queue with no job running on any project.
2. Look at the `Img 9817` card: below the title there is a full-width bar and a right-aligned `85%`, captioned `Rebuild to match your edit`.
3. Look at `Img 9823`: the same bar, `75%`, captioned `Needs your review`.

**Expected behavior:** The spec says a progress bar with a percentage and a changing verb is what a project **with a job running** shows, and that it updates every couple of seconds. The card's documented contents for an idle project are thumbnail, title, beat count, cut filename, source → cut length, status pill, Open and ⋯.

**Actual behavior:** Idle projects render what looks exactly like a running-job progress bar. The number is not job progress — the API reports it as `progressPct`, a weighted completion-through-stages figure (footage 15, transcript 15, beats 20, cut 25, reviewed 10, approved …). Nothing on screen distinguishes "this project is 85% of the way through its lifecycle" from "a job is 85% done", and the caption next to it is a verb phrase, which reinforces the wrong reading.

**Evidence:** Queue screen; `GET /api/projects` returns `"progressPct": 85` with a `stages` array for `img-9817` while no job is running.

**Suspected area:** The project card on the Queue.

---

## Review screen — the editor

## [BUG-001] Video never loads in the player or the snippet monitor
**Feature:** Review screen — the editor
**Severity:** Critical
**Status:** Confirmed reproducible *(browser-only — see the note at the top)*
**Found via:** Both

**Steps to reproduce:**
1. Open `http://127.0.0.1:4737/dashboard`.
2. Click **Open** on `Img 9817`.
3. Wait for the review screen. Look at the video area above the timeline.
4. Click **Your cut**, then **Rendered file**. Wait 30 seconds on each.
5. Select any line, click **Trim**, and look at the small monitor at the left of the snippet editor. Click **Play**.

**Expected behavior:** **Your cut** plays the edit live off the footage, jumping line to line, with every change visible immediately. **Rendered file** plays the exported file. The snippet editor's monitor shows the line.

**Actual behavior:** Every video surface stays solid black, indefinitely, in all three modes. No error is shown. Pressing Play changes nothing. Both `<video>` elements sit permanently at `readyState=0` (HAVE_NOTHING) with `networkState=2` (loading), `videoWidth 0`, `duration NaN`, and — notably — **no media error is ever raised**, so the app has nothing to display and no reason to complain.

This is not the app's player component: a bare `<video>` created in the console and pointed at the same URL also times out at `readyState=0` after 10 seconds.

**Cause found after the first draft of this report — it *is* the server, in one specific way.** The media route returns **416** for any range whose *end* runs past EOF, instead of clamping to `size - 1` and serving 206. Per RFC 7233 only a range whose *start* is past EOF may be refused. A browser's media stack opens with exactly this kind of over-long or open-ended range, gets 416, and abandons the load without raising an error — which is precisely the symptom:

```
bytes=0-99999999          -> 416 | content-range: bytes */56151928
bytes=56151828-56156928   -> 416   <-- start is INSIDE the file; unambiguously wrong
bytes=56151928-           -> 416
bytes=0-112303856         -> 416
```

This is **already in your ledger as S18** (`media/[...path]/route.ts:73`, "416 for a range past EOF instead of clamping to `size - 1`"), filed as an unremarkable spec-compliance nit. It is not a nit — it is why no video plays anywhere in the app. S18 has been moved to **Fix first** in the ledger with this evidence attached.

Everything else about the route is correct and fast, which is exactly why this looked like a player problem:

```
HEAD /api/media/img-9817/work/source-proxy.mp4
  -> 200 | type=video/mp4 | len=56151928 | accept-ranges=bytes
Range bytes=0-1023        -> 206 | 1024 bytes  | content-range: bytes 0-1023/56151928     | 15ms
Range bytes=0-65535       -> 206 | 65536 bytes | content-range: bytes 0-65535/56151928    | 15ms
Range bytes=0-            -> 206 | 56151928 bytes                                        | 619ms
Range bytes=56151000-…    -> 206 | 928 bytes                                             | 7ms
```

And the file itself is sound and browser-friendly — `ffprobe` reports H.264 High / yuv420p / 406x720 / AAC-LC, 526.7s, with `moov` at byte 32, ahead of `mdat`.

So: in-bounds bytes are served correctly and the file is decodable — but the one request pattern a media element actually opens with is refused. Fix the clamp and the player should come back.

**Blocking:** this stops any visual verification of the cut, which the spec calls the single most valuable check (Part 6 #1). Everything about whether the finished video actually *looks* right is untested because of it.

**Evidence:** `qa-screenshots/bug-001-black-player-review-screen.jpg`. Console probe results quoted above.

**Suspected area:** The player above the timeline on the review screen, and the monitor inside the snippet editor — both fed by the media route.

---

## [BUG-002] The rendered cut has its index at the end of the file, so it can never start streaming
**Feature:** Review screen — the editor
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. Open a terminal in `~/Movies/SnipAi/projects/img-9817`.
2. Walk the top-level atoms of `cuts/img-9817-v6.mp4` (any MP4 atom dumper, or the short Python loop used here).
3. Compare against `work/source-proxy.mp4`.

**Expected behavior:** **Rendered file** in the player plays the exported file. For that to start without downloading the whole thing, the `moov` index has to sit ahead of the media data, the way the proxy is written.

**Actual behavior:** The exported cut is written with `moov` **last**:

```
cuts/img-9817-v6.mp4        (513,765,973 bytes, 98.4s, 2160x3840)
   atom ftyp at 0            size 32
   atom free at 32           size 8
   atom mdat at 40           size 513655512
   atom moov at 513655552    size 110421     <-- index at the end

work/source-proxy.mp4       (56,151,928 bytes, 526.7s, 406x720)
   atom ftyp at 0            size 32
   atom moov at 32           size 582516     <-- index at the front
   atom free at 582548       size 8
   atom mdat at 582556       size 55569372
```

A player has to fetch all 513 MB before it can show frame one. Independently of BUG-001, this alone makes **Rendered file** unusable over the local server, and would make the exported file slow to open in anything that streams.

Note this is *not* known gap #9. That gap is about the app not saying whether you are looking at the 720p auto-build or the full-resolution build. This is about how the file is muxed.

**Evidence:** Atom dump above; `ffprobe` output for both files.

**Suspected area:** The step that writes the finished file into the project's `cuts/` folder.

---

## [BUG-008] Two different overall scores for the same project
**Feature:** Review screen — the editor
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. Open the review screen for `img-9817`. Read the score button at the top right: it shows **53/100**.
2. In the console, run `await (await fetch('/api/projects')).json()` and find the entry for `img-9817`.
3. Compare `scorecardOverall` there with `scorecard.overall` from `await (await fetch('/api/projects/img-9817')).json()`.

**Expected behavior:** One project has one score. The spec describes a single score button showing `NN/100` and a panel breaking it into metrics.

**Actual behavior:** The two endpoints disagree for the same project at the same moment:

```
review screen / project detail : scorecard.overall  = 53
queue listing                  : scorecardOverall   = 76
metrics: Word cutoffs=76 | Take quality=79 | Repeated phrases=0 | Pacing vs. house style=55
```

76 is exactly the **Word cutoffs** metric, which suggests the queue is reporting the first metric rather than the overall figure. The queue card does not currently render this number on screen, so it is not yet visible to a user — but it is wrong wherever it is read, and it will be wrong the moment the card starts showing it.

**Evidence:** Console output quoted above.

**Suspected area:** The score shown on the review screen header versus the score carried in the queue listing.

---

## [BUG-009] The flagged-line count disagrees between the queue and the review screen
**Feature:** Review screen — the editor
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. Open the review screen for `img-9817`. The header pill reads **"12 of 34 need a call"**, and the Lines section reads **"22 CLEAN · 12 NEEDS A CALL"**.
2. In the console, fetch `/api/projects` and count `flaggedBeatLabels` for `img-9817`.

**Expected behavior:** The pill reports how many lines need a human call; that count should be the same everywhere it appears.

**Actual behavior:** Three numbers for the same thing:

```
review header pill / lines list : 12
queue flaggedBeatLabels         : 6   ["between-eyes-looks","under-eyes-looks","need-egf-3",
                                       "good-thing-theres","just-drop-here","egf-going-improve"]
beats.json entries marked needs_review : 0
```

The review screen's 12 and the queue's 6 are both derived from the same project and cannot both be right.

**Evidence:** Console output quoted above; header pill and lines-list footer on the review screen.

**Suspected area:** The "N of M need a call" pill in the review header, and the flagged-beat list in the queue listing.

---

## [BUG-010] A large blank region replaces the top of the review screen after an edit
**Feature:** Review screen — the editor
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open the review screen for `img-9817`.
2. Scroll down until the Lines list is visible.
3. Click any line row to select it — or perform an edit and press **⌘Z**.
4. Screenshot immediately.

**Expected behavior:** Selecting a row highlights it and scrolls it into view. The spec is emphatic that the page should stay put during interaction, and nothing in it describes the header, player and timeline leaving the screen.

**Actual behavior:** For roughly a second, the top two-thirds of the viewport render as an empty region — no header, no player, no timeline — with the lines list starting partway down the page. It resolves on the next render. Reproduced twice from two different actions (row click, and ⌘Z after a delete).

**Evidence:**
- `qa-screenshots/bug-010-blank-viewport-after-row-click.jpg`
- `qa-screenshots/bug-010-blank-viewport-after-undo.jpg`

**Suspected area:** The review screen's re-render after a state change, and the scroll-into-view behaviour of the lines list.

---

## [BUG-012] The mouse wheel over the timeline does not scroll the page
**Feature:** Review screen — the editor
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open the review screen for `img-9817`, scrolled to the top.
2. Put the pointer over the timeline — either the video track or the waveform below it.
3. Scroll the wheel down several ticks.

**Expected behavior:** The spec assigns zoom to **Fit**, **−**, **+** and **⌘ + scroll**. Reserving the modified gesture for zoom implies the plain wheel behaves normally, i.e. scrolls the page.

**Actual behavior:** Nothing moves — neither the page nor the timeline. The wheel event is swallowed. Since the timeline is a tall band across the middle of the screen, a user scrolling down the page from the player hits it and the page stops responding until they move the pointer aside. This is easy to read as a freeze.

**Evidence:** Screenshots before and after a 5-tick wheel-down at the waveform (coordinates 700, 650) are pixel-identical, with the page still at scroll offset 0.

**Suspected area:** The timeline band on the review screen.

---

## [BUG-017] Undocumented "Keep the exported file current" checkbox above the player
**Feature:** Review screen — the editor
**Severity:** Needs clarification
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open the review screen for any project.
2. Look at the row of controls above the video: **Your cut**, **Rendered file**, then a ticked checkbox labelled *Keep the exported file current*, then the sentence *"Your edit, played straight off the original footage — every trim applies instantly."*

**Expected behavior:** The spec describes this row as "up to three mode buttons above the video" — *Your cut*, *Rendered file*, *With graphics* — and nothing else.

**Actual behavior:** There is an extra ticked checkbox with real consequences implied by its label (it presumably governs whether every edit triggers a re-render). It is undocumented, so I could not tell what unticking it is supposed to do, and I left it alone rather than change a setting on a real project. Worth documenting or, if it is a developer toggle, moving out of the main row.

**Evidence:** `qa-screenshots/bug-001-black-player-review-screen.jpg` — visible at the top of the player row.

**Suspected area:** The player mode row on the review screen.

---

## [BUG-018] The lines list is in source time while the timeline is in cut time
**Feature:** Review screen — the editor
**Severity:** Needs clarification
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open the review screen for `img-9817`.
2. Read the timeline ruler: it starts at `0:00.0` and the header says `34 clips · 2:06.8`.
3. Read the timecode column in the Lines list: line 1 is `1:18.9`, line 18 is `5:25.5`, line 34 is `8:36.5`.

**Expected behavior:** The spec says each line row shows "number, timecode, the line as spoken…" without saying which clock. Two clocks side by side on one screen need labelling either way.

**Actual behavior:** The lines list is in original-footage time (running to 8:36 of the 8m45s source) while the timeline directly above it is in finished-cut time (running to 2:06.8). A line's number in the list has no relationship to where its clip sits on the ruler. Not wrong, necessarily — but nothing on screen says which is which, and the first instinct is to read them as the same clock.

**Evidence:** Timeline header `34 clips · 2:06.8` against line 34 at `8:36.5`, same screen.

**Suspected area:** The timecode column of the Lines list, against the timeline ruler.

---

## The snippet editor (Trim)

No defects found. This section came through the spec's edge-case table cleanly and is the strongest part of the app I touched. For the record, all of the following behaved exactly as specified:

- Opens inline beneath the row, at the row's width. Monitor, filmstrip, high-resolution waveform, words laid out at their spoken positions, zoom `−`/`+` with a `4.1s` readout, and a bottom bar reading `1:28.3 → 1:30.4  2.12s` with **Play**, **Cancel**, **Save trim**.
- Dragging across the waveform produced `0.51s highlighted` with **Cut this bit out**, **Keep only this**, **Clear**.
- **The page did not move during the drag.** Scroll offset was `0,781` before and `0,781` after — the spec's second-hardest attack point, and it held.
- **Delete** cut the stretch; the timeline total went `2:06.8` → `2:06.3`, and a `-0.51s` badge appeared on the row. Pressing **Delete** a second time immediately did not double-cut.
- Highlighting an already-cut stretch produced exactly **"that stretch is already cut out"**, the highlight **stayed** in place, and nothing changed. Correct per spec.
- The cut region renders as a dark knock-out with a red edge and a diagonal through it. It reads as gone.
- **⌘Z** produced **"Undid cutting that bit out"** and the timeline returned to `2:06.8`.

The only caveat is BUG-001: the monitor at the left of the editor is black like every other video surface.

---

## Takes

Not tested — see the closing section.

---

## Graphics

Not tested — see the closing section.

---

## Settings

## [BUG-013] Saving an empty rule does nothing and says nothing
**Feature:** Settings
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Left rail → **Settings** → **Editing preferences**.
2. Leave the **Add a rule** box empty.
3. Click **Save**.

**Expected behavior:** The spec's cross-cutting rule is that an action which would change nothing *says so* rather than claiming success. Either refuse with a sentence, or disable the button while the field is empty.

**Actual behavior:** Nothing at all happens. No rule is added, no toast appears, no validation text, and the button does not look disabled. The user gets no signal that the click was received or why it did nothing.

**Evidence:** Screenshots before and after the click are identical; the rule lists under TAKE SELECTION, CUTTING RULES and PACING are unchanged.

**Suspected area:** The **Add a rule** form on the Editing preferences tab.

---

## [BUG-019] Undocumented "Pipeline" tab in Settings
**Feature:** Settings
**Severity:** Needs clarification
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Left rail → **Settings**.
2. Read the tab strip: **Editing preferences · Style references · Products & links · Profile · Pipeline**.

**Expected behavior:** The spec's Settings table lists five things: Profile, Microphone, Products SnipAi listens for + Amazon affiliate tag, Editing tools, and Videos to learn the style from / What SnipAi is aiming at. There is no Pipeline entry, and Part 5 does not list one as a known gap.

**Actual behavior:** A fifth tab, **Pipeline**, exists and is not described anywhere in the spec. I did not open it — an undocumented settings tab on a tool that operates on irreplaceable footage is not something to click blind on a live project. Flagging it so it gets either documented or removed.

Two smaller naming mismatches in the same strip, mentioned here rather than as their own entries: the spec's **Editing tools** appears as **Editing preferences**, and its **Videos to learn the style from** appears as **Style references**. Harmless, but a coding agent cross-referencing the two documents will not match them.

**Evidence:** Settings tab strip.

**Suspected area:** The Settings tab strip.

---

## [BUG-020] Profile is read-only with no way to change name or organisation
**Feature:** Settings
**Severity:** Needs clarification
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Left rail → **Settings** → **Profile**.
2. Look under the PROFILE heading.

**Expected behavior:** The spec's Settings table lists **Profile — name and organisation — works**, which reads as something you can set.

**Actual behavior:** The section renders the line `Kayer · Arzacorp` as plain text with the note *"Single-user for now — there are no accounts, and nothing leaves this machine."* There is no field, no edit control, and no save. Either the spec means "displays correctly" and this is fine, or an editor is missing. The MICROPHONE section above it is present and matches the spec, including the **Hold and say something to test it** control and the macOS privacy hint.

**Evidence:** Settings → Profile tab.

**Suspected area:** The PROFILE section of the Settings Profile tab.

---

## Connectors

No defects. Eight tiles — TikTok Shop, Instagram, Pinterest, Trybe, X, Snapchat, Facebook, Amazon Storefront — all reading "Not connected", exactly as Part 5 #6 describes. Not filed.

---

## Keyboard

Partially tested. **⌘Z** works on the review screen and inside the snippet editor, and **Delete** works in the snippet editor with the correct already-cut guard. The rest of the table is untested — see the closing section.

---

## Behaviours that cut across everything

Three of these were exercised and **passed**; recording them because they are the expensive ones to get wrong.

- **Does delete actually delete, and does ⌘Z put it back exactly?** Deleted line 3 (`smile-lines-look`, *"your smile lines look like this,"*) from the review screen. The row vanished, the list renumbered, the count went `22 CLEAN` → `21 CLEAN`, and a toast offered Undo. On disk, `beats.json` dropped from 34 to 33 entries within three seconds and `smile-lines-look` was gone. **⌘Z** then restored it — and the restored `beats.json` was **byte-identical** to the pre-test backup, with the beat back at its original index 2 and identical `start`/`end`/`text`. Exactly right.
- **A broken project stays visible.** Created a project with `beats.json` containing `{ this is not valid json ]]`. The queue still loaded, the other two projects were unaffected, and the broken one appeared on its own card reading *"beats.json is not valid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)"*. It did not vanish and it took nothing down with it.
- **Removals are clean.** `verify_removals.py` on both projects: 13 of 13 removals on `img-9817` and 32 of 32 on `img-9823` are below the project's own speech floor. Nothing audible has been cut out of the middle of a line.

## [BUG-003] Two beat out-points clip the last consonant of the line
**Feature:** End-to-end journey
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. `cd ~/Projects/SnipAi`
2. `python3 qa/verify_edges.py --project ~/Movies/SnipAi/projects/img-9817`
3. Read the fragments it reports, and read the line each one belongs to.

**Expected behavior:** The spec calls cutting a word in half "the single worst thing this app can do", and names these two exact words — the "s" of *this*, the "ce" of *face* — as where the only shipped clipping happened. Part 5 does not list word clipping as a known gap, so these should be clean.

**Actual behavior:** Both are still clipped. `verify_edges.py` reports 2 of 34 edge fragments carrying speech on `img-9817`:

```
speech in this project averages -18.2 dB
an edge fragment is speech if it is above -26.2 dB

2 of 34 edge fragments carry speech:

  under-eyes-looks  'this,'
    96.894-96.920  (26ms)  mean -22.5 dB  peak -12.4 dB
    line: And if under your eyes looks like this,
  egf-going-improve  'face.'
    163.999-164.020  (21ms)  mean -22.9 dB  peak -11.6 dB
    line: The EGF is going to improve the elasticity of your face.
```

Both fragments sit **inside** the line — they are the tail of the line's own final word, not the first word of an abandoned next take — which is the distinction the tool's own closing note asks the tester to draw. So these are clipped words, not take selection working.

**Not the poisoned `snap_tail`.** `~/Movies/SnipAi/state/tuning.json` shows `snap_tail: 0.01` as of 2026-09-10 07:32 with `overrides_seen: 0`, so the ledger's P2 (learning poisoned it to 0.881) has already been reset and is not the live cause. A 0.881 snap would leave hundreds of milliseconds past the out-point, not 21–26ms. The boundary placement itself is simply tight. P1's missing clamp is still unfixed, so the 0.881 case can recur — but that is a separate problem from this one. The ledger's stale "still poisoned to 0.881" note has been corrected.

For contrast, `img-9823`'s two flagged fragments **are** take selection working correctly and are **not** filed: `good-thing-medicube` ends *"…has a, I"* with 580ms past the out-point, and `no-guess` ends *"No, I guess, I"* with 685ms past it. In both the trailing fragment is a restart, and dropping it is right.

**Evidence:** Full `verify_edges.py` output quoted above, for both projects.

**Suspected area:** The out-point placement on beat edges, in whatever sets the cut boundaries.

---

## Running it

## [BUG-004] `./scripts/test` says "do not ship" with 173 of 173 tests passing
**Feature:** Running it
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. `cd ~/Projects/SnipAi`
2. `./scripts/test`
3. Read the last six lines.

**Expected behavior:** The spec says these checks are "all currently passing", that `1 still open` on the bug board "is expected and is a deliberate open item, not a failure", and that the run prints **"all green"** alongside that count.

**Actual behavior:** Every test passes and the run still ends in a red verdict:

```
# tests 173
# suites 32
# pass 173
# fail 0
# duration_ms 15448.050449

== bug board ==
  1 still open (2 fixed) -- ./scripts/qa --regressions

== guards ==
  every edit handler schedules a re-render
  the file chooser is implemented and matches the importer (2 inputs)
  no regression tests reported a result -- cannot check the ledger

== pipeline ==
  skipped -- no venv at ugc-edit-system/.venv/bin/python

something is broken -- do not ship
```

"all green" never appears. The verdict appears to treat the deliberate open bug-board item and/or the skipped pipeline suite as failures, which makes the script's headline useless — a real regression would look identical to this.

**Note on a false alarm worth recording:** the first run of this suite reported **24 failures**, every one an `EPERM: operation not permitted, unlink …` from a test tearing down its own temp project. That was the sandbox this session runs in refusing deletes, not the app. Once delete was permitted the same suite passed 173/173. Anyone re-running this in a restricted environment will hit the same phantom failures.

**Evidence:** Full run output above.

**Suspected area:** The verdict line at the end of the test script.

---

## [BUG-005] `./scripts/qa --full` contradicts itself inside a single run
**Feature:** Running it
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. `cd ~/Projects/SnipAi`
2. `./scripts/qa --full`
3. Read the nested "types and tests" section, then read the final line.

**Expected behavior:** One run, one verdict.

**Actual behavior:** The run prints a red **"something is broken -- do not ship"** inside its nested section and then finishes with **"notes above, nothing blocking"**, exiting 0. A reader gets opposite answers depending on where they look, and CI reading the exit code gets a third answer.

```
  == pipeline ==
    skipped -- no venv at ugc-edit-system/.venv/bin/python

  something is broken -- do not ship
  a suite was SKIPPED -- 'all green' does not mean all ran

== reproduced bugs (a failing test here is a bug still open) ==
  not ok 1 - S1: PATCH /pipeline keeps holes, fades and detached audio
  ok 2 - S2: a failed job reaches jobs.json
  ok 3 - S7: splitting a beat does not duplicate its audio and holes
  # pass 2
  # fail 1

notes above, nothing blocking -- /qa for the judgment layer
EXIT=0
```

The failing S1 is the deliberate open item the spec tells testers to expect, and is **not** filed as a bug.

Worth passing on separately: the same run flags four pieces of review state as written and never read back — `review-state.beatDiagnoses`, `review-state.spanCuts`, `review-state.deletedBeats`, `review-state.statusNote`. I chased `spanCuts` and `deletedBeats` specifically, because if edits were not being read back, delete and hole-cutting would silently not survive a reload. They do survive — the live delete/undo test above confirms `beats.json` is the source of truth and is updated correctly. So these four look like an append-only audit log rather than a defect, but the tool's own warning is worth a decision either way.

**Evidence:** Full run output above.

**Suspected area:** The verdict lines of the QA script.

---

## [BUG-006] The pipeline suite is skipped and "all green" is printed anyway
**Feature:** Running it
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. `cd ~/Projects/SnipAi`
2. `./scripts/qa --full`
3. Read the `== pipeline ==` section.

**Expected behavior:** The spec presents `./scripts/test` and `./scripts/qa --full` as the automated coverage, all currently passing.

**Actual behavior:** `skipped -- no venv at ugc-edit-system/.venv/bin/python`. The Python pipeline — the half of the app that does the actual cutting — is never exercised by the automated checks as the repo currently stands. The script is honest about it (`a suite was SKIPPED -- 'all green' does not mean all ran`), which is good, but the practical result is that a clean run says much less than it appears to. Either the venv should be part of setup, or the skip should be a hard failure.

**Blocking:** this is why nothing below the UI layer was verified automatically in this run.

**Evidence:** Run output quoted in BUG-005.

**Suspected area:** The pipeline stage of the QA script.

---

## [BUG-014] The launch log warns that the start command is wrong for this build
**Feature:** Running it
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. Start the app.
2. `tail ~/Projects/SnipAi/.snipai.log`

**Expected behavior:** A clean startup log.

**Actual behavior:** Every launch logs a Next.js warning that the configured start command is incompatible with the build output:

```
> snipai@0.1.0 start
> next start -p 4737 -H 127.0.0.1

  ▲ Next.js 14.2.35
  - Local:        http://127.0.0.1:4737
 ✓ Starting...
 ⚠ "next start" does not work with "output: standalone" configuration.
   Use "node .next/standalone/server.js" instead.
 ✓ Ready in 1564ms
```

The app does come up and serve. Recording it because it means the server running in front of the user is not the one the build was configured to produce, and it is a plausible thread to pull on for BUG-001 — a standalone build served the wrong way is exactly the sort of thing that breaks streaming media while leaving JSON routes fine.

Also worth noting: this log captures the startup banner only. No request errors reach it, which is why BUG-007's 500 has no stack trace.

**Evidence:** `.snipai.log` contents above.

**Suspected area:** How the app process is started behind `SnipAi.app`.

---

## [BUG-021] The spec says 165 unit tests; the suite reports 173
**Feature:** Running it
**Severity:** Needs clarification
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. `./scripts/test` and read `# tests`.
2. Compare with Part 7 of the spec.

**Expected behavior:** Spec says `./scripts/test` is 165 unit tests.

**Actual behavior:** `# tests 173`, `# suites 32`. Almost certainly the spec going stale rather than a defect, but flagging it because Part 7 is the one place a tester is given a number to check against.

**Evidence:** Test run output.

**Suspected area:** Part 7 of the spec document, or the test suite's own count.

---

## What I could not test, and why

**Blocked by another session holding the machine.** Desktop control of this Mac was taken by a different Claude session before this run started and never released, so `SnipAi.app` itself was never opened. Everything in Pass 2 came from the same app served in Chrome. The consequences:

- **The native window is entirely untested.** No confirmation that BUG-001 (black video) reproduces there — and this is the cross-reference that matters most. If video plays in the native window and not in the browser, the defect is in how the media route serves a browser and BUG-001 drops to Medium. If it is black in both, it is Critical as filed. **This is the first thing to check.**
- Window-level behaviour — closing mid-render, quitting mid-job, reopening — was not exercised.

**Blocked by BUG-001.** Part 6 ranks "does the finished video actually play correctly" as the single most valuable check. With every video surface black, none of it was possible: no check for silence over ~3 seconds, black frames at a join, missing audio, or a line spoken twice. The audio-level checks (`verify_removals.py`, `verify_edges.py`) were run and are reported above, but they measure audio, not picture, and they are no substitute.

**Not reachable from the test harness.**

- **Queue import edge cases.** The whole table — `.txt`/`.jpg` refusal, dedupe within one selection, duplicate-by-name-or-size, the 1.72 GB import, the 0-byte refusal, double-clicking Import, accented and emoji filenames, `../../etc/evil.mov` — could not be driven, because the file picker is a native macOS dialog and the harness could not put local files into it. Three of these are covered by unit tests that pass (`something that is not footage never creates a project`, `a second import of the same name is refused, not merged`, `a filename cannot escape the project's raw folder`), but none was confirmed through the interface, and the large-import and 0-byte cases are not covered anywhere I could see. Attempts to hit `/api/projects` directly with synthetic files were rejected at an earlier validation step (`project name must be lowercase kebab-case`) before reaching file-type checks, so they proved nothing.
- **⋯ menu → Delete, Recently deleted, and the 5-day restore window.** Not exercised — it moves a real project to trash and I was not willing to do that to live footage on a machine I could only half-observe.
- **History and the 60-version ledger.** Not opened.
- **Takes.** Not opened. Note the spec marks the preference-learning half as unfinished, but picking a take is supposed to work and was not tested.
- **Graphics.** Not opened. `img-9817` has 5 graphics recorded and no graphics render, so the **With graphics** player mode correctly did not appear.
- **Most of the Keyboard table.** J/K/L shuttle, arrows, Home/End, ↑/↓, I/O, S, ⌘B, `[`/`]`, T, M, F, N were not exercised, and neither was the rule that shortcuts must not fire while typing in a text box.
- **Timeline direct manipulation.** Dragging a clip to reorder, dragging the 1-pixel trim handles, the corner grip fade, marking a stretch on the audio track, scrub-with-audio, and ⌘+scroll zoom. The spec's "you should hear audio while scrubbing" cannot be verified through this harness at all.
- **Path traversal against the media route.** The one probe I tried was blocked by the browser tooling before it left the page. The equivalent unit test passes, but the live route is unverified.
- **The quiet-job warning at 150s and the 5-minute stop**, and **"only one heavy job at a time"**. No job was started — starting one on a real project during a black-box test was not a risk worth taking.

---

## Worked, but rough

Not bugs. Recording them because each one cost time to interpret.

- **The queue flashes empty on first load.** Opening `http://127.0.0.1:4737` shows the left rail against an empty content area for a beat before redirecting to `/dashboard` and painting. I nearly filed it as a blank-queue bug. A skeleton or holding the redirect would remove the false alarm.
- **The cut length on the queue card is the stale render's length.** `Img 9817` reads `8m 45s → 1m 38s`, while the review screen's timeline says the current edit is `2:06.8`. Both are correct — 1:38 is the exported file, 2:06.8 is the edit — and the card does carry *"that file was rendered before your latest edit"*. But the two numbers are 29 seconds apart with nothing tying them together, and the arrow notation reads as a statement about the project rather than about a stale file.
- **The broken-project message is a raw parser error.** *"beats.json is not valid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)"*. Precise and genuinely useful — but it is machine output in a UI that elsewhere speaks in sentences, and the spec flags exactly that pattern as worth reporting in the progress caption.
- **A missing project takes 2.1 seconds to 404.** `GET /api/projects/does-not-exist-zz` returned `404 {"error":"no project 'does-not-exist-zz'"}` in 2105ms, against 14–96ms for every other error response measured. Correct answer, twenty times slower than its neighbours.
- **`deletedBeats` is append-only.** `img-9817`'s review state lists `thing-good-thing` and `good-thing-theres` as deleted, but `good-thing-theres` is present in `beats.json` and on the timeline. I spent real time on this convinced it was a critical delete-persistence bug before the live delete/undo test showed `beats.json` is authoritative and correct. The log records what was done, including things later undone, and nothing says so. Anyone auditing this project from its state file will reach the same wrong conclusion I did.

---

*Report generated 2026-09-10. Screenshots in `qa-screenshots/`, filenames referenced in each entry.*

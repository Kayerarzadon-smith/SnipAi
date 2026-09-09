# SnipAi — QA bug report

Tested against `SNIPAI_QA_SPEC.md` (commit `06cc791`) on 2026-09-09.

**Two passes were run.**

- **Pass 1 (Terminal / sandbox)** — the dev server (`npm start` from `~/Projects/SnipAi`, i.e. `next start`),
  driven through a browser on `127.0.0.1:4737`, plus direct inspection of the project folders,
  `state/jobs.json`, `work/edl.json`, `work/transcript.json` and the exported files with `ffprobe`.
- **Pass 2 (Desktop / GUI)** — `SnipAi.app` launched from Finder, driven only as a user would:
  clicking, dragging, closing windows. No terminal.

Both passes used a throwaway library (`SNIPAI_DATA=~/Movies/SnipAi/qa-sandbox`) so the real
`~/Movies/SnipAi/projects` was never edited. The real projects **Img 9817** and **Img 9823** were opened
read-only in Pass 2 to cross-check two findings against real footage.

**The two passes do not agree, and the disagreement is where the worst bug lives.** The dev server and the
server inside `SnipAi.app` are different builds — the dev server even warns
`"next start" does not work with "output: standalone" configuration` on boot. Automatic re-rendering after an
edit works on the dev server and does not happen at all in the shipped app (BUG-006). Every divergence is
called out in the entry it belongs to.

Test footage: a 115-second 406×720 excerpt of the existing IMG_9817 material (real speech, real retakes),
plus three shorter clips cut from the same source.

Screenshots are in `qa-screenshots/` next to this file.

---

## Summary

| Bug ID | Title | Severity | Feature | Found via |
|---|---|---|---|---|
| BUG-001 | Auto-built cut chops words in half at intra-beat splits | Critical | End-to-end journey | Terminal |
| BUG-002 | Every build ends in an unhandled Python KeyError but reports success | High | End-to-end journey | Terminal |
| BUG-003 | Progress verbs and percentage bands do not match the documented phases | Low | End-to-end journey | Both |
| BUG-004 | "Import footage" opens no file picker in the desktop app | Critical | Queue (the home screen) | GUI |
| BUG-005 | Edits are saved but never rebuilt in the packaged app | Critical | Edits apply themselves | Both |
| BUG-006 | Queue advertises a stale cut as "Approved · Ready to post" | High | Queue (the home screen) | Both |
| BUG-007 | Queue, summary line and History overstate the cut length | High | Queue (the home screen) | Both |
| BUG-008 | Closing the window quits the app with no warning and no way back | Medium | Review screen — the editor | GUI |
| BUG-009 | Audio waveform never renders for newly imported projects | High | Review screen — the editor | Both |
| BUG-010 | "Your cut" plays the whole source instead of the edit | High | Review screen — the editor | GUI |
| BUG-011 | After ⌘Z the open snippet editor keeps the undone trim and re-applies it on Save | High | The snippet editor (Trim) | GUI |
| BUG-012 | Takes panel reports transcript/silence files "not present" when both exist | High | Takes | Both |
| BUG-013 | "Put back" from History is not undoable and clears the undo stack | Medium | Every write is snapshotted | GUI |
| BUG-014 | Quiet-job warning uses 20s/280s, not the documented 45s/255s | Low | A job that goes quiet warns before it's stopped | Both |
| BUG-015 | A 0-byte file is offered for import instead of being screened out | Low | Queue (the home screen) | Both |
| BUG-016 | Rejected reference videos are called "not a video", and only one rejection is reported | Low | Settings | GUI |
| BUG-017 | A refused second heavy job gives no message | Needs clarification | Only one heavy job at a time | GUI |
| BUG-018 | Approving a project did not refresh the card's status pill | Low | Queue (the home screen) | GUI |
| BUG-019 | A disk-full import failure is reported as "the connection dropped mid-import" | Low | Queue (the home screen) | GUI |

---

## End-to-end journey

## [BUG-001] Auto-built cut chops words in half at intra-beat splits
**Feature:** End-to-end journey
**Severity:** Critical
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. Launch SnipAi against an empty library and open the Queue.
2. Import talking-to-camera footage that contains pauses *inside* sentences (the 115 s excerpt used here
   starts at 00:76 of `IMG_9817.MOV`).
3. Wait for the four phases to finish and a cut to be built.
4. Open `~/Movies/SnipAi/projects/<name>/work/edl.json` and `work/transcript.json` and compare each EDL
   segment's `src_start` / `src_end` against the word start/end times in the transcript.

**Expected behavior:** The product's whole premise is a finished file that keeps "the best take of each line"
with "the dead air removed". Cuts should land between words. The scorecard even carries a **Word cutoffs**
metric for exactly this.

**Actual behavior:** When the pipeline splits a beat into sub-clips to drop interior silence, the split lands
*inside a word*, and the two fragments are joined with the middle removed. The first automatic build of the
test project did this at 15 points across 13 segments. The clearest cases:

| word | word span (source) | kept in clip A | resumes in clip B | removed between |
|---|---|---|---|---|
| ` good` | 33.620 – 34.640 | ends 33.636 (16 ms of the word) | starts 34.512 (last 128 ms) | 0.876 s |
| ` between` | 1.020 – 3.820 | ends 1.156 (136 ms) | starts 3.416 (last 404 ms) | 2.260 s |
| ` to` | 94.580 – 97.320 | ends 94.720 (140 ms) | starts 96.198 | 1.478 s |
| ` up` | 104.640 – 105.520 | ends 104.941 | starts 105.101 | 0.160 s |

The word ` cells` (97.880 – 99.040) is also truncated mid-word at 98.537 at the end of beat `power-up-cells`.

The scorecard reports **Word cutoffs 100%** for this project, so the check that exists for this class of
defect does not catch it.

**Evidence:**
- `work/edl.json`: `thing-good-thing-0` = `{"src_start": 33.36, "src_end": 33.636, "dur": 0.276}`,
  `thing-good-thing-1` = `{"src_start": 34.512, "src_end": 35.025, "dur": 0.513}`.
- `work/transcript.json`: `{"w": " good", "s": 33.62, "e": 34.64}`.
- Rendered clips match: `work/clips/p07_thing-good-thing-0.mp4` is 0.300 s, `p08_thing-good-thing-1.mp4`
  is 0.534 s.
- The exported file is otherwise technically clean — `ffmpeg silencedetect` (−35 dB, 1.5 s) found no long
  silences, `blackdetect` found no black frames, audio is present end to end. The defect is audible content,
  not container damage.

**Suspected area:** The take-selection / silence-splitting phase of the automatic build (the phase that writes
`work/edl.json`), and the Word cutoffs metric in the score panel.

---

## [BUG-002] Every build ends in an unhandled Python KeyError but reports success
**Feature:** End-to-end journey
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** Terminal

**Steps to reproduce:**
1. Import any video and let the build run to completion.
2. Open `~/Movies/SnipAi/qa-sandbox/state/jobs.json` and read the last job's `stage`, `status`, `progress`
   and `log`.

**Expected behavior:** A build that reaches 100% has completed its steps. The house-style comparison feeds the
score panel's **Pacing vs. house style** metric, which the spec lists as working.

**Actual behavior:** The comparison step raises an unhandled exception. The job's `stage` field ends up holding
the exception text, `status` is `done` and `progress` is `100`. Verbatim from `state/jobs.json`:

```
Traceback (most recent call last):
  File "/Users/kayer.arzadon-smith/Projects/SnipAi/SnipAi.app/Contents/Resources/pipeline/tools/compare_to_reference.py", line 77, in <module>
    sys.exit(main())
             ^^^^^^
  File "/Users/kayer.arzadon-smith/Projects/SnipAi/SnipAi.app/Contents/Resources/pipeline/tools/compare_to_reference.py", line 43, in main
    ("total length",     total,                       ref["duration"],                    "s",  ref["tolerance"]["duration_pct"]),
                                                                                                ~~~^^^^^^^^^^^^^
KeyError: 'tolerance'
```

11 of the 16 jobs recorded during testing carry this traceback — every job that ran a full build, starting
with the very first import at 18:00, and including builds run before any style reference existed. The five
that don't are graphics renders and the reference-measurement job, which don't run this step.

Two user-visible consequences: the queue card falls back to a generic **"Working…"** verb stuck at 98% while
the exception is the current stage (this is the "unchanging word" the spec's Part 6 warns about), and
**Pacing vs. house style** shows `—` in the score panel instead of a value.

The render itself still completes — the exported file is produced and is playable.

**Evidence:** Traceback above, copied verbatim from `state/jobs.json`. Job ids with the traceback include
`job-1788976800073-1ms0jj` (18:00:00, qa-clip), `job-1788979367919-0mj6f2` (18:42:47, qa-second),
`job-1788982553770-2zp4ks` (19:35:53, qa-drop-test).

**Suspected area:** The final comparison step of the build pipeline, and whatever decides a job's `status`
from its steps.

---

## [BUG-003] Progress verbs and percentage bands do not match the documented phases
**Feature:** End-to-end journey
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Import a video from the Queue.
2. Watch the project card's progress bar from 0% to 100% and note the verb at each percentage.

**Expected behavior:** Four phases with fixed bands — `Transcribing… 0–45%`, `Choosing the takes… 45–56%`,
`Shrinking for smooth playback 56–74%`, `Snipping… 74–100%`.

**Actual behavior:** Observed verbs and bands, consistent across both passes:

| observed verb | observed percentage |
|---|---|
| `Transcribing…` | 0% |
| `Working…` | 70 – 73% |
| `Choosing the takes…` | 74% |
| `Cutting the clips…` | 82 – 93% |
| `Stitching…` | 98% |
| `Editing it together…` | 98% |

`Shrinking for smooth playback` and `Snipping…` never appear. `Choosing the takes…` shows at 74%, not in the
documented 45–56% band. Two verbs that aren't in the spec at all (`Cutting the clips…`, `Stitching…`) do
appear, and `Working…` is a placeholder (see BUG-002).

**Evidence:** Verb/percentage pairs sampled every 1.2 s from the project card during three separate builds.

**Suspected area:** The stage labels reported by the pipeline job and rendered on the Queue card's progress bar.

---

## Queue (the home screen)

## [BUG-004] "Import footage" opens no file picker in the desktop app
**Feature:** Queue (the home screen)
**Severity:** Critical
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open `SnipAi.app` (double-click it in Finder).
2. On the Queue, click **Import footage** (top right).
3. Wait 10 seconds. Check both monitors if more than one is attached.

**Expected behavior:** "**Import footage** (top right) opens a file picker."

**Actual behavior:** Nothing opens. No file picker, no sheet, no error, no console-visible feedback. The button
does take keyboard focus — a focus ring appears around it after the click — so the click is being received;
it just never produces a picker. Repeated on three separate clicks and after an app relaunch.

**This is desktop-only.** The identical page served on `127.0.0.1:4737` and opened in a browser presents a
normal file chooser and imports fine — that is how every file in Pass 1 was imported. So the button works when
the page is in a browser and is dead when the same page is inside `SnipAi.app`.

**Workaround that does work:** dragging a file onto the window. The drop overlay ("Drop footage to start a
project / Drop several at once — they queue up") appears correctly, the file lands in the import tray with its
size and target project name, and **Import 1** completes normally. So the desktop app can import, but only by
drag-and-drop — a user with the video anywhere other than a visible Finder window or the Desktop has no route in.

**Blocks:** the first step of the end-to-end journey for any desktop user who doesn't think to drag.

**Evidence:** No screenshot — see "What I could not capture" at the end; `screencapture` on this machine
returns wallpaper only. The behaviour is fully described above and reproduced three times.

**Suspected area:** The Import footage control on the Queue screen, and how the desktop window handles a file
chooser request from the page it hosts.

---

## [BUG-005] Edits are saved but never rebuilt in the packaged app
**Feature:** Edits apply themselves
**Severity:** Critical
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Open `SnipAi.app` and open any built project from the Queue.
2. Hover a line in the **Lines** list and click **Delete** (or make any other edit).
3. Confirm the edit landed — the line disappears and a toast reads `✓ Cut "<line text>"`.
4. Leave the app open and wait two minutes.
5. Look in `~/Movies/SnipAi/qa-sandbox/projects/<name>/cuts/` and at
   `~/Movies/SnipAi/qa-sandbox/state/jobs.json`.

**Expected behavior:** "There is no 'render' button for ordinary edits. Cut something and the app rebuilds in
the background."

**Actual behavior:** The edit is written to `beats.json`, but **no rebuild job is ever created**. Two minutes
after the edit: `state/jobs.json` still held 16 jobs (unchanged), `work/edl.json` still carried its old
timestamp and still listed the deleted beat, and `cuts/` still contained only the previous render. No "Build
job" panel ever appears and `/api/jobs/running` returns `{"job":null}` throughout.

Three separate edits across three projects (a delete in `qa-clip`, a delete in `qa-drop-test`, a delete in
`qa-second`) produced zero rebuild jobs.

**This is the clearest divergence between the two passes.** In Pass 1, against the dev server, the same action
started a rebuild within a couple of seconds every time — nine renders (`v1` … `v9`) were produced from
successive trims and deletes, each with a visible "Build job (running)" panel and a matching entry in
`jobs.json`. Against the server inside `SnipAi.app`, nothing happens.

I isolated which side is at fault: with `SnipAi.app` running, I pointed a browser at the same
`127.0.0.1:4737` it was serving and deleted a line from `qa-second` there. The delete saved (4 beats → 3) and
**still no job started** — polled every 2 s for 30 s. So the defect is in the server build that ships inside
the app, not in the desktop window; the browser is not a workaround.

**Blocks:** every downstream check that needs a current render, and it is the direct cause of BUG-006.

**Evidence:** `beats.json` for `qa-clip` written 19:42:33 with 10 beats and `smile-lines-look` removed;
`work/edl.json` untouched from 19:36:35 and still listing `smile-lines-look` among its 13 segments;
`cuts/qa-clip-v9.mp4` still dated 18:58:46. `/api/jobs/running` → `{"job":null}` across the whole window.

**Suspected area:** Whatever schedules the background rebuild after a review edit, in the packaged build.

---

## [BUG-006] Queue advertises a stale cut as "Approved · Ready to post"
**Feature:** Queue (the home screen)
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. In `SnipAi.app`, open a project that has been approved and delete one line from it (see BUG-005 — no
   rebuild will run).
2. Go back to the Queue.
3. Read the card: beat count, cut filename, cut length, status pill and progress label.
4. Compare against the file actually in `~/Movies/SnipAi/qa-sandbox/projects/<name>/cuts/`.

**Expected behavior:** The card describes the project honestly. **Approved** means "user has signed it off",
and a cut that no longer matches the edit should not be presented as finished.

**Actual behavior:** The card pairs the **new** beat count with the **old** file and calls it ready to post.
For `qa-clip` after deleting one line:

- card: `10 beats · qa-clip-v9.mp4 · 1m 47s → 35.3s − 1m 12s cut`, pill **Approved**, **Ready to post 100%**
- on disk: `qa-clip-v9.mp4`, written 18:58:46, **16.66 s**, rendered from the 11-beat edit and still
  containing the deleted line "your smile lines look like this,"

`qa-second` is the same after its edit: `3 beats · qa-second-v1.mp4`, **Approved · Ready to post**, while the
file on disk is the 4-beat render.

The Review screen *sometimes* warns — a **PICTURE OUT OF DATE** badge appears next to the timeline for
`qa-clip` and `qa-drop-test` — but **it did not appear for `qa-second`**, before or after a full page reload,
even though that project's edit and file also disagree. So the warning is not something a user can rely on,
and it never reaches the Queue at all.

A user following the product's own signals would upload a video still containing the line they deleted.

**Evidence:** `qa-screenshots/bug-queue-stale-cut-ready-to-post.png` — the Queue listing
`Qa Clip · 10 beats · qa-clip-v9.mp4 · 35.3s · Ready to post` and
`Qa Second · 3 beats · qa-second-v1.mp4 · 5.1s · Ready to post`. Disk state as above.

**Suspected area:** The Queue card's status pill and progress label, and the freshness check behind the
PICTURE OUT OF DATE badge on the Review screen.

---

## [BUG-007] Queue, summary line and History overstate the cut length
**Feature:** Queue (the home screen)
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Import footage that contains pauses inside sentences and let the build finish.
2. On the Queue, read the card's `source length → cut length` and the summary line's `Xm Ys cut`.
3. Open the exported file in `~/Movies/SnipAi/projects/<name>/cuts/` and check its duration.

**Expected behavior:** The card shows "the source length → the cut length" — the length of the file that was
built.

**Actual behavior:** The figure is computed from the beat spans and ignores the interior silence the render
actually drops, so it is much longer than the file. It is wrong on the test projects **and on both of your
real projects**:

| project | card says | actual file | file duration |
|---|---|---|---|
| Qa Clip (test) | `1m 47s → 40.7s` | `qa-clip-v1.mp4` | **24.59 s** |
| Qa Clip (test, later) | `1m 47s → 38.2s` | `qa-clip-v6.mp4` | **22.26 s** |
| **Img 9817 (yours)** | `8m 45s → 2m 10s` | `img-9817-v6.mp4` | **1m 38s** |
| **Img 9823 (yours)** | `10m 49s → 3m 51s` | `img-9823-v2.mp4` | **2m 59s** |

The Review screen's own timeline header is correct for the same projects (`34 clips · 1:37.6` for Img 9817,
`13 clips · 0:24.3` for Qa Clip), so the two screens disagree. The Version history modal repeats the wrong
figure on every row.

The error scales with how much interior silence the pipeline removes: on short clips with no interior splits
the figures are nearly right (5.60 s claimed vs 5.32 s actual).

**Evidence:** `qa-screenshots/bug-cut-length-mismatch-queue-card.png` shows `1m 47s → 40.7s − 1m 6s cut` for a
file that is 24.59 s. Sum of `dur` in `work/edl.json` at that moment = 24.23 s; sum of beat spans in
`beats.json` = 38.18 s.

**Suspected area:** Whatever computes the project summary duration for the Queue card, the queue summary line
and the History modal — it reads beat spans rather than the built file or the EDL.

---

## [BUG-015] A 0-byte file is offered for import instead of being screened out
**Feature:** Queue (the home screen)
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Create an empty file with a video extension: `: > ~/empty.mov`.
2. Queue it for import together with a `.txt` and a `.jpg`.
3. Look at the tray, then press the Import button.

**Expected behavior:** "a 0-byte file | refused with 'is empty'". The `.txt` and `.jpg` are screened in the
tray before you press anything, so the empty file should be too.

**Actual behavior:** The `.txt` and `.jpg` rows are marked `✕ not a video file` and the badge reads
`2 not video`, but `empty.mov` is marked only `→ empty` and is counted as importable — the button reads
`Import 1`. Pressing it uploads the file and only then refuses it with `✕ empty.mov arrived empty`. No project
is created and nothing is left on disk, so the outcome is right; the screening and the wording are not.

**Evidence:** Tray row `empty.mov | 0.0 MB | → empty` with button `Import 1`; after pressing,
`✕ empty.mov arrived empty`.

**Suspected area:** The import tray's pre-flight validation on the Queue screen.

---

## [BUG-018] Approving a project did not refresh the card's status pill
**Feature:** Queue (the home screen)
**Severity:** Low
**Status:** Intermittent
**Found via:** GUI

**Steps to reproduce:**
1. Open a built project and press **Approve** on the Review screen.
2. Navigate back to the Queue via the left rail.
3. Watch the project's card for ~10 seconds.

**Expected behavior:** The pill reads **Approved** and the project stops being counted in "N need your review".

**Actual behavior:** On the first attempt the card still showed `Ready to review` / `Needs your review` and the
summary still said `3 projects · 3 need your review` for at least 9 seconds after approving, even though the
Queue had re-mounted after the approval. It corrected only after an unrelated action forced a re-render. A
deliberate second attempt on another project updated immediately, so this did not reproduce.

**Evidence:** With the page showing `Ready to review`, `/api/projects` returned `"cutStatus":"approved"` for
the same project at the same moment.

**Suspected area:** The Queue's live refresh of project status after an approval performed on the Review screen.

---

## [BUG-019] A disk-full import failure is reported as "the connection dropped mid-import"
**Feature:** Queue (the home screen)
**Severity:** Low
**Status:** Suspected
**Found via:** GUI

**Steps to reproduce:**
1. With very little free disk space, queue a large video (~1.5 GB) for import and press Import.
2. Watch the row.
3. Repeat with a smaller file (~300 MB).

**Expected behavior:** The failure message names the real cause. The spec lists disk space as a dependency of
the import.

**Actual behavior:** The 1.5 GB attempt sat on `copying 0%` for 20–40 seconds and then failed with
`✕ the connection dropped mid-import`. The 300 MB attempt, in the same conditions, failed with the accurate
`✕ could not save qa-big-300mb.mov: ENOSPC: no space left on device, write`. Nothing was left behind on disk
either way and the queue stayed healthy.

Marked *Suspected* because the machine genuinely had very little free space at the time (see the end of this
report), so the underlying failure was real — it is the wording of the large-file case, and the percentage
never leaving 0%, that look wrong.

**Evidence:** Exact strings above. `df` on the volume holding `~/Movies/SnipAi`: `234G size, 234G used,
297M available, 100% capacity`.

**Suspected area:** Error reporting on the Queue import row for large uploads.

---

## Review screen — the editor

## [BUG-008] Closing the window quits the app with no warning and no way back
**Feature:** Review screen — the editor
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open `SnipAi.app`.
2. Click the red close button on the window.
3. Look for SnipAi in the running applications.

**Expected behavior:** Not stated in the spec, but the macOS convention is that closing a window leaves the app
running and reopenable from the Dock or the app's own menus.

**Actual behavior:** Closing the window terminates the whole process, including the local server the app runs.
`com.arzacorp.snipai` disappears from the running-apps list immediately. There is no confirmation and no "you
have work in progress" prompt.

That matters more than it normally would because of BUG-005: a user who makes an edit and then closes the
window has an edit saved to disk with no render behind it, and nothing on relaunch retries it.

The app also has no **File** or **Window** menu — its menu bar is Apple / SnipAi / View / Edit, and the View and
Edit menus are the stock web-view ones (`Show Tab Bar`, `Show All Tabs`, `Reload`, `Back`, `Enter Full Screen`;
`Cut`, `Copy`, `Paste`, `Select All`, `AutoFill`, `Start Dictation…`, `Emoji & Symbols`). There is no Undo/Redo
in the Edit menu even though ⌘Z is a documented shortcut, and no menu command to reopen a closed window.

**Evidence:** `computer_list_apps` before the close lists `com.arzacorp.snipai` pid 26935; immediately after
the close it is absent. Menu contents listed above were read from the app's own menu bar.

**Suspected area:** The desktop window's close behaviour and the app's menu bar.

---

## [BUG-009] Audio waveform never renders for newly imported projects
**Feature:** Review screen — the editor
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Import a video and let the build finish.
2. Press **Open** on the project card.
3. Look at the lower of the timeline's two tracks. Leave the page open for a minute or more.
4. Also open the snippet editor on any line (**Trim**, or **T**) and look below the filmstrip.

**Expected behavior:** "Two tracks — video on top, audio (waveform) below", and in the snippet editor
"a high-resolution waveform". The audio track is where the spec asks you to "drag across empty space to mark a
stretch".

**Actual behavior:** The audio track stays permanently blank with the placeholder `audio envelope loading…` —
it never resolves and never turns into an error. The snippet editor's waveform area is likewise an empty dark
panel. Still the case 50+ seconds after load, on every reload and every newly-imported project, in both the
browser and the desktop app.

The underlying request fails immediately: `GET /api/projects/<name>/peaks` → **HTTP 500**, body
`{"error":"could not read the audio","log":""}`.

**Pass 2 pinned down what Pass 1 could not.** Opening your real project **Img 9817** in the desktop app shows a
full, correctly drawn waveform — same app, same session, minutes apart. The difference is that Img 9817 has a
`work/peaks.json` (2.7 MB, written 2026-09-07) and every project imported during testing has none. Img 9823,
which also lacks `work/peaks.json`, shows the same blank lane. So the defect is not rendering and not the
browser: **peaks are never generated during the import pipeline**, and only projects built by an older version
still have them.

The drag interactions still work on the invisible canvas (marking a range on the timeline and dragging a
selection in the snippet editor both behave correctly), so this is about not being able to see where the sound
is while deciding what to cut.

**Evidence:** `qa-screenshots/bug-waveform-never-renders-timeline.png` — timeline showing a populated video
track and a blank audio lane reading `audio envelope loading…`. API response text above.
`ls work/peaks.json`: present for `img-9817`, absent for `img-9823`, `qa-clip`, `qa-second`,
`w-ird-n-me-clip`, `qa-drop-test`.

**Suspected area:** The step of the import pipeline that should produce the audio envelope, and the timeline's
audio track / snippet-editor waveform that consume it.

---

## [BUG-010] "Your cut" plays the whole source instead of the edit
**Feature:** Review screen — the editor
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open `SnipAi.app` and open any built project.
2. Leave the mode set to **Your cut** (it is selected by default).
3. Press the play button on the video.
4. Read the time and total duration on the player's control bar, and compare with the timeline header.

**Expected behavior:** "**Your cut** | your edit as it stands, played live off the footage, **jumping line to
line**." The on-screen caption next to the mode buttons repeats this: "Your edit, played straight off the
original footage — every trim applies instantly."

**Actual behavior:** The player loads the full source proxy and plays it end to end. On the `qa-drop-test`
project the control bar reads **0:11 / 0:13** — the whole 13-second source — while the timeline header says the
edit is **2 clips · 0:07.9**. Playback starts at 0:00 of the source and advances linearly; it does not skip to
the first beat and does not jump between beats. The playhead runs off the right-hand end of the timeline into
empty space.

Same behaviour on your real project **Img 9817**: the player showed **8:46** total (the full raw take) and
played 74 seconds of dead air before the first beat at 1:18.9, while the timeline said `34 clips · 1:37.6`.

Two side effects while it runs: the Lines list keeps auto-scrolling to follow the source position (the spec's
"scrolls itself into view" behaviour), which makes the list impossible to scroll manually, and pressing
**Space** does not stop playback started from the on-video control.

**Evidence:** Player control bar reading `0:11 / 0:13` beside a timeline reading `2 clips · 0:07.9`, with
**Your cut** selected — described above; no screenshot, see "What I could not capture".

**Suspected area:** The Player's **Your cut** mode on the Review screen, and its relationship to the video
element's own controls.

---

## The snippet editor (Trim)

## [BUG-011] After ⌘Z the open snippet editor keeps the undone trim and re-applies it on Save
**Feature:** The snippet editor (Trim)
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open a built project on the Review screen.
2. On any line press **Trim**. The bottom bar reads e.g. `0:12.8 – 0:14.4  1.58s` with no change indicator.
3. Drag across the waveform area starting at the very left of the line, so the selection reaches the line's
   start, then press **Delete**. The line's in-point moves and the change is saved (bar now
   `0:13.2 – 0:14.4`).
4. Press **⌘Z**, leaving the snippet editor open.
5. Read the bottom bar, then press **Save trim**.

**Expected behavior:** ⌘Z reports "Undid trimming that edge off" and "the line goes back exactly". With the
edit undone, the open editor should show the line back at its original in/out with no pending change.

**Actual behavior:** The undo *is* applied to the stored edit — the API reports the beat back at
`start: 12.84` and the toast reads `Undid trimming that edge off` — but the open snippet editor still shows the
**undone** trim as a live pending change: bar `0:13.2 – 0:14.4` with a `-0.34` delta and **Save trim** armed.
Pressing Save trim silently re-applies the trim the user just undid (beat back to `start: 13.181`).

Two further consequences while the editor is in this stale state:

- Subsequent drags are computed against the stale window. With the editor showing a stale `0:00.0 – 0:00.5`, a
  drag across the line produced `4.86s highlighted` while the bar simultaneously read
  `0:00.0 – 0:00.5  0.54s  -4.48` — a −4.48 s trim already pending before **Cut this bit out** or
  **Keep only this** was chosen.
- Pressing **Clear** in that state removes the highlight but leaves the pending `-4.48` trim in place. Only
  **Cancel** escapes it.

From a freshly-opened editor none of this happens: a mid-line selection leaves the bar untouched and Clear
works correctly. The trigger is pressing ⌘Z with the editor open.

**Evidence:** `qa-screenshots/bug-snippet-editor-stale-after-undo.png` — the row reads
`4.86s highlighted | Cut this bit out | Keep only this | Clear` while the bar underneath reads
`0:00.0 – 0:00.5  0.54s  -4.48` with Save trim active. Paired readings for the simple case: after ⌘Z,
`/api/projects/qa-clip` reported `{"label":"smile-lines-look","start":12.84,"end":14.42}` while the editor bar
read `0:13.2 – 0:14.4` with `-0.34`; after Save trim the API reported `start: 13.181` again.

**Suspected area:** The snippet editor's local in/out state on the Review screen, which is not resynchronised
when an undo changes the underlying line.

---

## Takes

## [BUG-012] Takes panel reports transcript/silence files "not present" when both exist
**Feature:** Takes
**Severity:** High
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Open a built project on the Review screen.
2. Find a line showing a take count — line 7 of the test project reads `thing good thing  35% · 3 takes`.
3. Press **Takes** on that line.

**Expected behavior:** The panel shows the other attempts at that line so a different one can be chosen, with
**Approve this pick** and per-candidate options. (The spec marks only the *learning* from those picks as
unfinished — "Picking a take works; it just doesn't yet change future drafts.")

**Actual behavior:** The panel opens, shows `Scanning source region for candidate takes…`, then fails with:

> `Can't scan for candidate takes — this needs work/transcript.json and work/silence.txt for this project (not present on this machine).`

Both files exist and are non-empty in that project: `work/transcript.json` (7,315 bytes) and
`work/silence.txt` (6,537 bytes), both written by the build 40 minutes earlier. No candidates are ever listed,
so no take can be picked. **Approve this pick** is present but there is nothing to pick from.

**Blocks:** all testing of the Takes feature beyond the panel opening.

**Evidence:** `qa-screenshots/bug-takes-panel-missing-files.png`. Directory listing at the same moment:
`-rw------- 7315 Sep 9 18:01 transcript.json`, `-rw------- 6537 Sep 9 18:01 silence.txt`,
`-rw------- 10817 Sep 9 18:01 silence-strict.txt`.

**Suspected area:** The candidate-take scan launched by the Takes panel — it appears to be looking somewhere
other than where the build wrote those files (the projects sit under a non-default library root,
`SNIPAI_DATA=~/Movies/SnipAi/qa-sandbox`).

---

## Settings

## [BUG-016] Rejected reference videos are called "not a video", and only one rejection is reported
**Feature:** Settings
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Go to **Settings → Style references**.
2. Press **Add reference videos** and select two valid videos in containers the reference uploader does not
   accept — an `.mkv` and an `.avi`.
3. Read the message and the `REFERENCES (n)` count.
4. Repeat with just the `.mkv`.

**Expected behavior:** The reference upload accepts `.mp4` `.mov` `.m4v` `.webm` only, so both files should be
refused — with a message that says why, for each file.

**Actual behavior:** Both are correctly refused and `REFERENCES (0)` is unchanged, but:

- The message is `qa-ref.avi isn't a video`. Both files are valid, playable videos in containers this uploader
  doesn't take — and the importer on the Queue *does* accept `.avi` and `.mkv`, so the same file is "a video"
  on one screen and "not a video" on another.
- When two files are rejected together only one message appears (the `.avi`); the `.mkv` disappears silently.
  Uploading the `.mkv` alone does produce `qa-ref.mkv isn't a video`, confirming it was rejected rather than
  accepted.

The accepted path works: uploading a `.mov`, then pressing **Measure 1 new**, produced a measured reference and
a derived target (`duration: 11.07, segments: 1, seconds_per_cut: 11.07`).

**Evidence:** Exact strings `qa-ref.avi isn't a video` and `qa-ref.mkv isn't a video`; `REFERENCES (0)` after
the two-file attempt. The file input on that screen carries `accept="video/*"`, so the picker itself does not
filter to the four accepted extensions.

**Suspected area:** Reference upload validation and messaging on Settings → Style references.

---

## Behaviours that cut across everything

## [BUG-013] "Put back" from History is not undoable and clears the undo stack
**Feature:** Every write is snapshotted
**Severity:** Medium
**Status:** Confirmed reproducible
**Found via:** GUI

**Steps to reproduce:**
1. Open a built project and make a few edits (trim a line, cut a stretch, delete a line) so History has several
   entries.
2. Press **History**. The modal lists versions with times, reasons (`trim smile-lines-look`,
   `cut a hole in smile-lines-look`, `undo`, `edit`) and beat counts.
3. Press **Put back** on any row. The modal closes and the edit is restored.
4. Press **⌘Z**.

**Expected behavior:** "Restoring is itself undoable."

**Actual behavior:** ⌘Z reports `Nothing to undo` and the restore stands — the project stays at the restored
state (12 beats in the test). The undo steps built up earlier in the session are also gone, so nothing before
the restore can be stepped back either.

The state is not lost — a `__before_restore.json` snapshot *is* written, so the previous version can be
recovered through History itself — but not with ⌘Z as documented.

**Evidence:** After **Put back**, `/api/projects/qa-clip` reported 12 beats; after ⌘Z it still reported 12
beats and `Nothing to undo` appeared. Snapshot directory contains
`2026-09-09T18-32-46-544__before_restore.json`.

**Suspected area:** The undo stack's handling of a History restore on the Review screen.

---

## [BUG-014] Quiet-job warning uses 20s/280s, not the documented 45s/255s
**Feature:** A job that goes quiet warns before it's stopped
**Severity:** Low
**Status:** Confirmed reproducible
**Found via:** Both

**Steps to reproduce:**
1. Import a video and let the build run.
2. Watch the job log on the project card / Review screen during a slow step.

**Expected behavior:** *"still working — nothing reported for 45s. If it stays quiet for another 255s it will
be stopped."*

**Actual behavior:**

> `still working — nothing reported for 20s. If it stays quiet for another 280s it will be stopped.`

The total still adds up to the documented 5 minutes, but the first warning fires at 20 seconds rather than 45,
so it appears on ordinary steps that are simply slow. It showed up repeatedly during normal transcription and
rendering.

**Evidence:** Exact string above, captured from the job log during three separate builds.

**Suspected area:** The job watchdog's warning thresholds.

---

## [BUG-017] A refused second heavy job gives no message
**Feature:** Only one heavy job at a time
**Severity:** Needs clarification
**Status:** Suspected
**Found via:** GUI

**Steps to reproduce:**
1. Start a heavy job — import a video from the Queue so transcription begins.
2. While it is running, open a *different* project's Review screen, expand **Motion graphics**, and press
   **Burn in (N)**.
3. Watch for a message and check whether a second job starts.

**Expected behavior:** "A second request is refused with a message naming what's already running."

**Actual behavior:** The second request did not start a job — `/api/jobs/running` kept reporting the first
project's transcription and nothing else — but no message appeared anywhere on screen. Pressing **Burn in**
simply looked like nothing happened.

Marked *Needs clarification* / *Suspected* because the timing window was hard to hit reliably: the small test
clips finish in under a minute, and on the repeat attempt the first job had already completed, so the second
request succeeded and I could not confirm the no-message behaviour a second time. It is also possible the
button is meant to be inert while a job runs, in which case the missing part is only the message.

**Evidence:** With `/api/jobs/running` returning
`{"job":{"project":"qa-second","step":"auto","status":"running","stage":"Transcribing…"}}`, pressing
**Burn in (1)** on `qa-clip` produced no visible text change and no new job.

**Suspected area:** The Burn in control in the Motion graphics section, and whatever surfaces the "already
running" refusal.

---

## Where the two passes disagreed

Worth calling out on its own, since the user asked for it:

| Behaviour | Pass 1 (dev server, browser) | Pass 2 (SnipAi.app) | Conclusion |
|---|---|---|---|
| **Import footage button** | Opens a file picker; imports work | Opens nothing at all | BUG-004 — desktop-only |
| **Rebuild after an edit** | Starts within seconds; nine renders produced | Never starts | BUG-005 — the packaged server, not the window: a browser pointed at the app's own server also gets no rebuild |
| **Audio waveform** | Blank on every project tested | Blank on new projects, **correct on Img 9817** | BUG-009 — peaks are never generated at import; old projects still have theirs |
| **Video playback in Chrome** | Video element never loaded | Plays fine | *Not a SnipAi defect* — the user's Chrome extensions were blocking media. Verified in a clean browser and in the desktop app before discarding it |

---

## What I could not test, and why

- **A screenshot of anything in the desktop app.** `screencapture` run from Terminal on this Mac returns the
  wallpaper and menu bar only — every window is omitted, because Terminal has not been granted Screen
  Recording in System Settings → Privacy & Security. Eight desktop captures came back byte-identical wallpaper
  and were discarded rather than filed as evidence. The four screenshots in `qa-screenshots/` are browser
  captures of the same pages. Desktop-only findings (BUG-004, BUG-008, BUG-010) are described from direct
  observation instead; granting Terminal Screen Recording would let a re-run capture them.
- **Import of a file over 1.5 GB.** The spec requires large imports to work with no size limit. **Your disk is
  full** — 234 GB capacity, under 300 MB free, 100% used — so every large write fails with `ENOSPC` regardless
  of the app. BUG-019 is filed only for the misleading message. This needs re-testing once there is free space.
  (My test data accounts for ~60 MB; the disk was already full beforehand.)
- **A real >1.5 GB file through the picker.** The large file used in Pass 1 was synthesised in the browser, so
  only the upload path was exercised, not a genuine 4K master.
- **Playback correctness by ear or eye.** The exported files were verified programmatically (duration, frame
  count, stream presence, `silencedetect`, `blackdetect`) but not watched or listened to. BUG-001 is
  established from timecodes, not from hearing the stutter — worth confirming by ear.
- **Scrubbing audio.** The spec says you should hear audio while dragging the playhead at the speed of your
  hand. I could not evaluate audio output.
- **Several keyboard shortcuts.** Verified working: `Home`, `End`, `↑`, `↓`, `N`, `F`, `T`, `Delete`, `⌘Z`, and
  the rule that shortcuts do not fire while typing (typing `tnfsmio` into the graphics "Word or phrase" field
  changed nothing but the field). Not verified: `J/K/L`, `←/→` and their Shift variants, `I/O`, `S`, `⌘B`,
  `[`/`]`, `M`, and `Space` — these move a playhead or set points whose position I could not read back
  reliably, so I could not distinguish a no-op from a working shortcut and did not want to file guesses.
- **The fade grip and the 1-pixel clip trim handles on the timeline.** Reordering by drag and the audio-track
  range delete both work (a 3.20 s marked range across several clips deleted correctly, taking the timeline
  from `12 clips · 0:19.6` to `11 clips · 0:16.7`). I did not get reliable results dragging the 1-pixel handles
  or the corner fade grip.
- **Anything the spec marks unfinished** was skipped as instructed: take-preference learning, AI overlay image
  generation, Products & links, the eight Connectors (verified present and all eight showing "Not connected"),
  captions, filler-word removal, audio levelling, redo, and the 720p-vs-full-resolution labelling gap.

### Worked, but rough — not filed as bugs

- **The app moves its window to the built-in display on every launch.** `.snipai-window.log` records a fixed
  `x=130 y=40 1180x795` placement each time. If you work on the external monitor, the window jumps back to the
  laptop screen on every start.
- **The launch splash is light-themed** ("Starting SnipAi…" on light grey) in a dark app — a white flash on
  every launch.
- **`SnipAi.app` lives in `~/Projects/SnipAi`, so Spotlight and LaunchServices don't index it.** A fresh user
  has to navigate to the folder in Finder to start it.
- **The 1-pixel edge handles in the snippet editor are very easy to grab by accident.** Starting a selection
  drag 2 px from the edge of the waveform grabs the in-handle instead and moves the in-point by seconds in one
  gesture, with no highlight shown and no signal that a handle was grabbed. Starting 4 px in behaves as
  documented.
- **Nothing tells you the peaks request failed.** `audio envelope loading…` (BUG-009) reads as "still working"
  forever; an error state would save a user waiting.
- **The Approve button doesn't change after approving** — it still reads **Approve** on an approved project.
- **The ⋯ menu on a project card offers only "Delete project".** With BUG-005 in play there is no way to ask
  for a rebuild from the UI at all.
- **Settings section names differ from the spec's.** The tabs are *Editing preferences*, *Style references*,
  *Products & links*, *Profile* and *Pipeline*; the spec names *Editing tools*, *Videos to learn the style
  from*, *Products SnipAi listens for* and a *Microphone* section. There is no standalone Microphone section.
- **The graphics kinds are named slightly differently.** The spec lists *AI overlay*; the modal offers
  **AI shot** alongside Emphasis, Callout, Stat, Definition and Lower third.
- **A broken project's card shows a broken-image thumbnail** next to an otherwise excellent error message.

### Things confirmed working

Recorded so they don't get re-tested: import by drag-and-drop, including the drop overlay and the tray showing
size and target project name; automatic start after import; duplicate detection by name and byte size
(`⚠ already in Qa Clip`); `.txt`/`.jpg` refusal both through the picker and through a drop (`✕ not a video
file`); filename sanitising (`wéird nàme 🎬 clip.mp4` → `w-ird-n-me-clip`); double-clicking Import creating
exactly one project; four rapid clicks on a line's **Delete** removing exactly one line; the expected
`raw/ cuts/ work/ beats.json` layout; the score panel and its metrics; `next →`; History listing versions with
reasons; hole-cutting in the middle of a line; `that stretch is already cut out` with the highlight left in
place; `that's the whole line — use Delete to drop it`; click-without-drag moving the playhead; a sub-4-pixel
drag treated as a click; **the page not moving during a drag** (zero scroll events, checked on both the snippet
editor and the timeline); `Undid cutting that bit out`; delete-a-line then ⌘Z restoring it exactly
(`Undid deleting "speed up the skin cell renewal process."`); the `✓ Cut "<line>"` toast with its own Undo
button; the `PICTURE OUT OF DATE` badge (when it appears); snapshots written per change with readable reasons;
zoom via Fit/−/+ and ⌘+scroll; clip reordering by drag; audio-track range marking and delete; Approve; delete →
**Recently deleted** with `5 days left` → **Put it back**; Burn in producing a separate `-graphics.mp4` and
leaving the clean cut intact, with the **With graphics** mode appearing and **Rendered file** relabelled
**Rendered · clean**; and a project with deliberately corrupted `beats.json` staying on the queue with the
exact message
`beats.json is not valid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)` while the
other projects carried on unaffected.

---

## Files left on your machine

Delete these when you're done — they are mine, not the app's:

- `~/Projects/SnipAi/qa-launch.command`, `~/Projects/SnipAi/qa-desktop-sandbox.command` — launchers that point
  the app at the throwaway library
- `~/Movies/SnipAi/qa-sandbox/` — the throwaway library itself (~60 MB, four test projects)
- `~/Desktop/QA-DROP-TEST.mp4`, `~/Desktop/QA-DROP-BIGGER.mp4`, `~/Desktop/QA-DROP-NOTVIDEO.txt`,
  `~/Desktop/QA-INTERRUPT.mp4` — drag-and-drop test files

Your real library (`~/Movies/SnipAi/projects/img-9817`, `img-9823`) was opened read-only and not modified.

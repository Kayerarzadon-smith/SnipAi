# SnipAi — QA bug report, 2026-09-10

Tested against `SNIPAI_QA_SPEC.md` (working-tree version, HEAD `ffaa8bf`).

**How this run was done.** The app was run headless as a real browser session —
`next dev` on `127.0.0.1:4737` with `SNIPAI_DATA` pointed at a throwaway copy of
`~/Movies/SnipAi/qa-sandbox`, driven with Playwright. Every original file was
left untouched; every destructive step ran on the copy and the copy was reset
between scenarios. This is the first run in which **Parts 2, 3 and 4 of the spec
were actually exercised in the UI** — the 2026-09-10 mechanical report lists them
as NOT TESTED.

**Nothing in Part 5 of the spec ("known gaps") is filed here.** Where a finding
matches a row already on `audits/LEDGER.md`, the row is named.

**What this environment could not test** — listed so nothing here is mistaken for
coverage:

| Not tested | Why |
|---|---|
| Anything that needs the video to play — Space/J/K/L, scrub-audio, frame stepping, playhead behaviour, the three player modes | The headless Chromium build has no H.264 (`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`), so no cut ever decodes |
| Takes panel (§2.4) | `list_candidate_takes.py` is spawned through `nice`, which is absent from this sandbox → 422 `spawn nice ENOENT`. Environment, not a defect |
| Audio waveform data, filmstrip frames | `ugc-edit-system/` is not on this host, so `/peaks` and `/filmstrip` 500. The **client's handling** of that failure is filed as BUG-006; the 500 itself is not |
| Import edge cases (§2.1 table), 1.72 GB import, `.app` bundling, Gatekeeper | No file-picker access and no large fixtures in this sandbox |
| Black frames at joins, finished-video playback | Covered by the 2026-09-10 mechanical report; not repeated |

---

## Summary

| ID | Title | Severity | Feature |
|---|---|---|---|
| BUG-001 | Opening a project with unreadable `beats.json` says "No project called …" | Medium | §2.1 Queue / Part 4 "A broken project stays visible" |
| BUG-002 | Uncaught `Event` reaches `window.onerror` on the Queue | Needs clarification | §2.1 Queue |
| BUG-003 | Timeline and player disagree about how long the cut is (0:14.8 vs 0:33.4) | High | §2.2 Review screen — Timeline |
| BUG-004 | The last 18.6s of the edit cannot be reached on the timeline | High | §2.2 Review screen — Timeline |
| BUG-005 | "Picture out of date" tooltip claims the clips are current when they are not | Low | §2.2 Review screen — Timeline |
| BUG-006 | A failed `/peaks` leaves the audio track on "audio envelope loading…" forever | Medium | §2.2 Review screen — Timeline |
| BUG-007 | Double-clicking a line's **Delete** fires twice and shows an error toast | Medium | §2.2 Review screen — Lines list |
| BUG-008 | The app fetches its fonts from Google over the internet | Medium | Part 1 "works entirely offline" |
| BUG-009 | `./scripts/test` prints "all green" while a suite was skipped | Medium | Part 7 Running it |
| BUG-010 | Ledger row S2 says `open`, but its regression test now passes | Low | Part 7 / `audits/LEDGER.md` |
| BUG-011 | Settings has no **Microphone** section | Needs clarification | §2.6 Settings |
| BUG-012 | A reference upload is capped at 600 MB; a project import is not capped | Needs clarification | §2.6 Settings |
| BUG-013 | A video that fails to load produces no message anywhere on the Review screen | Needs clarification | §2.2 Review screen — Player |

**Checked and behaving as specified** (recorded so the next run does not re-test
them): drag stability on both the timeline and the snippet editor; delete → ⌘Z
exactness; all three snippet-editor refusal messages; the keyboard guard inside
text fields; the Queue surviving a corrupted project; `./scripts/qa --full`;
`qa/run.mts` (1290 scenarios); `qa/run-api.mts` (416 scenarios). Details are in
the last section.

---

## §2.1 — Queue

## [BUG-001] Opening a project with an unreadable beats.json says the project does not exist
**Feature:** §2.1 Queue → **Open**; Part 4, "A broken project stays visible"
**Severity:** Medium
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Point `SNIPAI_DATA` at a copy of the library and launch the app.
2. Replace `projects/qa-second/beats.json` with invalid JSON — e.g. write the
   literal text `{ this is not json` into it.
3. Load the Queue. The `Qa Second` card appears and correctly reads
   *"beats.json is not valid JSON: Expected property name or '}' in JSON at
   position 2 (line 1 column 3)"*. This half is correct.
4. Click **Open** on that same card.

**Expected behavior:** Spec Part 4 — *"If a project's edit file becomes
unreadable, it still appears on the queue, saying what's wrong. It must never
silently vanish."* Having just told the user the file is malformed, the screen
behind **Open** should say the same thing.

**Actual behavior:** `/projects/qa-second/review` renders **"No project called
qa-second. Back to the queue"**. `GET /api/projects/qa-second` returns 404. The
user is told the project does not exist, one click after being told it exists and
its edit file is malformed — which is the "silently vanished" reading the spec
exists to prevent.

**Evidence:** `qa-screenshots/2026-09-10-nightly/corrupt-queue.png` (card with the
correct message), `corrupt-review.png` (the contradicting screen).
Network: `GET /api/projects/qa-second → 404`, `GET /api/projects/qa-second/peaks → 404`.

**Suspected area:** Review screen, first load of a project whose `beats.json`
cannot be parsed. The Queue and the Review screen are reading the same broken file
and reporting two different things about it.

---

## [BUG-002] An uncaught `Event` reaches window.onerror on the Queue
**Feature:** §2.1 Queue
**Severity:** Needs clarification
**Status:** Suspected (couldn't fully confirm)

**Steps to reproduce:**
1. Open `http://127.0.0.1:4737/dashboard` with the browser console open.
2. Wait for the cards to finish rendering.

**Expected behavior:** No uncaught errors on a healthy screen.

**Actual behavior:** One uncaught error reaches `window.onerror` on every load of
the Queue. Its message is the string `Event` — an error *event* object being
thrown rather than an `Error`, so it carries no stack and no text. It appeared on
every Queue load in this run and on no other screen.

**Evidence:** Playwright `pageerror` handler, message `Event`, on `/dashboard` and
`/` (which redirects there). Nothing in the console beyond it.

**Why "needs clarification":** This sandbox cannot decode H.264, so every
`<video>`/poster on the Queue fires a media `error` event. That is the most likely
source, in which case it will not happen on a real Mac. It is filed because an
error event reaching `window.onerror` un-wrapped means *something* is not being
handled, and one run on a machine that can decode the footage settles it either
way.

**Suspected area:** Queue card thumbnails / poster elements.

---

## §2.2 — Review screen: the timeline

The next three findings are one mechanism seen from three sides. BUG-003 is the
symptom, BUG-004 is what it costs the user, BUG-005 is why a tester would talk
themselves out of filing it. Fixing the layout fixes all three.

## [BUG-003] The timeline and the player disagree about how long the cut is
**Feature:** §2.2 Review screen — Timeline; Part 4, "Edits apply themselves"
**Severity:** High
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Launch with `SNIPAI_DATA` pointed at a copy of `~/Movies/SnipAi/qa-sandbox`.
2. Open the `qa-clip` project (**Open** on its Queue card).
3. Read the timeline header, immediately right of "Timeline / shortcuts".
4. Read the transport readout under the player.

**Expected behavior:** §2.2 — *"**Your cut**: your edit as it stands, played live
off the footage… Every change shows immediately"*, and the timeline is *"the
edit, laid out in time… drawn from the beat list, so an edit shows up here the
moment it's made"*. Both describe the same edit, so both totals should be the
same number.

**Actual behavior:** The timeline header reads **`10 clips · 0:14.8`**. The
transport reads **`0:00.0/0:33.4`**. Same project, same edit, same moment, two
totals that differ by more than 2×. Arithmetic on the beat list confirms the
player: the ten beats span 35.30s, less 1.90s of holes, = **33.40s**. The
timeline's 14.8s is the length of the *last render* — the sum of the surviving
pieces in `work/edl.json` (16.39s total, 14.81s once the deleted `smile-lines-look`
pieces are dropped).

**Evidence:** `qa-screenshots/2026-09-10-nightly/timeline-duration-mismatch.png`.
Measured DOM: `.tl-inner` is 370px wide at 25 px/s = 14.81s; the ten `.tl-clip`
elements run 0→370px. `.lt-time` reads `0:00.0/0:33.4`.
Per-beat check (source seconds vs. the EDL piece laid out for it):

| beat | beat span | laid out as | ratio |
|---|---|---|---|
| `between-eyes-its` | 0.000 → 5.020 (5.02s) | 0.178 → 0.523 (0.345s) | 0.07 |
| `power-up-cells` | 97.320 → 104.420 (7.10s) | 97.320 → 98.537 (1.217s) | 0.17 |
| whole project | 33.40s | 14.81s | 0.44 |

**Suspected area:** Timeline layout. `edlStillFits()` decides whether a beat is
laid out from its rendered pieces or from itself; it checks only that each piece
sits *inside* the beat and clear of its holes. It never checks that the pieces
*cover* the beat, so a 0.345s piece "still fits" a 5.02s beat and the beat is
drawn at 0.345s. The comment directly above that function already names this
failure — *"laying the beat out from them reports the length of the last render…
That reads as 'my edit did not save'"* — so the intent is there and the guard is
one condition short. A coverage test (pieces must account for the beat's span,
minus its holes, within a tolerance) is the missing half.

**Note on the fixture:** of the four sandbox projects only `qa-clip` has an EDL
this far out of date (the other three sit at ratio 1.00–1.03), so this reproduces
on `qa-clip` and not on the others. The condition it needs — an edit made after
the last build — is the normal state of every project the Queue currently marks
*"that file was rendered before your latest edit"*, which is all four.

---

## [BUG-004] The last 18.6 seconds of the edit cannot be reached on the timeline
**Feature:** §2.2 Review screen — Timeline
**Severity:** High
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Open the `qa-clip` project as in BUG-003.
2. Click at the extreme right-hand edge of the timeline ruler.
3. Read the transport.

**Expected behavior:** §2.2 — *"Click anywhere to move the playhead."* The
timeline is the editing surface for the whole cut, so its right edge should be the
end of the cut.

**Actual behavior:** The timeline spans 0→14.81s. The cut is 33.40s. Clicking the
far right of the ruler puts the playhead at ~14.8s of 33.4s; the remaining 18.6s
of the edit — beats 6 through 10, `thing-good-thing` onward, more than half the
video — has no position on the timeline at all. Clicking at 50% of the ruler
width put the playhead at `0:07.4` of `0:33.4`, i.e. the ruler is being read as
cut-time in the 33.4s edit while the clips on it are drawn at 14.8s scale. The
two mappings are not the same mapping.

Marking a stretch on the audio track and pressing **Delete** resolves against the
clip layout, not the transport: a 1.48s mark at 30–40% of the ruler deleted the
whole of `need-egf-3` (21.50→22.60) and put two holes into `thing-good-thing` —
a beat whose row in the Lines list is timecoded 0:33.4, well past where the mark
appeared to be.

**Evidence:** `qa-screenshots/2026-09-10-nightly/timeline-duration-mismatch.png`,
`drag-span-qa-clip.png`, `after-span-delete.png`.
`beats.json` before: `need-egf-3:21.5-22.6:h[]`, `thing-good-thing:33.36-39.68:h[]`.
After the single Delete: `need-egf-3` gone; `thing-good-thing:33.36-39.68:h[[33.36,33.636],[34.512,34.743]]`.

**Suspected area:** Same layout as BUG-003. Worth calling out separately because
the consequence is not cosmetic: an edit made by dragging on the timeline lands on
different footage from the one the ruler and the transport suggest.

---

## [BUG-005] The "picture out of date" tooltip says the clips are current when they are not
**Feature:** §2.2 Review screen — Timeline
**Severity:** Low
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Open the `qa-clip` project.
2. Hover the **PICTURE OUT OF DATE** badge in the timeline header.

**Expected behavior:** The tooltip should describe what is stale and what is not.

**Actual behavior:** It reads *"The picture is from the last render; the clips and
audio are current."* On this project the clips are laid out from the last render
too (BUG-003) — they are exactly as stale as the picture. The tooltip is the
sentence that would talk a tester out of filing BUG-003.

**Evidence:** `title` attribute on `.tl-stale`, read from the live DOM:
`"The picture is from the last render; the clips and audio are current."`
`qa-screenshots/2026-09-10-nightly/timeline-duration-mismatch.png`

**Suspected area:** Timeline header badge. Fixing BUG-003 makes this sentence true
and no separate change is needed; if BUG-003 is deferred, the sentence should
stop making the claim.

---

## [BUG-006] A failed peaks request leaves the audio track on "audio envelope loading…" forever
**Feature:** §2.2 Review screen — Timeline (audio track)
**Severity:** Medium
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Make `GET /api/projects/<project>/peaks` fail. Any failure will do; in this
   run it returned `500 {"error":"could not read the audio"}` because the
   pipeline that generates peaks was not on the host.
2. Open that project's Review screen.
3. Look at the audio track under the video track and wait.

**Expected behavior:** §2.2 describes an audio track that shows a waveform. When
it cannot, the screen should say so — the app's own convention, stated in Part 4,
is that it says what is wrong rather than showing nothing.

**Actual behavior:** The audio track shows the text **"audio envelope loading…"**
and never changes. The request had already failed twice by the time the page
settled; no error text appears anywhere on the screen and nothing offers a retry.
A user waits for a waveform that is never coming.

**Evidence:** `qa-screenshots/2026-09-10-nightly/review-qa-clip.png` — the string
"audio envelope loading…" sits where the waveform belongs. Network:
`GET /api/projects/qa-clip/peaks → 500` ×2, body
`{"error":"could not read the audio","log":""}`.

**Suspected area:** The Review screen's peaks fetch — the loading state has no
failure branch. The 500 itself is an artefact of this sandbox and is **not** being
filed; the permanent loading state is the defect and would look the same after any
real failure (missing footage, ffmpeg gone, a killed tool). Related but distinct:
`audits/LEDGER.md` **S5**, which is about the path the route used to pass.

---

## §2.2 — Review screen: the lines list

## [BUG-007] Double-clicking a line's Delete fires twice and shows an error toast
**Feature:** §2.2 Review screen — Lines list → **Delete**; Part 6 #7 "Be impatient"
**Severity:** Medium
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Open the `qa-clip` project.
2. Hover line 4, *"And if under your eyes it's like this,"*, to reveal its actions.
3. Double-click **Delete** (two clicks ~40ms apart — one impatient press).

**Expected behavior:** One delete, one confirmation. The spec's Part 6 #7 asks for
exactly this test, and §2.1 states the equivalent rule for the importer —
*"double-clicking Import fast → must import once, not twice"*. The same standard
should hold here. Part 4 also says an action that changes nothing says so
*calmly*; an error is not that.

**Actual behavior:** Both clicks are sent. The line is deleted once (correct), but
the second request is a `POST /api/projects/qa-clip/beats` for a beat that no
longer exists and returns **404**, and the user sees the error toast
**`no beat 'under-eyes-its'`** followed by the success toast
*"Cut "And if under your eyes it's like this," — Undo"*. The user's last
impression of a successful delete is an error message naming an internal beat
label.

**Evidence:** Toasts captured in order via a `MutationObserver` on `.toast`:
`["no beat 'under-eyes-its'", "Cut “And if under your eyes it's like this,” Undo"]`.
Network: `POST /api/projects/qa-clip/beats → 404`.
Beat count 10 → 9, `under-eyes-its` removed — so the delete itself is correct.

**Suspected area:** The **Delete** button on a line row — no in-flight guard and
no disabled state while the request is out. Worth checking **Approve**, **Trash**
and **Burn in** for the same shape.

---

## Part 1 — "works entirely offline"

## [BUG-008] The app fetches its fonts from Google over the internet
**Feature:** Part 1 — *"a Mac desktop app that works entirely offline. No account,
no login, no cloud, no internet needed."*
**Severity:** Medium
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Launch the app on a machine with no route to `fonts.googleapis.com`
   (offline, or a firewall that drops it).
2. Open any screen.

**Expected behavior:** Everything the app needs is on the machine. No outbound
request on launch.

**Actual behavior:** Every screen requests
`https://fonts.googleapis.com/css2?family=Fraunces…&family=IBM+Plex+Sans…&family=IBM+Plex+Mono…`
and the request fails when there is no internet. Two consequences: the app's
typography silently falls back to whatever the OS supplies, and an app the spec
describes as needing no internet announces every launch to a third party.

**Evidence:** `app/globals.css`, line 1 — an `@import url('https://fonts.googleapis.com/…')`.
Observed on all four screens as `GET https://fonts.googleapis.com/css2?… ::
net::ERR_TUNNEL_CONNECTION_FAILED` plus a console error. Screenshots throughout
this run show the fallback typography.

**Suspected area:** Global stylesheet. The fix is to ship the three families as
local font files and `@font-face` them — self-hosting also removes the flash of
fallback text on every launch.

---

## Part 7 — Running it

## [BUG-009] `./scripts/test` prints "all green" while a suite was skipped
**Feature:** Part 7 — *"Automated checks, all currently passing: `./scripts/test`"*
**Severity:** Medium
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. On a checkout where `ugc-edit-system/.venv/bin/python` does not exist, run
   `./scripts/test`.
2. Read the last line.

**Expected behavior:** A runner that skipped a suite should not claim everything
passed. `./scripts/qa --full` gets this right — it prints
*"a suite was SKIPPED — 'all green' does not mean all ran"* — so the two runners
disagree about the same run.

**Actual behavior:** `./scripts/test` prints
```
== pipeline ==
  skipped -- no venv at ugc-edit-system/.venv/bin/python

all green
```
The pipeline suite did not run and the runner reports a clean pass.

**Evidence:** Full run captured this session: `27/27` app tests pass, bug board
`1 still open (2 fixed)`, guards pass, pipeline `skipped`, final line `all green`.
The same run under `./scripts/qa --full` prints the skip warning.

**Suspected area:** `scripts/test`, the pipeline section and the final verdict.
This is `audits/LEDGER.md` **T1** (`scripts/test:26`, status `open`) — confirmed
still reproducible today, filed here because Part 7 tells a tester to trust that
line.

---

## [BUG-010] Ledger row S2 says `open`, but its regression test now passes
**Feature:** Part 7 / `audits/LEDGER.md` bug board
**Severity:** Low
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Run `./scripts/qa --regressions` (or `./scripts/qa --full` and read the
   *reproduced bugs* section).
2. Compare the result for `S2` against its row in `audits/LEDGER.md`.

**Expected behavior:** `QA.md` — *"A test there going green is the signal that its
bug is fixed — flip the ledger row and move on."*

**Actual behavior:** The board reports `ok 2 - S2: a failed job reaches jobs.json`
— green — while `audits/LEDGER.md` still lists **S2** (`lib/jobs.ts:184`,
*"failJob never persists"*) as `open`, including in the "Fix first" table at the
top of the file. Anyone reading the ledger to choose what to work on is pointed at
something already fixed. `S1` is correctly red (`wontfix`, deliberately) and `S7`
is correctly green and marked `fixed`.

**Evidence:** `./scripts/qa --full`, *reproduced bugs* section:
```
not ok 1 - S1: PATCH /pipeline keeps holes, fades and detached audio
ok 2 - S2: a failed job reaches jobs.json
ok 3 - S7: splitting a beat does not duplicate its audio and holes
# pass 2  # fail 1
```

**Suspected area:** `audits/LEDGER.md` — the S2 row and the "Fix first" table.
Confirm the fix in `lib/jobs.ts` before flipping it.

---

## §2.6 — Settings

## [BUG-011] Settings has no Microphone section
**Feature:** §2.6 Settings — the table lists **Microphone**, *"permission check for
voice input"*, state **works**
**Severity:** Needs clarification
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Left rail → **Settings**.
2. Read the section tabs.

**Expected behavior:** Per §2.6, five sections, one of them **Microphone**.

**Actual behavior:** Five tabs, and Microphone is not among them:
**Editing preferences · Style references · Products & links · Profile ·
Pipeline**. No microphone control or permission check appears under any of them.
§2.5 says the microphone *"is asked for once at launch"*, so voice input may still
work — but the place the spec says to check it from is not there, and there is an
extra section (**Pipeline**) the spec does not mention.

**Evidence:** `qa-screenshots/2026-09-10-nightly/settings.png`. Full page text
contains no case-insensitive match for "microphone".

**Suspected area:** Settings. Either the section was removed and the spec is
stale, or it regressed. A one-line answer settles which.

---

## [BUG-012] A reference upload is capped at 600 MB; a project import is not capped
**Feature:** §2.6 Settings — *"Cap 600 MB (the project importer has no cap). This
inconsistency is real; flag it if you think it matters."*
**Severity:** Needs clarification
**Status:** Confirmed reproducible

**Steps to reproduce:**
1. Settings → **Style references** → upload a reference video larger than 600 MB.
2. Compare with importing a file of the same size on the Queue.

**Expected behavior:** The spec asks for a judgement rather than stating one.

**Actual behavior:** The reference route refuses at `600 * 1024 * 1024` with
*"that file is too big for a reference"* (HTTP 413). The project importer applies
no size limit — §2.1 states *"There is no size limit"* and reports a 1.72 GB
import working. A user whose own finished edits are 4K — the same footage this app
imports without complaint — cannot upload one as a style reference, which is
exactly the file the feature wants. **Yes, it matters**, but the right cap is a
product call.

The other half of the same §2.6 note — that references accept a narrower list of
extensions than the importer — **is already fixed**: both now use
`VIDEO_EXT_LIST = [".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"]`, and the
reference route carries the comment explaining the old mismatch. The spec should
drop that half.

**Evidence:** `app/api/references/route.ts` — the 600 MB check and the 413.
`app/api/projects/route.ts` — no equivalent check (only a 256 MB *disk headroom*
allowance, which is a different thing).

**Suspected area:** Settings → Style references upload, vs. Queue → Import
footage. One number, two screens.

---

## §2.2 — Review screen: the player

## [BUG-013] A video that fails to load produces no message anywhere
**Feature:** §2.2 Review screen — Player; Part 4 *"A broken project stays visible"*
**Severity:** Needs clarification
**Status:** Confirmed reproducible (in an environment that cannot decode H.264)

**Steps to reproduce:**
1. Open a project on a browser that cannot decode the cut's codec — this run used
   headless Chromium, which has no H.264.
2. Watch the player area and the transport.

**Expected behavior:** The app's stated convention is to say what is wrong.

**Actual behavior:** Nothing is said. The `<video>` element ends at
`readyState 0`, `networkState 3`, `error.code 4`
(`DEMUXER_ERROR_NO_SUPPORTED_STREAMS`). The transport sits at `0:00.0/0:33.4`,
**Play** does nothing when pressed, no error appears, and the transport still
advertises a duration for a video that never loaded. The screen looks like a video
that has not started rather than one that cannot.

**Evidence:** `qa-screenshots/2026-09-10-nightly/playback-overrun.png`. Ten
two-second polls after pressing **Play**: the transport read `0:00.0/0:33.4` on
every one.

**Why "needs clarification":** the trigger here is this sandbox's codec support,
which will not happen inside the real `.app`. But a `<video>` `error` event with
no UI branch behind it will look identical after a missing proxy file, a truncated
render, or a `/api/media` failure — all of which can happen on a real Mac. Worth
one deliberate test there: rename a project's `work/source-proxy.mp4` and open it.

**Suspected area:** Review screen player — no handler on the media element's
`error` event.

---

## What was checked and found correct

Recorded so the next run starts here rather than repeating it.

| Spec | Check | Result |
|---|---|---|
| Part 6 #2 | Page must not move while dragging — **timeline audio track**. `window.scrollY/X`, `.main` scrollTop/Left and `.tl-scroll` scrollLeft sampled at four points mid-drag | **No movement.** Every sample identical to the pre-drag values. Mark reported `5.16s marked — Delete to cut it out` |
| Part 6 #2 | Page must not move while dragging — **snippet editor waveform**, same instrumentation, page pre-scrolled to 390px | **No movement**, all four samples identical |
| §2.3 step 1 | Drag across the waveform highlights a stretch | Correct — `1.69s highlighted` with **Cut this bit out** / **Keep only this** / **Clear** |
| §2.3 step 2 | The cut is removed and the gap closes | Correct — `between-eyes-its` gained hole `[1.802, 3.488]`; toast *"Cut out 1.44s — the gap closed"* |
| §2.3 edge case | Highlighting a stretch already cut | Correct — toast **"that stretch is already cut out"**, nothing written, the highlight stays put (`.trimwave-sel` still present) |
| §2.3 edge case | Highlighting the whole line | Correct — toast **"that's the whole line — use Delete to drop it"**, nothing written |
| §2.3 / Part 6 #3 | ⌘Z after cutting a stretch | Correct — toast **"Undid cutting that bit out"**, hole removed, beat back to `0-5.02:h[]` |
| Part 4 | An edit that changes nothing burns no undo step | Correct — after the two refused edits, one ⌘Z undid the one real change and the next said **"Nothing to undo"** |
| Part 6 #3 | Delete a line, then ⌘Z — does it come back *exactly*? | Correct. Full beat signature (label, start, end, holes, order) byte-identical before and after, for both a line delete and a span delete |
| Part 3 | Shortcuts must not fire while typing in a text box | Correct. Typing `smooth fast note` into the graphic text field (s, f, t, m, n, o all bound) changed no beats and raised no toast; **Backspace** and **Delete** edited the field only |
| Part 6 #6 | Corrupt `beats.json` — the Queue must still load and say what is wrong | Queue correct: all four projects still listed, the broken card reads *"beats.json is not valid JSON: Expected property name or '}' in JSON at position 2"*. The Review screen half is BUG-001 |
| §2.2 | Score panel opens with the metric breakdown | Correct — *Repeated phrases*, *Pacing vs. house style* and the `NN/100` readout all present |
| §2.2 | **History** opens | Correct — overlay renders |
| §2.7 | Eight connectors, all "Not connected" | As specified (Part 5 #6) — not filed |
| Part 7 | `./scripts/test` | 27/27 app suites pass; bug board `1 still open (2 fixed)`; both guards pass. Verdict line is BUG-009 |
| Part 7 | `./scripts/qa --full` | Green. Every API route has a caller; every edit handler schedules a re-render; no orphaned routes |
| — | `qa/run.mts` gauntlet | **1290 scenarios, 1290 pass, 0 fail** |
| — | `qa/run-api.mts` gauntlet | **416 scenarios, 416 pass, 0 fail** |

## Spec drift — worth correcting, not defects

1. §2.1 gives the Queue summary as *"N projects · N need your review · Xm Ys
   cut"*. It actually reads
   *"4 projects · 2 need your review · 2 approved · 1m 51s cut"* — there is an
   extra `N approved` segment, and a fifth (`N awaiting a beat draft`) appears
   when a project is unreadable.
2. §2.6's note that references accept a narrower extension list than the importer
   is out of date — both use the same six extensions now. The 600 MB cap half of
   that note is still true (BUG-012).
3. §2.6 lists five Settings sections; the app has five, but **Microphone** is not
   one of them and **Pipeline** is (BUG-011).
4. Part 7 says *"165 unit tests"*. `./scripts/test` now reports **171** across 30
   suites.
5. The spec header says it was read off commit `06cc791`; HEAD is `ffaa8bf`, and
   `SNIPAI_QA_SPEC.md` itself has uncommitted edits in the working tree — line
   numbers and counts quoted from it will drift.

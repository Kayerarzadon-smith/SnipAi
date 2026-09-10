# SnipAi — QA specification

**For a tester who has never seen this app or its code.** Everything here was read off the current source at commit `06cc791`. Where something is unfinished, it says so — please don't file those as bugs.

---

## Part 1 — What this app is for

Someone films themselves talking to camera about a product. They fumble, they restart sentences, they say each line three or four times, they pause. The raw file is nine or ten minutes long. What they want to post is ninety seconds.

**SnipAi does that cut for them.** You drop the raw video in, and it comes back as a finished vertical video with the fumbles gone, the best take of each line kept, and the dead air removed.

Two things about the product shape you need to hold in your head:

- **It is a Mac desktop app that works entirely offline.** No account, no login, no cloud, no internet needed. The window you see is a web page, but it's served from a tiny server running on the same machine, reachable only from that machine.
- **The user's videos live in `~/Movies/SnipAi`, not inside the app.** They're the user's own files, visible in Finder. The app never modifies the original footage — every edit is a set of timecodes pointing into an untouched source file.

### The vocabulary you need

| word | what it means here |
|---|---|
| **project** | one raw video and everything derived from it |
| **beat** / **line** | one line of the script. The edit is a list of beats, each with a start and end time in the source footage |
| **hole** | a stretch cut out of the *middle* of a beat. The picture either side joins up |
| **the cut** | the finished rendered video file |
| **take** | one of several attempts the person made at the same line |
| **house style** | numbers measured from a video the user already edited by hand, used as a target |

### End-to-end journey

```
1  Open the app                   →  the Queue (a list of projects)
2  Drop a video file in           →  a project is created, work starts by itself
3  Wait                           →  a progress bar, and a caption saying what
                                      the machine is doing right now
4  Click Open on the project      →  the Review screen
5  Watch it, fix what's wrong     →  trim edges, cut out stretches, delete lines,
                                      reorder, split. Every edit re-renders itself
6  Approve                        →  the finished file is in the project's cuts/ folder
```

**Step 3 is the whole product.** Steps 5–6 are for correcting what it got wrong.

**Do not judge word cutoffs from the transcript.** The single worst thing this
app can do is cut a word in half, and the obvious check — compare the edit
list against the word timings in `work/transcript.json` — gives the wrong
answer. Whisper starts words 200–400ms early and folds pauses and restarts
into the preceding word's duration, so a "word" spanning 1.02s is a word, a
hesitation and often a restart; a removal overlapping it may have removed
nothing audible. Measure the audio instead. **Two checks, because they look in different
places and neither one alone answers the question.** Both run from the repo
root:

    python3 ugc-edit-system/tools/verify_removals.py --project ~/Movies/SnipAi/projects/<name>
    python3 qa/verify_edges.py --project ~/Movies/SnipAi/projects/<name>

The first measures every stretch removed from the **middle** of a line against
that project's own speech level. The second measures the beat **edges** — the
in and out points, where `snap()` works and where the only clipping this app
has actually shipped happened (the "s" of *this*, the "ce" of *face*).
`verify_removals` is blind to the edges and says so when it finishes.

Report what they say, not what the timestamps imply.

**About that caption.** An earlier version of this document listed four phases
against fixed percentage bands. There are no fixed bands, and there is no
fixed set of four — that was wrong, and a tester who checks against it will
file a bug that is not there. What actually happens: the caption is derived
from the line the running tool has just printed, matched against a table of
phases in `app/dashboard/LiveProgress.tsx`. Each phase has two or three
phrasings that mean the same thing and it rotates between them, so a
nine-minute job does not sit on one frozen word and read as a hang — which
means "Snipping…", "Cutting the clips…" and "Pulling the pieces" are the same
phase, not three. The percentage comes separately, from the tool itself, and
is not tied to the caption.

Worth reporting about the caption: **"Working…"**. That is the fallback shown
when the log line matches no phase at all, and every occurrence is a gap in
that table. Also worth reporting: any caption that is clearly machine output
rather than a sentence — a file path, a traceback, an ffmpeg command line.

---

## Part 2 — Screens

There are **four screens** and one editor. The left rail is always visible: **Queue**, **Connectors**, **Settings**.

---

### 2.1 Queue (the home screen)

**Where:** opens by default; "Queue" in the left rail.

**What it does:** lists every project, and is where footage gets imported.

**Intended behaviour, step by step:**

1. On open you see a heading "Production queue" and a summary line: *"N projects · N need your review · Xm Ys cut"*.
2. Each project shows as a card: thumbnail, title, beat count, the cut's filename, the source length → the cut length, a status pill, an **Open** button, and a **⋯** menu.
3. A project with a job running shows a **progress bar with a percentage and a changing verb**. It updates roughly every 2 seconds without you refreshing.
4. **Import footage** (top right) opens a file picker. You can also **drag a video anywhere onto the window** — a drop zone appears only while a file is over the window.
5. Dropped files appear in a tray with their size. Press **Import N**.
6. During upload each row shows **`copying 41%`** and a thin bar fills along the row. After the last byte it says **`filing it away…`** while the server writes it.
7. When the upload finishes, work starts **automatically**. You do not press anything else.

**Status pills:**

| pill | meaning |
|---|---|
| Needs fixes | flagged lines need a human call |
| Ready to review / Needs your review | built and waiting |
| Approved | user has signed it off |
| Unscored | no transcript yet |

**Inputs accepted:** `.mov` `.mp4` `.m4v` `.avi` `.mkv` `.webm`. The picker filters to `video/*`.

**Edge cases and what should happen:**

| input | expected |
|---|---|
| a `.txt` or `.jpg` | row marked **not video**, refused, no project created |
| the same file twice in one selection | deduped — it appears **once** |
| a file matching an existing project's name, or the exact same byte size | marked **duplicate**, skipped, message names the project it's already in |
| a very large file (tested to **1.72 GB**) | must import. There is **no size limit** |
| a 0-byte file | refused with "is empty" |
| double-clicking **Import** fast | must import **once**, not twice |
| a filename with spaces, accents, emoji | accepted; the saved name is sanitised |
| a filename like `../../etc/evil.mov` | must save as `evil.mov` inside the project, never outside |

**Expected end state:** a new folder in `~/Movies/SnipAi/projects/<name>/` containing `raw/`, `cuts/`, `work/` and `beats.json`, a card on the queue, and a job running.

**Depends on:** disk space; Python and ffmpeg being present (the app ships its own).

**⋯ menu → Delete** moves the project to a trash area. **Recently deleted** lists them with days remaining; they're kept **5 days** and can be put back.

---

### 2.2 Review screen — the editor

**Where:** **Open** on any project card.

This is where almost all the functionality is. Top to bottom:

#### Header
- Breadcrumb **Queue / \<project>**, then the title and the cut's filename.
- A **score button** showing `NN/100`. Click it to open a panel listing each metric with a bar: *Repeated phrases*, *Pacing vs. house style*, and others.
- A pill: either **"N of M need a call"** with a **next →** that jumps to the worst line, or **"All beats clean"**, or **"Unscored — no transcript"**.
- **History** — every saved version, with a way back to any of them.
- **Approve** and **Trash**.

#### Player
Up to three mode buttons above the video:

| button | what it plays |
|---|---|
| **Your cut** | your edit as it stands, played live off the footage, jumping line to line. Every change shows immediately, with no re-render |
| **Rendered file** | the actual exported file. Trails your edit by one render |
| **With graphics** | only appears if a graphics render exists |

The player can be resized by dragging its corner. Nothing is drawn over the picture.

#### Timeline
Two tracks — **video** on top, **audio** (waveform) below.

- **Fit**, **−**, **+**, and a `px/s` readout control zoom. **⌘ + scroll** also zooms.
- Click anywhere to move the playhead. Drag it to scrub — **you should hear audio while scrubbing**, at the speed of your hand.
- Drag a clip to reorder it.
- Drag the 1-pixel handle at either end of a clip to trim it.
- Drag the corner grip to add a fade.
- **On the audio track, drag across empty space to mark a stretch**, then press **Delete**.

#### Lines list
One row per beat: number, timecode, the line as spoken, a confidence percentage, take count, and a status tick or warning. The row currently playing is highlighted and scrolls itself into view.

Hovering or selecting a row reveals: **Trim · Takes · Graphic · Delete**.

#### Motion graphics
A collapsed section under the timeline. Not a separate panel.

---

### 2.3 The snippet editor (Trim)

**Where:** the **Trim** button on any line, or press **T** with a line selected.

Opens inline underneath that line, the same width as the row, so it reads as belonging to it.

**What you get:** a small video monitor on the left; a filmstrip of frames along the top; a high-resolution waveform below it; the words of the line laid out under the waveform at their spoken positions; a zoom `−` / `+` with a duration readout; and a bottom bar reading `in – out  duration`, with **Play**, **Cancel**, and **Save trim** at the right.

**Intended behaviour:**

1. **Drag across the waveform** to highlight a stretch. A row appears: **`X.XXs highlighted`**, **Cut this bit out**, **Keep only this**, **Clear**.
2. Press **Delete** or **Backspace**, or click **Cut this bit out** — the stretch is removed, the gap closes, and the picture either side joins up.
3. **Keep only this** does the opposite: trims the line down to just what you highlighted.
4. **Space** plays the line. Space again stops.
5. Drag either 1-pixel edge handle to move the in or out point.
6. **Cancel** closes without saving. **Save trim** commits the edges.

**Cut stretches are drawn as a dark knock-out with a red edge and a diagonal line through them** — that footage is gone, and it should read as gone.

**Edge cases and what should happen:**

| you do | expected |
|---|---|
| click without dragging | the playhead moves; no highlight |
| drag less than ~4 pixels | treated as a click |
| highlight a stretch **that's already been cut** | **"that stretch is already cut out"** — the highlight **stays** so you can move it. Nothing changes. **This is correct behaviour, not a bug** |
| highlight the whole line | *"that's the whole line — use Delete to drop it"* |
| highlight so much that under 0.15s survives | refused |
| highlight the very start or end | it becomes a trim of that edge rather than a hole |
| press Delete twice quickly | **one** cut, then "already cut out" |
| ⌘Z afterwards | **"Undid cutting that bit out"** and the line goes back exactly |

**Critical:** while you are dragging, **the page must not move**. Not vertically, not horizontally. This was broken until recently and is worth checking hard.

---

### 2.4 Takes

**Where:** the **Takes** button on a line.

The person said each line several times. This shows the other attempts, so you can pick a different one. Buttons: **Approve this pick**, and options per candidate.

**Unfinished:** the machine that learns which take you prefer is wired up but **has never been taught** — no preferences have been recorded yet. Picking a take works; it just doesn't yet change future drafts.

---

### 2.5 Graphics

**Where:** the **Graphic** button on a line, or the graphics section under the timeline.

Six kinds: **definition**, **stat**, **callout**, **emphasis**, **lower third**, and **AI overlay**.

- **Generate a graphic for one line** takes about a second, read off the existing transcript.
- There's a **box that takes your voice** — describe the graphic by speaking instead of typing. The microphone is asked for once at launch, not mid-sentence.
- **Burn in (N)** renders them into a separate file. It does **not** overwrite the clean cut.

**Unfinished:** **AI overlay** is recorded as a request and shown in the list, but **nothing generates an image**. The user parked it after seeing the per-image cost. Everything except the generation call is built. **Do not file "AI overlay does nothing" as a bug.**

---

### 2.6 Settings

**Where:** left rail → Settings.

| section | what it does | state |
|---|---|---|
| **Profile** | name and organisation | works |
| **Microphone** | permission check for voice input | works |
| **Products SnipAi listens for** + **Amazon affiliate tag** | a list of product names to recognise | **the form saves, but nothing in the app reads the file yet** |
| **Editing tools** | rules learned from your editing, each removable; **Add a rule** | works |
| **Videos to learn the style from** / **What SnipAi is aiming at** | upload a raw video and your finished edit of it; the app measures the difference and derives a target | **upload and measurement work** |

**Reference upload accepts:** `.mp4` `.mov` `.m4v` `.webm` only — **narrower than the importer**, which also takes `.avi` and `.mkv`. Cap **600 MB** (the project importer has no cap). This inconsistency is real; flag it if you think it matters.

---

### 2.7 Connectors

**Where:** left rail → Connectors.

Eight tiles: TikTok Shop, Instagram, Pinterest, Trybe, X, Snapchat, Facebook, Amazon Storefront.

**All eight are permanently "not connected."** There is no login, no posting, no API integration behind any of them. This screen is a placeholder awaiting developer accounts on each platform. **Do not file these as broken.**

---

## Part 3 — Keyboard

Active on the Review screen. **They must not fire while you're typing in a text box.**

| key | does |
|---|---|
| **Space** | play/pause. With a snippet editor open, plays that line |
| **J / K / L** | shuttle back / stop / forward, doubling up to 8× |
| **← / →** | one frame. With **Shift**, one second |
| **Home / End** | first / last line |
| **↑ / ↓** | previous / next line |
| **I / O** | set in / out point at the playhead |
| **S** | split the selected line at the playhead |
| **⌘B** | split whichever line the playhead is inside |
| **[ / ]** | nudge in/out by 0.05s; **Shift** 0.20s |
| **T** | open the snippet editor |
| **M** | drop a marker |
| **F** | clear the selection |
| **N** | jump to the next line needing a call |
| **Delete / Backspace** | delete the highlighted stretch, or the selected line |
| **⌘Z** | undo |

**There is no redo.** ⌘⇧Z does nothing. This is a genuine gap, not a bug to file — but worth knowing.

**Undo depth is 24 steps, and it is lost on refresh.** The edit itself survives; the ability to step back doesn't.

---

## Part 4 — Behaviours that cut across everything

### Edits apply themselves
There is no "render" button for ordinary edits. Cut something and the app rebuilds in the background. Watch the edit, not the last render. If the rendered file is behind, the **Rendered file** button says so.

### Every write is snapshotted
Before any change to the edit, a copy is filed. **60 versions** are kept. **History** lists them with the reason ("cutting that bit out", "trim hook", "undo") and puts any back. Restoring is itself undoable.

### An edit that changes nothing says so
If an action wouldn't change anything, the app says so instead of claiming success — *"that stretch is already cut out"*, *"that line is already there"*, *"there was nothing to undo"*. **Nothing is written, no version is burned, and no undo step is added.** This is correct.

### A job that goes quiet warns before it's stopped
A step with nothing to report says so once half its patience is gone, and
keeps saying so: *"still working — nothing reported for 150s. If it stays
quiet for another 150s it will be stopped."* It is stopped after 5 minutes of
true silence, so the first warning arrives at 150 seconds. (An earlier version
of this document said 45s/255s, and the app said 20s/280s. Neither was right:
20 seconds of quiet is normal during transcription and rendering, so the
warning fired constantly on healthy jobs. It is half the window now, and the
numbers in the sentence are computed, not fixed — a step given a shorter
patience warns proportionally sooner.)

### Only one heavy job at a time
Transcription and rendering each want the whole machine. A second request is refused with a message naming what's already running.

### A build knows which pipeline made it
A render is a snapshot of the edit *and* of the cutting that produced it. The
app already says when a file no longer matches the edit; it now also says when
the file was built by an older version of the cutting — *"that file was built
by an older version of the cutting"*, and the next step reads **Rebuild — the
cutting has improved since this was built**. A build with no stamp at all is
from before this existed, so it counts as older. This is quieter than the
edit-mismatch line on purpose: the file is not wrong about your decisions, it
just predates a fix.

### A broken project stays visible
If a project's edit file becomes unreadable, it **still appears on the queue**, saying what's wrong. It must never silently vanish, and it must never take other projects down with it.

---

## Part 5 — Known gaps. Please don't file these.

| # | What you'll see | Why |
|---|---|---|
| 1 | **The word being spoken is not highlighted** as the video plays | Line-level highlighting works. Word-level is written but never renders — a confirmed open defect, cause not yet found |
| 2 | **No captions/subtitles anywhere** | Never built. The word-level transcript exists but nothing renders captions |
| 3 | **No filler-word removal** ("um", "uh") | Never built. The app removes whole bad takes instead |
| 4 | **No audio levelling and no music bed** | Never built |
| 5 | **No redo** | Never built |
| 6 | **All eight Connectors say "not connected"** | Placeholder; needs a developer account per platform |
| 7 | **AI overlay generates no image** | Parked on cost |
| 8 | **Products & links saves but does nothing** | The form writes a file nothing reads yet |
| 9 | **The auto-built cut is 720p; pressing Build gives full resolution** | Deliberate (minutes vs tens of minutes) — but **nothing on screen tells you which you're looking at**. A real usability gap |
| 10 | **The finished cut may still contain repeated phrases** | The check reports them; nothing acts on them. Currently 11 on the sample project |
| 11 | **A partly-overlapping cut reports the whole highlight length** | It removes only the new part; the message names the full selection |
| 12 | **Filmstrip may show the previous render's frames** | Known caching defect |
| 13 | **Gatekeeper blocks the app on any other Mac** | Unsigned. Needs a $99/yr Apple account |
| 14 | **Apple Silicon runs it under Rosetta** | Built for Intel only |
| 15 | **No accessibility work has been done** | Never assessed. Screen-reader and keyboard-only support are unknown |

---

## Part 6 — Where to attack hardest

Ranked by what a defect would cost the user.

1. **Does the finished video actually play correctly?** Open the exported file. Check for silence longer than about 3 seconds, black frames at a join, missing audio, a line spoken twice. An export can report success and still be wrong — this is the single most valuable thing you can check.
2. **Does the page stay still while dragging?** Snippet editor and timeline both. Vertically and horizontally.
3. **Does delete actually delete?** Then does ⌘Z put it back *exactly*?
4. **Does a big import survive?** Try over 1.5 GB. Watch the percentage move. It should never sit on one unchanging word.
5. **Interrupt things.** Quit mid-render and reopen. Refresh mid-edit. Start two jobs. Import while a build runs.
6. **Corrupt things.** Edit a project's `beats.json` to invalid JSON. The queue must still load, and that project must appear *saying it's broken*.
7. **Be impatient.** Double-click every button. Hammer Delete. Drag while playing.

**One rule:** the app operates on the user's real, irreplaceable footage. Test destructively on a **copy** of a project, never on one that matters.

---

## Part 7 — Running it

```bash
cd ~/Projects/SnipAi
./scripts/bundle-app     # builds SnipAi.app (a few minutes)
open SnipAi.app
```

The app serves itself at `http://127.0.0.1:4737` and you can open that in a browser too — useful, because browser dev tools show console errors the app window doesn't.

**To test against throwaway data instead of the real library**, set `SNIPAI_DATA` to an empty folder before launching. Strongly recommended.

Automated checks, all currently passing: `./scripts/test` (165 unit tests) and `./scripts/qa --full`. Note that "all green" is printed alongside a separate **bug board** count — `1 still open` is expected and is a deliberate open item, not a failure.

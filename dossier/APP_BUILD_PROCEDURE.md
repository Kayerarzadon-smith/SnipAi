# Build & deployment procedure

Every command below is taken from this repository. Anything not established from the source is marked **UNKNOWN**.

Commit: **b9ee16f** · branch **master** · `package.json` version **0.1.0** · `Info.plist` **CFBundleShortVersionString 0.1.0 / CFBundleVersion 1**.

There is **no CI configuration in the repository** — no `.github/`, no pipeline file. Every command here is run by a person on the machine.

---

## What "deploy" means here

Two distinct artifacts, and they are **not** the same build:

| | development | shipped |
|---|---|---|
| server | `next dev` / `next start` from the repo | `.next/standalone` copied into `SnipAi.app/Contents/Resources/server` |
| node | the system node | a copy of the host's node binary inside the bundle |
| python | `ugc-edit-system/.venv` | a relocatable CPython 3.11.16 inside the bundle |
| ffmpeg | `.venv/bin/ffmpeg` | `Contents/Resources/pipeline/bin/ffmpeg`, lifted out of `imageio_ffmpeg` |
| tools | `ugc-edit-system/tools` | copied into `Contents/Resources/pipeline/tools` |

**`npm run build` does not update the app.** Only `./scripts/bundle-app` does.

---

## 1. Stop running processes

```bash
osascript -e 'quit app "SnipAi"' 2>/dev/null
PID=$(lsof -nP -iTCP:4737 -sTCP:LISTEN -t | head -1); [ -n "$PID" ] && kill "$PID"
sleep 2
lsof -nP -iTCP:4737 -sTCP:LISTEN -t || echo "port free"
```

> Kill **by port**. The server process renames itself to `next-server`, so `pkill -f node` and `pkill -f SnipAi.app` both miss it. There is also a `stop-snipai.command` in the repo root for the browser-launch path.

## 2. Remove stale artifacts

```bash
rm -rf .next SnipAi.app tsconfig.tsbuildinfo
rm -f .snipai.pid .snipai.log .snipai-window.log
```

## 3. Clear caches (full cold build only)

```bash
rm -rf .build-cache          # 543 MB: the pinned CPython tarball and its pip install
rm -rf node_modules
rm -rf ugc-edit-system/.venv
```

`.build-cache` is reused whenever `$PYBUILD/bin/python3` exists, so **a change to `requirements.txt` will not take effect until this is cleared**.

## 4–5. Restore and install dependencies

```bash
npm ci                                                   # lockfileVersion 3, 36 packages
python3 -m venv ugc-edit-system/.venv
ugc-edit-system/.venv/bin/pip install -r ugc-edit-system/requirements.txt
```

Pinned Python: `faster-whisper==1.2.1`, `imageio-ffmpeg==0.6.0`.
The bundle pins its interpreter separately in `scripts/bundle-app`: `PY_RELEASE=20260901`, `PY_FULL=3.11.16`, from `astral-sh/python-build-standalone`.

Node under test: **v24.20.0**. Node 24 is **required** — `tests/register.mts` relies on native TypeScript type-stripping. npm 11.19.0.

## 6. Generate assets

There is no separate asset step. The app icon is prebuilt at `scripts/build/AppIcon.icns` (regenerable with `scripts/make_icon.py`, which is **not** part of the bundle flow).

## 7. Build

```bash
npm run build          # next build; postbuild runs ./scripts/qa --fast
```

Produces `.next/standalone` (`output: "standalone"` in `next.config.js`), which is what makes the bundle 31 MB instead of 250 MB. `experimental.outputFileTracingExcludes` keeps `ugc-edit-system/**`, `.next/cache/**` and `tests/**` out of the trace — without it the tracer follows `lib/pipeline.ts` into the venv and the user's footage.

## 8. Verify the build

```bash
./scripts/test        # types + TS suite + bug board (reported separately) + Python suite
./scripts/qa --full   # the above, plus guards, reproduced bugs, orphaned-route sweep

# the frozen-route check — a GET-only route Next prerendered is a permanent
# stale answer that development can never reproduce
find .next/server/app/api -name '*.body'      # must print nothing
```

Optional but recommended before shipping:
```bash
QA_BUDGET=400 node --import ./tests/register.mts qa/run.mts       # ~3,400 generated scenarios
QA_BUDGET=60  node --import ./tests/register.mts qa/run-api.mts   # ~416 route scenarios
```

## 9. Assemble and install the app

```bash
./scripts/bundle-app            # QA gate first; QA_SKIP=1 to bundle regardless
open -a "$PWD/SnipAi.app"
```

`bundle-app` in order: QA gate → `npm run build` → fetch/unpack the pinned CPython → copy the standalone tree, `.next/static`, `public/`, the Python tools and the runtime → lift `ffmpeg` out of `imageio_ffmpeg` to `pipeline/bin/ffmpeg` → strip `__pycache__` and the CPython test suite → `swiftc -O native/main.swift` → report sizes.

Two guards worth keeping: it verifies `swiftc` actually produced a binary (a shell chain can report success while the compile failed), and it fails if any API route was prerendered.

Current output: node 119 MB · server 31 MB · pipeline 496 MB · **total ~666 MB**.

## 10. Verify the running app is the current commit

```bash
for i in $(seq 1 60); do curl -sf -m 3 http://localhost:4737/api/projects >/dev/null && break; sleep 1; done

# which tree is serving?
lsof -p "$(lsof -nP -iTCP:4737 -sTCP:LISTEN -t)" | awk '$4=="cwd"{print $NF}'

# and is the code actually yours? there is no version endpoint, so grep the served files
grep -c "<a string unique to HEAD>" SnipAi.app/Contents/Resources/pipeline/tools/build_cut.py
```

> **UNKNOWN / GAP:** the application exposes **no build stamp, version endpoint, or commit hash at runtime**. `/api/projects` returns project data only. Verifying "the running app is this commit" is currently forensic. Adding a `/api/version` returning the commit and build time would make every clean-state gauntlet cheaper and is the single highest-value ship-readiness addition.

---

## Signing, notarisation, distribution

```bash
codesign -dv SnipAi.app     # → "code object is not signed at all"
```

The bundle is **unsigned**. It runs on the machine that built it; Gatekeeper stops it anywhere else. Signing and notarisation need an Apple Developer account (**$99/yr**), which the user has explicitly deferred — `DOCKET.md` B2. Auto-update (B3) depends on B2. A universal binary (B4) is not built; both shipped binaries are **x86_64**, and the host is x86_64.

There is no installer, no DMG, no update channel, no release script. Distribution today is: copy `SnipAi.app`.

## Launch paths

| path | what it does |
|---|---|
| `open -a SnipAi.app` | the native wrapper: starts its own server, opens a WKWebView on 127.0.0.1:4737 |
| `./launch-snipai.command` | double-clickable: starts the server and opens the **default browser** |
| `./stop-snipai.command` | stops that server |
| `npm run dev` | `next dev -p 4737 -H 127.0.0.1` — hot reload, **cannot reproduce prerender faults** |
| `npm start` | `next start -p 4737 -H 127.0.0.1` against `.next` |

All bind **127.0.0.1 only**, in `package.json` and in `native/main.swift` (`env["HOSTNAME"] = "127.0.0.1"`). There is no authentication anywhere in the application; loopback binding is the entire access control, and it must not be relaxed.

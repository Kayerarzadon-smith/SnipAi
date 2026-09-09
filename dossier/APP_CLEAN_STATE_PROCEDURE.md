# Clean-state procedure

Commit under test: **b9ee16f** · branch **master** · working tree clean.

The single most important fact for this application:

> **There is no browser-side state.** `grep -rE "localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker|caches\." app/ lib/` returns **nothing**. No cookies, no service worker, no Cache API, no IndexedDB, no auth token. Every byte of state is a file on disk.

That removes an entire class of contamination and concentrates the risk somewhere less obvious: **build artifacts and the user's library**.

---

## Contamination surfaces, ranked by how badly each can lie to you

### 1. `SnipAi.app/` — 666 MB · **the worst offender**

The bundle is a **complete second copy** of the application: its own `node`, its own Next server (`Contents/Resources/server`), its own CPython, its own copy of every Python tool (`Contents/Resources/pipeline/tools`). It is **gitignored** and is **not** rebuilt by `npm run build`.

**How it lies:** you edit `lib/beats.ts`, run the tests, they pass — and then you test "the app", which is running the bundle from three commits ago. This happened repeatedly during development. It is also possible for the bundle's *server* to be current while its *Python tools* are stale, because they are copied in a separate step.

**Detect:**
```bash
grep -c "<a string only in your change>" SnipAi.app/Contents/Resources/pipeline/tools/build_cut.py
grep -c "<a string only in your change>" SnipAi.app/Contents/Resources/server/.next/server/app/api/**/route.js
```

**Clear:** `rm -rf SnipAi.app` and re-run `./scripts/bundle-app`.

### 2. A server process outliving its bundle

The node process **renames itself to `next-server`**, so `pkill -f 'SnipAi.app/Contents/Resources/node'` does **not** match it. A stale server can keep answering on 4737 after you quit the app, and every test then runs against old code.

**Detect and kill by port, never by name:**
```bash
lsof -nP -iTCP:4737 -sTCP:LISTEN -t
```

### 3. `.next/` — 136 MB, and the frozen-route trap

Next 14 **prerenders a GET-only route handler** unless it declares `export const dynamic = "force-dynamic"`. `/api/jobs/running` shipped as a permanent `{"job":null}` — so the queue's progress bar never moved for any job, in every build, while working perfectly in `next dev`.

**This class of fault cannot be reproduced in development.** Only a production build shows it.

**Detect:** any `.body` file under `.next/server/app/api` is a frozen route.
```bash
find .next/server/app/api -name '*.body'
```
`scripts/bundle-app` now fails the build if it finds one. Keep that guard.

### 4. `~/Movies/SnipAi` (`DATA_ROOT`) — 8.8 GB · **the user's real work**

Resolution order (`lib/paths.ts:resolveDataRoot`):
1. `$SNIPAI_DATA` if set
2. `~/Movies/SnipAi` if `projects/` exists there
3. otherwise `CODE_ROOT` (the pre-migration in-repo layout)

Contains: `projects/<name>/{beats.json, review-state.json, .snapshots/, raw/, cuts/, work/}`, `state/{jobs.json, tuning.json, learnings.json, providers.json}`, `reference/`, `.trash/`.

**How it lies:**
- `state/tuning.json` — learned parameters. This loop has run away once (`snap_tail` reached 1.359 and put 10.8s of dead air into a render). A tuning file from an earlier session **changes what the renderer produces**.
- `state/jobs.json` — 40 jobs, 251 KB, up to 379 log lines each. A job left `running` makes the next build 409.
- `.snapshots/` — capped at 60, but a test that counts snapshots is meaningless against a pre-filled ring.
- `review-state.json` — take picks, trim edits, cut regions, the cached scorecard.

**NEVER delete this to get a clean state.** Point the app somewhere else:
```bash
export SNIPAI_DATA="$(mktemp -d)/lib"
```

### 5. `.build-cache/` — 543 MB

Holds the downloaded CPython tarball and the unpacked, pip-installed runtime, keyed by version and arch. `scripts/bundle-app` reuses it if `$PYBUILD/bin/python3` exists — so **a change to `requirements.txt` does not reinstall anything**. A bundle can ship dependencies that no longer match the manifest.

**Detect:** `ls .build-cache/` · **Clear:** `rm -rf .build-cache` (costs a ~60 MB download and a pip install).

### 6. `ugc-edit-system/.venv/` — 433 MB

The development interpreter. **Not what the bundle ships** (the bundle carries a relocatable CPython). `./scripts/test` skips the Python suite entirely if the venv is missing — and prints `skipped -- no venv`, which the QA gate now catches.

A venv whose `faster-whisper` differs from `requirements.txt` puts a different transcriber in front of you than the bundle uses.

### 7. `node_modules/` + `package-lock.json`

lockfileVersion 3, 36 locked packages, 3 runtime dependencies. `npm ci` is the only install that respects the lock; `npm install` may drift.

### 8. `tsconfig.tsbuildinfo` (72 KB)

Incremental type-check state. A stale one can let a type error through on the first run after a checkout.

### 9. Working-tree scratch

`.snipai.pid`, `.snipai.log`, `.snipai-window.log`, `prototype/`, `ugc-edit-system/reference.superseded/`, and any `zz-*` or `_scratch` project left in `DATA_ROOT/projects` by a previous test run. `listProjectNames()` filters names starting with `_` but **not** `zz-`.

### 10. Environment variables

`SNIPAI_CODE`, `SNIPAI_DATA`, `SNIPAI_PYTHON`, `SNIPAI_FFMPEG` (the bundle's whole contract), plus `SNIPAI_THREADS`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS`, and the three image-provider keys. An exported `SNIPAI_DATA` from a previous session silently redirects everything.

> **Note:** `SNIPAI_THREADS` is read by seven Python tools and is **set by nothing in this repository**. Whether it is ever set in practice is UNKNOWN.

### 11. Not applicable here

No Docker, no containers, no volumes, no database server, no migrations, no CDN, no service worker, no CI cache. Do not spend gauntlet budget on them.

---

## The procedure

```bash
cd ~/Projects/SnipAi

# 1 — stop everything, BY PORT (the process is named next-server, not node)
osascript -e 'quit app "SnipAi"' 2>/dev/null
PID=$(lsof -nP -iTCP:4737 -sTCP:LISTEN -t | head -1); [ -n "$PID" ] && kill "$PID"
sleep 2; lsof -nP -iTCP:4737 -sTCP:LISTEN -t || echo "port free"

# 2 — confirm what you are testing
git rev-parse HEAD; git status --short        # must be empty

# 3 — remove every build artifact
rm -rf .next SnipAi.app tsconfig.tsbuildinfo
rm -f .snipai.pid .snipai.log .snipai-window.log

# 4 — for a TRUE cold build, also drop the runtime caches
#     (skip only if you accept that requirements.txt changes will not take)
rm -rf .build-cache node_modules ugc-edit-system/.venv

# 5 — clear any environment redirect from a previous session
unset SNIPAI_CODE SNIPAI_DATA SNIPAI_PYTHON SNIPAI_FFMPEG SNIPAI_THREADS

# 6 — restore dependencies exactly
npm ci
python3 -m venv ugc-edit-system/.venv
ugc-edit-system/.venv/bin/pip install -r ugc-edit-system/requirements.txt

# 7 — isolate the library. NEVER test against ~/Movies/SnipAi.
export SNIPAI_DATA="$(mktemp -d)/snipai-lib"
mkdir -p "$SNIPAI_DATA/projects" "$SNIPAI_DATA/state"
echo "testing against $SNIPAI_DATA"
```

### Verifying you are clean

```bash
[ ! -d .next ] && [ ! -d SnipAi.app ] && echo "no build artifacts"
lsof -nP -iTCP:4737 -sTCP:LISTEN -t || echo "nothing on 4737"
env | grep -E '^SNIPAI_' || echo "no SNIPAI_ overrides except the one you just set"
ls "$SNIPAI_DATA/projects"            # must be empty
```

### Verifying the *running* app is the current commit

`git rev-parse HEAD` says nothing about what is serving on 4737. Assert it directly:

```bash
lsof -p "$(lsof -nP -iTCP:4737 -sTCP:LISTEN -t)" | awk '$4=="cwd"{print $NF}'
# → .../SnipAi.app/Contents/Resources/server  (the bundle)
# → .../Projects/SnipAi                        (npm start / next dev)

# and prove a string from the commit under test is actually in the served code:
grep -rl "<a string unique to HEAD>" SnipAi.app/Contents/Resources/server/.next/server/app/
grep -c  "<a string unique to HEAD>" SnipAi.app/Contents/Resources/pipeline/tools/build_cut.py
```

**There is no build stamp, version endpoint, or commit hash exposed at runtime.** Adding one would make this check trivial instead of forensic. Recommended.

---

## Traps specific to this repository

- **`./scripts/test` prints "all green" for the suite while the bug board is red.** The board (`tests/regressions/`) is written to fail until the bug it names is fixed, so it is reported separately. `1 still open` under a green suite is the expected state today.
- **`npm run build` triggers `postbuild: ./scripts/qa --fast`.** A build is never just a build.
- **The commit hook** (`core.hooksPath=.githooks`) runs `./scripts/qa --fast` and blocks only on findings that are *new* against `audits/.qa-baseline`.
- **Destructive testing must never touch `img-9817` or `img-9823`** — those are the user's real projects. Use `SNIPAI_DATA` isolation, or a `zz-*` project, and delete it afterwards.

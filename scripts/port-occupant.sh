# Who is on the port? -- sourced, not run.
#
# The shell half of the rule in native/LaunchDecision.swift, and it exists for
# the same reason: **the port identifies nobody.** Ledger N1, P19, N8 and T10
# are four sightings of one fallacy -- "something answered on 4737, therefore
# it is our server" -- and one of them cost a write into the real library.
#
# `curl -s $URL/api/projects | grep -q '"projects"'` was the shell's version.
# It is better than checking that the port is open and still not enough: EVERY
# SnipAi server answers "projects", including one serving a different library,
# so the launcher said "Already running" and opened the browser onto somebody
# else's footage (N8). Two libraries can hold projects of the same name -- a
# sandbox copy is exactly that -- so the list of names settles nothing.
#
# /api/health settles it, and the order matters as much as the route: ASK WHO
# IS THERE FIRST. Identification used to be gated behind a liveness probe with
# a 1.5s budget, and a `next dev` still compiling that route read as an empty
# port (N5).
#
#   . scripts/port-occupant.sh
#   snipai_probe_port 4737
#   case "$SNIPAI_OCCUPANT" in free|identified|unidentified) ... esac
#
# After snipai_probe_port, these are set:
#   SNIPAI_OCCUPANT        free | identified | unidentified
#   SNIPAI_OCCUPANT_ROOT   the library it serves      (identified only)
#   SNIPAI_OCCUPANT_PID    the pid it reports         (identified only)
#   SNIPAI_OCCUPANT_CODE   the code root it reports   (identified only)
#   SNIPAI_OCCUPANT_PIDS   the listening pids         (unidentified only)

# The timeout is generous on purpose. Next compiles a route the first time it
# is asked for, so a perfectly healthy server can take seconds to answer the
# first request -- and an empty port costs nothing, because the connection is
# refused immediately.
SNIPAI_HEALTH_TIMEOUT="${SNIPAI_HEALTH_TIMEOUT:-8}"

_snipai_json_string() {   # $1 = key, JSON on stdin
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

_snipai_json_number() {   # $1 = key, JSON on stdin
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1
}

# The data root the SERVER would resolve, worked out the same way it does.
# Mirrors resolveDataRoot() in lib/paths.ts, and the order of the three
# branches is load-bearing: SNIPAI_DATA wins; otherwise the standard library
# if the migration has run; otherwise the old in-repo layout, which is
# CODE_ROOT -- the ugc-edit-system directory, not the repo root.
snipai_expected_data_root() {   # $1 = repo root (defaults to $PWD)
  local repo="${1:-$PWD}"
  if [ -n "${SNIPAI_DATA:-}" ]; then
    # path.resolve() on the other side: absolute, with `..` flattened.
    snipai_resolve_path "$SNIPAI_DATA"
    return
  fi
  if [ -d "$HOME/Movies/SnipAi/projects" ]; then
    printf '%s\n' "$HOME/Movies/SnipAi"
    return
  fi
  printf '%s\n' "$repo/ugc-edit-system"
}

# path.resolve(), lexically -- absolute, `.` dropped, `..` flattened, and
# WITHOUT touching the disk.
#
# Not `cd "$p" && pwd -P`: bash's cd checks that every component exists, so a
# library that has not been created yet came back unresolved while the server
# -- whose path.resolve() is pure string work -- reported the flattened form.
# The two then disagreed about one directory and the launcher refused to open
# the app against its own library. A safety check that cries wolf is one
# somebody switches off.
snipai_resolve_path() {
  local p="$1" part out=""
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  local IFS=/
  for part in $p; do
    case "$part" in
      ""|.) ;;
      ..)   out="${out%/*}" ;;
      *)    out="$out/$part" ;;
    esac
  done
  printf '%s\n' "${out:-/}"
}

# Two paths naming the same directory. The two sides normalise differently
# (/var vs /private/var is the one that bites on macOS, and it is exactly
# where a throwaway library gets created) and must still agree. Three tiers,
# the same three native/LaunchDecision.swift's samePath() uses: equal as
# written, equal once flattened, or equal once symlinks are followed -- that
# last one only when both actually exist.
snipai_same_path() {
  [ "$1" = "$2" ] && return 0
  local a b ra rb
  a=$(snipai_resolve_path "$1")
  b=$(snipai_resolve_path "$2")
  [ "$a" = "$b" ] && return 0
  ra=$( cd "$a" 2>/dev/null && pwd -P ) || ra="$a"
  rb=$( cd "$b" 2>/dev/null && pwd -P ) || rb="$b"
  [ "$ra" = "$rb" ]
}

snipai_probe_port() {   # $1 = port
  local port="$1" json
  SNIPAI_OCCUPANT=free
  SNIPAI_OCCUPANT_ROOT=""
  SNIPAI_OCCUPANT_PID=""
  SNIPAI_OCCUPANT_CODE=""
  SNIPAI_OCCUPANT_PIDS=""

  json=$(curl -s -m "$SNIPAI_HEALTH_TIMEOUT" "http://127.0.0.1:$port/api/health" 2>/dev/null)
  if [ -n "$json" ]; then
    SNIPAI_OCCUPANT_ROOT=$(printf '%s' "$json" | _snipai_json_string dataRoot)
    if [ -n "$SNIPAI_OCCUPANT_ROOT" ]; then
      SNIPAI_OCCUPANT=identified
      SNIPAI_OCCUPANT_PID=$(printf '%s' "$json" | _snipai_json_number pid)
      SNIPAI_OCCUPANT_CODE=$(printf '%s' "$json" | _snipai_json_string codeRoot)
      return 0
    fi
  fi

  # Nobody said who they are. That is not the same as nobody being there: an
  # older build serves the app perfectly well and has no such route, and a
  # program that is not SnipAi at all will not answer either. Either way we
  # must not treat the port as empty, or we start a server that dies of
  # EADDRINUSE and report that we started one.
  SNIPAI_OCCUPANT_PIDS=$(lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null | sort -u | tr '\n' ' ')
  SNIPAI_OCCUPANT_PIDS="${SNIPAI_OCCUPANT_PIDS% }"
  [ -n "$SNIPAI_OCCUPANT_PIDS" ] && SNIPAI_OCCUPANT=unidentified
  return 0
}

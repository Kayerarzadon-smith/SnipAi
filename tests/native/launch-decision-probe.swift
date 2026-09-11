import Foundation

// Exercises native/LaunchDecision.swift -- the server-ownership rule behind
// ledger N1 and P19 -- without a window, a bundle, or port 4737.
//
//   swiftc -o /tmp/probe native/LaunchDecision.swift tests/native/launch-decision-probe.swift
//   /tmp/probe                 # the decision table
//   /tmp/probe <port> <root>   # also check a REAL server on <port>: it must
//                              # be identified as serving <root>, refused,
//                              # and left running
//
// The second form is the reproduction the ledger asks for: a server on a port
// with a different data root, and proof the app neither adopts nor kills it.
// It is a probe rather than a node test because the code under test is Swift;
// `./scripts/qa` does not compile it, so it is run deliberately and its output
// pasted into the commit.

var failures = 0
var checks = 0

func check(_ ok: Bool, _ what: String) {
    checks += 1
    if ok {
        print("  ok    \(what)")
    } else {
        print("  FAIL  \(what)")
        failures += 1
    }
}

func check(_ got: LaunchAction, _ want: LaunchAction, _ what: String) {
    // Compare the case, not the wording: the messages are for a person and
    // will be reworded; the decision is the contract.
    func tag(_ a: LaunchAction) -> String {
        switch a {
        case .startOurOwn:    return "startOurOwn"
        case .adopt:          return "adopt"
        case .restartOrphan:  return "restartOrphan"
        case .refuse:         return "refuse"
        }
    }
    check(tag(got) == tag(want), "\(what) -> \(tag(got))")
}

let sandbox = "/tmp/snipai-sandbox"
let real = NSString(string: "~/Movies/SnipAi").expandingTildeInPath

func identified(_ root: String, pid: Int32 = 4242) -> PortOccupant {
    .identified(ServerIdentity(dataRoot: root, codeRoot: "/x/code", pid: pid))
}

@main
struct LaunchDecisionProbe {
  static func main() {
    print("\n== nothing on the port ==")
    check(decideLaunch(occupant: .free, expectedDataRoot: sandbox, buildMatches: false,
                       listenerIsOurOrphan: false, port: 4737),
          .startOurOwn, "free port")

    print("\n== N1: a server serving a DIFFERENT library ==")
    // The 2026-09-10 failure exactly: launched for a sandbox, real library on the
    // port, builds identical so the old code adopted it without a word.
    check(decideLaunch(occupant: identified(real), expectedDataRoot: sandbox,
                       buildMatches: true, listenerIsOurOrphan: false, port: 4737),
          .refuse(""), "real library on the port, sandbox asked for, builds match")
    check(decideLaunch(occupant: identified(real), expectedDataRoot: sandbox,
                       buildMatches: false, listenerIsOurOrphan: false, port: 4737),
          .refuse(""), "same, builds differ")
    // Our own leftover pointed at the wrong library is ours to correct.
    check(decideLaunch(occupant: identified(real), expectedDataRoot: sandbox,
                       buildMatches: true, listenerIsOurOrphan: true, port: 4737),
          .restartOrphan(""), "our own orphan on the wrong library")

    print("\n== P19: a stranger's server we must not kill ==")
    // `npm run dev` on the same library, then an edit, then double-click the app.
    // This is the case that used to run `lsof | xargs kill`.
    check(decideLaunch(occupant: identified(real), expectedDataRoot: real,
                       buildMatches: false, listenerIsOurOrphan: false, port: 4737),
          .adopt(""), "dev server, right library, older build -- adopt, never kill")
    check(decideLaunch(occupant: .unidentified, expectedDataRoot: real,
                       buildMatches: false, listenerIsOurOrphan: false, port: 4737),
          .refuse(""), "unknown program on the port -- refuse, never kill")

    print("\n== the ordinary cases ==")
    check(decideLaunch(occupant: identified(real), expectedDataRoot: real,
                       buildMatches: true, listenerIsOurOrphan: false, port: 4737),
          .adopt(""), "right library, current build")
    check(decideLaunch(occupant: identified(real), expectedDataRoot: real,
                       buildMatches: false, listenerIsOurOrphan: true, port: 4737),
          .restartOrphan(""), "our orphan, right library, stale build")
    check(decideLaunch(occupant: .unidentified, expectedDataRoot: real,
                       buildMatches: true, listenerIsOurOrphan: true, port: 4737),
          .restartOrphan(""), "our orphan, too old to identify itself")

    print("\n== no action ever kills without ownership ==")
    for occ in [PortOccupant.unidentified, identified(real), identified(sandbox)] {
        for matches in [true, false] {
            let a = decideLaunch(occupant: occ, expectedDataRoot: sandbox,
                                 buildMatches: matches, listenerIsOurOrphan: false, port: 4737)
            if case .restartOrphan = a {
                check(false, "restartOrphan reached without ownership -- \(occ), build=\(matches)")
            }
        }
    }
    check(true, "no unowned listener is ever restarted (6 combinations)")

    print("\n== path comparison does not cry wolf ==")
    check(samePath("/tmp/x", "/tmp/x"), "identical")
    check(samePath("/tmp/x/y/..", "/tmp/x"), "flattened .. matches")
    check(!samePath("/tmp/x", "/tmp/y"), "genuinely different roots differ")

    print("\n== expectedDataRoot mirrors lib/paths.ts resolveDataRoot ==")
    check(expectedDataRoot(codeRoot: "/code", environment: ["SNIPAI_DATA": "/a/b"],
                           fileExists: { _ in true }) == "/a/b",
          "SNIPAI_DATA wins")
    check(expectedDataRoot(codeRoot: "/code", environment: ["SNIPAI_DATA": "  "],
                           fileExists: { _ in true }) == NSString(string: "~/Movies/SnipAi").expandingTildeInPath,
          "blank SNIPAI_DATA is not a value")
    check(expectedDataRoot(codeRoot: "/code", environment: [:],
                           fileExists: { _ in true }) == NSString(string: "~/Movies/SnipAi").expandingTildeInPath,
          "standard library when it has projects/")
    check(expectedDataRoot(codeRoot: "/code", environment: [:],
                           fileExists: { _ in false }) == "/code",
          "pre-migration falls back to the code root")

    // ---------------------------------------------------------------- live check
    if CommandLine.arguments.count > 2, let port = Int(CommandLine.arguments[1]) {
        let otherRoot = CommandLine.arguments[2]
        print("\n== live: a real server on port \(port) serving \(otherRoot) ==")

        guard let id = fetchServerIdentity(port: port) else {
            print("  FAIL  /api/health did not answer on \(port)")
            exit(1)
        }
        check(samePath(id.dataRoot, otherRoot),
              "identified it as serving \(id.dataRoot) (pid \(id.pid))")

        let before = kill(id.pid, 0)          // signal 0: does it exist?
        check(before == 0, "server pid \(id.pid) is alive before the decision")

        let action = decideLaunch(occupant: .identified(id),
                                  expectedDataRoot: sandbox,
                                  buildMatches: true,
                                  listenerIsOurOrphan: listenerIsOurOrphan(
                                      port: port, ourServerPath: "/nonexistent/bundled/server.js"),
                                  port: port)
        if case .refuse(let why) = action {
            check(true, "refused to adopt it")
            print("        message shown to the user:")
            for line in why.split(separator: "\n") { print("        | \(line)") }
        } else {
            check(false, "expected refuse, got \(action)")
        }

        // The decision is only half of it: prove nothing killed it.
        Thread.sleep(forTimeInterval: 0.5)
        check(kill(id.pid, 0) == 0, "server pid \(id.pid) is STILL ALIVE after the decision")
    }

    print("\n\(checks - failures)/\(checks) checks passed")
    exit(failures == 0 ? 0 : 1)

  }
}

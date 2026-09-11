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
// It is a probe rather than a node test because the code under test is Swift.
//
// The first form is no longer run by hand: `scripts/check-launcher` compiles
// and runs it on every `./scripts/test`, and therefore on every
// `./scripts/qa --full` and every `scripts/bundle-app` (ledger N4). Hand-run
// with its output pasted into a commit message was the defect -- the rule
// could have stopped being enforced and nothing would have said so. Keep this
// file cheap enough to stay in that gate: it is ~14s today, nearly all of it
// the live sections below.

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

// MARK: - Helpers for the live sections

/// The question the OLD launcher asked to decide the port was free: GET
/// /api/projects, 1.5s, body must contain "projects". Kept here, in the test
/// and not in the app, so the fix can be shown failing the way it used to.
func answersProjectsWithin(port: Int, timeout: TimeInterval) -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/projects") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = timeout
    request.cachePolicy = .reloadIgnoringLocalCacheData
    var alive = false
    let sem = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { data, response, _ in
        if let http = response as? HTTPURLResponse, http.statusCode == 200,
           let data = data, let body = String(data: data, encoding: .utf8),
           body.contains("\"projects\"") {
            alive = true
        }
        sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + timeout + 0.5)
    return alive
}

/// Sockets sitting in TIME_WAIT whose LOCAL port is this one -- what a server
/// that was stopped gracefully leaves behind for ~30s after it is gone.
func timeWaitCount(port: Int) -> Int {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/sbin/netstat")
    p.arguments = ["-an", "-p", "tcp"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return 0 }
    let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    p.waitUntilExit()
    return out.split(separator: "\n").filter { line in
        let f = line.split(separator: " ", omittingEmptySubsequences: true)
        guard f.count >= 6, f[5] == "TIME_WAIT" else { return false }
        return f[3].hasSuffix(".\(port)")     // LOCAL address, not the remote one
    }.count
}

/// A port nothing is using, found with the check under test.
func findFreePort(from: Int = 4900, to: Int = 4960) -> Int? {
    (from...to).first { !portIsOccupied($0) }
}

/// Hold a port the way a real server holds it -- bound, listening, and with
/// SO_REUSEADDR set, because every server built on libuv sets it. Returns the
/// socket to close when done, or nil if it could not take the port.
func holdPort(_ port: Int) -> Int32? {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    if fd < 0 { return nil }
    var on: Int32 = 1
    _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = UInt16(truncatingIfNeeded: port).bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    let bound = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    if bound != 0 || listen(fd, 1) != 0 {
        _ = Darwin.close(fd)
        return nil
    }
    return fd
}

/// tests/native/fake-occupant.mjs, wherever this was run from.
func fakeOccupantScript() -> String? {
    let cwd = FileManager.default.currentDirectoryPath
    let candidates = [
        cwd + "/tests/native/fake-occupant.mjs",
        cwd + "/fake-occupant.mjs",
        (CommandLine.arguments[0] as NSString).deletingLastPathComponent
            + "/tests/native/fake-occupant.mjs",
    ]
    return candidates.first { FileManager.default.fileExists(atPath: $0) }
}

/// Start the fake occupant and wait until it says it is bound.
///
/// `host`, `claimPID` and `serverPath` are the N12 case: a process that binds
/// one address family of a port and answers /api/health with somebody else's
/// pid and a serverPath anyone can read off the filesystem.
func startFakeOccupant(script: String, port: Int, dataRoot: String,
                       projectsDelayMS: Int, withHealth: Bool,
                       host: String = "127.0.0.1",
                       claimPID: Int32? = nil,
                       serverPath: String = "") -> Process? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    var args = ["node", script, "--port", "\(port)", "--data-root", dataRoot,
                "--projects-delay", "\(projectsDelayMS)", "--host", host]
    if !withHealth { args.append("--no-health") }
    if let claimed = claimPID { args += ["--claim-pid", "\(claimed)"] }
    if !serverPath.isEmpty { args += ["--server-path", serverPath] }
    p.arguments = args
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }

    // Block on its own "listening" line rather than sleeping a guess.
    let deadline = Date().addingTimeInterval(10)
    var seen = ""
    while Date() < deadline {
        let chunk = out.fileHandleForReading.availableData
        if chunk.isEmpty { continue }
        seen += String(data: chunk, encoding: .utf8) ?? ""
        if seen.contains("listening") { return p }
    }
    p.terminate()
    return nil
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

    print("\n== N5: identity is asked FIRST, never gated behind a page load ==")
    // The shape of the bug: a server that identifies itself instantly and is
    // slow to serve a page. Under the old order it was filed as `.free`.
    let slowIdentity = ServerIdentity(dataRoot: real, codeRoot: "/x/code", pid: 4242)
    check(lookUpOccupant(port: 4737,
                         identify: { _ in slowIdentity },
                         occupied: { _ in true }) == .identified(slowIdentity),
          "identifies itself -> identified")
    check(lookUpOccupant(port: 4737,
                         identify: { _ in nil },
                         occupied: { _ in true }) == .unidentified,
          "silent but holding the port -> unidentified, NOT free")
    check(lookUpOccupant(port: 4737,
                         identify: { _ in nil },
                         occupied: { _ in false }) == .free,
          "nothing there -> free")
    // An identified server is never re-read as free even if the port check
    // disagrees -- identity is the stronger statement, and it is asked first.
    check(lookUpOccupant(port: 4737,
                         identify: { _ in slowIdentity },
                         occupied: { _ in false }) == .identified(slowIdentity),
          "identity wins over the port check, not the other way round")

    print("\n== N5: portIsOccupied asks the kernel, not a route ==")
    if let free = findFreePort() {
        check(!portIsOccupied(free), "an unused port reads as free (\(free))")
        // Hold it for real, the way a stranger would.
        if let held = holdPort(free) {
            check(true, "test bound port \(free) itself")
            check(portIsOccupied(free), "a held port reads as occupied -- with no HTTP asked")
            _ = Darwin.close(held)
        } else {
            check(false, "could not take port \(free) to test with")
        }
    } else {
        check(false, "no free port in 4900-4960 to test with")
    }

    print("\n== N5 live: a SLOW occupant is identified, not misread as absent ==")
    // The tester's case, reproduced: /api/health answers at once, /api/projects
    // takes 4s. Before the fix the app called this port FREE, started a server
    // that died of EADDRINUSE, logged a pid that was already dead, and hung.
    guard let script = fakeOccupantScript() else {
        print("  FAIL  tests/native/fake-occupant.mjs not found -- run this from the repo root")
        exit(1)
    }
    guard let slowPort = findFreePort() else {
        print("  FAIL  no free port to run the slow occupant on")
        exit(1)
    }
    let otherLibrary = "/tmp/snipai-someone-elses-library"
    guard let occupantProc = startFakeOccupant(script: script, port: slowPort,
                                               dataRoot: otherLibrary,
                                               projectsDelayMS: 4000, withHealth: true) else {
        print("  FAIL  could not start the fake occupant on \(slowPort)")
        exit(1)
    }
    defer { if occupantProc.isRunning { occupantProc.terminate() } }

    // 1. The old question, asked the old way, gets the wrong answer. This is
    //    the failing half of the proof and it must keep failing.
    check(!answersProjectsWithin(port: slowPort, timeout: 1.5),
          "the OLD gate (GET /api/projects, 1.5s) does not answer -- 'port is free'")
    // 2. The new question gets the right one.
    let liveOccupant = lookUpOccupant(port: slowPort)
    if case .identified(let id) = liveOccupant {
        check(samePath(id.dataRoot, otherLibrary),
              "asked directly, it names its library: \(id.dataRoot) (pid \(id.pid))")
    } else {
        check(false, "slow occupant was read as \(liveOccupant), not identified")
    }
    // 3. And the decision that follows protects the library.
    let liveAction = decideLaunch(occupant: liveOccupant, expectedDataRoot: sandbox,
                                  buildMatches: true, listenerIsOurOrphan: false,
                                  port: slowPort)
    if case .refuse = liveAction {
        check(true, "refused to start against a slow stranger's server")
    } else {
        check(false, "expected refuse, got \(liveAction)")
    }
    check(occupantProc.isRunning, "the slow occupant is still running -- nothing was killed")
    occupantProc.terminate()

    print("\n== N5 live: a port whose last server was stopped CLEANLY is free ==")
    // Found by running the reproduction rather than by reading: a graceful
    // shutdown leaves the connections that server had accepted in TIME_WAIT on
    // its own port for up to 30 seconds. `lsof -sTCP:LISTEN` correctly reports
    // nobody; a bind WITHOUT SO_REUSEADDR is refused anyway. So the first cut
    // of this check called the port occupied, refused to launch, and could
    // name no pid at all -- on the commonest path there is: quit SnipAi, open
    // it again. libuv sets SO_REUSEADDR on every bind, so our own server would
    // have started fine; the check has to ask the question the same way.
    if let twPort = findFreePort(),
       let gentle = startFakeOccupant(script: script, port: twPort, dataRoot: "/tmp/x",
                                      projectsDelayMS: 0, withHealth: true) {
        // A real client connection, so there is something to leave behind.
        _ = fetchServerIdentity(port: twPort, timeout: 3)
        gentle.terminate()                    // SIGTERM: the graceful stop
        gentle.waitUntilExit()
        Thread.sleep(forTimeInterval: 0.4)

        let waiting = timeWaitCount(port: twPort)
        check(waiting > 0,
              "the case is armed: \(waiting) socket(s) in TIME_WAIT on port \(twPort)")
        check(listeningPIDs(port: twPort).isEmpty, "nothing is listening on it any more")
        check(!portIsOccupied(twPort),
              "a port with only TIME_WAIT sockets left on it reads as FREE")
        check(lookUpOccupant(port: twPort) == .free,
              "so relaunching straight after a clean quit starts a server, not a refusal")
    } else {
        check(false, "could not set up the TIME_WAIT case")
    }

    print("\n== N5 live: something on the port that will not speak at all ==")
    if let silentPort = findFreePort(), let holder = holdPort(silentPort) {
        check(lookUpOccupant(port: silentPort) == .unidentified,
              "a non-HTTP program holding the port is unidentified, not free (N5: this " +
              "case could not be reached at all before)")
        let silentAction = decideLaunch(occupant: .unidentified, expectedDataRoot: sandbox,
                                        buildMatches: false, listenerIsOurOrphan: false,
                                        port: silentPort)
        if case .refuse = silentAction {
            check(true, "refuses instead of starting a server that would fail EADDRINUSE")
        } else {
            check(false, "expected refuse, got \(silentAction)")
        }
        _ = Darwin.close(holder)
    } else {
        check(false, "no free port for the silent-holder case")
    }

    print("\n== ownership: only a server that says it is ours ==")
    // The command-line test this replaces could never match in the packaged
    // app: the bundled server re-titles itself to `next-server (v14.2.35)`,
    // which is also exactly what `next dev` reports. Verified against the
    // shipped bundle. Ownership is now what the server says about itself.
    let ourPath = "/Applications/SnipAi.app/Contents/Resources/server/server.js"
    let ourToken = "TOKEN-THIS-RUN"
    let held: [Int32] = [4242]

    func ours(_ id: ServerIdentity?, path: String = ourPath, token: String = ourToken) -> [Int32] {
        ourListeningPIDs(port: 4737, identity: id, ourServerPath: path,
                         ourLaunchToken: token, listening: held)
    }
    func server(pid: Int32 = 4242, serverPath: String = "", launchToken: String = "")
        -> ServerIdentity {
        ServerIdentity(dataRoot: real, codeRoot: "/x/code", pid: pid,
                       serverPath: serverPath, launchToken: launchToken)
    }

    check(ours(server(launchToken: ourToken)) == [4242],
          "carries THIS run's token -> ours")
    check(ours(server(serverPath: ourPath)) == [4242],
          "launched from our own bundled server file -> our orphan")
    check(ours(server()) == [],
          "a server that claims neither -> not ours")
    check(ours(server(launchToken: "SOMEBODY-ELSES-TOKEN")) == [],
          "another run's token -> not ours")
    check(ours(nil) == [],
          "silence is not ownership -- an unidentified listener is never signalled")
    check(ours(server(pid: 9999, launchToken: ourToken)) == [],
          "right token, but not the pid holding the port -> nothing signalled")
    // P19, restated at the new mechanism: a dev checkout has no bundled server
    // path, so a person's `npm run dev` in the same checkout can never be ours.
    check(ours(server(serverPath: "/Users/k/Projects/SnipAi/node_modules/.bin/next"),
               path: "", token: "") == [],
          "P19: dev checkout owns nothing -- somebody's `npm run dev` is never ours")
    check(ours(server(serverPath: ourPath), path: "", token: "") == [],
          "a bundled server, seen from a dev checkout -> still not ours to stop")
    // The token is only ever OUR token; an empty one must not match an empty
    // one, or every server a person started would be ours.
    check(ours(server(launchToken: ""), path: "", token: "") == [],
          "empty token never matches empty token")

    print("\n== ownership composes: no identity, no restart ==")
    // decideLaunch still takes `listenerIsOurOrphan` as a free parameter and
    // its table is unchanged -- but the LOOKUP can no longer hand it `true`
    // without an identity, so the `.unidentified -> restartOrphan` row is now
    // unreachable in the app. Asserted rather than claimed in a comment.
    if let silent = findFreePort() {
        let holder = socket(AF_INET, SOCK_STREAM, 0)
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = UInt16(truncatingIfNeeded: silent).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        _ = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(holder, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        _ = listen(holder, 1)
        check(!listenerIsOurOrphan(port: silent, identity: nil,
                                   ourServerPath: ourPath, ourLaunchToken: ourToken),
              "a real listener that answers nothing is not our orphan")
        _ = Darwin.close(holder)
    } else {
        check(false, "no free port for the composition check")
    }

    print("\n== N12: a server may only nominate ITSELF ==")
    // The defect this replaces: ownership asked "is the pid it named holding
    // the port?" and never "is the pid it named the thing that answered?".
    // Those differ the moment TWO processes hold the port -- which is ordinary,
    // because 127.0.0.1 and ::1 are different addresses and a process may have
    // either without the other.
    //
    // Deterministic half first: the count rule, with the listener set injected.
    let bothFamilies: [Int32] = [4242, 5555]
    func oursAmong(_ id: ServerIdentity?, _ held: [Int32]) -> [Int32] {
        ourListeningPIDs(port: 4737, identity: id, ourServerPath: ourPath,
                         ourLaunchToken: ourToken, listening: held)
    }
    check(oursAmong(server(launchToken: ourToken), bothFamilies) == [],
          "a second listener on the port -> nothing is ours to signal, token or no token")
    check(oursAmong(server(serverPath: ourPath), bothFamilies) == [],
          "N12 exactly: right serverPath, but a stranger is alongside -> signal nobody")
    check(oursAmong(server(pid: 5555, launchToken: ourToken), bothFamilies) == [],
          "naming the OTHER listener's pid is never ownership")
    check(oursAmong(server(launchToken: ourToken), [4242]) == [4242],
          "sole listener, our token -> still ours (the fix does not disown us)")
    // And the three call sites must now agree. listenerIsOurOrphan used to be
    // the only one carrying this rule; the quit path and restartOrphan called
    // ourListeningPIDs raw and skipped it.
    check(ourListeningPIDs(port: 4737, identity: server(serverPath: ourPath),
                           ourServerPath: ourPath, ourLaunchToken: ourToken,
                           listening: bothFamilies).isEmpty,
          "the QUIT path's call answers the same as the launch path's")

    print("\n== N12: the live dual-stack reproduction ==")
    // One port, two processes, two address families. The bystander is not
    // SnipAi and says nothing; the impostor holds the address we probe and
    // hands us the bystander's pid. Before the fix this printed
    // "Stopping our own server, pid <bystander>" and SIGTERMed it.
    if let script = fakeOccupantScript(), let port = findFreePort() {
        let bystander = startFakeOccupant(script: script, port: port,
                                          dataRoot: "/tmp/not-snipai-at-all",
                                          projectsDelayMS: 0, withHealth: false,
                                          host: "::1")
        if let bys = bystander {
            let bysPID = bys.processIdentifier
            let impostor = startFakeOccupant(script: script, port: port,
                                             dataRoot: real,
                                             projectsDelayMS: 0, withHealth: true,
                                             host: "127.0.0.1",
                                             claimPID: bysPID,
                                             serverPath: ourPath)
            if let imp = impostor {
                let impPID = imp.processIdentifier
                let held = listeningPIDs(port: port)
                // The precondition IS the finding. If two processes cannot
                // share the port on this machine there is nothing to prove
                // here, and that must be visible rather than pass quietly.
                check(held.contains(bysPID) && held.contains(impPID),
                      "two processes hold port \(port) at once: \(held) " +
                      "(bystander \(bysPID) on ::1, impostor \(impPID) on 127.0.0.1)")
                let id = fetchServerIdentity(port: port, timeout: 4.0)
                check(id?.pid == bysPID,
                      "the probe reached the IPv4 impostor, which named the bystander's pid")
                check(id?.serverPath == ourPath,
                      "and stated our bundle's real server path -- which is not a secret")

                let signalled = ourListeningPIDs(port: port, identity: id,
                                                 ourServerPath: ourPath,
                                                 ourLaunchToken: ourToken)
                check(signalled.isEmpty,
                      "NOTHING is signalled -- would have been [\(bysPID)] before the fix")
                check(!signalled.contains(bysPID),
                      "the bystander, which never claimed anything, is not signalled")
                check(!listenerIsOurOrphan(port: port, identity: id,
                                           ourServerPath: ourPath, ourLaunchToken: ourToken),
                      "and the launch path still refuses it too -- all three call sites agree")
                check(kill(bysPID, 0) == 0, "bystander pid \(bysPID) is still alive")
                check(kill(impPID, 0) == 0, "impostor pid \(impPID) is still alive")
                imp.terminate()
            } else {
                check(false, "could not start the IPv4 impostor on \(port)")
            }
            bys.terminate()
        } else {
            check(false, "could not start the IPv6 bystander on \(port)")
        }
    } else {
        check(false, "no fake-occupant script or no free port for the N12 reproduction")
    }

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
                                      port: port, identity: id,
                                      ourServerPath: "/nonexistent/bundled/server.js",
                                      ourLaunchToken: "not-the-token-it-carries"),
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

import Foundation

// Who owns the server on the port -- ledger N1 and P19.
//
// Both rows are the same wrong assumption seen from opposite sides:
//
//   N1  the app ADOPTS whatever is listening on 4737, checking only that the
//       BUILD matches. Launch with SNIPAI_DATA pointed at a sandbox while a
//       server for ~/Movies/SnipAi holds the port and the app serves, and
//       edits, the real library while reporting nothing. This happened on
//       2026-09-10.
//
//   P19 the app KILLS whatever is listening on 4737 when the build does not
//       match, whoever started it. Run `npm run dev`, edit a file, open
//       SnipAi.app, and your dev server dies mid-session.
//
// They pull in opposite directions only if you keep believing the port
// identifies the server. It does not. The rule that settles both:
//
//     the app may start and stop only a server it owns, it may use a server
//     it can identify as serving the right library, and it must say out loud
//     what it found -- never act on the port alone, and never silently.
//
// This file is separate from main.swift so the decision can be exercised
// without a window: it is Foundation only, no AppKit, and decide() is a pure
// function of what was found. See tests/native/launch-decision-probe.swift.

// MARK: - What is on the port

struct ServerIdentity: Equatable {
    let dataRoot: String
    let codeRoot: String
    let pid: Int32
}

enum PortOccupant: Equatable {
    /// Nothing is serving the app on this port.
    case free
    /// A server that answers /api/health and says which library it serves.
    case identified(ServerIdentity)
    /// Something is serving the app but will not say who it is -- a build
    /// older than /api/health, or another program entirely.
    case unidentified
}

enum LaunchAction: Equatable {
    /// Nothing in the way: spawn our own and own its lifetime.
    case startOurOwn
    /// Use what is there. Never kill it -- we did not start it.
    case adopt(String)
    /// A server we ourselves left behind, in the way. Stop it, start again.
    case restartOrphan(String)
    /// Somebody else's server, or one we cannot identify. Do not adopt it and
    /// do not kill it: stop, and say what is there.
    case refuse(String)
}

// MARK: - Path comparison

/// Do two strings name the same directory?
///
/// The two sides normalise differently and must still agree: lib/paths.ts
/// does `path.resolve(SNIPAI_DATA)`, which flattens `..` but does NOT follow
/// symlinks, while Foundation's `standardizingPath` follows them for some
/// prefixes (/var -> /private/var is the one that bites on macOS, and it is
/// exactly where a sandbox library gets created). A false "these differ"
/// would refuse to launch against the app's own library, and a safety check
/// that cries wolf is one somebody switches off. So: equal if either
/// normalisation agrees.
func samePath(_ a: String, _ b: String) -> Bool {
    if a == b { return true }
    let sa = (a as NSString).standardizingPath
    let sb = (b as NSString).standardizingPath
    if sa == sb { return true }
    return (sa as NSString).resolvingSymlinksInPath == (sb as NSString).resolvingSymlinksInPath
}

// MARK: - The decision

/// Pure: everything it needs has already been looked up.
///
/// - Parameters:
///   - occupant: what answered on the port.
///   - expectedDataRoot: the library THIS launch was asked for.
///   - buildMatches: is the running server serving the build on disk?
///   - listenerIsOurOrphan: is the listening process a bundled server this
///     app started and lost -- as opposed to a person's `npm run dev`?
func decideLaunch(occupant: PortOccupant,
                  expectedDataRoot: String,
                  buildMatches: Bool,
                  listenerIsOurOrphan: Bool,
                  port: Int) -> LaunchAction {
    switch occupant {

    case .free:
        return .startOurOwn

    // Cannot be identified. Before /api/health existed every server looked
    // like this, so our own leftovers land here too -- hence the orphan check
    // rather than a flat refusal.
    case .unidentified:
        if listenerIsOurOrphan {
            return .restartOrphan(
                "A SnipAi server from an earlier run is still on port \(port) " +
                "and is too old to identify itself. Restarting it.")
        }
        return .refuse(
            "Something is already using port \(port) and it is not a SnipAi " +
            "server this app can identify. SnipAi has not started a server " +
            "and has not stopped that one. Quit whatever is on port \(port) " +
            "and open SnipAi again.")

    case .identified(let id):
        // THE check the old code never made. The build is not the dangerous
        // difference; the library is.
        if !samePath(id.dataRoot, expectedDataRoot) {
            if listenerIsOurOrphan {
                return .restartOrphan(
                    "A SnipAi server from an earlier run is on port \(port) " +
                    "serving \(id.dataRoot), but this launch was asked for " +
                    "\(expectedDataRoot). Restarting it against the right library.")
            }
            return .refuse(
                "Port \(port) is already serving a different SnipAi library.\n" +
                "  on the port: \(id.dataRoot)  (pid \(id.pid))\n" +
                "  asked for:   \(expectedDataRoot)\n" +
                "SnipAi has not started a server and has not stopped that one. " +
                "Using it would edit the wrong footage.")
        }

        if buildMatches {
            return .adopt(
                "Using the SnipAi server already running on port \(port) " +
                "(pid \(id.pid), library \(id.dataRoot)).")
        }

        // Right library, older build. Worth restarting -- "the changes did
        // not apply" is what this check was built for -- but only if the
        // server is ours. Somebody else's dev server serving the same library
        // is theirs to restart, so we say so and use it rather than pull it
        // out from under them. This is P19: the old code killed it.
        if listenerIsOurOrphan {
            return .restartOrphan(
                "A SnipAi server from an earlier run is on port \(port) " +
                "serving an older build. Restarting it.")
        }
        return .adopt(
            "Using the server already on port \(port) (pid \(id.pid)). It is " +
            "serving an older build than the one on disk, and SnipAi did not " +
            "start it, so it has been left alone -- restart it yourself if " +
            "the app looks out of date.")
    }
}

// MARK: - Looking those things up

/// Ask the server on the port who it is.
///
/// nil means "did not answer /api/health" -- which is not the same as "no
/// server": an older build serves the app perfectly well and has no such
/// route. The caller distinguishes those two with its own health check.
func fetchServerIdentity(port: Int, timeout: TimeInterval = 2.0) -> ServerIdentity? {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return nil }
    var request = URLRequest(url: url)
    request.timeoutInterval = timeout
    request.cachePolicy = .reloadIgnoringLocalCacheData

    var identity: ServerIdentity?
    let sem = DispatchSemaphore(value: 0)
    let task = URLSession.shared.dataTask(with: request) { data, response, _ in
        defer { sem.signal() }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let data = data,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataRoot = obj["dataRoot"] as? String, !dataRoot.isEmpty
        else { return }
        let codeRoot = obj["codeRoot"] as? String ?? ""
        let pid = (obj["pid"] as? NSNumber)?.int32Value ?? -1
        identity = ServerIdentity(dataRoot: dataRoot, codeRoot: codeRoot, pid: pid)
    }
    task.resume()
    _ = sem.wait(timeout: .now() + timeout + 0.5)
    return identity
}

/// Run a command and hand back its stdout. Foundation's Process directly --
/// no login shell, because nothing here needs the user's PATH and a shell
/// would only add a way for this to do more than it says.
private func capture(_ launchPath: String, _ args: [String]) -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: launchPath)
    p.arguments = args
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return "" }
    let out = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(data: out, encoding: .utf8) ?? ""
}

/// The pids actually LISTENING on the port -- never a client that merely has
/// a connection to it.
func listeningPIDs(port: Int) -> [Int32] {
    return capture("/usr/sbin/lsof", ["-ti:\(port)", "-sTCP:LISTEN"])
        .split(whereSeparator: { $0 == "\n" || $0 == " " })
        .compactMap { Int32($0) }
}

/// The full command line of a pid, for deciding whether it is ours.
func commandLine(ofPID pid: Int32) -> String {
    return capture("/bin/ps", ["-o", "command=", "-p", "\(pid)"])
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

/// The listening pids that are running OUR bundled server -- the ones this
/// app is entitled to stop.
///
/// The test is the server path we would launch ourselves appearing in the
/// listener's own command line. `npm run dev` and `next dev` never match it;
/// a bundled server we spawned and lost -- because the wrapper was force
/// quit, so applicationWillTerminate never ran -- always does.
///
/// A blank serverPath (a dev checkout, which spawns through npm and has no
/// bundled server of its own) means we own nothing: answer nothing, so the
/// app falls through to refusing rather than to killing.
func ourOrphanPIDs(port: Int, ourServerPath: String) -> [Int32] {
    guard !ourServerPath.isEmpty else { return [] }
    return listeningPIDs(port: port).filter {
        commandLine(ofPID: $0).contains(ourServerPath)
    }
}

/// Is everything holding the port a server THIS bundle started?
///
/// `allSatisfy`, not `contains`: if even one listener is a stranger's, this
/// is not ours to restart. An empty list is not ownership either, which is
/// why the count is checked first -- `allSatisfy` on an empty array is true.
func listenerIsOurOrphan(port: Int, ourServerPath: String) -> Bool {
    let listening = listeningPIDs(port: port)
    guard !listening.isEmpty else { return false }
    return ourOrphanPIDs(port: port, ourServerPath: ourServerPath).count == listening.count
}

// MARK: - Which library this launch was asked for

/// The data root the SERVER would resolve, computed the same way it does.
///
/// This mirrors `resolveDataRoot()` in lib/paths.ts exactly, and the two must
/// not drift: SNIPAI_DATA wins; otherwise the standard library location if
/// the migration has run; otherwise the old in-repo layout. If this function
/// and that one ever disagree, the app refuses to launch against its own
/// library, so the ordering of these three branches is load-bearing.
func expectedDataRoot(codeRoot: String,
                      environment: [String: String] = ProcessInfo.processInfo.environment,
                      fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
) -> String {
    if let env = environment["SNIPAI_DATA"]?.trimmingCharacters(in: .whitespaces), !env.isEmpty {
        // path.resolve() on the other side: absolute, `..` flattened.
        return (((env as NSString).expandingTildeInPath) as NSString).standardizingPath
    }
    let standard = (("~/Movies/SnipAi") as NSString).expandingTildeInPath
    if fileExists(standard + "/projects") { return standard }
    return codeRoot
}
